-- #153 adds durable retry scheduling after 0014 was published. Keep 0014 immutable so databases
-- that recorded its original checksum can advance through this additive migration.

ALTER TABLE paid_answer_reservations
  ADD COLUMN purge_attempted_at timestamptz,
  ADD COLUMN purge_retry_at timestamptz,
  ADD COLUMN purge_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN purge_last_error text;

ALTER TABLE paid_answer_reservations
  ADD CONSTRAINT paid_answer_reservations_purge_failure_count_check
    CHECK (purge_failure_count BETWEEN 0 AND 31) NOT VALID,
  ADD CONSTRAINT paid_answer_reservations_purge_last_error_check
    CHECK (
      purge_last_error IS NULL OR purge_last_error IN ('usage_event_integrity', 'purge_failed')
    ) NOT VALID;

ALTER TABLE paid_answer_reservations
  VALIDATE CONSTRAINT paid_answer_reservations_purge_failure_count_check;
ALTER TABLE paid_answer_reservations
  VALIDATE CONSTRAINT paid_answer_reservations_purge_last_error_check;

DROP INDEX paid_answer_reservations_details_purge_idx;
CREATE INDEX paid_answer_reservations_details_purge_idx
  ON paid_answer_reservations(
    (coalesce(purge_retry_at, details_purge_at)), account_id, details_purge_at, id
  )
  WHERE details_purged_at IS NULL;
