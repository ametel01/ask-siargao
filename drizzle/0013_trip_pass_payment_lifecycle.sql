-- #152 expands the payment lifecycle without rewriting durable Stripe receipt,
-- closure, Order, Pass, Grant, or Usage Meter history. Rollback disables event
-- application/refund workers and uses forward repair; these facts stay durable.

ALTER TABLE trip_pass_orders
  ADD COLUMN IF NOT EXISTS captured_amount_minor integer,
  ADD COLUMN IF NOT EXISTS successful_refund_amount_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS dispute_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS terminal_revocation_reason text,
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at timestamptz;

UPDATE trip_pass_orders
SET captured_amount_minor = amount_total_minor
WHERE captured_amount_minor IS NULL AND status IN ('paid', 'refunded', 'disputed');

ALTER TABLE trip_pass_orders
  ADD CONSTRAINT trip_pass_orders_captured_amount_check CHECK (
    captured_amount_minor IS NULL OR captured_amount_minor >= 0
  ),
  ADD CONSTRAINT trip_pass_orders_successful_refund_amount_check CHECK (
    successful_refund_amount_minor >= 0
    AND (captured_amount_minor IS NULL OR successful_refund_amount_minor <= captured_amount_minor)
  ),
  ADD CONSTRAINT trip_pass_orders_refund_state_check CHECK (
    refund_state IN ('none', 'review', 'full')
  ),
  ADD CONSTRAINT trip_pass_orders_dispute_state_check CHECK (
    dispute_state IN ('none', 'open', 'won', 'lost')
  ),
  ADD CONSTRAINT trip_pass_orders_terminal_revocation_reason_check CHECK (
    terminal_revocation_reason IS NULL
    OR terminal_revocation_reason IN ('full_refund', 'dispute_lost')
  );

ALTER TABLE trip_passes DROP CONSTRAINT trip_passes_status_check;
ALTER TABLE trip_passes
  ADD COLUMN IF NOT EXISTS terminal_revocation_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD CONSTRAINT trip_passes_status_check CHECK (
    status IN ('active', 'suspended', 'expired', 'cancelled', 'refunded')
  ),
  ADD CONSTRAINT trip_passes_terminal_revocation_reason_check CHECK (
    terminal_revocation_reason IS NULL
    OR terminal_revocation_reason IN ('full_refund', 'dispute_lost', 'account_closure')
  );

CREATE TABLE IF NOT EXISTS trip_pass_refund_facts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES trip_pass_orders(id),
  stripe_refund_id text NOT NULL UNIQUE,
  stripe_charge_id text NOT NULL,
  stripe_event_id text NOT NULL,
  provider_status text NOT NULL,
  amount_minor integer NOT NULL,
  provider_created_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_refund_facts_status_check CHECK (
    provider_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')
  ),
  CONSTRAINT trip_pass_refund_facts_amount_check CHECK (amount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS trip_pass_refund_facts_order_status_idx
  ON trip_pass_refund_facts(order_id, provider_status, updated_at);

CREATE TABLE IF NOT EXISTS trip_pass_dispute_facts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES trip_pass_orders(id),
  stripe_dispute_id text NOT NULL UNIQUE,
  stripe_charge_id text,
  stripe_event_id text NOT NULL,
  provider_status text NOT NULL,
  application_status text NOT NULL,
  amount_minor integer,
  provider_created_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_dispute_facts_application_status_check CHECK (
    application_status IN ('open', 'won', 'lost')
  ),
  CONSTRAINT trip_pass_dispute_facts_amount_check CHECK (
    amount_minor IS NULL OR amount_minor >= 0
  )
);

CREATE INDEX IF NOT EXISTS trip_pass_dispute_facts_order_status_idx
  ON trip_pass_dispute_facts(order_id, application_status, updated_at);

CREATE OR REPLACE FUNCTION enforce_open_account_trip_pass_order_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_owner_id text;
  new_owner_id text;
BEGIN
  SELECT user_id INTO new_owner_id FROM trip_pass_orders WHERE id = NEW.order_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT user_id INTO old_owner_id FROM trip_pass_orders WHERE id = OLD.order_id;
  END IF;
  PERFORM enforce_open_account_owner(old_owner_id, true);
  IF new_owner_id IS DISTINCT FROM old_owner_id THEN
    PERFORM enforce_open_account_owner(new_owner_id, true);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trip_pass_refund_facts_open_account_write
BEFORE INSERT OR UPDATE ON trip_pass_refund_facts
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_trip_pass_order_child_write();

CREATE TRIGGER trip_pass_dispute_facts_open_account_write
BEFORE INSERT OR UPDATE ON trip_pass_dispute_facts
FOR EACH ROW EXECUTE FUNCTION enforce_open_account_trip_pass_order_child_write();

ALTER TABLE account_closure_refund_obligations
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS expected_amount_minor integer,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE account_closure_refund_obligations
  ADD CONSTRAINT account_closure_refund_obligations_expected_amount_check CHECK (
    expected_amount_minor IS NULL OR expected_amount_minor >= 0
  ),
  ADD CONSTRAINT account_closure_refund_obligations_provider_status_check CHECK (
    provider_status IS NULL
    OR provider_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')
  );

CREATE UNIQUE INDEX IF NOT EXISTS account_closure_refund_obligations_stripe_refund_id_idx
  ON account_closure_refund_obligations(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

-- #153 creates the reservation table in the following migration. Keeping this
-- function here makes the terminal transition deployable first while providing
-- one stable, transaction-local invalidation call once that table exists.
CREATE OR REPLACE FUNCTION invalidate_open_paid_answer_reservations(
  target_trip_pass_id text,
  terminal_reason text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  invalidated_count integer := 0;
BEGIN
  IF terminal_reason NOT IN ('full_refund', 'dispute_lost') THEN
    RAISE EXCEPTION 'unsupported reservation invalidation reason'
      USING ERRCODE = '23514';
  END IF;

  IF to_regclass('paid_answer_reservations') IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE
    'UPDATE paid_answer_reservations
       SET status = ''invalidated'',
           invalidation_reason = $2,
           invalidated_at = transaction_timestamp(),
           updated_at = transaction_timestamp()
     WHERE trip_pass_id = $1 AND status = ''open'''
    USING target_trip_pass_id, terminal_reason;
  GET DIAGNOSTICS invalidated_count = ROW_COUNT;
  RETURN invalidated_count;
END;
$$;
