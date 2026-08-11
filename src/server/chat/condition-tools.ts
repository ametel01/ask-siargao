import { z } from "zod";

import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  AskSiargaoAgentToolName,
  DecisionSummary,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import type {
  RealityCheckProposal,
  RealityCheckRecognition,
  RealityCheckVerdict,
} from "@/server/chat/reality-check";
import type {
  LocalGuideSearchFilters,
  LocalGuideSearchResult,
} from "@/server/local/siargao-beaches";
import type { TideForecastSnapshot } from "@/server/providers/tide-forecast";
import type { WeatherSnapshot } from "@/server/public-pages/weather-snapshot";

export const conditionSignalKinds = ["weather", "tide", "surf", "road", "manual_caveat"] as const;
export const conditionSignalStatuses = ["checked", "not_checked", "unavailable"] as const;
export const conditionRiskLevels = ["low", "medium", "high"] as const;
export const conditionActivities = [
  "visit",
  "swimming",
  "surfing",
  "scooter",
  "rain_plan",
  "sunset",
  "boat_trip",
] as const;
export const conditionRecommendations = [
  "good",
  "flexible",
  "avoid",
  "needs_local_confirmation",
] as const;

const answerTrustLabels = [
  "live_checked",
  "fresh_cache",
  "event_checked",
  "venue_checked",
  "curated_local_guide",
  "weather_checked",
  "marine_checked",
  "tide_forecast_checked",
  "community_signal",
  "no_current_event_facts",
  "web_researched",
  "official_checked",
  "directory_checked",
  "insufficient_web_evidence",
  "not_verified",
  "provider_unavailable",
] as const satisfies readonly AnswerTrustLabel[];

const conditionSourceSummarySchema = z.strictObject({
  label: z.enum(answerTrustLabels),
  sourceName: z.string().min(1),
  sourceProfileId: z.string().min(1).optional(),
  fetchedAt: z.string().min(1).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  checked: z.array(z.string().min(1)),
  notChecked: z.array(z.string().min(1)),
});

const conditionSignalSchema = z.strictObject({
  kind: z.enum(conditionSignalKinds),
  status: z.enum(conditionSignalStatuses),
  level: z.enum(conditionRiskLevels),
  label: z.string().min(1),
  summary: z.string().min(1),
  checked: z.array(z.string().min(1)),
  notChecked: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)),
  source: conditionSourceSummarySchema,
});

export const conditionJudgmentSchema = z.strictObject({
  activity: z.enum(conditionActivities),
  locationName: z.string().min(1),
  dateLabel: z.string().min(1),
  recommendation: z.enum(conditionRecommendations),
  level: z.enum(conditionRiskLevels),
  reasons: z.array(z.string().min(1)).min(1),
  alternatives: z.array(z.string().min(1)).min(1),
  caveats: z.array(z.string().min(1)),
  signals: z.array(conditionSignalSchema).min(1),
  sources: z.array(conditionSourceSummarySchema).min(1),
});

export const conditionJudgmentRequestSchema = z.strictObject({
  activity: z.enum(conditionActivities),
  location: z.enum(["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"]),
  date_range: z.enum(["today", "next_7_days"]),
  beach_name: z.string().min(1).nullable(),
  include_local_caveats: z.boolean().nullable(),
  constraints: z.array(z.string().min(1)).nullable(),
});

export type ConditionSignal = z.infer<typeof conditionSignalSchema>;
export type ConditionJudgment = z.infer<typeof conditionJudgmentSchema>;
export type ConditionJudgmentRequest = z.infer<typeof conditionJudgmentRequestSchema>;

type BuildConditionJudgmentInput = {
  request: ConditionJudgmentRequest;
  weatherSnapshot?: WeatherSnapshot | null;
  marineSnapshot?: MarineConditionsSnapshot | null;
  tideForecastSnapshot?: TideForecastSnapshot | null;
  localGuideResult?: LocalGuideSearchResult | null;
};

export type ConditionJudgmentAdapters = {
  getWeatherSnapshot(request: {
    location: ConditionJudgmentRequest["location"];
  }): Promise<WeatherSnapshot | null>;
  getMarineSnapshot(request: {
    location: ConditionJudgmentRequest["location"];
    dateRange: "today" | "next_48_hours";
  }): Promise<MarineConditionsSnapshot | null>;
  getTideForecastSnapshot(request: {
    location: ConditionJudgmentRequest["location"];
    dateRange: "today" | "next_7_days";
  }): Promise<TideForecastSnapshot | null>;
  searchLocalGuide(request: {
    query: string;
    filters?: LocalGuideSearchFilters;
  }): LocalGuideSearchResult;
};

export type ConditionJudgmentResult = {
  judgment: ConditionJudgment;
  decisionSummary: DecisionSummary;
  text: string;
};

export type MarineConditionsSnapshot = {
  status: "live";
  locationName: string;
  sourceName: "Open-Meteo Marine API";
  sourceProfileId: "source_open_meteo_marine";
  fetchedAt: string;
  expiresAt: string | null;
  confidence: "medium" | "low";
  citationUrl: string | null;
  evidenceIds: string[];
  summary: string;
  current: {
    time: string;
    seaLevelHeightMsl: number | null;
    waveHeight: number | null;
    swellWaveHeight: number | null;
    wavePeriod: number | null;
    swellWavePeriod: number | null;
    oceanCurrentVelocity: number | null;
    seaSurfaceTemperature: number | null;
  };
  metrics: {
    maxWaveHeight: number | null;
    maxSwellWaveHeight: number | null;
    maxOceanCurrentVelocity: number | null;
    minSeaLevelHeightMsl: number | null;
    maxSeaLevelHeightMsl: number | null;
    seaLevelHeightRangeMsl: number | null;
  };
};

export const conditionJudgmentToolParameters = {
  type: "object",
  properties: {
    activity: {
      type: "string",
      enum: conditionActivities,
      description: "Activity or decision the traveler is asking about.",
    },
    location: {
      type: "string",
      enum: ["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"],
      description: "Known Siargao forecast location to use for the condition judgment.",
    },
    date_range: {
      type: "string",
      enum: ["today", "next_7_days"],
      description: "Forecast range to judge.",
    },
    beach_name: {
      type: ["string", "null"],
      description: "Optional beach or coastal spot when the question names one.",
    },
    include_local_caveats: {
      type: ["boolean", "null"],
      description: "Whether curated local caveats should be included when relevant.",
    },
    constraints: {
      type: ["array", "null"],
      items: { type: "string" },
      description: "Optional traveler constraints to preserve as caveats.",
    },
  },
  required: [
    "activity",
    "location",
    "date_range",
    "beach_name",
    "include_local_caveats",
    "constraints",
  ],
  additionalProperties: false,
} as const;

