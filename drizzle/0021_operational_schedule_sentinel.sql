-- Consolidate the four Vercel schedules behind one durable, quota-efficient sentinel.
-- State contains bounded operational codes only; no provider payloads or traveler data.

CREATE TABLE operational_schedule_states (
  schedule_key text PRIMARY KEY,
  schedule_minutes integer NOT NULL,
  grace_minutes integer NOT NULL,
  status text NOT NULL DEFAULT 'observing',
  lifecycle bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  monitoring_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operational_schedule_states_key_check CHECK (
    schedule_key IN ('weather', 'marine', 'places_prune')
  ),
  CONSTRAINT operational_schedule_states_schedule_check CHECK (
    schedule_minutes > 0 AND schedule_minutes <= 10080
  ),
  CONSTRAINT operational_schedule_states_grace_check CHECK (
    grace_minutes >= 0 AND grace_minutes <= 1440
  ),
  CONSTRAINT operational_schedule_states_status_check CHECK (
    status IN ('observing', 'healthy', 'failed', 'stale')
  ),
  CONSTRAINT operational_schedule_states_lifecycle_check CHECK (lifecycle >= 0),
  CONSTRAINT operational_schedule_states_failures_check CHECK (consecutive_failures >= 0),
  CONSTRAINT operational_schedule_states_error_check CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{2,63}$'
  ),
  CONSTRAINT operational_schedule_states_failure_state_check CHECK (
    (status = 'failed' AND consecutive_failures > 0 AND last_failed_at IS NOT NULL)
    OR (status <> 'failed')
  )
);

CREATE INDEX operational_schedule_states_status_idx
  ON operational_schedule_states(status, updated_at, schedule_key);
