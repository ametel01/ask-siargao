import { sanitizeForTelemetry } from "@/server/security/privacy";

import { createComponentLogger } from "./logger";

const telemetryLogger = createComponentLogger("telemetry");
const defaultAnalyticsTimeoutMs = 1_500;

export type ObservabilityEventName =
  | "intake_completed"
  | "accommodation_resolution_completed"
  | "completeness_gate_completed"
  | "preview_to_payment_started"
  | "payment_succeeded"
  | "trip_pass_activated"
  | "trip_pass_cached_fallback_used"
  | "trip_pass_checkout_completed"
  | "trip_pass_checkout_cancel_failed"
  | "trip_pass_checkout_cancelled"
  | "trip_pass_checkout_failed"
  | "trip_pass_checkout_started"
  | "trip_pass_dispute_transition"
  | "trip_pass_expired"
  | "trip_pass_free_limit_reached"
  | "trip_pass_free_limit_warning"
  | "trip_pass_stripe_event_applied"
  | "trip_pass_free_allowance_blocked"
  | "trip_pass_identity_challenge"
  | "trip_pass_meter_exhausted"
  | "trip_pass_meter_warning"
  | "trip_pass_paid_chat_delivery_cancelled"
  | "trip_pass_pricing_viewed"
  | "trip_pass_provider_budget_exhausted"
  | "trip_pass_provider_budget_warning"
  | "trip_pass_reconciliation_failed"
  | "trip_pass_refund_transition"
  | "trip_pass_reset_velocity_suspected"
  | "generation_latency_recorded"
  | "chat_latency_recorded"
  | "provider_error_recorded"
  | "llm_cost_recorded"
  | "reality_check_completed"
  | "reviewer_rejection_recorded"
  | "report_confidence_recorded"
  | "public_page_generation_failed"
  | "agent_snapshot_freshness_recorded"
  | "public_api_used"
  | "planning_guide_reality_check_clicked"
  | "planning_guide_viewed"
  | "indexation_crawl_recorded"
  | "ai_search_referral_recorded"
  | "top_cited_public_page_recorded";

export type ObservabilityEvent = {
  name: ObservabilityEventName;
  at: string;
  payload: Record<string, unknown>;
  sinks: {
    sentryConfigured: boolean;
    posthogConfigured: boolean;
  };
  delivery?: Promise<AnalyticsDeliveryResult>;
};

export type AnalyticsCaptureEvent = {
  distinctId: string;
  event: ObservabilityEventName;
  properties: Record<string, unknown>;
  timestamp: string;
};

export type AnalyticsSink = {
  name: string;
  send(event: AnalyticsCaptureEvent, signal: AbortSignal): Promise<void>;
};

export type AnalyticsDeliveryResult =
  | { sink: "none"; status: "disabled" }
  | { sink: string; status: "sent" }
  | { error: string; sink: string; status: "failed" }
  | { sink: string; status: "timed_out" };

export function trackServerEvent(input: {
  distinctId?: string;
  name: ObservabilityEventName;
  payload: Record<string, unknown>;
  now?: Date;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sink?: AnalyticsSink | null;
  timeoutMs?: number;
}): ObservabilityEvent {
  const env = input.env ?? process.env;
  const sink =
    input.sink === undefined && !isTestEnvironment(env)
      ? createPostHogAnalyticsSink({ env, fetch: input.fetch })
      : (input.sink ?? null);

  const event: ObservabilityEvent = {
    name: input.name,
    at: (input.now ?? new Date()).toISOString(),
    payload: allowlistedPayload(input.name, sanitizeForTelemetry(input.payload)),
    sinks: {
      sentryConfigured: Boolean(env.SENTRY_DSN),
      posthogConfigured: Boolean(env.NEXT_PUBLIC_POSTHOG_KEY),
    },
  };
  const delivery = deliverAnalyticsEvent({
    distinctId: input.distinctId ?? `server:${input.name}`,
    event,
    sink,
    timeoutMs: input.timeoutMs ?? defaultAnalyticsTimeoutMs,
  });
  event.delivery = delivery;
  void delivery.then((result) => {
    if (result.status === "failed" || result.status === "timed_out") {
      telemetryLogger.warn(
        {
          eventName: event.name,
          sink: result.sink,
          status: result.status,
        },
        "Telemetry sink delivery failed.",
      );
    }
  });

  telemetryLogger.info(
    {
      event: {
        at: event.at,
        name: event.name,
        payload: event.payload,
        sinks: event.sinks,
      },
      eventName: event.name,
      sinkConfiguration: event.sinks,
    },
    "Telemetry event recorded.",
  );

  return event;
}

