ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS checkout_return_lookup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_return_lookup_claimed_at timestamptz;

ALTER TABLE trip_pass_orders
  DROP CONSTRAINT IF EXISTS trip_pass_orders_checkout_return_lookup_attempts_check;

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_checkout_return_lookup_attempts_check
  CHECK (checkout_return_lookup_attempts >= 0);
