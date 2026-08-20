ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS checkout_return_provider_order_id text,
  ADD COLUMN IF NOT EXISTS checkout_return_provider_order_identifier text;

ALTER TABLE trip_pass_orders
  DROP CONSTRAINT IF EXISTS trip_pass_orders_checkout_return_provider_reference_check;

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_checkout_return_provider_reference_check CHECK (
    (checkout_return_provider_order_id IS NULL
      AND checkout_return_provider_order_identifier IS NULL)
    OR
    (checkout_return_provider_order_id IS NOT NULL
      AND checkout_return_provider_order_identifier IS NOT NULL)
  );

CREATE INDEX trip_pass_orders_checkout_return_lookup_due_idx
  ON trip_pass_orders(checkout_return_lookup_status, checkout_return_lookup_completed_at, id)
  WHERE checkout_return_lookup_attempts > 0 AND accepted_payment_fact_id IS NULL;

ALTER TABLE operational_worker_tasks
  DROP CONSTRAINT IF EXISTS operational_worker_tasks_type_check;

ALTER TABLE operational_worker_tasks
  ADD CONSTRAINT operational_worker_tasks_type_check CHECK (
    task_type IN (
      'account_closure',
      'checkout_return_lookup',
      'pending_payment_event',
      'pending_stripe_event',
      'paid_after_closure_refund',
      'lemon_squeezy_refund',
      'retention_purge',
      'commerce_reconciliation'
    )
  );