export function shouldIncludeConditionLocalCaveats(request: ConditionJudgmentRequest) {
  if (request.include_local_caveats === false) {
    return false;
  }
  if (request.beach_name) {
    return true;
  }
  return request.activity === "sunset" && request.location === "Cloud 9";
}

function buildConditionJudgment(input: BuildConditionJudgmentInput): ConditionJudgment {
  const request = conditionJudgmentRequestSchema.parse(input.request);
  const weatherSignal = buildWeatherSignal(input.weatherSnapshot, request.date_range);
  const signals = [
    weatherSignal,
    ...buildMarineSignals(request.activity, input.marineSnapshot, input.tideForecastSnapshot),
    ...buildUncheckedRoadSignals(request.activity),
    ...buildManualCaveatSignals(request, input.localGuideResult),
  ];
  const recommendation = recommendationFor({ activity: request.activity, signals });
  const sources = dedupeSources(signals.map((signal) => signal.source));
  const judgment = {
    activity: request.activity,
    locationName: request.beach_name ?? request.location,
    dateLabel: request.date_range === "today" ? "today" : "next 7 days",
    recommendation,
    level: highestSignalLevel(signals),
    reasons: reasonsFor({ recommendation, request, signals }),
    alternatives: alternativesFor(request.activity, recommendation, signals),
    caveats: caveatsFor({ request, signals }),
    signals,
    sources,
  };

  return conditionJudgmentSchema.parse(judgment);
}

export async function judgeConditions(
  requestInput: ConditionJudgmentRequest,
  adapters: ConditionJudgmentAdapters,
): Promise<ConditionJudgmentResult> {
  const request = conditionJudgmentRequestSchema.parse(requestInput);
  const usesMarineEvidence = conditionActivityUsesMarineEvidence(request.activity);
  const [weatherSnapshot, marineSnapshot, tideForecastSnapshot] = await Promise.all([
    acquireConditionSnapshot(() => adapters.getWeatherSnapshot({ location: request.location })),
    usesMarineEvidence
      ? acquireConditionSnapshot(() =>
          adapters.getMarineSnapshot({
            location: request.location,
            dateRange: request.date_range === "today" ? "today" : "next_48_hours",
          }),
        )
      : null,
    usesMarineEvidence
      ? acquireConditionSnapshot(() =>
          adapters.getTideForecastSnapshot({
            location: request.location,
            dateRange: request.date_range,
          }),
        )
      : null,
  ]);
  const localGuideResult = shouldIncludeConditionLocalCaveats(request)
    ? adapters.searchLocalGuide({
        query: conditionLocalGuideQuery(request),
        filters: {
          ...(request.beach_name ? { beachName: request.beach_name } : {}),
          swimming: request.activity === "swimming",
          sunset: request.activity === "sunset",
          rainFit: request.activity === "rain_plan",
          beachSurface: request.activity === "swimming" ? "sand" : "any",
        },
      })
    : null;
  const judgment = buildConditionJudgment({
    request,
    weatherSnapshot,
    marineSnapshot,
    tideForecastSnapshot,
    localGuideResult,
  });
  const decisionSummary = buildConditionDecisionSummary(judgment);

  return {
    judgment,
    decisionSummary,
    text: renderConditionJudgment(judgment, decisionSummary),
  };
}

export function conditionJudgmentRepairCall(
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
) {
  const required = inferConditionJudgmentRequest(request);
  if (!required || conditionJudgmentEvidenceAlreadyCompleted(required, toolCalls)) {
    return undefined;
  }
  return {
    callId: "auto_required_condition_judgment_1",
    name: "get_condition_judgment" as const,
    arguments: required,
  };
}

export function conditionJudgmentRepairInstruction(
  request: Pick<ConditionJudgmentRequest, "date_range">,
) {
  const base =
    "Validation repair: you attempted a final condition answer before choosing get_condition_judgment as required. Use this runtime-repaired condition evidence, preserve unchecked road, lifeguard, official-warning, and safety caveats, and write the final traveler-facing answer now. If marine_checked evidence is present, describe it as modelled Open-Meteo Marine sea-level, wave, swell, and current data. If tide_forecast_checked evidence is present, describe it as predicted Tide-Forecast Dapa station page data for development/testing.";
  return request.date_range === "next_7_days"
    ? `${base} The repaired evidence uses the next_7_days range; if the user asked about tomorrow or a specific future day, say this is a 7-day proxy rather than a tomorrow-specific forecast judgment.`
    : base;
}

export function inferConditionJudgmentRequest(
  request: AgentRuntimeRequest,
): ConditionJudgmentRequest | undefined {
  const userTurns = request.messages.flatMap((message) =>
    message.role === "user" ? [message.content] : [],
  );
  const latestUserTurn = userTurns.at(-1) ?? "";
  if (!latestUserTurn.trim() || isItineraryReviewRequest(latestUserTurn)) {
    return undefined;
  }
  if (isItineraryPlanningRequest(latestUserTurn) && !hasExplicitConditionQuestion(latestUserTurn)) {
    return undefined;
  }

  const priorUserContext = userTurns.slice(0, -1).join(" ");
  const inheritedPlaceContext = latestTurnHasConditionPlace(latestUserTurn) ? "" : priorUserContext;
  const activity = inferConditionActivity(latestUserTurn, inheritedPlaceContext);
  if (!activity) {
    return undefined;
  }
  const conditionContext = [latestUserTurn, inheritedPlaceContext].filter(Boolean).join(" ");
  return conditionJudgmentRequestSchema.parse({
    activity,
    location: inferConditionLocation(
      latestUserTurn,
      inheritedPlaceContext,
      request.deterministicSignals,
    ),
    date_range: inferConditionDateRange(latestUserTurn),
    beach_name:
      inferConditionBeachName(latestUserTurn) ?? inferConditionBeachName(inheritedPlaceContext),
    include_local_caveats: null,
    constraints: inferConditionConstraints(conditionContext, request.deterministicSignals),
  });
}

