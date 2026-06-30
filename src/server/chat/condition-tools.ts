import { z } from "zod";

import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import type { LocalGuideSearchResult } from "@/server/local/siargao-beaches";
import type { TideForecastSnapshot } from "@/server/providers/tide-forecast";
import type { WeatherSnapshot } from "@/server/public-pages/weather-snapshot";

export const conditionSignalKinds = ["weather", "tide", "surf", "road", "manual_caveat"] as const;
export const conditionSignalStatuses = ["checked", "not_checked", "unavailable"] as const;
export const conditionRiskLevels = ["low", "medium", "high"] as const;
export const conditionActivities = [
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

export type BuildConditionJudgmentInput = {
  request: ConditionJudgmentRequest;
  weatherSnapshot?: WeatherSnapshot | null;
  marineSnapshot?: MarineConditionsSnapshot | null;
  tideForecastSnapshot?: TideForecastSnapshot | null;
  localGuideResult?: LocalGuideSearchResult | null;
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

export function buildConditionJudgment(input: BuildConditionJudgmentInput): ConditionJudgment {
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
  if (!["swimming", "surfing", "boat_trip"].includes(activity)) {
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
