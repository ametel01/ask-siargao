-- #151 expands the opaque terminal state introduced in 0009. This migration is
-- intentionally numbered after the reserved #148/#149 slices. It has no
-- dependency on their columns so it remains safe while those branches merge.

ALTER TABLE account_closure_operations
  ADD COLUMN IF NOT EXISTS phase_one_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_policy_version text,
  ADD COLUMN IF NOT EXISTS commerce_policy_version text,
  ADD COLUMN IF NOT EXISTS alert_after_attempts integer NOT NULL DEFAULT 3;

ALTER TABLE account_closure_operations
  ADD CONSTRAINT account_closure_operations_alert_after_attempts_check
    CHECK (alert_after_attempts > 0);

CREATE TABLE IF NOT EXISTS account_closure_steps (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES account_closure_operations(id) ON DELETE CASCADE,
  step_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  lease_token text,
  lease_expires_at timestamptz,
  last_error_category text,
  alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT account_closure_steps_operation_step_key UNIQUE (operation_id, step_type),
  CONSTRAINT account_closure_steps_type_check CHECK (
    step_type IN (
      'clerk_deletion',
      'checkout_expiry',
      'local_erasure',
      'commerce_minimization',
      'identity_erasure'
    )
  ),
  CONSTRAINT account_closure_steps_status_check CHECK (
    status IN ('pending', 'running', 'succeeded')
  ),
  CONSTRAINT account_closure_steps_attempts_check CHECK (attempts >= 0),
  CONSTRAINT account_closure_steps_lease_check CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT account_closure_steps_completed_check CHECK (
    (status = 'succeeded' AND completed_at IS NOT NULL)
    OR (status <> 'succeeded' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS account_closure_steps_due_idx
  ON account_closure_steps(status, next_attempt_at, lease_expires_at, id);

-- Do not manufacture runnable steps for 0009 operations here: the old schema
-- deliberately retained no reversible Clerk subject. A repeated signed request
-- or Clerk deletion webhook supplies that subject and atomically upgrades the
-- operation before workers can claim it.
UPDATE account_closure_operations
SET
  phase_one_committed_at = COALESCE(phase_one_committed_at, created_at),
  alert_after_attempts = GREATEST(alert_after_attempts, 1),
  status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END
WHERE phase_one_committed_at IS NULL OR status = 'failed';

-- This is transient, retry-owned encrypted provider state. It is removed as
-- soon as Clerk deletion and final identity erasure succeed. Key material is
-- server-only and is never stored beside the ciphertext.
CREATE TABLE IF NOT EXISTS account_closure_provider_subjects (
  operation_id text PRIMARY KEY REFERENCES account_closure_operations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_closure_provider_subjects_key_version_check CHECK (key_version > 0)
);

CREATE TABLE IF NOT EXISTS account_closure_checkout_sessions (
  operation_id text NOT NULL REFERENCES account_closure_operations(id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_error_category text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, stripe_checkout_session_id),
  CONSTRAINT account_closure_checkout_sessions_status_check CHECK (
    status IN ('pending', 'succeeded')
  )
);

CREATE TABLE IF NOT EXISTS retained_commerce_evidence (
  id text PRIMARY KEY,
  tombstone_id text NOT NULL REFERENCES account_closure_tombstones(id),
  source_type text NOT NULL,
  source_ref text NOT NULL,
  amount_minor integer,
  currency text,
  product_code text,
  product_version integer,
  product_family text,
  lifecycle_status text NOT NULL,
  lifecycle_timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_event_id text,
  policy_version text NOT NULL,
  consent_policy_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  aggregate_service_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retained_commerce_evidence_source_key UNIQUE (source_type, source_ref),
  CONSTRAINT retained_commerce_evidence_source_type_check CHECK (
    source_type IN ('legacy_payment', 'legacy_payment_event', 'trip_pass_order', 'trip_pass')
  ),
  CONSTRAINT retained_commerce_evidence_amount_check CHECK (
    amount_minor IS NULL OR amount_minor >= 0
  ),
  CONSTRAINT retained_commerce_evidence_currency_check CHECK (
    currency IS NULL OR currency ~ '^[a-z]{3}$'
  ),
  CONSTRAINT retained_commerce_evidence_retention_check CHECK (
    retention_expires_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS retained_commerce_evidence_tombstone_idx
  ON retained_commerce_evidence(tombstone_id, retention_expires_at);

CREATE TABLE IF NOT EXISTS account_closure_refund_obligations (
  id text PRIMARY KEY,
  tombstone_id text NOT NULL REFERENCES account_closure_tombstones(id),
  order_id text NOT NULL,
  stripe_event_id text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  lease_token text,
  lease_expires_at timestamptz,
  last_error_category text,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT account_closure_refund_obligations_order_key UNIQUE (order_id),
  CONSTRAINT account_closure_refund_obligations_reason_check CHECK (
    reason = 'paid_after_closure'
  ),
  CONSTRAINT account_closure_refund_obligations_status_check CHECK (
    status IN ('pending', 'running', 'succeeded')
  ),
  CONSTRAINT account_closure_refund_obligations_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS account_closure_refund_obligations_due_idx
  ON account_closure_refund_obligations(status, next_attempt_at, lease_expires_at, id);

CREATE TABLE IF NOT EXISTS privacy_restore_guard_state (
  id text PRIMARY KEY,
  privacy_snapshot_version text NOT NULL,
  source_max_closed_at timestamptz NOT NULL,
  applied_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacy_restore_guard_state_singleton_check CHECK (id = 'current')
);

ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS closure_tombstone_id text REFERENCES account_closure_tombstones(id),
  ADD COLUMN IF NOT EXISTS closure_outcome text,
  ADD COLUMN IF NOT EXISTS closure_refund_obligation_id text
    REFERENCES account_closure_refund_obligations(id);

CREATE INDEX IF NOT EXISTS trip_pass_orders_closure_tombstone_id_idx
  ON trip_pass_orders(closure_tombstone_id);
CREATE INDEX IF NOT EXISTS trip_pass_orders_closure_refund_obligation_id_idx
  ON trip_pass_orders(closure_refund_obligation_id);

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_closure_outcome_check CHECK (
    closure_outcome IS NULL OR closure_outcome IN ('blocked_at_closure', 'paid_after_closure')
  );

ALTER TABLE trip_usage_events ALTER COLUMN idempotency_key DROP NOT NULL;
ALTER TABLE trip_usage_events ALTER COLUMN request_id DROP NOT NULL;

-- Every Account-owned mutation participates in one transaction-scoped Account
-- lock. A transaction that acquired the lock before closure either commits and
-- is erased/revoked by phase one, or closure commits first and this trigger
-- denies it. Cleanup deletes require the transaction-local token of the
-- currently running, unexpired cleanup step that owns the transaction.
CREATE OR REPLACE FUNCTION account_closure_cleanup_bypass_active()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_closure_steps s
    WHERE s.status = 'running'
      AND s.step_type IN ('local_erasure', 'commerce_minimization', 'identity_erasure')
      AND s.lease_token = current_setting('ask_siargao.account_closure_cleanup_lease', true)
      AND s.lease_expires_at > clock_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_owner(owner_id text, lock_trip_pass_family boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  owner_deleted_at timestamptz;
BEGIN
  IF owner_id IS NULL OR account_closure_cleanup_bypass_active() THEN
    RETURN;
  END IF;
  IF lock_trip_pass_family THEN
    PERFORM pg_advisory_xact_lock(hashtext(owner_id), hashtext('siargao_trip_pass'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ask-siargao-account-write'), hashtext(owner_id));
  SELECT deleted_at INTO owner_deleted_at FROM users WHERE id = owner_id;
  IF owner_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account is terminally closed' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_direct_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
  family_lock boolean;
BEGIN
  new_owner_id := to_jsonb(NEW)->>'user_id';
  IF TG_OP = 'UPDATE' THEN
    old_owner_id := to_jsonb(OLD)->>'user_id';
  END IF;
  family_lock := TG_TABLE_NAME IN ('trip_passes', 'trip_pass_orders', 'trip_pass_grants', 'trip_usage_events');
  PERFORM enforce_open_account_owner(old_owner_id, family_lock);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, family_lock);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_saved_trip_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
BEGIN
  SELECT user_id INTO new_owner_id FROM saved_trips WHERE id = NEW.trip_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT user_id INTO old_owner_id FROM saved_trips WHERE id = OLD.trip_id;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, false);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_chat_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
BEGIN
  new_owner_id := to_jsonb(NEW)->>'user_id';
  IF new_owner_id IS NULL THEN
    SELECT user_id INTO new_owner_id FROM chat_threads WHERE id = NEW.thread_id;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_owner_id := to_jsonb(OLD)->>'user_id';
    IF old_owner_id IS NULL THEN
      SELECT user_id INTO old_owner_id FROM chat_threads WHERE id = OLD.thread_id;
    END IF;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, false);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_audit_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
BEGIN
  SELECT user_id INTO new_owner_id FROM audit_requests WHERE id = NEW.audit_request_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT user_id INTO old_owner_id FROM audit_requests WHERE id = OLD.audit_request_id;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, false);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_audit_run_descendant_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
  old_audit_run_id text;
  old_llm_run_id text;
  new_audit_run_id text;
  new_llm_run_id text;
BEGIN
  new_audit_run_id := to_jsonb(NEW)->>'audit_run_id';
  new_llm_run_id := to_jsonb(NEW)->>'llm_run_id';
  IF new_audit_run_id IS NOT NULL THEN
    SELECT a.user_id INTO new_owner_id FROM audit_runs r
      JOIN audit_requests a ON a.id = r.audit_request_id
      WHERE r.id = new_audit_run_id;
  ELSIF new_llm_run_id IS NOT NULL THEN
    SELECT a.user_id INTO new_owner_id FROM llm_runs l
      JOIN audit_runs r ON r.id = l.audit_run_id
      JOIN audit_requests a ON a.id = r.audit_request_id
      WHERE l.id = new_llm_run_id;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_audit_run_id := to_jsonb(OLD)->>'audit_run_id';
    old_llm_run_id := to_jsonb(OLD)->>'llm_run_id';
    IF old_audit_run_id IS NOT NULL THEN
      SELECT a.user_id INTO old_owner_id FROM audit_runs r
        JOIN audit_requests a ON a.id = r.audit_request_id
        WHERE r.id = old_audit_run_id;
    ELSIF old_llm_run_id IS NOT NULL THEN
      SELECT a.user_id INTO old_owner_id FROM llm_runs l
        JOIN audit_runs r ON r.id = l.audit_run_id
        JOIN audit_requests a ON a.id = r.audit_request_id
        WHERE l.id = old_llm_run_id;
    END IF;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, false);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_open_account_trip_pass_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
BEGIN
  SELECT user_id INTO new_owner_id FROM trip_passes WHERE id = NEW.trip_pass_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT user_id INTO old_owner_id FROM trip_passes WHERE id = OLD.trip_pass_id;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, true);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, true);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_profiles', 'saved_trips', 'chat_threads', 'audit_requests', 'trip_passes', 'trip_pass_orders',
    'trip_pass_grants', 'trip_usage_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_open_account_write', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_open_account_direct_write()',
      table_name || '_open_account_write',
      table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['chat_messages', 'chat_response_ratings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_open_account_write', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_open_account_chat_child_write()',
      table_name || '_open_account_write', table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_inputs', 'audit_runs', 'audit_completeness_checks',
    'payments', 'payment_events', 'audit_reports'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_open_account_write', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_open_account_audit_child_write()',
      table_name || '_open_account_write', table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['llm_runs', 'llm_tool_calls', 'reviewer_results']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_open_account_write', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_open_account_audit_run_descendant_write()',
      table_name || '_open_account_write', table_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS saved_trip_items_open_account_write ON saved_trip_items;
CREATE TRIGGER saved_trip_items_open_account_write
BEFORE INSERT OR UPDATE ON saved_trip_items
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_saved_trip_child_write();

DROP TRIGGER IF EXISTS shared_trip_plans_open_account_write ON shared_trip_plans;
CREATE TRIGGER shared_trip_plans_open_account_write
BEFORE INSERT OR UPDATE ON shared_trip_plans
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_saved_trip_child_write();

DROP TRIGGER IF EXISTS trip_usage_meters_open_account_write ON trip_usage_meters;
CREATE TRIGGER trip_usage_meters_open_account_write
BEFORE INSERT OR UPDATE ON trip_usage_meters
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_trip_pass_child_write();
