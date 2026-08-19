import { createHash, randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";

export type OperationalAlert = {
  alertKey: string;
  errorCode: string;
  findingId?: string;
  findingObservationSequence?: string;
  impact: "warning" | "high";
  operation:
    | "stripe_persistence"
    | "stripe_application"
    | "payment_event_application"
    | "paid_without_pass"
    | "account_closure"
    | "redis_availability"
    | "paid_after_closure_refund"
    | "live_reconciliation"
    | "configuration"
    | "scheduled_maintenance";
};

export type OperationalCondition =
  | "verified_stripe_persistence_failure"
  | "repeated_stripe_application_failure"
  | "paid_without_pass"
  | "immediate_closure_phase_failure"
  | "redis_unavailable"
  | "paid_after_closure_refund_failure"
  | "live_money_access_mismatch"
  | "invalid_stripe_signature"
  | "checkout_abandoned"
  | "partial_refund"
  | "analytics_delivery_failure";

export function classifyOperationalCondition(input: {
  checkoutMode: "off" | "canary" | "on";
  condition: OperationalCondition;
  confirmed: boolean;
}): "warning" | "high" {
  if (!input.confirmed) return "warning";
  if (input.condition === "redis_unavailable") {
    return input.checkoutMode === "off" ? "warning" : "high";
  }
  return new Set<OperationalCondition>([
    "verified_stripe_persistence_failure",
    "repeated_stripe_application_failure",
    "paid_without_pass",
    "immediate_closure_phase_failure",
    "paid_after_closure_refund_failure",
    "live_money_access_mismatch",
  ]).has(input.condition)
    ? "high"
    : "warning";
}

export type SentryOperationalSink = {
  send(event: {
    errorCode: string;
    eventId: string;
    findingId?: string;
    impact: "warning" | "high";
    operation: OperationalAlert["operation"];
  }): Promise<void>;
};

export async function deliverOperationalAlertOnce(
  alert: OperationalAlert,
  dependencies: {
    createId?: (prefix: string) => string;
    createToken?: () => string;
    db: DatabaseQueryClient;
    leaseSeconds?: number;
    sink: SentryOperationalSink;
  },
) {
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const token = dependencies.createToken?.() ?? randomUUID();
  const leaseSeconds = dependencies.leaseSeconds ?? 60;
  const eventId = sentryEventIdForAlertKey(alert.alertKey);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) {
    throw new Error("invalid_alert_lease_seconds");
  }
  const claimed = await dependencies.db.query<{ id: string }>(
    `with eligible_finding as materialized (
       select id from operational_findings
       where $7::bigint is not null and id = $3 and status = 'open'
         and last_observation_sequence = $7::bigint
       for update
     )
     insert into operational_alert_deliveries (
       id, alert_key, finding_id, impact, destination, status, delivery_token,
       lease_expires_at, attempted_at
     ) select
       $1, $2, $3, $4, 'sentry', 'sending', $5,
       clock_timestamp() + ($6::text || ' seconds')::interval, clock_timestamp()
     where $7::bigint is null or exists (select 1 from eligible_finding)
     on conflict (alert_key) do update set
       status = 'sending', delivery_token = excluded.delivery_token,
       lease_expires_at = excluded.lease_expires_at, attempted_at = clock_timestamp()
     where operational_alert_deliveries.status = 'failed'
        or (
          operational_alert_deliveries.status = 'sending'
          and operational_alert_deliveries.lease_expires_at <= clock_timestamp()
        )
     returning id`,
    [
      createId("alert_delivery"),
      alert.alertKey,
      alert.findingId ?? null,
      alert.impact,
      token,
      leaseSeconds,
      alert.findingObservationSequence ?? null,
    ],
  );
  if (!claimed.rows[0]) return { status: "already_delivered_or_in_flight" as const };

  try {
    await dependencies.sink.send({
      errorCode: normalizeCode(alert.errorCode),
      eventId,
      findingId: alert.findingId,
      impact: alert.impact,
      operation: alert.operation,
    });
    const updated = await dependencies.db.query<{ id: string }>(
      `update operational_alert_deliveries set status = 'sent', delivered_at = clock_timestamp(),
         lease_expires_at = null
       where alert_key = $1 and status = 'sending' and delivery_token = $2
         and lease_expires_at > clock_timestamp()
       returning id`,
      [alert.alertKey, token],
    );
    return updated.rows[0] ? { status: "sent" as const } : { status: "stale_delivery" as const };
  } catch {
    const updated = await dependencies.db.query<{ id: string }>(
      `update operational_alert_deliveries set status = 'failed', lease_expires_at = null
       where alert_key = $1 and status = 'sending' and delivery_token = $2
         and lease_expires_at > clock_timestamp()
       returning id`,
      [alert.alertKey, token],
    );
    return updated.rows[0] ? { status: "failed" as const } : { status: "stale_delivery" as const };
  }
}

