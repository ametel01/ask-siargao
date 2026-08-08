-- This preflight intentionally sorts after immutable 0016 and before immutable 0017. Historical
-- databases that have not applied 0017 need duplicate incident rows converged before 0017 creates
-- its unique incident-key index. Databases already through 0017 safely no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'operational_findings'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operational_findings'
      AND column_name = 'incident_key'
  ) THEN
    CREATE TEMP TABLE operational_finding_dedup_groups ON COMMIT DROP AS
    WITH fingerprinted AS (
      SELECT
        id,
        status,
        detected_at,
        resolved_at,
        md5(kind || E'\x1f' || local_entity_type || E'\x1f' || local_entity_ref
          || E'\x1f' || summary_code) AS fingerprint
      FROM operational_findings
    )
    SELECT
      fingerprint,
      (array_agg(id ORDER BY (status = 'open') DESC, detected_at, id))[1] AS keep_id,
      bool_or(status = 'open') AS has_open,
      min(detected_at) AS first_detected_at,
      max(resolved_at) AS last_resolved_at
    FROM fingerprinted
    GROUP BY fingerprint
    HAVING count(*) > 1;

    CREATE TEMP TABLE operational_finding_dedup_map ON COMMIT DROP AS
    SELECT finding.id AS duplicate_id, grouped.keep_id
    FROM operational_findings finding
    JOIN operational_finding_dedup_groups grouped
      ON md5(finding.kind || E'\x1f' || finding.local_entity_type || E'\x1f'
        || finding.local_entity_ref || E'\x1f' || finding.summary_code)
        = grouped.fingerprint
    WHERE finding.id <> grouped.keep_id;

    UPDATE operator_repair_actions repair
    SET finding_id = mapping.keep_id
    FROM operational_finding_dedup_map mapping
    WHERE repair.finding_id = mapping.duplicate_id;

    UPDATE operational_alert_deliveries alert
    SET finding_id = mapping.keep_id
    FROM operational_finding_dedup_map mapping
    WHERE alert.finding_id = mapping.duplicate_id;

    UPDATE operational_findings finding
    SET
      status = CASE WHEN grouped.has_open THEN 'open' ELSE 'resolved' END,
      detected_at = grouped.first_detected_at,
      resolved_at = CASE WHEN grouped.has_open THEN NULL ELSE grouped.last_resolved_at END
    FROM operational_finding_dedup_groups grouped
    WHERE finding.id = grouped.keep_id;

    DELETE FROM operational_findings finding
    USING operational_finding_dedup_map mapping
    WHERE finding.id = mapping.duplicate_id;
  END IF;
END
$$;
