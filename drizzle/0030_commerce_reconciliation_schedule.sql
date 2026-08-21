-- Run provider-neutral reconciliation every five minutes and page after two missed cycles.

ALTER TABLE operational_schedule_states
  DROP CONSTRAINT IF EXISTS operational_schedule_states_key_check;

ALTER TABLE operational_schedule_states
  ADD CONSTRAINT operational_schedule_states_key_check CHECK (
    schedule_key IN ('weather', 'marine', 'places_prune', 'commerce_reconciliation')
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