export function createPostHogAnalyticsSink(input: {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): AnalyticsSink | null {
  const env = input.env ?? process.env;
  const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    return null;
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const host = (env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/+$/u, "");

  return {
    name: "posthog",
    async send(event, signal) {
      const response = await fetchImpl(`${host}/capture/`, {
        body: JSON.stringify({
          api_key: apiKey,
          distinct_id: event.distinctId,
          event: event.event,
          properties: event.properties,
          timestamp: event.timestamp,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal,
      });
      if (!response.ok) {
        throw new Error(`PostHog capture failed with HTTP ${response.status}.`);
      }
    },
  };
}

async function deliverAnalyticsEvent(input: {
  distinctId: string;
  event: ObservabilityEvent;
  sink: AnalyticsSink | null;
  timeoutMs: number;
}): Promise<AnalyticsDeliveryResult> {
  if (!input.sink) {
    return { sink: "none", status: "disabled" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    await input.sink.send(
      {
        distinctId: input.distinctId,
        event: input.event.name,
        properties: {
          ...input.event.payload,
          eventAt: input.event.at,
          source: "ask-siargao-server",
        },
        timestamp: input.event.at,
      },
      controller.signal,
    );
    return { sink: input.sink.name, status: "sent" };
  } catch (error) {
    if (controller.signal.aborted) {
      return { sink: input.sink.name, status: "timed_out" };
    }
    return {
      error: error instanceof Error ? error.message : "unknown analytics sink error",
      sink: input.sink.name,
      status: "failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const eventPayloadAllowlist = {
  accommodation_resolution_completed: ["status", "reason", "source"],
  agent_snapshot_freshness_recorded: ["status", "ageSeconds", "source"],
  ai_search_referral_recorded: ["family", "surface", "source"],
  completeness_gate_completed: ["auditRequestStatus", "blockingReasons", "optionalModuleCount"],
  chat_latency_recorded: [
    "status",
    "streamed",
    "totalMs",
    "firstByteMs",
    "preflightMs",
    "agentMs",
    "modelMs",
    "settlementMs",
    "persistenceMs",
    "modelCallCount",
    "toolCallCount",
    "repairCount",
    "modelCalls",
    "tools",
  ],
  generation_latency_recorded: ["durationMs", "status", "source"],
  indexation_crawl_recorded: ["family", "surface", "status"],
  intake_completed: ["auditRequestStatus", "completenessReasons", "intake"],
  llm_cost_recorded: [
    "priceVersion",
    "callCount",
    "fallbackUsed",
    "totalLatencyMs",
    "totalModeledCostUsd",
    "totals",
    "calls",
  ],
  payment_succeeded: ["applicationStatus", "auditRequestId", "eventType"],
  planning_guide_reality_check_clicked: ["action", "guideSlug", "status", "surface"],
  planning_guide_viewed: ["guideSlug", "status", "surface"],
  preview_to_payment_started: ["auditRequestId", "state"],
  provider_error_recorded: ["diagnostics", "provider", "reason", "source", "status"],
  public_api_used: ["evidenceIds", "family", "slug"],
  public_page_generation_failed: ["family", "reason", "slug", "status"],
  reality_check_completed: [
    "status",
    "kind",
    "verdict",
    "sourceState",
    "sourceCount",
    "toolCallCount",
    "durationMs",
    "cardCount",
    "itineraryCount",
    "decisionSummaryCount",
  ],
  report_confidence_recorded: ["confidence", "riskCount", "status"],
  reviewer_rejection_recorded: ["reason", "status"],
  top_cited_public_page_recorded: ["family", "slug", "count"],
  trip_pass_activated: [
    "action",
    "applicationStatus",
    "eventType",
    "productCode",
    "productVersion",
    "status",
  ],
  trip_pass_cached_fallback_used: ["meterType", "reason", "source", "status"],
  trip_pass_checkout_completed: [
    "action",
    "applicationStatus",
    "eventType",
    "productCode",
    "productVersion",
    "status",
  ],
  trip_pass_checkout_cancel_failed: ["reason", "status"],
  trip_pass_checkout_cancelled: ["status", "surface"],
  trip_pass_checkout_failed: ["applicationStatus", "eventType", "reason", "status"],
  trip_pass_checkout_started: [
    "checkoutAvailable",
    "productCode",
    "productVersion",
    "reason",
    "status",
    "surface",
  ],
  trip_pass_dispute_transition: ["action", "applicationStatus", "eventType", "status"],
  trip_pass_expired: ["action", "applicationStatus", "eventType", "status"],
  trip_pass_free_allowance_blocked: ["actor", "reason", "status"],
  trip_pass_free_limit_reached: ["meterType", "reason", "status"],
  trip_pass_free_limit_warning: ["meterType", "remaining", "status"],
  trip_pass_identity_challenge: ["cohortVersion", "reason", "status", "tripVersion"],
  trip_pass_meter_exhausted: ["limit", "meterType", "reason", "remaining", "status", "used"],
  trip_pass_meter_warning: ["limit", "meterType", "remaining", "status", "used"],
  trip_pass_paid_chat_delivery_cancelled: ["settlementStatus"],
  trip_pass_pricing_viewed: ["productCode", "productVersion", "status", "surface"],
  trip_pass_provider_budget_exhausted: ["budgetType", "provider", "reason", "status"],
  trip_pass_provider_budget_warning: ["budgetType", "provider", "remaining", "status"],
  trip_pass_reconciliation_failed: ["reason", "status"],
  trip_pass_refund_transition: ["action", "applicationStatus", "eventType", "status"],
  trip_pass_reset_velocity_suspected: [
    "cohortVersion",
    "reason",
    "resetVelocityBucket",
    "status",
    "tripVersion",
  ],
  trip_pass_stripe_event_applied: ["action", "applicationStatus", "eventType", "reason", "status"],
} as const satisfies Record<ObservabilityEventName, readonly string[]>;

const prohibitedTelemetryKeyPattern =
  /api.?key|body|cookie|email|idempotency|ip|journeyid|latitude|longitude|message|orderid|paymentintent|prompt|raw|requestid|secret|sessionid|stripe.*id|(?:^|[_-])token(?:$|[_-])|token$|userid|webhook/iu;

function allowlistedPayload(
  eventName: ObservabilityEventName,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys: Set<string> = new Set(eventPayloadAllowlist[eventName]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedKeys.has(key) || prohibitedTelemetryKeyPattern.test(key)) {
      continue;
    }
    const allowedValue = allowlistedValue(value);
    if (allowedValue !== undefined) {
      result[key] = allowedValue;
    }
  }
  return result;
}

function allowlistedValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const allowed = allowlistedValue(item);
      return allowed === undefined ? [] : [allowed];
    });
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (prohibitedTelemetryKeyPattern.test(key)) {
        continue;
      }
      const allowedNestedValue = allowlistedValue(nestedValue);
      if (allowedNestedValue !== undefined) {
        output[key] = allowedNestedValue;
      }
    }
    return output;
  }
  return undefined;
}

function isTestEnvironment(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "test" || env.BUN_ENV === "test";
}
