import { sanitizeForTelemetry } from "@/server/security/privacy";

export type ObservabilityEventName =
  | "intake_completed"
  | "accommodation_resolution_completed"
  | "completeness_gate_completed"
  | "preview_to_payment_started"
  | "payment_succeeded"
  | "generation_latency_recorded"
  | "provider_error_recorded"
  | "llm_cost_recorded"
  | "reviewer_rejection_recorded"
  | "report_confidence_recorded"
  | "public_page_generation_failed"
  | "agent_snapshot_freshness_recorded"
  | "public_api_used"
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
};

export function trackServerEvent(input: {
  name: ObservabilityEventName;
  payload: Record<string, unknown>;
  now?: Date;
  env?: Record<string, string | undefined>;
}): ObservabilityEvent {
  const env = input.env ?? process.env;

  return {
    name: input.name,
    at: (input.now ?? new Date()).toISOString(),
    payload: sanitizeForTelemetry(input.payload),
    sinks: {
      sentryConfigured: Boolean(env.SENTRY_DSN),
      posthogConfigured: Boolean(env.NEXT_PUBLIC_POSTHOG_KEY),
    },
  };
}
