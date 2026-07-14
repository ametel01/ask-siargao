import { redactDiagnosticValue } from "@/server/admin/redaction";
import type { AuditLifecycleRecord } from "@/server/audit/lifecycle";
import type { GovernedFact } from "@/server/facts/types";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import type {
  TripPassReconciliationSnapshot,
  TripPassSupportLookupResult,
} from "@/server/trip-pass/reconciliation";

export type CompletenessDiagnostic = {
  auditRequestId: string;
  canComplete: boolean;
  blockingReasons: string[];
  evidenceSummary: string[];
};

export type AccommodationMatchDiagnostic = {
  auditRequestId: string;
  query: string;
  status: "confident" | "probable" | "ambiguous" | "rejected";
  score: number;
  followups: string[];
};

export type ProviderErrorDiagnostic = {
  providerId: string;
  providerName: string;
  status: "ok" | "degraded" | "failed";
  lastError?: string;
  checkedAt: string;
};

export type ReviewerDiagnostic = {
  auditRequestId: string;
  verdict: "approved" | "needs_revision" | "blocked";
  corrections: string[];
  blockedReasons: string[];
};

export type LlmRunDiagnostic = {
  auditRequestId: string;
  runId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type ToolCallDiagnostic = {
  auditRequestId: string;
  toolName: string;
  argumentsJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  evidenceIds: string[];
};

export type SourceProfileDiagnostic = {
  id: string;
  name: string;
  sourceType: string;
  allowedUse: string;
  freshnessWindowDays: number;
};

export type AuditDiagnosticsInput = {
  audits: AuditLifecycleRecord[];
  completenessChecks: CompletenessDiagnostic[];
  accommodationMatches: AccommodationMatchDiagnostic[];
  providerErrors: ProviderErrorDiagnostic[];
  facts: GovernedFact[];
  jobs: QueuedAuditJob[];
  reviewerResults: ReviewerDiagnostic[];
  llmRuns: LlmRunDiagnostic[];
  toolCalls: ToolCallDiagnostic[];
  sourceProfiles: SourceProfileDiagnostic[];
  tripPassReconciliation?: TripPassReconciliationSnapshot | null;
  tripPassSupportLookup?: TripPassSupportLookupResult | null;
  now: Date;
};

export type AdminDiagnosticsSnapshot = ReturnType<typeof buildAuditDiagnostics>;

const blockedAuditStates = new Set(["blocked", "failed", "needs_user_input"]);

export function buildAuditDiagnostics(input: AuditDiagnosticsInput) {
  const blockedAuditIds = new Set<string>();
  for (const audit of input.audits) {
    if (blockedAuditStates.has(audit.state)) {
      blockedAuditIds.add(audit.id);
    }
  }

  const blockedAudits: { auditRequestId: string; state: string; diagnostics: unknown }[] = [];
  for (const audit of input.audits) {
    if (blockedAuditIds.has(audit.id)) {
      blockedAudits.push({
        auditRequestId: audit.id,
        state: audit.state,
        diagnostics: redactDiagnosticValue(audit.diagnostics),
      });
    }
  }

  const sourceFreshnessIssues: {
    factId: string;
    factType: string;
    expiresAt: string | undefined | null;
    confidence: string;
  }[] = [];
  for (const fact of input.facts) {
    if (fact.expiresAt && new Date(fact.expiresAt).getTime() < input.now.getTime()) {
      sourceFreshnessIssues.push({
        factId: fact.id,
        factType: fact.factType,
        expiresAt: fact.expiresAt,
        confidence: fact.confidenceLabel,
      });
    }
  }

  const jobFailures: {
    auditRequestId: string;
    jobId: string;
    kind: string;
    attempts: number;
    lastError: string | null | undefined;
    diagnostics: unknown;
  }[] = [];
  for (const job of input.jobs) {
    if (job.state === "failed") {
      jobFailures.push({
        auditRequestId: job.auditRequestId,
        jobId: job.id,
        kind: job.kind,
        attempts: job.attempts,
        lastError: job.lastError,
        diagnostics: redactDiagnosticValue(job.diagnostics),
      });
    }
  }

  return {
    generatedAt: input.now.toISOString(),
    blockedAudits,
    failedAccommodationMatches: input.accommodationMatches.filter(
      (match) => match.status === "ambiguous" || match.status === "rejected",
    ),
    providerErrors: input.providerErrors.filter((provider) => provider.status !== "ok"),
    sourceFreshnessIssues,
    completenessFailures: input.completenessChecks.filter((check) => !check.canComplete),
    reviewerRejections: input.reviewerResults.filter((review) => review.verdict !== "approved"),
    llmCostEstimates: input.llmRuns.map((run) => ({
      auditRequestId: run.auditRequestId,
      runId: run.runId,
      model: run.model,
      estimatedUsd: estimateLlmCost(run),
      tokenDrivers: {
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
      },
    })),
    jobFailures,
    tripPassReconciliation: input.tripPassReconciliation
      ? (redactDiagnosticValue(input.tripPassReconciliation) as TripPassReconciliationSnapshot)
      : null,
    tripPassSupportLookup: input.tripPassSupportLookup
      ? (redactDiagnosticValue(input.tripPassSupportLookup) as TripPassSupportLookupResult)
      : null,
    drilldowns: {
      auditRequests: input.audits.map((audit) => ({
        id: audit.id,
        state: audit.state,
        stateHistory: audit.stateHistory,
      })),
      evidenceSummary: input.completenessChecks.flatMap((check) => check.evidenceSummary),
      sourceProfiles: input.sourceProfiles,
      factConfidence: input.facts.map((fact) => ({
        factId: fact.id,
        confidence: fact.confidenceLabel,
        sourceAuthority: fact.sourceAuthority,
      })),
      toolCallLogs: redactDiagnosticValue(input.toolCalls) as ToolCallDiagnostic[],
      reviewerResults: input.reviewerResults,
    },
  };
}

export function createDiagnosticLogEvent(input: {
  type:
    | "provider_call"
    | "audit_run"
    | "llm_tool_call"
    | "reviewer_result"
    | "public_page_generation_failure";
  at: Date;
  payload: Record<string, unknown>;
}) {
  return {
    type: input.type,
    at: input.at.toISOString(),
    payload: redactDiagnosticValue(input.payload),
  };
}

export function createSampleDiagnosticsSnapshot(now = new Date("2026-06-23T08:00:00.000Z")) {
  return buildAuditDiagnostics({
    now,
    audits: [
      {
        id: "audit_blocked_001",
        state: "needs_user_input",
        checkoutEligible: false,
        priceUsd: 9.99,
        diagnostics: [
          {
            at: now.toISOString(),
            phase: "checkout",
            message: "Accommodation match below payment threshold.",
            context: { travelerEmail: "traveler@example.com" },
          },
        ],
        stateHistory: [
          { state: "needs_user_input", at: now.toISOString(), reason: "match_failed" },
        ],
      },
      {
        id: "audit_review_002",
        state: "blocked",
        checkoutEligible: true,
        priceUsd: 9.99,
        diagnostics: [
          {
            at: now.toISOString(),
            phase: "review",
            message: "Reviewer blocked stale weather caveat.",
          },
        ],
        stateHistory: [{ state: "blocked", at: now.toISOString(), reason: "reviewer_blocked" }],
      },
    ],
    completenessChecks: [
      {
        auditRequestId: "audit_blocked_001",
        canComplete: false,
        blockingReasons: ["Accommodation match confidence is below the payment threshold."],
        evidenceSummary: ["ev_route"],
      },
    ],
    accommodationMatches: [
      {
        auditRequestId: "audit_blocked_001",
        query: "Unverified Beach Stay",
        status: "ambiguous",
        score: 0.42,
        followups: ["Ask traveler for booking link or exact area."],
      },
    ],
    providerErrors: [
      {
        providerId: "provider_weather",
        providerName: "Weather source",
        status: "degraded",
        lastError: "Timeout refreshing rainfall window.",
        checkedAt: now.toISOString(),
      },
    ],
    facts: [
      {
        id: "fact_weather_stale",
        claim: "Rainfall window last refreshed last week.",
        factType: "weather",
        fetchedAt: "2026-06-10T00:00:00.000Z",
        expiresAt: "2026-06-20T00:00:00.000Z",
        sourceProfileId: "source_weather",
        sourceRecordId: "record_weather",
        sourceType: "licensed_api",
        allowedUse: "audit_only",
        confidenceLabel: "medium",
        sourceAuthority: 3,
        publicRepublishAllowed: false,
        auditUseAllowed: true,
        rawEvidenceAllowed: false,
      },
    ],
    jobs: [
      {
        id: "job_generate_001",
        auditRequestId: "audit_review_002",
        kind: "generate_audit",
        state: "failed",
        attempts: 3,
        maxAttempts: 3,
        queuedAt: now.toISOString(),
        failedAt: now.toISOString(),
        lastError: "Provider refresh exhausted.",
        diagnostics: [
          {
            at: now.toISOString(),
            phase: "generate_audit",
            message: "Provider refresh exhausted.",
            context: { apiKey: "sk_test_should_not_render" },
          },
        ],
      },
    ],
    reviewerResults: [
      {
        auditRequestId: "audit_review_002",
        verdict: "blocked",
        corrections: ["Add stale weather caveat."],
        blockedReasons: ["stale_critical_fact"],
      },
    ],
    llmRuns: [
      {
        auditRequestId: "audit_review_002",
        runId: "llm_run_001",
        model: "gpt-5.4-mini",
        inputTokens: 5_000,
        outputTokens: 1_000,
      },
    ],
    toolCalls: [
      {
        auditRequestId: "audit_review_002",
        toolName: "weather",
        argumentsJson: { area: "General Luna" },
        resultJson: { rawPayload: { secret: "should not render" }, summary: "Stale weather fact" },
        evidenceIds: ["ev_weather"],
      },
    ],
    sourceProfiles: [
      {
        id: "source_weather",
        name: "Weather source",
        sourceType: "licensed_api",
        allowedUse: "audit_only",
        freshnessWindowDays: 1,
      },
    ],
    tripPassReconciliation: {
      generatedAt: now.toISOString(),
      mode: "dry_run",
      scope: {},
      thresholds: {
        staleOrderMinutes: 30,
        staleReservationMinutes: 10,
      },
      infrastructure: {
        analyticsSink: "unavailable",
        sharedQuotaStore: "unavailable",
        costCircuits: {
          deepseek: "configured",
          openai: "unconfigured",
          global: "configured",
        },
        priceCatalog: {
          productCode: "siargao_trip_pass_14d_v1",
          productVersion: 1,
          stripePriceConfigured: true,
        },
      },
      issues: [
        {
          code: "paid_without_pass",
          severity: "repairable",
          localRef: "order_support_001",
          reason: "paid order has no linked Trip Pass grant",
          repairable: true,
          details: { grants: 0, passes: 0 },
        },
        {
          code: "stale_usage_reservation",
          severity: "repairable",
          localRef: "usage_event_stale_001",
          reason: "reserved usage event exceeded the release window",
          repairable: true,
          details: { passRef: "trip_pass_support_001", meterType: "live_refresh" },
        },
        {
          code: "provider_usage_missing_request_id",
          severity: "warning",
          localRef: "usage_event_missing_provider",
          reason: "settled usage event has no provider request reference",
          repairable: false,
        },
      ],
      actions: [
        {
          action: "grant_missing_trip_pass",
          localRef: "order_support_001",
          status: "planned",
          reason: "dry_run_would_create_manual_reconciliation_grant",
        },
        {
          action: "release_stale_reservation",
          localRef: "usage_event_stale_001",
          status: "planned",
          reason: "dry_run_would_release_reserved_usage_event",
        },
      ],
    },
    tripPassSupportLookup: {
      status: "found",
      referenceType: "order",
      summary: {
        orderRefs: ["order_support_001"],
        passRefs: ["trip_pass_support_001"],
        userRef: "user_support_001",
        statuses: ["order:paid", "pass:active"],
        meterSummary: [
          {
            meterType: "chat_message",
            used: 12,
            limit: 150,
            reserved: 0,
          },
        ],
      },
    },
  });
}

function estimateLlmCost(run: LlmRunDiagnostic) {
  const inputCost = (run.inputTokens / 1_000_000) * 2;
  const outputCost = (run.outputTokens / 1_000_000) * 8;

  return Number((inputCost + outputCost).toFixed(4));
}
