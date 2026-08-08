import { randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";

export type OperationalAlert = {
  alertKey: string;
  errorCode: string;
  findingId?: string;
  impact: "warning" | "high";
  operation:
    | "stripe_persistence"
    | "stripe_application"
    | "paid_without_pass"
    | "account_closure"
    | "redis_availability"
    | "paid_after_closure_refund"
    | "live_reconciliation";
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
    sink: SentryOperationalSink;
  },
) {
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const token = dependencies.createToken?.() ?? randomUUID();
  const claimed = await dependencies.db.query<{ id: string }>(
    `insert into operational_alert_deliveries (
       id, alert_key, finding_id, impact, destination, status, delivery_token, attempted_at
     ) values ($1, $2, $3, $4, 'sentry', 'sending', $5, clock_timestamp())
     on conflict (alert_key) do update set
       status = 'sending', delivery_token = excluded.delivery_token,
       attempted_at = clock_timestamp()
     where operational_alert_deliveries.status = 'failed'
     returning id`,
    [createId("alert_delivery"), alert.alertKey, alert.findingId ?? null, alert.impact, token],
  );
  if (!claimed.rows[0]) return { status: "already_delivered_or_in_flight" as const };

  try {
    await dependencies.sink.send({
      errorCode: normalizeCode(alert.errorCode),
      findingId: alert.findingId,
      impact: alert.impact,
      operation: alert.operation,
    });
    const updated = await dependencies.db.query<{ id: string }>(
      `update operational_alert_deliveries set status = 'sent', delivered_at = clock_timestamp()
       where alert_key = $1 and status = 'sending' and delivery_token = $2 returning id`,
      [alert.alertKey, token],
    );
    return updated.rows[0] ? { status: "sent" as const } : { status: "stale_delivery" as const };
  } catch {
    await dependencies.db.query(
      `update operational_alert_deliveries set status = 'failed'
       where alert_key = $1 and status = 'sending' and delivery_token = $2`,
      [alert.alertKey, token],
    );
    return { status: "failed" as const };
  }
}

export function createSentryHttpSink(input: {
  dsn: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): SentryOperationalSink {
  const endpoint = parseSentryDsn(input.dsn);
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async send(event) {
      const response = await fetchImpl(endpoint.url, {
        body: JSON.stringify({
          event_id: randomUUID().replaceAll("-", ""),
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
      });
      if (!response.ok) throw new Error("sentry_delivery_failed");
    },
  };
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
