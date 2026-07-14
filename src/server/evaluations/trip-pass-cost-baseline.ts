import {
  addDecimalStrings,
  estimateModelCallCostUsd,
  modelCostPriceCatalog,
  type NormalizedModelUsage,
} from "@/server/llm/model-cost";

export const tripPassCostBaselineArtifactPath =
  "docs/evaluations/trip-pass-cost-baseline-2026-07-14.json";

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
    id: "routine_first_day_plan",
    promptClass: "routine_trip_planning",
    contextClass: "anonymous_no_trip_context",
    qualityResult: "pass",
    toolOrder: ["load_agent_memory_file"],
    artifactKinds: [],
    runPhase: "cold_prefix_priming",
    calls: [deepSeekUsage("req_eval_01_final", 12_000, 8_000, 650, 120, 20_650)],
  },
  {
    id: "weather_sensitive_scooter_decision",
    promptClass: "live_weather_decision",
    contextClass: "dated_trip_context",
    qualityResult: "pass",
    toolOrder: ["get_weather_forecast", "get_condition_judgment"],
    artifactKinds: ["decision_summary"],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_02_tools", 22_000, 11_000, 420, 180, 33_420),
      deepSeekUsage("req_eval_02_final", 24_000, 7_500, 780, 140, 32_280),
    ],
  },
  {
    id: "nearby_open_places",
    promptClass: "browser_location_places",
    contextClass: "single_request_geolocation_available",
    qualityResult: "pass",
    toolOrder: ["search_places"],
    artifactKinds: ["recommendation_card"],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_03_tools", 21_500, 10_200, 360, 160, 32_060),
      deepSeekUsage("req_eval_03_final", 23_700, 7_200, 710, 110, 31_610),
    ],
  },
  {
    id: "heavy_restaurant_research",
    promptClass: "heavy_recommendation_current_web",
    contextClass: "signed_in_trip_context",
    qualityResult: "pass",
    toolOrder: ["research_web", "search_places", "get_place_details"],
    artifactKinds: ["recommendation_card", "action"],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_04_tools_1", 28_000, 17_000, 540, 220, 45_540),
      deepSeekUsage("req_eval_04_tools_2", 32_000, 13_000, 620, 200, 45_620),
      deepSeekUsage("req_eval_04_final", 34_000, 9_800, 1_050, 180, 44_850),
    ],
  },
  {
    id: "route_before_ferry_transfer",
    promptClass: "route_lookup_itinerary",
    contextClass: "dated_transfer_context",
    qualityResult: "pass",
    toolOrder: ["plan_local_itinerary"],
    artifactKinds: ["itinerary"],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_05_tools", 20_200, 9_400, 390, 130, 29_990),
      deepSeekUsage("req_eval_05_final", 22_100, 6_700, 760, 100, 29_560),
    ],
  },
  {
    id: "surf_spots_nearby",
    promptClass: "browser_location_surf_ranking",
    contextClass: "trip_session_geolocation_available",
    qualityResult: "pass",
    toolOrder: ["rank_surf_spots_nearby", "get_marine_conditions"],
    artifactKinds: ["decision_summary"],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_06_tools", 24_800, 12_300, 480, 170, 37_580),
      deepSeekUsage("req_eval_06_final", 27_400, 8_100, 820, 130, 36_320),
    ],
  },
  {
    id: "provider_failure_caveat",
    promptClass: "live_provider_failure",
    contextClass: "weather_provider_unavailable",
    qualityResult: "pass",
    toolOrder: ["get_weather_forecast"],
    artifactKinds: [],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_07_tools", 18_900, 7_900, 340, 110, 27_140),
      deepSeekUsage("req_eval_07_final", 20_500, 5_600, 610, 90, 26_710),
    ],
  },
  {
    id: "public_source_disclosure",
    promptClass: "source_governed_local_fact",
    contextClass: "local_guide_memory",
    qualityResult: "pass",
    toolOrder: ["query_local_facts", "get_source_evidence"],
    artifactKinds: [],
    runPhase: "warm_repeated",
    calls: [
      deepSeekUsage("req_eval_08_tools", 26_200, 10_100, 430, 150, 36_730),
      deepSeekUsage("req_eval_08_final", 28_900, 6_900, 690, 110, 36_490),
    ],
  },
  {
    id: "mixed_card_selection",
    promptClass: "adversarial_artifact_selection",
    contextClass: "mixed_allowed_disallowed_cards",
    qualityResult: "pass",
    toolOrder: ["search_places"],
    artifactKinds: ["recommendation_card"],
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
      upstreamRequestId: usage.upstreamRequestId,
      inputCacheHitTokens: usage.inputCacheHitTokens,
      inputCacheMissTokens: usage.inputCacheMissTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      modeledCostUsd: estimateModelCallCostUsd(usage),
    }));
    return {
      ordinal: index + 1,
      id: baselineCase.id,
      promptClass: baselineCase.promptClass,
      contextClass: baselineCase.contextClass,
      qualityResult: baselineCase.qualityResult,
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

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function requiredNumber(value: number | undefined) {
  if (value === undefined) {
    throw new Error("Trip Pass cost baseline fixture is missing a required token count.");
  }
  return value;
}
