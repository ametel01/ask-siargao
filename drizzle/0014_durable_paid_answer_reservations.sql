-- Paid Answer Reservations are durable product-data state. Rollback keeps this additive table and
-- rolls application code forward; never drop open reservations while paid generation may exist.

CREATE TABLE IF NOT EXISTS paid_answer_reservations (
  id text PRIMARY KEY,
  trip_pass_id text NOT NULL REFERENCES trip_passes(id),
  usage_meter_id text NOT NULL REFERENCES trip_usage_meters(id),
  account_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key_hash text NOT NULL,
  request_body_hash text NOT NULL,
  request_id text NOT NULL,
  lease_token text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  release_reason text,
  invalidation_reason text,
  answer_message_id text REFERENCES chat_messages(id) ON DELETE SET NULL,
  result_json jsonb,
  provider_request_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  lease_expires_at timestamptz NOT NULL,
  details_purge_at timestamptz NOT NULL,
  details_purged_at timestamptz,
  purge_attempted_at timestamptz,
  purge_retry_at timestamptz,
  purge_failure_count integer NOT NULL DEFAULT 0,
  purge_last_error text,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  released_at timestamptz,
  invalidated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT paid_answer_reservations_status_check CHECK (
    status IN ('open', 'settled', 'released', 'invalidated')
  ),
  CONSTRAINT paid_answer_reservations_release_reason_check CHECK (
    release_reason IS NULL OR release_reason IN (
      'provider_failure',
      'internal_failure',
      'empty_output',
      'safety_refusal',
      'stale_lease',
      'redis_unavailable',
      'operational_limit',
      'database_unavailable',
      'pass_expired'
    )
  ),
  CONSTRAINT paid_answer_reservations_invalidation_reason_check CHECK (
    invalidation_reason IS NULL OR invalidation_reason IN (
      'account_closed',
      'full_refund',
      'dispute_lost'
    )
  ),
  CONSTRAINT paid_answer_reservations_lease_order_check CHECK (
    reserved_at < lease_expires_at
  ),
  CONSTRAINT paid_answer_reservations_purge_order_check CHECK (
    reserved_at < details_purge_at
  ),
  CONSTRAINT paid_answer_reservations_purge_failure_count_check CHECK (
    purge_failure_count BETWEEN 0 AND 31
  ),
  CONSTRAINT paid_answer_reservations_purge_last_error_check CHECK (
    purge_last_error IS NULL OR purge_last_error IN ('usage_event_integrity', 'purge_failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS paid_answer_reservations_account_idempotency_idx
  ON paid_answer_reservations(account_id, idempotency_key_hash);

CREATE INDEX IF NOT EXISTS paid_answer_reservations_trip_pass_id_idx
  ON paid_answer_reservations(trip_pass_id);

CREATE INDEX IF NOT EXISTS paid_answer_reservations_usage_meter_id_idx
  ON paid_answer_reservations(usage_meter_id);

CREATE INDEX IF NOT EXISTS paid_answer_reservations_answer_message_id_idx
  ON paid_answer_reservations(answer_message_id)
  WHERE answer_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS paid_answer_reservations_open_pass_idx
  ON paid_answer_reservations(trip_pass_id, usage_meter_id, lease_expires_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS paid_answer_reservations_details_purge_idx
  ON paid_answer_reservations(
    (coalesce(purge_retry_at, details_purge_at)), account_id, details_purge_at, id
  )
  WHERE details_purged_at IS NULL;

DROP TRIGGER IF EXISTS paid_answer_reservations_open_account_write
  ON paid_answer_reservations;
CREATE TRIGGER paid_answer_reservations_open_account_write
BEFORE INSERT OR UPDATE ON paid_answer_reservations
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_trip_pass_child_write();
