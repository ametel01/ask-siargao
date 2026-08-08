-- #154 hardens incident convergence and external alert delivery leases.
-- 0016 is immutable: these additions support safe upgrades from its original shape.

ALTER TABLE operational_findings
  ADD COLUMN incident_key text,
  ADD COLUMN lifecycle integer NOT NULL DEFAULT 1,
  ADD COLUMN last_detected_at timestamptz;

UPDATE operational_findings
SET incident_key = 'incident_' || md5(
      kind || E'\x1f' || local_entity_type || E'\x1f' || local_entity_ref || E'\x1f' || summary_code
    ),
    last_detected_at = detected_at;

ALTER TABLE operational_findings
  ALTER COLUMN incident_key SET NOT NULL,
  ALTER COLUMN last_detected_at SET NOT NULL,
  ADD CONSTRAINT operational_findings_lifecycle_check CHECK (lifecycle >= 1);

CREATE UNIQUE INDEX operational_findings_incident_key_key
  ON operational_findings(incident_key);

ALTER TABLE operational_alert_deliveries
  ADD COLUMN lease_expires_at timestamptz;

UPDATE operational_alert_deliveries
SET lease_expires_at = attempted_at + interval '5 minutes'
WHERE status = 'sending';

ALTER TABLE operational_alert_deliveries
  ADD CONSTRAINT operational_alert_deliveries_lease_check CHECK (
    (status = 'sending' AND lease_expires_at IS NOT NULL)
    OR (status <> 'sending' AND lease_expires_at IS NULL)
  );

CREATE INDEX operational_alert_deliveries_lease_idx
  ON operational_alert_deliveries(status, lease_expires_at, alert_key);
