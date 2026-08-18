-- Lemon Squeezy migration is additive. Historical Stripe identifiers remain readable for
-- reconciliation, while new Orders and normalized payment facts use provider-neutral fields.
-- Rollback is a forward configuration rollback to checkout=off; do not drop commerce evidence.

ALTER TABLE trip_pass_orders
  ALTER COLUMN stripe_price_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_store_id text,
  ADD COLUMN IF NOT EXISTS provider_product_id text,
  ADD COLUMN IF NOT EXISTS provider_variant_id text,
  ADD COLUMN IF NOT EXISTS provider_checkout_id text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_attempt_id text,
  ADD COLUMN IF NOT EXISTS accepted_payment_fact_id text,
  ADD COLUMN IF NOT EXISTS payment_suspension_state text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_pass_orders_payment_provider_check'
      AND conrelid = 'trip_pass_orders'::regclass
  ) THEN
    ALTER TABLE trip_pass_orders
      ADD CONSTRAINT trip_pass_orders_payment_provider_check
      CHECK (payment_provider IN ('stripe', 'lemon_squeezy'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_pass_orders_payment_suspension_check'
      AND conrelid = 'trip_pass_orders'::regclass
  ) THEN
    ALTER TABLE trip_pass_orders
      ADD CONSTRAINT trip_pass_orders_payment_suspension_check
      CHECK (payment_suspension_state IN ('none', 'fraudulent', 'disputed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS trip_pass_orders_provider_order_id_idx
  ON trip_pass_orders(provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_pass_checkout_attempts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES trip_pass_orders(id),
  provider text NOT NULL,
  provider_checkout_id text,
  idempotency_key text NOT NULL UNIQUE,
  checkout_url text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_checkout_attempts_provider_check CHECK (provider IN ('lemon_squeezy', 'stripe')),
  CONSTRAINT trip_pass_checkout_attempts_status_check CHECK (
    status IN ('pending', 'created', 'expired', 'failed', 'paid', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_pass_checkout_attempts_provider_checkout_idx
  ON trip_pass_checkout_attempts(provider, provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trip_pass_checkout_attempts_order_idx
  ON trip_pass_checkout_attempts(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trip_pass_payment_event_receipts (
  id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  provider text NOT NULL,
  event_name text NOT NULL,
  object_id text NOT NULL,
  provider_updated_at timestamptz NOT NULL,
  order_id text,
  provider_order_id text,
  status text NOT NULL DEFAULT 'pending',
  amount_total_minor integer,
  refunded_amount_minor integer,
  currency text,
  normalized_facts_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_payment_event_receipts_provider_check CHECK (provider = 'lemon_squeezy'),
  CONSTRAINT trip_pass_payment_event_receipts_status_check CHECK (status IN ('pending', 'applied', 'blocked')),
  CONSTRAINT trip_pass_payment_event_receipts_amount_check CHECK (
    (amount_total_minor IS NULL OR amount_total_minor >= 0)
    AND (refunded_amount_minor IS NULL OR refunded_amount_minor >= 0)
  )
);

CREATE INDEX IF NOT EXISTS trip_pass_payment_event_receipts_due_idx
  ON trip_pass_payment_event_receipts(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS trip_pass_payment_facts (
  id text PRIMARY KEY,
  order_id text REFERENCES trip_pass_orders(id),
  receipt_id text NOT NULL REFERENCES trip_pass_payment_event_receipts(id),
  provider text NOT NULL,
  provider_order_id text NOT NULL,
  provider_payment_id text,
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL,
  amount_total_minor integer,
  refunded_amount_minor integer,
  currency text,
  provider_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_payment_facts_provider_check CHECK (provider = 'lemon_squeezy'),
  CONSTRAINT trip_pass_payment_facts_status_check CHECK (
    status IN ('pending', 'failed', 'paid', 'refunded', 'partial_refund', 'fraudulent')
  )
);

CREATE TABLE IF NOT EXISTS trip_pass_refund_operations (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES trip_pass_orders(id),
  provider text NOT NULL,
  provider_order_id text NOT NULL,
  reason text NOT NULL,
  amount_minor integer,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_refund_operations_provider_check CHECK (provider = 'lemon_squeezy'),
  CONSTRAINT trip_pass_refund_operations_reason_check CHECK (
    reason IN ('duplicate_payment', 'paid_after_closure', 'partial_refund_deadline')
  ),
  CONSTRAINT trip_pass_refund_operations_status_check CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_pass_payment_facts_provider_order_idx
  ON trip_pass_payment_facts(provider, provider_order_id, fingerprint);

ALTER TABLE trip_pass_grants DROP CONSTRAINT IF EXISTS trip_pass_grants_source_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_pass_grants_source_type_check'
      AND conrelid = 'trip_pass_grants'::regclass
  ) THEN
    ALTER TABLE trip_pass_grants
      ADD CONSTRAINT trip_pass_grants_source_type_check CHECK (
        source_type IN (
          'stripe_checkout',
          'lemon_squeezy_checkout',
          'manual_operator',
          'refund_adjustment',
          'dispute_adjustment'
        )
      );
  END IF;
END $$;
