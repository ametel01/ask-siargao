ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS checkout_commercial_terms_verified_at timestamptz;

ALTER TABLE trip_pass_orders
  DROP CONSTRAINT IF EXISTS trip_pass_orders_refund_state_check;
ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_refund_state_check
  CHECK (refund_state IN ('none', 'review', 'partial_final', 'full'));

ALTER TABLE trip_pass_refund_operations
  DROP CONSTRAINT IF EXISTS trip_pass_refund_operations_status_check;
ALTER TABLE trip_pass_refund_operations
  ADD CONSTRAINT trip_pass_refund_operations_status_check
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE operator_repair_actions
  DROP CONSTRAINT IF EXISTS operator_repair_actions_action_check;
ALTER TABLE operator_repair_actions
  ADD CONSTRAINT operator_repair_actions_action_check CHECK (
    action_type IN (
      'grant_missing_trip_pass', 'initialize_missing_meters', 'release_stale_reservation',
      'manual_commerce_transition', 'goodwill_grant', 'account_recovery'
    )
  );

CREATE TABLE operator_refund_actions (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES trip_pass_orders(id),
  operator_account_id text NOT NULL,
  idempotency_key_hash text NOT NULL,
  command_hash text NOT NULL,
  decision text NOT NULL,
  reason_code text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_refund_actions_decision_check
    CHECK (decision IN ('full_refund', 'accept_partial_refund')),
  CONSTRAINT operator_refund_actions_idempotency_key
    UNIQUE (operator_account_id, idempotency_key_hash)
);

CREATE INDEX operator_refund_actions_order_id_idx
  ON operator_refund_actions(order_id, created_at);
