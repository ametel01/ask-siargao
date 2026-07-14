-- Rollback strategy: keep this additive ledger in place, disable Trip Pass checkout and metering
-- feature flags, and apply forward repair migrations for bad rows or indexes. Do not drop these
-- audit tables in production because checkout, grant, and meter dedupe evidence is append-only.

CREATE TABLE IF NOT EXISTS trip_pass_orders (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  email text,
  status text NOT NULL,
  product_code text NOT NULL,
  product_version integer NOT NULL,
  stripe_price_id text NOT NULL,
  amount_total_minor integer,
  currency text,
  checkout_idempotency_key text NOT NULL UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  stripe_customer_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT trip_pass_orders_status_check CHECK (
    status IN (
      'pending',
      'checkout_created',
      'paid',
      'cancelled',
      'expired',
      'refunded',
      'disputed',
      'failed'
    )
  ),
  CONSTRAINT trip_pass_orders_product_version_check CHECK (product_version > 0),
  CONSTRAINT trip_pass_orders_amount_total_minor_check CHECK (
    amount_total_minor IS NULL OR amount_total_minor >= 0
  ),
  CONSTRAINT trip_pass_orders_currency_check CHECK (
    currency IS NULL OR currency ~ '^[a-z]{3}$'
  ),
  CONSTRAINT trip_pass_orders_completed_at_check CHECK (
    completed_at IS NULL OR completed_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS trip_pass_orders_user_status_created_at_idx
  ON trip_pass_orders(user_id, status, created_at);

CREATE INDEX IF NOT EXISTS trip_pass_orders_status_created_at_idx
  ON trip_pass_orders(status, created_at);

CREATE INDEX IF NOT EXISTS trip_pass_orders_product_code_idx
  ON trip_pass_orders(product_code);

CREATE TABLE IF NOT EXISTS trip_pass_grants (
  id text PRIMARY KEY,
  order_id text REFERENCES trip_pass_orders(id),
  trip_pass_id text NOT NULL REFERENCES trip_passes(id),
  user_id text REFERENCES users(id),
  source_type text NOT NULL,
  source_event_id text NOT NULL,
  product_code text NOT NULL,
  product_version integer NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  duration_days integer NOT NULL,
  meter_limits_json jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_pass_grants_source_type_event_id_key UNIQUE (source_type, source_event_id),
  CONSTRAINT trip_pass_grants_source_type_check CHECK (
    source_type IN (
      'stripe_checkout',
      'manual_operator',
      'refund_adjustment',
      'dispute_adjustment'
    )
  ),
  CONSTRAINT trip_pass_grants_product_version_check CHECK (product_version > 0),
  CONSTRAINT trip_pass_grants_quantity_check CHECK (quantity > 0),
  CONSTRAINT trip_pass_grants_duration_days_check CHECK (duration_days > 0),
  CONSTRAINT trip_pass_grants_timestamp_order_check CHECK (starts_at < expires_at)
);

CREATE INDEX IF NOT EXISTS trip_pass_grants_order_id_idx
  ON trip_pass_grants(order_id);

CREATE INDEX IF NOT EXISTS trip_pass_grants_trip_pass_id_idx
  ON trip_pass_grants(trip_pass_id);

CREATE INDEX IF NOT EXISTS trip_pass_grants_user_expires_at_idx
  ON trip_pass_grants(user_id, expires_at);

CREATE TABLE IF NOT EXISTS trip_usage_events (
  id text PRIMARY KEY,
  trip_pass_id text NOT NULL REFERENCES trip_passes(id),
  usage_meter_id text REFERENCES trip_usage_meters(id),
  user_id text REFERENCES users(id),
  event_type text NOT NULL,
  meter_type text NOT NULL,
  quantity integer NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_id text NOT NULL,
  request_hash text,
  provider_request_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_usage_events_event_type_check CHECK (
    event_type IN ('reserved', 'settled', 'released', 'adjusted')
  ),
  CONSTRAINT trip_usage_events_meter_type_check CHECK (
    meter_type IN (
      'chat_message',
      'live_refresh',
      'heavy_recommendation',
      'weather_refresh',
      'route_lookup'
    )
  ),
  CONSTRAINT trip_usage_events_quantity_check CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS trip_usage_events_trip_pass_meter_created_at_idx
  ON trip_usage_events(trip_pass_id, meter_type, created_at);

CREATE INDEX IF NOT EXISTS trip_usage_events_usage_meter_id_idx
  ON trip_usage_events(usage_meter_id);

CREATE INDEX IF NOT EXISTS trip_usage_events_user_created_at_idx
  ON trip_usage_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS trip_usage_events_request_id_idx
  ON trip_usage_events(request_id);
