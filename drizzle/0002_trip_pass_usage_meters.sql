CREATE TABLE IF NOT EXISTS trip_passes (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  email text,
  status text NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_event_id text UNIQUE,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_passes_user_id_idx
  ON trip_passes(user_id);

CREATE INDEX IF NOT EXISTS trip_passes_status_expires_at_idx
  ON trip_passes(status, expires_at);

CREATE TABLE IF NOT EXISTS trip_usage_meters (
  id text PRIMARY KEY,
  trip_pass_id text NOT NULL REFERENCES trip_passes(id),
  meter_type text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  "limit" integer NOT NULL,
  reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_usage_meters_trip_pass_id_meter_type_idx
  ON trip_usage_meters(trip_pass_id, meter_type);

CREATE INDEX IF NOT EXISTS trip_usage_meters_trip_pass_id_idx
  ON trip_usage_meters(trip_pass_id);
