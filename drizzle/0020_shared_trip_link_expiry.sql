-- Shared Trip Links are bearer capabilities. Existing non-expiring links receive a 30-day sunset;
-- new links are bounded by the application and this default protects direct inserts.
UPDATE shared_trip_plans
SET expires_at = created_at + interval '30 days', updated_at = clock_timestamp()
WHERE expires_at IS NULL;

ALTER TABLE shared_trip_plans
  ALTER COLUMN expires_at SET DEFAULT (clock_timestamp() + interval '30 days'),
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE shared_trip_plans
  ADD CONSTRAINT shared_trip_plans_expiry_after_creation_check
  CHECK (expires_at > created_at);
