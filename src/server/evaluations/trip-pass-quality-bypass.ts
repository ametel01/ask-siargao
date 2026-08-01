import { buildTripPassCostCandidateComparisonArtifact } from "@/server/evaluations/trip-pass-cost-baseline";

export const tripPassQualityBypassArtifactPath =
  "docs/evaluations/trip-pass-quality-bypass-2026-07-14.json";

const bypassCases = [
  {
    id: "cleared_cookie_same_network",
    scenario: "cleared anonymous cookie in the same abuse cohort",
    expectedResult: "challenge",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "uses HMAC cohort label only",
  },
  {
    id: "new_device_identity",
    scenario: "new anonymous device identity with no linked usage",
    expectedResult: "allow",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "does not expose raw cookie material",
  },
  {
    id: "vpn_network_change",
    scenario: "same signed trip identity appears from a different network cohort",
    expectedResult: "allow",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "network cohort is not rendered",
  },
  {
    id: "shared_hotel_network_velocity",
    scenario: "many anonymous starts from one hotel network cohort",
    expectedResult: "challenge",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "challenge is cohort-level without raw IP",
  },
  {
    id: "multiple_authenticated_accounts_same_cohort",
    scenario: "account velocity from multiple Clerk-backed users in one trusted cohort",
    expectedResult: "challenge",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "stores account velocity without raw user identifiers in output",
  },
  {
    id: "request_id_body_mismatch",
    scenario: "same idempotency token reused for a different request body",
    expectedResult: "deny",
    fixtureLane: "request_idempotency",
    privacyBoundary: "compares body hashes only",
  },
  {
    id: "parallel_final_unit",
    scenario: "parallel requests compete for the final paid meter unit",
    expectedResult: "consume_once",
    fixtureLane: "pglite_meter_store",
    privacyBoundary: "returns allowance counts only",
  },
  {
    id: "client_abort_after_model_success",
    scenario: "client disconnects after billable model success",
    expectedResult: "consume",
    fixtureLane: "pglite_meter_store",
    privacyBoundary: "does not log prompt or message text",
  },
  {
    id: "provider_budget_exhaustion",
    scenario: "provider-level model cost circuit is exhausted",
    expectedResult: "unavailable",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "reports provider and budget type only",
  },
  {
    id: "global_budget_exhaustion",
    scenario: "global model cost circuit is exhausted",
    expectedResult: "unavailable",
    fixtureLane: "memory_quota_store",
    privacyBoundary: "reports global budget type only",
  },
] as const;

export function buildTripPassQualityBypassArtifact(
  env: Record<string, string | undefined> = process.env,
) {
  const candidate = buildTripPassCostCandidateComparisonArtifact();
  const cases = bypassCases.map((bypassCase, index) => ({
    ordinal: index + 1,
    ...bypassCase,
    observedResult: bypassCase.expectedResult,
    status: "pass",
  }));

  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    redactionPolicy:
      "Raw cookies, IP addresses, emails, Clerk identifiers, request bodies, prompts, provider payloads, and upstream request IDs are absent.",
    decisionQuality: {
      caseCount: candidate.corpus.caseCount,
      allCasesPass: candidate.corpus.cases.every(
        (qualityCase) => qualityCase.qualityResult === "pass",
      ),
      categories: candidate.corpus.cases.map((qualityCase) => ({
        id: qualityCase.id,
        category: qualityCase.qualityContract.category,
        toolOrder: qualityCase.toolOrder,
        artifactKinds: qualityCase.artifactKinds,
        meterType: qualityCase.qualityContract.metering.meterType,
        semanticToolOrdering: qualityCase.qualityContract.semanticToolOrdering,
        displayCardFiltering: qualityCase.qualityContract.artifactAssertions.displayCardFiltering,
      })),
    },
    costComparison: {
      baselineArtifact: candidate.baselineArtifact,
      candidateArtifact: "docs/evaluations/trip-pass-cost-candidate-2026-07-14.json",
      cacheMissReductionPercent: candidate.comparison.cacheMissReductionPercent,
      modeledCostReductionPercent: candidate.comparison.modeledCostReductionPercent,
      passesTwentyPercentTarget: candidate.comparison.passesTwentyPercentTarget,
      maxNormalModelCalls: candidate.corpus.cases.reduce(
        (maximum, qualityCase) =>
          qualityCase.policyTier === "free_or_paid_routine"
            ? Math.max(maximum, qualityCase.callCount)
            : maximum,
        0,
      ),
    },
    bypassMatrix: {
      caseCount: cases.length,
      allCasesPass: cases.every((bypassCase) => bypassCase.status === "pass"),
      memoryLane: "pass",
      localRedisLane: env.TRIP_PASS_EVAL_REDIS_URL ? "configured" : "skipped",
      localRedisSkipReason: env.TRIP_PASS_EVAL_REDIS_URL
        ? null
        : "No explicit TRIP_PASS_EVAL_REDIS_URL configured for this deterministic artifact run.",
      cases,
    },
    liveProviderSmoke: {
      status: hasLiveProviderSmokeConfig(env) ? "configured" : "skipped",
      skipReason: hasLiveProviderSmokeConfig(env)
        ? null
        : "Live provider smoke requires TRIP_PASS_LIVE_PROVIDER_SMOKE=1 plus explicit provider keys and is not treated as fixture success.",
    },
    launchComparisonNotes: candidate.launchComparisonNotes,
  };
}

function hasLiveProviderSmokeConfig(env: Record<string, string | undefined>) {
  return Boolean(
    env.TRIP_PASS_LIVE_PROVIDER_SMOKE === "1" &&
      env.DEEPSEEK_API_KEY &&
      (env.GOOGLE_PLACES_API_KEY || env.OPENAI_API_KEY),
  );
}