export function conditionToolNamesForAgentTurn(
  request: AgentRuntimeRequest,
): readonly AskSiargaoAgentToolName[] {
  const latestUserTurn =
    request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  const judgmentRequest = inferConditionJudgmentRequest(request);
  if (judgmentRequest && hasConditionDecisionIntent(latestUserTurn)) {
    return ["get_condition_judgment"];
  }
  if (/\b(?:tide|tides|high\s+tide|low\s+tide)\b/iu.test(latestUserTurn)) {
    return ["get_tide_forecast"];
  }
  if (hasRawMarineDetailIntent(latestUserTurn)) {
    return ["get_marine_conditions", "get_tide_forecast"];
  }
  if (judgmentRequest) {
    return ["get_condition_judgment"];
  }
  if (
    /\b(?:should|safe|safety|okay|ok|worth|good|bad|avoid|go\s+ahead)\b/iu.test(latestUserTurn) &&
    /\b(?:weather|rain|storm|wind|conditions?|swim|swimming|surf|surfing|boat|road|flood|sunset)\b/iu.test(
      latestUserTurn,
    )
  ) {
    return ["get_condition_judgment"];
  }
  if (/\b(?:waves?|swell|currents?|sea\s+level|marine)\b/iu.test(latestUserTurn)) {
    return ["get_marine_conditions", "get_tide_forecast"];
  }
  if (/\b(?:weather|rain|storm|wind|forecast)\b/iu.test(latestUserTurn)) {
    return ["get_weather_forecast"];
  }
  return [];
}

export function conditionRealityCheckProposal(input: {
  finalPayload: AgentFinalPayload | undefined;
  recognition: RealityCheckRecognition;
  toolResults: readonly AgentToolResult[];
}): RealityCheckProposal | undefined {
  if (
    !input.finalPayload ||
    (input.recognition.kind !== "immediate_plan" && input.recognition.kind !== "surf_session")
  ) {
    return undefined;
  }
  const usedToolCallIds = new Set(input.finalPayload.usedToolCallIds);
  const result = [...input.toolResults]
    .reverse()
    .find(
      (candidate) =>
        candidate.name === "get_condition_judgment" &&
        candidate.status === "success" &&
        Boolean(candidate.toolCallId && usedToolCallIds.has(candidate.toolCallId)),
    );
  const summary = result?.decisionSummaries?.[0];
  const recommendation = conditionRecommendationFromResult(result);
  const verdict = conditionRecommendationVerdict(recommendation);
  if (!result?.toolCallId || !summary || !verdict) {
    return undefined;
  }
  const subject = [summary.area, summary.timing].filter(Boolean).join(" ");
  if (!subject) {
    return undefined;
  }
  return {
    kind: input.recognition.kind,
    verdict,
    subject,
    bestAction: summary.bestAction,
    basis: summary.basis,
    ...(summary.fallback ? { fallback: summary.fallback } : {}),
    ...(summary.avoid ? { avoid: summary.avoid } : {}),
    ...(summary.timing ? { timing: summary.timing } : {}),
    ...(summary.area ? { area: summary.area } : {}),
    evidenceToolCallIds: [result.toolCallId],
  };
}

export function precipitationProbabilityRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 75, medium: 45 });
}

export function rainSumRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 18, medium: 6 });
}

export function windSpeedRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 40, medium: 25 });
}

export function windGustRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 55, medium: 35 });
}

export function marineWaveHeightRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 1.5, medium: 0.8 });
}

export function marineCurrentRiskLevel(value: number | null | undefined) {
  return thresholdRiskLevel(value, { high: 3, medium: 1.5 });
}

function conditionActivityUsesMarineEvidence(activity: ConditionJudgmentRequest["activity"]) {
  return (
    activity === "visit" ||
    activity === "swimming" ||
    activity === "surfing" ||
    activity === "boat_trip"
  );
}

async function acquireConditionSnapshot<T>(acquire: () => Promise<T | null>) {
  try {
    return await acquire();
  } catch {
    return null;
  }
}

function conditionLocalGuideQuery(request: ConditionJudgmentRequest) {
  return compact([
    request.beach_name ?? undefined,
    request.activity.replaceAll("_", " "),
    request.location,
    ...(request.constraints ?? []),
  ]).join(" ");
}

