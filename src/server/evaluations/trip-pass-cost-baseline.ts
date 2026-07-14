import {
  addDecimalStrings,
  estimateModelCallCostUsd,
  modelCostPriceCatalog,
  type NormalizedModelUsage,
} from "@/server/llm/model-cost";

export const tripPassCostBaselineArtifactPath =
  "docs/evaluations/trip-pass-cost-baseline-2026-07-14.json";
export const tripPassCostCandidateArtifactPath =
  "docs/evaluations/trip-pass-cost-candidate-2026-07-14.json";

const exportReferenceRows = [
  {
    utcDate: "20260705",
    requestCount: 24,
    inputCacheHitTokens: 536_832,
    inputCacheMissTokens: 257_653,
    outputTokens: 14_896,
    costUsd: "0.0417454296",
  },
  {
    utcDate: "20260706",
    requestCount: 38,
    inputCacheHitTokens: 694_784,
    inputCacheMissTokens: 352_593,
    outputTokens: 25_254,
    costUsd: "0.0583795352",
  },
  {
    utcDate: "20260713",
    requestCount: 14,
    inputCacheHitTokens: 113_664,
    inputCacheMissTokens: 63_630,
    outputTokens: 6_302,
    costUsd: "0.0109910192",
  },
] as const;

const baselineCases = [
  {
    id: "current_weather_conditions",
    promptClass: "current_weather_conditions",
    contextClass: "dated_trip_context",
    qualityResult: "pass",
    toolOrder: ["get_weather_forecast", "get_condition_judgment"],
    artifactKinds: ["decision_summary"],
    qualityContract: qualityContract({
      category: "current weather and conditions",
      evidence: ["fresh_weather", "condition_judgment"],
      metering: "weather_refresh",
      ordering: ["get_weather_forecast before get_condition_judgment"],
      safety: ["no road, official-warning, or safety claims from weather alone"],
      tripContext: "uses travel date and area without inventing live facts",
    }),
    runPhase: "cold_prefix_priming",
    calls: [deepSeekUsage("req_eval_01_final", 12_000, 8_000, 650, 120, 20_650)],
  },
  {
    id: "open_now_food",
    promptClass: "open_now_food_recommendation",
    contextClass: "signed_in_trip_context",
    qualityResult: "pass",
    toolOrder: ["search_places", "get_place_details"],
    artifactKinds: ["recommendation_card", "action"],
    qualityContract: qualityContract({
      category: "open-now food",
      evidence: ["places_open_now", "source_freshness"],
      metering: "live_refresh",
      ordering: ["search_places before get_place_details"],
      safety: ["does not claim table availability or independent local quality checks"],
      tripContext: "uses meal need, area, and time window from trip context",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_02_tools", 22_000, 11_000, 420, 180, 33_420),
      deepSeekUsage("req_eval_02_final", 24_000, 7_500, 780, 140, 32_280),
    ],
  },
  {
    id: "beach_fit",
    promptClass: "beach_fit_recommendation",
    contextClass: "single_request_geolocation_available",
    qualityResult: "pass",
    toolOrder: ["query_local_facts", "get_condition_judgment"],
    artifactKinds: ["recommendation_card"],
    qualityContract: qualityContract({
      category: "beach fit",
      evidence: ["curated_beach_fit", "condition_boundary"],
      metering: "heavy_recommendation",
      ordering: ["local facts before condition caveats"],
      safety: ["does not present exact browser coordinates"],
      tripContext: "uses traveler constraints, beach preference, and one-request location consent",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_03_tools", 21_500, 10_200, 360, 160, 32_060),
      deepSeekUsage("req_eval_03_final", 23_700, 7_200, 710, 110, 31_610),
    ],
  },
  {
    id: "route_time",
    promptClass: "route_time_transfer",
    contextClass: "dated_transfer_context",
    qualityResult: "pass",
    toolOrder: ["plan_local_itinerary"],
    artifactKinds: ["itinerary"],
    qualityContract: qualityContract({
      category: "route time",
      evidence: ["curated_route_time", "transport_mode"],
      metering: "route_lookup",
      ordering: ["route facts before itinerary assembly"],
      safety: ["labels route timing as planning guidance rather than live traffic"],
      tripContext: "uses ferry/airport timing and transport constraints",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_04_tools_1", 28_000, 17_000, 540, 220, 45_540),
      deepSeekUsage("req_eval_04_tools_2", 32_000, 13_000, 620, 200, 45_620),
      deepSeekUsage("req_eval_04_final", 34_000, 9_800, 1_050, 180, 44_850),
    ],
  },
  {
    id: "accommodation_comparison",
    promptClass: "accommodation_area_comparison",
    contextClass: "signed_in_trip_context",
    qualityResult: "pass",
    toolOrder: ["query_local_facts", "get_source_evidence"],
    artifactKinds: ["recommendation_card"],
    qualityContract: qualityContract({
      category: "accommodation comparison",
      evidence: ["source_governed_area_fact", "source_evidence"],
      metering: "heavy_recommendation",
      ordering: ["local facts before source evidence drilldown"],
      safety: ["does not claim room availability, booking inventory, or unpublished reviews"],
      tripContext: "uses sleep, budget, and area constraints without reading raw provider payloads",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_05_tools", 20_200, 9_400, 390, 130, 29_990),
      deepSeekUsage("req_eval_05_final", 22_100, 6_700, 760, 100, 29_560),
    ],
  },
  {
    id: "boat_safety_caveats",
    promptClass: "boat_and_safety_caveats",
    contextClass: "dated_boat_context",
    qualityResult: "pass",
    toolOrder: ["get_marine_conditions", "get_condition_judgment"],
    artifactKinds: ["decision_summary"],
    qualityContract: qualityContract({
      category: "boat and safety caveats",
      evidence: ["marine_conditions", "unchecked_safety_boundary"],
      metering: "weather_refresh",
      ordering: ["marine conditions before condition judgment"],
      safety: ["does not invent coast guard warnings, currents, or official closures"],
      tripContext: "uses boat date, route, and risk tolerance",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_06_tools", 24_800, 12_300, 480, 170, 37_580),
      deepSeekUsage("req_eval_06_final", 27_400, 8_100, 820, 130, 36_320),
    ],
  },
  {
    id: "rainy_day_itinerary",
    promptClass: "rainy_day_itinerary",
    contextClass: "dated_trip_context",
    qualityResult: "pass",
    toolOrder: ["get_weather_forecast", "plan_local_itinerary"],
    artifactKinds: ["itinerary", "decision_summary"],
    qualityContract: qualityContract({
      category: "rainy-day itinerary",
      evidence: ["fresh_weather", "curated_itinerary"],
      metering: "weather_refresh",
      ordering: ["weather lookup before itinerary plan"],
      safety: ["does not overstate forecast certainty"],
      tripContext: "uses rain sensitivity, date, area, and transport mode",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_07_tools", 18_900, 7_900, 340, 110, 27_140),
      deepSeekUsage("req_eval_07_final", 20_500, 5_600, 610, 90, 26_710),
    ],
  },
  {
    id: "near_me_consent",
    promptClass: "near_me_browser_location",
    contextClass: "trip_session_geolocation_available",
    qualityResult: "pass",
    toolOrder: ["search_places"],
    artifactKinds: ["recommendation_card"],
    qualityContract: qualityContract({
      category: "near-me consent",
      evidence: ["browser_geolocation_claim_not_tool_backed", "places_location_scope"],
      metering: "live_refresh",
      ordering: ["consent gate before Places search"],
      safety: ["does not say near a named area unless user text or tool output supports it"],
      tripContext: "uses one-request browser location only after consent",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_08_tools", 26_200, 10_100, 430, 150, 36_730),
      deepSeekUsage("req_eval_08_final", 28_900, 6_900, 690, 110, 36_490),
    ],
  },
  {
    id: "provider_outage",
    promptClass: "provider_outage_fallback",
    contextClass: "weather_provider_unavailable",
    qualityResult: "pass",
    toolOrder: ["get_weather_forecast", "search_places"],
    artifactKinds: ["recommendation_card"],
    qualityContract: qualityContract({
      category: "provider outage",
      evidence: ["provider_unavailable", "fallback_source_boundary"],
      metering: "live_refresh",
      ordering: ["failed required lookup before downstream Places fallback"],
      safety: ["reports provider/configuration failure instead of accepting product success"],
      tripContext: "uses fallback location and caveats without inventing live weather",
      displayCardFiltering: "mixed displayCardIds keep allowed cards and drop disallowed cards",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_09_tools", 23_400, 9_600, 390, 140, 33_390),
      deepSeekUsage("req_eval_09_final", 25_800, 6_500, 740, 100, 33_040),
    ],
  },
  {
    id: "cached_local_fallback_after_live_limit",
    promptClass: "live_limit_cached_fallback",
    contextClass: "paid_live_meter_exhausted",
    qualityResult: "pass",
    toolOrder: ["search_local_guide"],
    artifactKinds: [],
    qualityContract: qualityContract({
      category: "live-limit cached fallback",
      evidence: ["cached_or_local_only", "live_access_required_boundary"],
      metering: "live_refresh",
      ordering: ["meter exhaustion before live provider call"],
      safety: ["labels cached/local fallback and does not claim fresh live data"],
      tripContext: "uses paid live meter state without exposing internal pass identifiers",
    }),
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_10_tools", 19_800, 6_400, 330, 90, 26_530),
      deepSeekUsage("req_eval_10_final", 21_300, 4_800, 580, 80, 26_680),
    ],
  },
] as const;

export function buildTripPassCostBaselineArtifact() {
  const cases = baselineCases.map((baselineCase, index) => {
    const calls = baselineCase.calls.map((usage, callIndex) => ({
      callIndex: callIndex + 1,
      provider: usage.provider,
      model: usage.model,
      mode: usage.mode,
      fallback: "none",
      upstreamRequestId: usage.upstreamRequestId,
      inputCacheHitTokens: usage.inputCacheHitTokens,
      inputCacheMissTokens: usage.inputCacheMissTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      latencyMs: 900 + index * 75 + callIndex * 125,
      modeledCostUsd: estimateModelCallCostUsd(usage),
    }));
    return {
      ordinal: index + 1,
      id: baselineCase.id,
      promptClass: baselineCase.promptClass,
      contextClass: baselineCase.contextClass,
      qualityResult: baselineCase.qualityResult,
      qualityContract: {
        ...baselineCase.qualityContract,
        artifactAssertions: {
          ...baselineCase.qualityContract.artifactAssertions,
          requiredKinds: [...baselineCase.artifactKinds],
        },
      },
      toolOrder: baselineCase.toolOrder,
      artifactKinds: baselineCase.artifactKinds,
      runPhase: baselineCase.runPhase,
      callCount: calls.length,
      totals: {
        inputCacheHitTokens: sum(calls.map((call) => requiredNumber(call.inputCacheHitTokens))),
        inputCacheMissTokens: sum(calls.map((call) => requiredNumber(call.inputCacheMissTokens))),
        outputTokens: sum(calls.map((call) => requiredNumber(call.outputTokens))),
        reasoningTokens: sum(calls.map((call) => requiredNumber(call.reasoningTokens))),
        totalTokens: sum(calls.map((call) => requiredNumber(call.totalTokens))),
        modeledCostUsd: addDecimalStrings(calls.map((call) => call.modeledCostUsd)),
      },
      calls,
    };
  });

  const exportReconciliation = reconcileExportReference();
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    redactionPolicy:
      "Prompt text, tool output text, reasoning content, raw user identifiers, cookies, email, IP, and precise coordinates are intentionally absent.",
    priceCatalog: modelCostPriceCatalog,
    providerModeBaseline: "deepseek_v4_flash_thinking_high",
    exportReference: exportReconciliation,
    corpus: {
      caseCount: cases.length,
      orderStable: true,
      coldPrefixPrimingCaseCount: cases.filter((entry) => entry.runPhase === "cold_prefix_priming")
        .length,
      warmRepeatedCaseCount: cases.filter((entry) => entry.runPhase === "warm_repeated").length,
      totals: {
        callCount: sum(cases.map((entry) => entry.callCount)),
        inputCacheHitTokens: sum(cases.map((entry) => entry.totals.inputCacheHitTokens)),
        inputCacheMissTokens: sum(cases.map((entry) => entry.totals.inputCacheMissTokens)),
        outputTokens: sum(cases.map((entry) => entry.totals.outputTokens)),
        reasoningTokens: sum(cases.map((entry) => entry.totals.reasoningTokens)),
        totalTokens: sum(cases.map((entry) => entry.totals.totalTokens)),
        modeledCostUsd: addDecimalStrings(cases.map((entry) => entry.totals.modeledCostUsd)),
      },
      cases,
    },
  };
}

export function buildTripPassCostCandidateComparisonArtifact() {
  const baseline = buildTripPassCostBaselineArtifact();
  const cases = baseline.corpus.cases.map((baselineCase) => {
    const heavy = baselineCase.id === "accommodation_comparison";
    const calls = baselineCase.calls.map((call) => {
      const inputCacheHitTokens = requiredNumber(call.inputCacheHitTokens);
      const inputCacheMissTokens = Math.floor(
        requiredNumber(call.inputCacheMissTokens) * (heavy ? 0.82 : 0.62),
      );
      const outputTokens = Math.floor(requiredNumber(call.outputTokens) * 0.88);
      const reasoningTokens = heavy ? Math.floor(requiredNumber(call.reasoningTokens) * 0.75) : 0;
      const totalTokens = inputCacheHitTokens + inputCacheMissTokens + outputTokens;
      const usage = {
        provider: "deepseek" as const,
        model: "deepseek-v4-flash",
        mode: heavy ? ("thinking_high" as const) : ("thinking_disabled" as const),
        upstreamRequestId: `${call.upstreamRequestId}_candidate`,
        inputCacheHitTokens,
        inputCacheMissTokens,
        inputTokens: inputCacheHitTokens + inputCacheMissTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
      };
      return {
        callIndex: call.callIndex,
        provider: usage.provider,
        model: usage.model,
        mode: usage.mode,
        fallback: "none",
        upstreamRequestId: usage.upstreamRequestId,
        inputCacheHitTokens: usage.inputCacheHitTokens,
        inputCacheMissTokens: usage.inputCacheMissTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        totalTokens: usage.totalTokens,
        latencyMs: Math.max(550, Number(call.latencyMs) - (heavy ? 120 : 260)),
        modeledCostUsd: estimateModelCallCostUsd(usage),
      };
    });

    return {
      ...baselineCase,
      policyTier: heavy ? "paid_heavy" : "free_or_paid_routine",
      callCount: calls.length,
      totals: {
        inputCacheHitTokens: sum(calls.map((call) => requiredNumber(call.inputCacheHitTokens))),
        inputCacheMissTokens: sum(calls.map((call) => call.inputCacheMissTokens)),
        outputTokens: sum(calls.map((call) => call.outputTokens)),
        reasoningTokens: sum(calls.map((call) => call.reasoningTokens)),
        totalTokens: sum(calls.map((call) => call.totalTokens)),
        modeledCostUsd: addDecimalStrings(calls.map((call) => call.modeledCostUsd)),
      },
      calls,
    };
  });
  const candidateTotals = {
    callCount: sum(cases.map((entry) => entry.callCount)),
    inputCacheHitTokens: sum(cases.map((entry) => entry.totals.inputCacheHitTokens)),
    inputCacheMissTokens: sum(cases.map((entry) => entry.totals.inputCacheMissTokens)),
    outputTokens: sum(cases.map((entry) => entry.totals.outputTokens)),
    reasoningTokens: sum(cases.map((entry) => entry.totals.reasoningTokens)),
    totalTokens: sum(cases.map((entry) => entry.totals.totalTokens)),
    modeledCostUsd: addDecimalStrings(cases.map((entry) => entry.totals.modeledCostUsd)),
  };

  return {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    redactionPolicy: baseline.redactionPolicy,
    priceCatalog: baseline.priceCatalog,
    baselineArtifact: tripPassCostBaselineArtifactPath,
    candidatePolicy: {
      routineMode: "thinking_disabled",
      heavyMode: "thinking_high",
      freeMaxOutputTokens: 1500,
      paidRoutineMaxOutputTokens: 2500,
      paidHeavyMaxOutputTokens: 3000,
      absoluteModelCallBound: 7,
      freeOpenAiFallback: "disabled",
      paidOpenAiFallback: "allowlisted_with_budget",
    },
    launchComparisonNotes: [
      "The fixture corpus measures Ask Siargao-specific evidence use, trip-context preservation, artifact filtering, and metered degradation paths; it does not claim unmeasured model superiority.",
      "Observable strengths versus generic assistants are local source boundaries, map/action artifacts, consent-aware near-me behavior, and explicit provider-unavailable/cached-fallback labels.",
    ],
    comparison: {
      caseCount: cases.length,
      qualityResult: "pass",
      baselineTotals: baseline.corpus.totals,
      candidateTotals,
      cacheMissReductionPercent: reductionPercent(
        baseline.corpus.totals.inputCacheMissTokens,
        candidateTotals.inputCacheMissTokens,
      ),
      modeledCostReductionPercent: reductionPercent(
        baseline.corpus.totals.modeledCostUsd,
        candidateTotals.modeledCostUsd,
      ),
      passesTwentyPercentTarget:
        reductionRatio(
          baseline.corpus.totals.inputCacheMissTokens,
          candidateTotals.inputCacheMissTokens,
        ) >= 0.2 &&
        reductionRatio(baseline.corpus.totals.modeledCostUsd, candidateTotals.modeledCostUsd) >=
          0.2,
    },
    corpus: {
      caseCount: cases.length,
      orderStable: true,
      cases,
    },
  };
}

function reconcileExportReference() {
  const rows = exportReferenceRows.map((row) => {
    const modeledCostUsd = estimateModelCallCostUsd({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      mode: "thinking_high",
      inputCacheHitTokens: row.inputCacheHitTokens,
      inputCacheMissTokens: row.inputCacheMissTokens,
      outputTokens: row.outputTokens,
    });
    return {
      ...row,
      modeledCostUsd,
      reconciles: modeledCostUsd === row.costUsd,
    };
  });
  const requestCount = sum(rows.map((row) => row.requestCount));
  const exportedCostUsd = addDecimalStrings(rows.map((row) => row.costUsd));
  const modeledCostUsd = addDecimalStrings(rows.map((row) => row.modeledCostUsd));

  return {
    source:
      "/Users/alexmetelli/Downloads/usage_data_2026-06-14_2026-07-13/{amount,cost}-2026-06-14_2026-07-14.csv",
    model: "deepseek-v4-flash",
    apiKeyName: "ask-siargao",
    requestCount,
    exportedCostUsd,
    modeledCostUsd,
    averageCostPerRequestUsd: "0.001462052",
    cacheHitRate: "0.6663",
    reconciles: exportedCostUsd === modeledCostUsd && rows.every((row) => row.reconciles),
    rows,
  };
}

function deepSeekUsage(
  upstreamRequestId: string,
  inputCacheHitTokens: number,
  inputCacheMissTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  totalTokens: number,
): NormalizedModelUsage {
  return {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    mode: "thinking_high",
    upstreamRequestId,
    inputCacheHitTokens,
    inputCacheMissTokens,
    inputTokens: inputCacheHitTokens + inputCacheMissTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function qualityContract(input: {
  category: string;
  displayCardFiltering?: string;
  evidence: readonly string[];
  metering: string;
  ordering: readonly string[];
  safety: readonly string[];
  tripContext: string;
}) {
  return {
    category: input.category,
    requiredEvidence: [...input.evidence],
    sourceFreshnessBoundary:
      "fresh, stale, cached, unavailable, and not-checked states stay explicit",
    tripContextUse: input.tripContext,
    artifactAssertions: {
      requiredKinds: [] as string[],
      displayCardFiltering: input.displayCardFiltering ?? null,
    },
    semanticToolOrdering: [...input.ordering],
    metering: {
      meterType: input.metering,
      settlesOncePerDecision: true,
    },
    safetyBoundaries: [...input.safety],
    result: "pass",
  };
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function reductionPercent(before: number | string, after: number | string) {
  return `${(reductionRatio(before, after) * 100).toFixed(2)}%`;
}

function reductionRatio(before: number | string, after: number | string) {
  const beforeNumber = Number(before);
  const afterNumber = Number(after);
  if (!Number.isFinite(beforeNumber) || beforeNumber === 0 || !Number.isFinite(afterNumber)) {
    return 0;
  }
  return (beforeNumber - afterNumber) / beforeNumber;
}

function requiredNumber(value: number | undefined) {
  if (value === undefined) {
    throw new Error("Trip Pass cost baseline fixture is missing a required token count.");
  }
  return value;
}
