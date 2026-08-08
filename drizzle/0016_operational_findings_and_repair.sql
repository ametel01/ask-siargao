-- #154 adds provider-neutral operational evidence and durable worker leases.
-- Reconciliation findings are deliberately separate from commerce/access state:
-- detecting a mismatch cannot grant access, transition an Order, or call a provider mutation.

CREATE TABLE operational_reconciliation_runs (
  id text PRIMARY KEY,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  checked_count integer NOT NULL DEFAULT 0,
  finding_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT operational_reconciliation_runs_source_check CHECK (
    source IN ('cli', 'authenticated_adapter', 'worker')
  ),
  CONSTRAINT operational_reconciliation_runs_status_check CHECK (
    status IN ('running', 'succeeded', 'failed')
  ),
  CONSTRAINT operational_reconciliation_runs_counts_check CHECK (
    checked_count >= 0 AND finding_count >= 0
  ),
  CONSTRAINT operational_reconciliation_runs_completed_check CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE operational_findings (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES operational_reconciliation_runs(id),
  kind text NOT NULL,
  impact text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  local_entity_type text NOT NULL,
  local_entity_ref text NOT NULL,
  summary_code text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT operational_findings_kind_check CHECK (
    kind IN (
      'paid_without_pass',
      'access_without_payment',
      'payment_state_mismatch',
      'pending_payment_stale',
      'missing_usage_meters',
      'stale_usage_reservation',
      'redis_unavailable',
      'privacy_cleanup_failed',
      'provider_application_failed'
    )
  ),
  CONSTRAINT operational_findings_impact_check CHECK (
    impact IN ('warning', 'high')
  ),
  CONSTRAINT operational_findings_status_check CHECK (
    status IN ('open', 'resolved')
  ),
  CONSTRAINT operational_findings_entity_type_check CHECK (
    local_entity_type IN ('trip_pass_order', 'trip_pass', 'closure_operation', 'service')
  ),
  CONSTRAINT operational_findings_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT operational_findings_run_entity_key UNIQUE (
    run_id, kind, local_entity_type, local_entity_ref
  )
);

CREATE INDEX operational_findings_open_idx
  ON operational_findings(status, impact, detected_at, id);

CREATE INDEX operational_findings_run_id_idx
  ON operational_findings(run_id);

CREATE TABLE operator_repair_actions (
  id text PRIMARY KEY,
  finding_id text NOT NULL REFERENCES operational_findings(id),
  operator_account_id text NOT NULL,
  idempotency_key_hash text NOT NULL,
  command_hash text NOT NULL,
  action_type text NOT NULL,
  reason_code text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_repair_actions_action_check CHECK (
    action_type IN (
      'grant_missing_trip_pass',
      'initialize_missing_meters',
      'release_stale_reservation',
      'manual_commerce_transition',
      'goodwill_grant',
      'account_recovery'
    )
  ),
  CONSTRAINT operator_repair_actions_idempotency_key UNIQUE (
    operator_account_id, idempotency_key_hash
  )
);

CREATE INDEX operator_repair_actions_finding_id_idx
  ON operator_repair_actions(finding_id);

CREATE TABLE operational_alert_deliveries (
  id text PRIMARY KEY,
  alert_key text NOT NULL UNIQUE,
  finding_id text REFERENCES operational_findings(id),
  impact text NOT NULL,
  destination text NOT NULL,
  status text NOT NULL,
  delivery_token text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT operational_alert_deliveries_impact_check CHECK (
    impact IN ('warning', 'high')
  ),
  CONSTRAINT operational_alert_deliveries_destination_check CHECK (
    destination IN ('sentry')
  ),
  CONSTRAINT operational_alert_deliveries_status_check CHECK (
    status IN ('sending', 'sent', 'failed')
  )
);

CREATE INDEX operational_alert_deliveries_finding_id_idx
  ON operational_alert_deliveries(finding_id);

CREATE TABLE operational_worker_tasks (
  id text PRIMARY KEY,
  task_type text NOT NULL,
  resource_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT operational_worker_tasks_type_check CHECK (
    task_type IN (
      'account_closure',
      'pending_stripe_event',
      'paid_after_closure_refund',
      'retention_purge',
      'commerce_reconciliation'
    )
  ),
  CONSTRAINT operational_worker_tasks_status_check CHECK (
    status IN ('pending', 'running', 'succeeded')
  ),
  CONSTRAINT operational_worker_tasks_attempts_check CHECK (attempts >= 0),
  CONSTRAINT operational_worker_tasks_lease_check CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT operational_worker_tasks_completed_check CHECK (
    (status = 'succeeded' AND completed_at IS NOT NULL)
    OR (status <> 'succeeded' AND completed_at IS NULL)
  ),
  CONSTRAINT operational_worker_tasks_resource_key UNIQUE (task_type, resource_ref)
);

CREATE INDEX operational_worker_tasks_due_idx
  ON operational_worker_tasks(status, next_attempt_at, lease_expires_at, id);