export function createSentryHttpSink(input: {
  dsn: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): SentryOperationalSink {
  const endpoint = parseSentryDsn(input.dsn);
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("invalid_sentry_timeout");
  }
  return {
    async send(event) {
      const response = await fetchImpl(endpoint.url, {
        body: JSON.stringify({
          event_id: event.eventId,
          level: event.impact === "high" ? "fatal" : "warning",
          logger: "ask-siargao.operations",
          message: `${event.operation}:${event.errorCode}`,
          platform: "javascript",
          tags: {
            error_code: event.errorCode,
            finding_id: event.findingId ?? "none",
            impact: event.impact,
            operation: event.operation,
          },
        }),
        headers: {
          "content-type": "application/json",
          "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${endpoint.publicKey}`,
        },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error("sentry_delivery_failed");
    },
  };
}

type PageWorthyState = {
  alert_key: string;
  error_code: string;
  finding_id: string | null;
  finding_observation_sequence: string | null;
  impact: "warning" | "high";
  operation: OperationalAlert["operation"];
};

export async function deliverPendingPageWorthyAlerts(dependencies: {
  db: DatabaseQueryClient;
  sink: SentryOperationalSink;
}) {
  const states = await dependencies.db.query<PageWorthyState>(`
    select
      'stripe-event:' || id as alert_key,
      coalesce(sanitized_error_class, 'repeated_stripe_application_failure') as error_code,
      null::text as finding_id,
      null::text as finding_observation_sequence,
      'high'::text as impact,
      'stripe_application'::text as operation
    from trip_pass_stripe_events
    where status = 'pending' and alert_state = 'page'
    union all
    select
      'account-closure-step:' || s.id,
      coalesce(s.last_error_category, 'account_closure_step_failure'),
      null::text,
      null::text,
      'high'::text,
      'account_closure'::text
    from account_closure_steps s
    where s.status <> 'succeeded' and s.alerted_at is not null
    union all
    select
      'paid-after-closure-refund:' || id,
      coalesce(last_error_category, 'paid_after_closure_refund_failure'),
      null::text,
      null::text,
      'high'::text,
      'paid_after_closure_refund'::text
    from account_closure_refund_obligations
    where status <> 'succeeded' and alerted_at is not null
    union all
    select
      'operational-finding:' || id || ':lifecycle:' || lifecycle::text,
      summary_code,
      id,
      last_observation_sequence::text,
      impact,
      case when kind = 'paid_without_pass' then 'paid_without_pass'
        else 'live_reconciliation' end
    from operational_findings
    where status = 'open'
    order by alert_key
  `);

  const results = [];
  for (const state of states.rows) {
    results.push(
      await deliverOperationalAlertOnce(
        {
          alertKey: state.alert_key,
          errorCode: state.error_code,
          ...(state.finding_id ? { findingId: state.finding_id } : {}),
          ...(state.finding_observation_sequence
            ? { findingObservationSequence: state.finding_observation_sequence }
            : {}),
          impact: state.impact,
          operation: state.operation,
        },
        dependencies,
      ),
    );
  }
  return { checked: states.rows.length, results };
}

export function sentryEventIdForAlertKey(alertKey: string) {
  return createHash("sha256").update(alertKey).digest("hex").slice(0, 32);
}

function parseSentryDsn(value: string) {
  const parsed = new URL(value);
  const publicKey = parsed.username;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) throw new Error("invalid_sentry_dsn");
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    publicKey,
    url: `${parsed.protocol}//${parsed.host}${prefix}/api/${projectId}/store/`,
  };
}

function normalizeCode(value: string) {
  return /^[a-z][a-z0-9_]{2,63}$/.test(value) ? value : "operational_failure";
}
