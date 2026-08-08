-- 0016 and 0017 are immutable. Add command identity/indexes and reconciliation observation fencing
-- here so historical checksum ledgers can advance without rewriting an applied migration.

ALTER TABLE operator_repair_actions
  ADD COLUMN command_hash text;

UPDATE operator_repair_actions
SET command_hash = 'legacy_' || md5(concat_ws(E'\x1f', finding_id, operator_account_id,
  idempotency_key_hash, action_type, reason_code, before_state::text, after_state::text))
WHERE command_hash IS NULL;

ALTER TABLE operator_repair_actions
  ALTER COLUMN command_hash SET NOT NULL;

CREATE INDEX operational_findings_run_id_idx
  ON operational_findings(run_id);

CREATE INDEX operator_repair_actions_finding_id_idx
  ON operator_repair_actions(finding_id);

CREATE INDEX operational_alert_deliveries_finding_id_idx
  ON operational_alert_deliveries(finding_id);

CREATE SEQUENCE operational_reconciliation_observation_sequence AS bigint;

CREATE TABLE operational_reconciliation_observations (
  local_entity_type text NOT NULL,
  local_entity_ref text NOT NULL,
  last_applied_sequence bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (local_entity_type, local_entity_ref),
  CONSTRAINT operational_reconciliation_observations_entity_type_check CHECK (
    local_entity_type = 'trip_pass_order'
  ),
  CONSTRAINT operational_reconciliation_observations_sequence_check CHECK (
    last_applied_sequence > 0
  )
);
