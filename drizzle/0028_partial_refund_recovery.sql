-- Persist the review deadline and remaining amount for Lemon Squeezy partial
-- refunds so recovery is durable and cannot silently leave access active.

ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS refund_remaining_amount_minor integer,
  ADD COLUMN IF NOT EXISTS refund_review_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_review_alerted_at timestamptz;

ALTER TABLE trip_pass_orders
  DROP CONSTRAINT IF EXISTS trip_pass_orders_refund_remaining_amount_check;

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_refund_remaining_amount_check CHECK (
    refund_remaining_amount_minor IS NULL OR refund_remaining_amount_minor >= 0
  );