function renderConditionJudgment(judgment: ConditionJudgment, decisionSummary: DecisionSummary) {
  return [
    `Condition judgment for ${judgment.activity.replaceAll("_", " ")} at ${judgment.locationName}: ${judgment.recommendation} (${judgment.level} risk).`,
    `Reasons: ${judgment.reasons.join(" ")}`,
    `Alternatives: ${judgment.alternatives.join(" ")}`,
    judgment.caveats.length ? `Caveats: ${judgment.caveats.join(" ")}` : "",
    `Decision summary artifact: ${decisionSummary.id}; best action: ${decisionSummary.bestAction}; basis: ${decisionSummary.basis}`,
    `Signals: ${judgment.signals
      .map((signal) => `${signal.kind} ${signal.status} ${signal.level}: ${signal.summary}`)
      .join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConditionDecisionSummary(judgment: ConditionJudgment): DecisionSummary {
  const needsConfirmation =
    judgment.recommendation === "needs_local_confirmation" ||
    judgment.sources.some((source) => source.label === "provider_unavailable");
  const fallback = judgment.alternatives[0];
  const avoid =
    judgment.recommendation === "avoid"
      ? "Avoid exposed plans until the high-risk signal eases."
      : needsConfirmation
        ? "Avoid treating this as checked safety clearance."
        : undefined;

  return {
    id: `condition_decision:${slugify(judgment.activity)}:${slugify(judgment.locationName)}:${slugify(judgment.dateLabel)}`,
    bestAction: conditionBestAction(judgment, needsConfirmation),
    basis: judgment.reasons.slice(0, 2).join(" "),
    ...(fallback ? { fallback } : {}),
    ...(avoid ? { avoid } : {}),
    timing: judgment.dateLabel,
    area: judgment.locationName,
    sources: judgment.sources,
  };
}

function conditionBestAction(judgment: ConditionJudgment, needsConfirmation: boolean) {
  if (judgment.activity === "visit") {
    if (needsConfirmation) {
      return `Confirm locally before committing to the ${judgment.locationName} visit.`;
    }
    if (judgment.recommendation === "avoid") {
      return `Avoid the ${judgment.locationName} visit for now.`;
    }
    if (judgment.recommendation === "flexible") {
      return `Keep the ${judgment.locationName} visit flexible.`;
    }
    return `Go ahead with the ${judgment.locationName} visit.`;
  }

  const activity = judgment.activity.replaceAll("_", " ");
  if (needsConfirmation) {
    return `Confirm locally before committing to ${activity}.`;
  }
  if (judgment.recommendation === "avoid") {
    return `Avoid ${activity} for now.`;
  }
  if (judgment.recommendation === "flexible") {
    return `Keep ${activity} flexible.`;
  }
  return `Go ahead with ${activity}.`;
}

function buildWeatherSignal(
  weatherSnapshot: WeatherSnapshot | null | undefined,
  dateRange: ConditionJudgmentRequest["date_range"],
): ConditionSignal {
  if (!weatherSnapshot || weatherSnapshot.status === "fallback") {
    const source: AnswerSourceSummary = {
      label: "provider_unavailable",
      sourceName: "Open-Meteo weather API",
      sourceProfileId: "source_open_meteo",
      confidence: "low",
      checked: [],
      notChecked: ["weather forecast", "tide", "surf", "road flooding"],
    };
    return {
      kind: "weather",
      status: "unavailable",
      level: "medium",
      label: "Open-Meteo forecast unavailable",
      summary: "Open-Meteo weather could not be checked for this condition judgment.",
      checked: [],
      notChecked: source.notChecked,
      evidenceIds: [],
      source,
    };
  }

  const today = weatherSnapshot.today;
  const todayLevel = highestRiskLevel([
    today.level,
    precipitationProbabilityRiskLevel(today.precipitationProbability),
    rainSumRiskLevel(today.rainSum ?? today.precipitationSum),
    windSpeedRiskLevel(today.windSpeed),
    windGustRiskLevel(today.windGust),
  ]);
  const rangeMetricLevels =
    dateRange === "next_7_days" ? weatherSnapshot.metrics.map((metric) => metric.level) : [];
  const level = highestRiskLevel([todayLevel, ...rangeMetricLevels]);
  const source: AnswerSourceSummary = {
    label: "weather_checked",
    sourceName: weatherSnapshot.sourceName,
    sourceProfileId: weatherSnapshot.sourceProfileId,
    fetchedAt: weatherSnapshot.fetchedAt,
    confidence: weatherSnapshot.confidence,
    checked: [
      `forecast for ${weatherSnapshot.locationName}`,
      "precipitation probability",
      "rain amount",
      "wind speed",
      "wind gust",
    ],
    notChecked: ["tide", "surf", "currents", "road flooding", "lifeguard or swimming safety"],
  };

  return {
    kind: "weather",
    status: "checked",
    level,
    label: "Open-Meteo forecast",
    summary: weatherSignalSummary(weatherSnapshot, level, dateRange),
    checked: source.checked,
    notChecked: source.notChecked,
    evidenceIds: weatherSnapshot.evidenceIds,
    source,
  };
}

function buildMarineSignals(
  activity: ConditionJudgmentRequest["activity"],
  marineSnapshot: MarineConditionsSnapshot | null | undefined,
  tideForecastSnapshot: TideForecastSnapshot | null | undefined,
): ConditionSignal[] {
  if (!["visit", "swimming", "surfing", "boat_trip"].includes(activity)) {
    return [];
  }
  if (marineSnapshot || tideForecastSnapshot) {
    return [
      ...(tideForecastSnapshot ? buildCheckedTideForecastSignals(tideForecastSnapshot) : []),
      ...(marineSnapshot
        ? buildCheckedMarineSignals(marineSnapshot, Boolean(tideForecastSnapshot))
        : []),
    ];
  }
  return buildUncheckedMarineSignals();
}

function buildCheckedMarineSignals(
  marineSnapshot: MarineConditionsSnapshot,
  skipTideSignal = false,
): ConditionSignal[] {
  const source: AnswerSourceSummary = {
    label: "marine_checked",
    sourceName: marineSnapshot.sourceName,
    sourceProfileId: marineSnapshot.sourceProfileId,
    fetchedAt: marineSnapshot.fetchedAt,
    confidence: marineSnapshot.confidence,
    checked: [
      `modelled sea level height MSL (tide proxy) for ${marineSnapshot.locationName}`,
      "modelled wave height",
      "modelled swell wave height",
      "modelled ocean current velocity",
    ],
    notChecked: [
      "official tide table",
      "tide-gauge measurement",
      "surf break quality",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
    ],
  };
  const surfSignal: ConditionSignal = {
    kind: "surf",
    status: "checked",
    level: highestRiskLevel([
      marineWaveHeightRiskLevel(marineSnapshot.metrics.maxWaveHeight),
      marineWaveHeightRiskLevel(marineSnapshot.metrics.maxSwellWaveHeight),
      marineCurrentRiskLevel(marineSnapshot.metrics.maxOceanCurrentVelocity),
    ]),
    label: "Open-Meteo Marine waves, swell, and current",
    summary: [
      `current wave ${formatMetric(marineSnapshot.current.waveHeight, "m")}`,
      `swell ${formatMetric(marineSnapshot.current.swellWaveHeight, "m")}`,
      `ocean current ${formatMetric(marineSnapshot.current.oceanCurrentVelocity, "km/h")}`,
    ].join("; "),
    checked: source.checked.slice(1),
    notChecked: [
      "surf break quality",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
    ],
    evidenceIds: marineSnapshot.evidenceIds,
    source,
  };
  if (skipTideSignal) {
    return [surfSignal];
  }
  return [
    {
      kind: "tide",
      status: "checked",
      level: "low",
      label: "Open-Meteo Marine sea level",
      summary: [
        `modelled sea level ${formatMetric(marineSnapshot.current.seaLevelHeightMsl, "m")} MSL at ${marineSnapshot.current.time}`,
        `modelled range ${formatMetric(marineSnapshot.metrics.seaLevelHeightRangeMsl, "m")}`,
      ].join("; "),
      checked: [source.checked[0] ?? "modelled sea level height MSL"],
      notChecked: ["official tide table", "tide-gauge measurement"],
      evidenceIds: marineSnapshot.evidenceIds,
      source,
    },
    surfSignal,
  ];
}

function buildCheckedTideForecastSignals(snapshot: TideForecastSnapshot): ConditionSignal[] {
  const source: AnswerSourceSummary = {
    label: "tide_forecast_checked",
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    confidence: "low",
    checked: [
      `Tide-Forecast ${snapshot.stationName} predicted tide table for ${snapshot.targetDates.join(", ")}`,
      "predicted high and low tide times",
      "predicted tide heights",
      ...(snapshot.seaPeriods.length > 0
        ? ["embedded Tide-Forecast 3-hour swell and wind periods"]
        : []),
    ],
    notChecked: [
      "official tide-gauge measurement",
      "exact Cloud 9 break reading",
      "navigation safety",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
      "local operator call",
    ],
  };
  const firstDay = snapshot.days[0];
  const tideEvents = firstDay?.tides.filter((tide) => tide.type === "high" || tide.type === "low");
  const bestWindow = snapshot.recommendedWindows[0];
  return [
    {
      kind: "tide",
      status: "checked",
      level: "low",
      label: "Tide-Forecast predicted tide table",
      summary:
        tideEvents && tideEvents.length > 0
          ? tideEvents
              .slice(0, 4)
              .map((tide) => `${tide.type} ${tide.time} ${formatMetric(tide.heightMeters, "m")}`)
              .join("; ")
          : "Tide-Forecast predicted tide table was checked.",
      checked: source.checked.slice(0, 3),
      notChecked: source.notChecked,
      evidenceIds: [`tide_forecast:${snapshot.stationName.replaceAll(/\s+/g, "_").toLowerCase()}`],
      source,
    },
    {
      kind: "surf",
      status: snapshot.seaPeriods.length > 0 ? "checked" : "not_checked",
      level: "low",
      label: "Tide-Forecast surf timing window",
      summary: bestWindow
        ? `best daylight window ${bestWindow.localLabel}: ${bestWindow.reason}`
        : "Tide timing was checked, but embedded swell/wind periods were unavailable.",
      checked: snapshot.seaPeriods.length > 0 ? source.checked.slice(3) : [],
      notChecked:
        snapshot.seaPeriods.length > 0
          ? source.notChecked
          : ["swell period", "wind period", ...source.notChecked],
      evidenceIds: [`tide_forecast:${snapshot.stationName.replaceAll(/\s+/g, "_").toLowerCase()}`],
      source,
    },
  ] satisfies ConditionSignal[];
}

function buildUncheckedMarineSignals() {
  const source: AnswerSourceSummary = {
    label: "not_verified",
    sourceName: "Condition judgment unchecked marine signals",
    confidence: "medium",
    checked: [],
    notChecked: ["tide", "surf", "swell", "currents", "lifeguard or swimming safety"],
  };
  const tideSignal: ConditionSignal = {
    kind: "tide",
    status: "not_checked",
    level: "medium",
    label: "Tide",
    summary: "No marine provider data was available for tide timing or height.",
    checked: [],
    notChecked: ["tide height", "tide timing"],
    evidenceIds: [],
    source,
  };
  const surfSignal: ConditionSignal = {
    kind: "surf",
    status: "not_checked",
    level: "medium",
    label: "Surf, swell, and current",
    summary: "No marine provider data was available for surf, swell, or current.",
    checked: [],
    notChecked: ["surf height", "swell", "currents"],
    evidenceIds: [],
    source,
  };
  return [tideSignal, surfSignal];
}

function buildUncheckedRoadSignals(activity: ConditionJudgmentRequest["activity"]) {
  if (!["scooter", "rain_plan", "boat_trip"].includes(activity)) {
    return [];
  }
  const source: AnswerSourceSummary = {
    label: "not_verified",
    sourceName: "Condition judgment unchecked road signals",
    confidence: "medium",
    checked: [],
    notChecked: ["road flooding", "road closures", "official transport warnings"],
  };
  return [
    {
      kind: "road",
      status: "not_checked",
      level: "medium",
      label: "Road conditions",
      summary: "No live road flooding, closure, or official warning provider is integrated.",
      checked: [],
      notChecked: source.notChecked,
      evidenceIds: [],
      source,
    } satisfies ConditionSignal,
  ];
}

function buildManualCaveatSignals(
  request: ConditionJudgmentRequest,
  localGuideResult: LocalGuideSearchResult | null | undefined,
) {
  if (!localGuideResult || !shouldIncludeConditionLocalCaveats(request)) {
    return [];
  }
  const candidate = selectManualCaveatCandidate(request, localGuideResult);
  if (!candidate) {
    return [];
  }
  const source = localGuideResult.sourceSummary;
  return [
    {
      kind: "manual_caveat",
      status: "checked",
      level: candidate?.confidence === "high" ? "low" : "medium",
      label: "Curated local caveat",
      summary: candidate.caveats[0] ?? "Curated local guide caveats apply.",
      checked: source.checked,
      notChecked: source.notChecked,
      evidenceIds: [`curated_local_guide:${slugify(candidate.name)}`],
      source,
    } satisfies ConditionSignal,
  ];
}

function selectManualCaveatCandidate(
  request: ConditionJudgmentRequest,
  localGuideResult: LocalGuideSearchResult,
) {
  if (!request.beach_name) {
    return localGuideResult.candidates[0];
  }
  return localGuideResult.candidates.find((candidate) =>
    conditionBeachNameMatches(candidate.name, request.beach_name ?? undefined),
  );
}

function conditionBeachNameMatches(candidateName: string, requestedName: string | undefined) {
  if (!requestedName) {
    return false;
  }
  const candidate = normalizeConditionBeachName(candidateName);
  const requested = normalizeConditionBeachName(requestedName);
  return candidate === requested || candidate.includes(requested) || requested.includes(candidate);
}

function recommendationFor({
  activity,
  signals,
}: {
  activity: ConditionJudgmentRequest["activity"];
  signals: readonly ConditionSignal[];
}): ConditionJudgment["recommendation"] {
  const weatherSignal = signals.find((signal) => signal.kind === "weather");
  if (weatherSignal?.status === "unavailable") {
    return "needs_local_confirmation";
  }
  if (weatherSignal?.level === "high") {
    return activity === "rain_plan" ? "flexible" : "avoid";
  }
  if (activity === "visit") {
    return weatherSignal?.level === "medium" ? "flexible" : "good";
  }
  if (hasCheckedHighMarineSignal(signals)) {
    return activity === "swimming" ? "avoid" : "needs_local_confirmation";
  }
  if (activity === "surfing" || activity === "boat_trip") {
    return "needs_local_confirmation";
  }
  if (
    weatherSignal?.level === "medium" ||
    hasUncheckedMarineSignal(signals) ||
    hasCheckedMediumMarineSignal(signals)
  ) {
    return "flexible";
  }
  return activity === "rain_plan" ? "flexible" : "good";
}

function reasonsFor({
  recommendation,
  request,
  signals,
}: {
  recommendation: ConditionJudgment["recommendation"];
  request: ConditionJudgmentRequest;
  signals: readonly ConditionSignal[];
}) {
  const weatherSignal = signals.find((signal) => signal.kind === "weather");
  const reasons = [
    weatherSignal
      ? `${weatherSignal.label}: ${weatherSignal.summary}`
      : "No weather signal was available.",
    hasUncheckedMarineSignal(signals)
      ? "Tide, surf, swell, and current signals are explicitly not checked."
      : undefined,
    hasCheckedOpenMeteoMarineSignal(signals)
      ? "Open-Meteo Marine modelled sea-level, wave, swell, and current signals were checked."
      : undefined,
    hasCheckedTideForecastSignal(signals)
      ? "Tide-Forecast predicted tide table and embedded sea-condition timing were checked."
      : undefined,
    signals.some((signal) => signal.kind === "road")
      ? "Road flooding and closure signals are explicitly not checked."
      : undefined,
    request.constraints?.length
      ? `Traveler constraints preserved: ${request.constraints.join("; ")}.`
      : undefined,
    recommendation === "avoid"
      ? "A checked condition signal is high enough to favor a safer alternative."
      : undefined,
  ];
  return compact(reasons).slice(0, 5);
}

function alternativesFor(
  activity: ConditionJudgmentRequest["activity"],
  recommendation: ConditionJudgment["recommendation"],
  signals: readonly ConditionSignal[],
) {
  if (recommendation === "avoid") {
    if (activity === "scooter") {
      return [
        "Use a short tricycle/van hop or stay close to General Luna until conditions improve.",
      ];
    }
    if (activity === "boat_trip") {
      return ["Postpone the boat trip and choose a covered General Luna plan instead."];
    }
    if (activity === "sunset") {
      return [
        "Use a covered cafe or Cloud 9-adjacent stop and only step out during a clear break.",
      ];
    }
    return ["Choose a covered cafe, food stop, or short low-exposure plan instead."];
  }
  if (activity === "rain_plan") {
    return ["Favor covered cafes, short transfers, and flexible timing around rain breaks."];
  }
  if (activity === "sunset") {
    return ["Keep a nearby covered fallback if cloud or rain builds before sunset."];
  }
  if (activity === "swimming") {
    return hasCheckedMarineSignal(signals)
      ? ["Use a close sandy beach only after confirming local beach safety in person."]
      : ["Use a close sandy beach only after confirming tide, surf, and currents in person."];
  }
  if (activity === "surfing" || activity === "boat_trip") {
    return ["Confirm marine conditions with a local operator before committing."];
  }
  return ["Keep the plan short and choose a lower-exposure fallback if conditions change."];
}

function caveatsFor({
  request,
  signals,
}: {
  request: ConditionJudgmentRequest;
  signals: readonly ConditionSignal[];
}) {
  const caveats = [
    "This is a condition judgment, not an official safety warning.",
    request.activity === "visit"
      ? hasCheckedMarineSignal(signals)
        ? "Modelled sea and tide conditions can inform surf-watching, but they are not an exact break reading or surfing or swimming safety clearance."
        : "Surf, tide, currents, and water safety were not evaluated for this general visit recommendation."
      : undefined,
    request.date_range === "next_7_days"
      ? "Next-7-days evidence is a range-level proxy, not a day-specific forecast judgment."
      : undefined,
    hasUncheckedMarineSignal(signals)
      ? "Tide, surf, swell, currents, and lifeguard status were not checked."
      : undefined,
    hasCheckedOpenMeteoMarineSignal(signals)
      ? "Marine evidence is Open-Meteo model data, not an official tide table, tide-gauge reading, navigation aid, local operator call, or safety clearance."
      : undefined,
    hasCheckedTideForecastSignal(signals)
      ? "Tide-Forecast evidence is predicted page data from the Dapa station proxy, not an official tide-gauge, exact Cloud 9 break reading, local operator call, or safety clearance."
      : undefined,
    signals.some((signal) => signal.kind === "road")
      ? "Road flooding, road closures, and official transport warnings were not checked."
      : undefined,
    request.constraints?.length
      ? `Preserved constraints: ${request.constraints.join("; ")}.`
      : undefined,
  ];
  return compact(caveats);
}

function weatherSignalSummary(
  weatherSnapshot: WeatherSnapshot,
  level: ConditionSignal["level"],
  dateRange: ConditionJudgmentRequest["date_range"],
) {
  const today = weatherSnapshot.today;
  const todaySummary = [
    `${today.condition} for ${weatherSnapshot.locationName}`,
    `risk ${level}`,
    `precipitation probability ${formatMetric(today.precipitationProbability, "%")}`,
    `rain ${formatMetric(today.rainSum ?? today.precipitationSum, "mm")}`,
    `wind gust ${formatMetric(today.windGust, "km/h")}`,
  ];
  if (dateRange !== "next_7_days" || weatherSnapshot.metrics.length === 0) {
    return todaySummary.join("; ");
  }
  return [
    ...todaySummary,
    `7-day peaks ${weatherSnapshot.metrics
      .map((metric) => `${metric.label.toLowerCase()} ${metric.value}${metric.unit}`)
      .join(", ")}`,
  ].join("; ");
}

function thresholdRiskLevel(
  value: number | null | undefined,
  thresholds: { high: number; medium: number },
): ConditionSignal["level"] {
  if (value === null || value === undefined) {
    return "low";
  }
  if (value >= thresholds.high) {
    return "high";
  }
  if (value >= thresholds.medium) {
    return "medium";
  }
  return "low";
}

function highestSignalLevel(signals: readonly ConditionSignal[]): ConditionSignal["level"] {
  return highestRiskLevel(signals.map((signal) => signal.level));
}

function highestRiskLevel(levels: readonly ConditionSignal["level"][]): ConditionSignal["level"] {
  if (levels.includes("high")) {
    return "high";
  }
  if (levels.includes("medium")) {
    return "medium";
  }
  return "low";
}

function hasUncheckedMarineSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) =>
      (signal.kind === "tide" || signal.kind === "surf") && signal.status === "not_checked",
  );
}

function hasCheckedMarineSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) => (signal.kind === "tide" || signal.kind === "surf") && signal.status === "checked",
  );
}

function hasCheckedOpenMeteoMarineSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) =>
      (signal.kind === "tide" || signal.kind === "surf") &&
      signal.status === "checked" &&
      signal.source.label === "marine_checked",
  );
}

function hasCheckedTideForecastSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) =>
      (signal.kind === "tide" || signal.kind === "surf") &&
      signal.status === "checked" &&
      signal.source.label === "tide_forecast_checked",
  );
}

function hasCheckedMediumMarineSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) =>
      (signal.kind === "tide" || signal.kind === "surf") &&
      signal.status === "checked" &&
      signal.level === "medium",
  );
}

function hasCheckedHighMarineSignal(signals: readonly ConditionSignal[]) {
  return signals.some(
    (signal) =>
      (signal.kind === "tide" || signal.kind === "surf") &&
      signal.status === "checked" &&
      signal.level === "high",
  );
}

function dedupeSources(sources: readonly AnswerSourceSummary[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = [source.label, source.sourceName, source.sourceProfileId ?? ""].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function conditionJudgmentEvidenceAlreadyCompleted(
  required: ConditionJudgmentRequest,
  toolCalls: readonly AgentToolCallAudit[],
) {
  const matchingCall = toolCalls.find(
    (call) =>
      call.name === "get_condition_judgment" &&
      call.errorCode !== "invalid_tool_arguments" &&
      conditionJudgmentRequestMatches(call.arguments, required),
  );
  if (matchingCall) {
    return true;
  }
  if (
    required.activity === "visit" &&
    toolCalls.some(
      (call) =>
        call.name === "get_condition_judgment" &&
        call.errorCode !== "invalid_tool_arguments" &&
        call.arguments.activity !== "visit" &&
        call.arguments.date_range === required.date_range &&
        call.arguments.location === required.location,
    )
  ) {
    return true;
  }
  return false;
}

function conditionJudgmentRequestMatches(
  actual: Record<string, unknown>,
  required: ConditionJudgmentRequest,
) {
  if (
    actual.activity !== required.activity ||
    actual.date_range !== required.date_range ||
    actual.location !== required.location
  ) {
    return false;
  }
  if (
    required.beach_name &&
    normalizeConditionText(actual.beach_name) !== normalizeConditionText(required.beach_name)
  ) {
    return false;
  }
  const actualConstraints = new Set(
    readConditionStrings(actual.constraints).map(normalizeConditionText),
  );
  if (
    (required.constraints ?? [])
      .map(normalizeConditionText)
      .some((constraint) => !actualConstraints.has(constraint))
  ) {
    return false;
  }
  if (required.beach_name && actual.include_local_caveats === false) {
    return false;
  }
  return (
    required.include_local_caveats === null ||
    actual.include_local_caveats === required.include_local_caveats
  );
}

function inferConditionActivity(
  latestContent: string,
  inheritedPlaceContext: string,
): ConditionJudgmentRequest["activity"] | undefined {
  if (hasBoatTripConditionContent(latestContent)) {
    return "boat_trip";
  }
  if (isBareRideBoatFollowUp(latestContent, inheritedPlaceContext)) {
    return "boat_trip";
  }
  if (
    (/\bsurf(?:ing|er|s|ed)?|waves?|swell\b/i.test(latestContent) ||
      (/\breefs?\b/i.test(latestContent) &&
        /\b(?:conditions?|safe|surf|waves?|swell|forecast|report)\b/i.test(latestContent))) &&
    !/\b(?:not|no|avoid)\s+surf(?:ing)?\b/i.test(latestContent) &&
    /\btoday|tomorrow|conditions?|weather|forecast|report|waves?|swell|safe|can|could|okay|ok|worth|near\s+me|closest|nearest\b/i.test(
      latestContent,
    )
  ) {
    return "surfing";
  }
  if (
    /\bswim(?:ming)?|kids?\s+swim|beach\s+safety|lifeguard|rip\s+current\b/i.test(latestContent)
  ) {
    return "swimming";
  }
  if (
    /\bscooter|motorbike|motor\s*bike|roads?|ride\b/i.test(latestContent) &&
    !/\brent(?:al|ing)?|hire\b/i.test(latestContent) &&
    /\bsafe|safety|rain|weather|roads?|flood|today|tomorrow|go|ride|drive\b/i.test(latestContent)
  ) {
    return "scooter";
  }
  if (/\bsunset\b/i.test(latestContent)) {
    return "sunset";
  }
  if (
    inferConditionLocationFromContent(latestContent) &&
    (/\bshould\s+(?:i|we)\s+still\b/i.test(latestContent) ||
      /\b(?:worth\s+going|still\s+go|visit|head\s+to|stop\s+by)\b/i.test(latestContent))
  ) {
    return "visit";
  }
  return undefined;
}

function inferConditionLocation(
  latestContent: string,
  inheritedPlaceContext: string,
  deterministicSignals: Record<string, unknown> | undefined,
): ConditionJudgmentRequest["location"] {
  const latestLocation = inferConditionLocationFromContent(latestContent);
  if (latestLocation) {
    return latestLocation;
  }
  const signalLocation =
    readConditionStringPath(deterministicSignals, ["context", "locationLabel"]) ??
    readConditionStringPath(deterministicSignals, ["context", "tripContext", "currentArea"]);
  if (isConditionLocation(signalLocation)) {
    return signalLocation;
  }
  return inferConditionLocationFromContent(inheritedPlaceContext) ?? "Siargao Island";
}

function inferConditionLocationFromContent(
  content: string,
): ConditionJudgmentRequest["location"] | undefined {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bmalinao|doot|sandy\s+beach|half[-\s]?day\b/i.test(content)) {
    return "General Luna";
  }
  if (/\bdel\s+carmen|sugba\s+lagoon|sugba\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  return undefined;
}

function inferConditionDateRange(content: string): ConditionJudgmentRequest["date_range"] {
  return /\b(tomorrow|tmrw|next\s+7\s+days?|next\s+seven\s+days?|this\s+week|next\s+week|weekend|later\s+this\s+week|in\s+(?:[2-7]|two|three|four|five|six|seven)\s+days?)\b/i.test(
    content,
  )
    ? "next_7_days"
    : "today";
}

function inferConditionBeachName(content: string): string | null {
  const match = /\b(malinao|doot|cloud\s*9|pacifico|alegria|magpupungko|sugba)\b/i.exec(content);
  if (!match?.[1]) {
    return null;
  }
  const normalized = match[1].replaceAll(/\s+/g, " ");
  if (/^cloud\s*9$/i.test(normalized)) {
    return "Cloud 9";
  }
  if (/^sugba$/i.test(normalized)) {
    return "Sugba Lagoon";
  }
  return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1).toLowerCase()} Beach`;
}

function inferConditionConstraints(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  return uniqueConditionText([
    ...readConditionStringArrayPath(deterministicSignals, [
      "context",
      "tripContext",
      "durableConstraints",
    ]),
    ...(/\bkids?|children|child|toddler|family|families\b/i.test(content) ? ["with kids"] : []),
    ...(/\bno\s+scooter|without\s+(?:a\s+)?scooter|avoid\s+scooters?|walk(?:ing)?\s+only\b/i.test(
      content,
    )
      ? ["avoid scooters"]
      : []),
    ...(/\bvegetarian|vegan|plant[-\s]?based|no\s+meat\b/i.test(content) ? ["vegetarian"] : []),
    ...(/\bquiet|calm|low[-\s]?key|not\s+crowded|avoid\s+crowds?|peaceful\b/i.test(content)
      ? ["quiet"]
      : []),
    ...(/\bnon[-\s]?surfer|not\s+surfing|avoid\s+surf|no\s+surf(?:ing)?\b/i.test(content)
      ? ["not surfing"]
      : []),
  ]);
}

function hasExplicitConditionQuestion(content: string) {
  return (
    /\b(?:tell\s+me\s+if|whether|is|are|can|could|should|safe|safety|okay|ok|worth|conditions?)\b/i.test(
      content,
    ) &&
    /\b(?:swim(?:ming)?|surf(?:ing)?|scooter|motorbike|ride|boat|island\s+hopping|sunset|rain|weather|roads?|waves?|swell|marine|beach)\b/i.test(
      content,
    )
  );
}

function hasBoatTripConditionContent(content: string) {
  return /\b(boat|island\s+hopping|sugba|lagoon|boat\s+trip|boat\s+ride|marine)\b/i.test(content);
}

function hasRawMarineDetailIntent(content: string) {
  return (
    /\b(?:wave|swell)\s+(?:height|period|forecast)\b/i.test(content) ||
    /\b(?:marine|sea)\s+(?:forecast|data|details?|metrics?)\b/i.test(content) ||
    /\b(?:ocean\s+currents?|current\s+velocity|sea\s+level)\b/i.test(content)
  );
}

function hasConditionDecisionIntent(content: string) {
  return (
    /\b(?:should|safe|safety|okay|ok|worth|good|bad|avoid|go\s+ahead)\b/i.test(content) ||
    /\b(?:can|could)\b[^?.!]{0,48}\b(?:surf|swim|go|ride|drive|visit|take\s+(?:a|the)\s+boat)\b/i.test(
      content,
    )
  );
}

function isBareRideBoatFollowUp(latestContent: string, inheritedPlaceContext: string) {
  return (
    /\bride\b/i.test(latestContent) &&
    !/\b(scooter|motorbike|motor\s*bike|drive|road|land\s+tour)\b/i.test(latestContent) &&
    !hasBoatTripConditionContent(latestContent) &&
    hasBoatTripConditionContent(inheritedPlaceContext)
  );
}

function latestTurnHasConditionPlace(content: string) {
  return Boolean(inferConditionLocationFromContent(content) ?? inferConditionBeachName(content));
}

function isItineraryPlanningRequest(content: string) {
  if (!content.trim() || isExcludedItineraryRepairRequest(content)) {
    return false;
  }
  const hasActivityPlanSignal =
    /\b(today|tomorrow|this\s+(?:morning|afternoon|evening)|cloud\s*9|general\s+luna|dapa|pacifico|del\s+carmen|sugba|malinao|doot)\b/i.test(
      content,
    );
  const hasInitialThemeLanguage =
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      content,
    );
  const hasScopedDuration =
    /\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(content) ||
    /\bhalf[-\s]?day\b/i.test(content);
  const hasRouteWithStops = /\b(?:route|sequence)\b/i.test(content) && /\bstops?\b/i.test(content);
  const hasOpenEndedActivityPlanLanguage =
    /\b(?:what\s+should\s+i\s+do|what\s+can\s+i\s+do|things?\s+to\s+do|activities?|day\s+plan|plan\s+(?:my|a|an|the)\s+day)\b/i.test(
      content,
    );
  const hasScopedItineraryLanguage =
    hasInitialThemeLanguage ||
    (hasScopedDuration &&
      /\b(itinerary|plan|route|sequence|stops?|things?\s+to\s+do|activities?)\b/i.test(content)) ||
    hasRouteWithStops;
  return (
    hasInitialThemeLanguage ||
    hasScopedItineraryLanguage ||
    (hasOpenEndedActivityPlanLanguage && hasActivityPlanSignal)
  );
}

