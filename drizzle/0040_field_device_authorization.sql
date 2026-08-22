-- Authorization metadata only. Protected Field Data remains encrypted and local to Authorized
-- Field Devices; these tables must never receive field payloads, filenames, or human content.
CREATE TABLE field_authorized_devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('recorder', 'desk')),
  signing_public_key JSONB NOT NULL,
  signing_public_key_fingerprint TEXT NOT NULL UNIQUE
    CHECK (signing_public_key_fingerprint ~ '^[a-f0-9]{64}$'),
  agreement_public_key JSONB NOT NULL,
  agreement_public_key_fingerprint TEXT NOT NULL UNIQUE
    CHECK (agreement_public_key_fingerprint ~ '^[a-f0-9]{64}$'),
  webauthn_credential_id TEXT NOT NULL UNIQUE,
  webauthn_public_key JSONB NOT NULL,
  webauthn_backup_eligible BOOLEAN NOT NULL CHECK (webauthn_backup_eligible = false),
  webauthn_user_verified BOOLEAN NOT NULL CHECK (webauthn_user_verified = true),
  application_version TEXT NOT NULL,
  registration_version TEXT NOT NULL CHECK (registration_version = 'field-device-registration.v1'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE INDEX field_authorized_devices_account_status_idx
  ON field_authorized_devices (account_id, status, registered_at, id);

CREATE TABLE field_offline_grants (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES field_authorized_devices(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  grant_version TEXT NOT NULL CHECK (grant_version = 'offline-field-grant.v1'),
  signer_key_id TEXT NOT NULL,
  signature_fingerprint TEXT NOT NULL CHECK (signature_fingerprint ~ '^[a-f0-9]{64}$'),
  grant_claims JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '72 hours'),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked')
);

CREATE INDEX field_offline_grants_device_expiry_idx
  ON field_offline_grants (device_id, status, expires_at, id);
CREATE INDEX field_offline_grants_account_idx
  ON field_offline_grants (account_id, created_at, id);

CREATE TABLE field_device_audit_events (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES field_authorized_devices(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'device_registered', 'grant_issued', 'device_revoked', 'purge_authorized'
  )),
  outcome_code TEXT NOT NULL CHECK (outcome_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX field_device_audit_events_device_time_idx
  ON field_device_audit_events (device_id, occurred_at, id);
CREATE INDEX field_device_audit_events_account_time_idx
  ON field_device_audit_events (account_id, occurred_at, id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      field_authorized_devices, field_offline_grants, field_device_audit_events
      TO ask_siargao_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_migration') THEN
    ALTER TABLE field_authorized_devices OWNER TO ask_siargao_migration;
    ALTER TABLE field_offline_grants OWNER TO ask_siargao_migration;
    ALTER TABLE field_device_audit_events OWNER TO ask_siargao_migration;
  END IF;
END
$$;
