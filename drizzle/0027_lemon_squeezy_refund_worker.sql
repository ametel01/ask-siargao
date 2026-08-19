-- Give Lemon Squeezy refund operations the same fenced lease semantics as the
-- other durable operational work, and route them through the worker.

ALTER TABLE trip_pass_refund_operations
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE trip_pass_refund_operations
  DROP CONSTRAINT IF EXISTS trip_pass_refund_operations_lease_check;

ALTER TABLE trip_pass_refund_operations
  ADD CONSTRAINT trip_pass_refund_operations_lease_check CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

ALTER TABLE operational_worker_tasks
  DROP CONSTRAINT IF EXISTS operational_worker_tasks_type_check;

ALTER TABLE operational_worker_tasks
  ADD CONSTRAINT operational_worker_tasks_type_check CHECK (
    task_type IN (
      'account_closure',
      'pending_payment_event',
      'pending_stripe_event',
      'paid_after_closure_refund',
      'lemon_squeezy_refund',
      'retention_purge',
      'commerce_reconciliation'
    )
  );

CREATE INDEX IF NOT EXISTS trip_pass_refund_operations_due_idx
  ON trip_pass_refund_operations(status, next_attempt_at, lease_expires_at, id);