function isExcludedItineraryRepairRequest(content: string) {
  if (isItineraryReviewRequest(content)) {
    return true;
  }
  return (
    /\b(airport|flight|ferry|pier|port|transfer|pickup|pick\s+up|drop[-\s]?off|taxi|shuttle|transport|transportation|logistics?)\b/i.test(
      content,
    ) && !hasScopedLocalItineraryContent(content)
  );
}

function isItineraryReviewRequest(content: string) {
  return /\b(critique|review|audit|improve\s+my\s+itinerary|plan\s+my\s+(?:trip|vacation|holiday))\b/i.test(
    content,
  );
}

function hasScopedLocalItineraryContent(content: string) {
  return (
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      content,
    ) ||
    (/\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(content) &&
      /\b(food\s+crawl|crawl|things?\s+to\s+do|activities?|stops?|beaches?|sunset|dinner|lunch|breakfast|brunch|caf[eé]s?|restaurants?|eat)\b/i.test(
        content,
      )) ||
    (/\b(?:route|sequence)\b/i.test(content) && /\bstops?\b/i.test(content))
  );
}

function conditionRecommendationFromResult(result: AgentToolResult | undefined) {
  if (!isConditionRecord(result?.data)) {
    return undefined;
  }
  const judgment = result.data.judgment;
  return isConditionRecord(judgment) && typeof judgment.recommendation === "string"
    ? judgment.recommendation
    : undefined;
}

