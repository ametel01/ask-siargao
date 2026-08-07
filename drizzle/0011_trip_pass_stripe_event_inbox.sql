-- Rollback strategy: keep the normalized Stripe inbox in place and disable webhook replay workers.
-- The ledger is append-only payment evidence; forward repair bad rows rather than deleting receipt
-- or application history.

CREATE TABLE IF NOT EXISTS trip_pass_stripe_events (
  id text PRIMARY KEY,
  stripe_event_id text NOT NULL UNIQUE,
  stripe_api_version text NOT NULL,
  normalized_schema_version integer NOT NULL,
  event_type text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  checkout_session_id text,
  payment_intent_id text,
  order_id text,
  product_code text,
  product_version integer,
  stripe_price_id text,
  amount_total_minor integer,
  currency text,
  payment_status text,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  claim_token text,
  claim_expires_at timestamptz,
  alert_state text NOT NULL DEFAULT 'none',
  sanitized_error_class text,
  normalized_facts_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_stripe_events_schema_version_check CHECK (normalized_schema_version > 0),
  CONSTRAINT trip_pass_stripe_events_status_check CHECK (
    status IN ('pending', 'applied', 'blocked')
  ),
  CONSTRAINT trip_pass_stripe_events_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT trip_pass_stripe_events_alert_state_check CHECK (
    alert_state IN ('none', 'watch', 'page')
  ),
  CONSTRAINT trip_pass_stripe_events_product_version_check CHECK (
    product_version IS NULL OR product_version > 0
  ),
  CONSTRAINT trip_pass_stripe_events_amount_total_minor_check CHECK (
    amount_total_minor IS NULL OR amount_total_minor >= 0
  ),
  CONSTRAINT trip_pass_stripe_events_currency_check CHECK (
    currency IS NULL OR currency ~ '^[a-z]{3}$'
  )
);

CREATE INDEX IF NOT EXISTS trip_pass_stripe_events_status_next_attempt_idx
  ON trip_pass_stripe_events(status, next_attempt_at, received_at);

CREATE INDEX IF NOT EXISTS trip_pass_stripe_events_order_id_idx
  ON trip_pass_stripe_events(order_id);

CREATE INDEX IF NOT EXISTS trip_pass_stripe_events_checkout_session_id_idx
  ON trip_pass_stripe_events(checkout_session_id);

CREATE INDEX IF NOT EXISTS trip_pass_stripe_events_payment_intent_id_idx
  ON trip_pass_stripe_events(payment_intent_id);

CREATE INDEX IF NOT EXISTS trip_pass_stripe_events_claim_idx
  ON trip_pass_stripe_events(claim_token, claim_expires_at);
