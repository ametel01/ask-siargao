ALTER TABLE trip_pass_checkout_attempts
  DROP CONSTRAINT IF EXISTS trip_pass_checkout_attempts_idempotency_key_key;

CREATE INDEX IF NOT EXISTS trip_pass_checkout_attempts_idempotency_idx
  ON trip_pass_checkout_attempts(idempotency_key);
