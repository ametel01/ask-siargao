-- Route provider-neutral Lemon Squeezy payment receipts through the durable operational worker.
-- Existing task rows remain valid; this only widens the task-type constraint.

ALTER TABLE operational_worker_tasks
  DROP CONSTRAINT IF EXISTS operational_worker_tasks_type_check;

ALTER TABLE operational_worker_tasks
  ADD CONSTRAINT operational_worker_tasks_type_check CHECK (
    task_type IN (
      'account_closure',
      'pending_payment_event',
      'pending_stripe_event',
      'paid_after_closure_refund',
      'retention_purge',
      'commerce_reconciliation'
    )
  );
