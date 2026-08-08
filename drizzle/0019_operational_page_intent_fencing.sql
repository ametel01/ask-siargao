-- 0016, its preflight, 0017, and 0018 are immutable. Persist the observation that owns a
-- Finding lifecycle so a Sentry page intent can be linearized against later resolution.

ALTER TABLE operational_findings
  ADD COLUMN last_observation_sequence bigint;

ALTER TABLE operational_findings
  ADD CONSTRAINT operational_findings_observation_sequence_check CHECK (
    last_observation_sequence IS NULL OR last_observation_sequence > 0
  );
