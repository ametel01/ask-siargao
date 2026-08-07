-- Rolling deploy strategy: migrate first. The trigger below makes terminal
-- users rows non-resurrectable while previous-release app instances are still
-- running. Keep closure tombstones and write barriers in place during rollback;
-- roll application code forward and repair incompatible identity rows with a
-- later privacy-reviewed migration. Do not drop tombstones to roll back account
-- denial.

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE TABLE IF NOT EXISTS account_closure_tombstones (
  id text PRIMARY KEY,
  subject_hash text NOT NULL UNIQUE,
  subject_hash_version integer NOT NULL,
  subject_type text NOT NULL,
  closure_policy_version text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_closure_tombstones_subject_hash_version_check CHECK (
    subject_hash_version > 0
  ),
  CONSTRAINT account_closure_tombstones_subject_type_check CHECK (
    subject_type IN ('clerk_user_id')
  ),
  CONSTRAINT account_closure_tombstones_purge_after_check CHECK (
    purge_after IS NULL OR purge_after >= closed_at
  )
);

CREATE INDEX IF NOT EXISTS account_closure_tombstones_subject_idx
  ON account_closure_tombstones(subject_type, subject_hash_version, subject_hash);

CREATE INDEX IF NOT EXISTS account_closure_tombstones_purge_after_idx
  ON account_closure_tombstones(purge_after);

CREATE TABLE IF NOT EXISTS account_closure_operations (
  id text PRIMARY KEY,
  tombstone_id text NOT NULL REFERENCES account_closure_tombstones(id),
  operation_type text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT account_closure_operations_operation_type_check CHECK (
    operation_type IN ('traveler_requested_closure', 'clerk_deletion_identity_sync')
  ),
  CONSTRAINT account_closure_operations_status_check CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed')
  ),
  CONSTRAINT account_closure_operations_attempts_check CHECK (attempts >= 0),
  CONSTRAINT account_closure_operations_completed_at_check CHECK (
    completed_at IS NULL OR completed_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS account_closure_operations_tombstone_id_idx
  ON account_closure_operations(tombstone_id);

CREATE INDEX IF NOT EXISTS account_closure_operations_status_next_attempt_idx
  ON account_closure_operations(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS account_closure_write_barriers (
  id text PRIMARY KEY,
  tombstone_id text NOT NULL REFERENCES account_closure_tombstones(id),
  subject_hash text NOT NULL UNIQUE,
  subject_hash_version integer NOT NULL,
  subject_type text NOT NULL,
  status text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_closure_write_barriers_subject_hash_version_check CHECK (
    subject_hash_version > 0
  ),
  CONSTRAINT account_closure_write_barriers_subject_type_check CHECK (
    subject_type IN ('clerk_user_id')
  ),
  CONSTRAINT account_closure_write_barriers_status_check CHECK (
    status IN ('active', 'released')
  )
);

CREATE INDEX IF NOT EXISTS account_closure_write_barriers_tombstone_id_idx
  ON account_closure_write_barriers(tombstone_id);

CREATE INDEX IF NOT EXISTS account_closure_write_barriers_subject_idx
  ON account_closure_write_barriers(subject_type, subject_hash_version, subject_hash);

-- Existing terminal rows become the trigger's preserved baseline during a
-- rolling deploy, so clear readable identity and provider lifecycle caches first.
UPDATE users
SET
  email = NULL,
  first_name = NULL,
  last_name = NULL,
  image_url = NULL,
  clerk_updated_at = NULL,
  last_seen_at = NULL
WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_terminal_user_identity_resurrection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL
      OR NEW.email IS NOT NULL
      OR NEW.first_name IS NOT NULL
      OR NEW.last_name IS NOT NULL
      OR NEW.image_url IS NOT NULL
      OR NEW.clerk_updated_at IS NOT NULL
      OR NEW.last_seen_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'terminal user row cannot be resurrected'
        USING ERRCODE = '23514';
    END IF;

    NEW.email := NULL;
    NEW.first_name := NULL;
    NEW.last_name := NULL;
    NEW.image_url := NULL;
    NEW.clerk_updated_at := NULL;
    NEW.last_seen_at := NULL;
    NEW.deleted_at := OLD.deleted_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_prevent_terminal_identity_resurrection ON users;
CREATE TRIGGER users_prevent_terminal_identity_resurrection
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_user_identity_resurrection();
