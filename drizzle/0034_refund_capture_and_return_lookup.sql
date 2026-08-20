ALTER TABLE trip_pass_refund_operations
  ADD COLUMN IF NOT EXISTS provider_captured_amount_minor integer;

ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS checkout_return_lookup_status text NOT NULL DEFAULT 'pending';

ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS checkout_return_lookup_completed_at timestamptz;

ALTER TABLE trip_pass_orders
  DROP CONSTRAINT IF EXISTS trip_pass_orders_checkout_return_lookup_status_check;

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_checkout_return_lookup_status_check CHECK (
    checkout_return_lookup_status IN ('pending', 'succeeded', 'not_found', 'exhausted')
  );

ALTER TABLE trip_pass_refund_operations
  DROP CONSTRAINT IF EXISTS trip_pass_refund_operations_reason_check;

ALTER TABLE trip_pass_refund_operations
  ADD CONSTRAINT trip_pass_refund_operations_reason_check CHECK (
    reason IN ('duplicate_payment', 'paid_after_closure', 'partial_refund_deadline', 'operator_refund')
  );