function conditionRecommendationVerdict(
  value: string | undefined,
): RealityCheckVerdict | undefined {
  if (value === "good") return "keep";
  if (value === "flexible") return "change";
  if (value === "avoid") return "avoid";
  if (value === "needs_local_confirmation") return "needs_confirmation";
  return undefined;
}

function readConditionStringPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isConditionRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function readConditionStringArrayPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isConditionRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return readConditionStrings(current);
}

function readConditionStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isConditionLocation(
  value: string | undefined,
): value is ConditionJudgmentRequest["location"] {
  return (
    value === "Siargao Island" ||
    value === "Cloud 9" ||
    value === "General Luna" ||
    value === "Del Carmen"
  );
}

function isConditionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConditionText(value: unknown) {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim().toLowerCase() : "";
}

function uniqueConditionText(values: readonly string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalized = value.replaceAll(/\s+/g, " ").trim();
        return normalized ? [normalized] : [];
      }),
    ),
  ];
}

function compact(values: readonly (string | undefined)[]) {
  return values.filter((value): value is string => Boolean(value));
}

function formatMetric(value: number | null | undefined, unit: string) {
  return value === null || value === undefined ? "unavailable" : `${value}${unit}`;
}

function normalizeConditionBeachName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(beach|area|access)\b/g, "")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_|_$/g, "");
}
