import { z } from "zod";

import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import type { LocalGuideSearchResult } from "@/server/local/siargao-beaches";
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
  "curated_local_guide",
  "weather_checked",
  "not_verified",
  "provider_unavailable",
] as const satisfies readonly AnswerTrustLabel[];

export const conditionSourceSummarySchema = z
  .object({
    label: z.enum(answerTrustLabels),
    sourceName: z.string().min(1),
    sourceProfileId: z.string().min(1).optional(),
    fetchedAt: z.string().min(1).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    checked: z.array(z.string().min(1)),
    notChecked: z.array(z.string().min(1)),
  })
  .strict();

export const conditionSignalSchema = z
  .object({
    kind: z.enum(conditionSignalKinds),
    status: z.enum(conditionSignalStatuses),
    level: z.enum(conditionRiskLevels),
    label: z.string().min(1),
    summary: z.string().min(1),
    checked: z.array(z.string().min(1)),
    notChecked: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    source: conditionSourceSummarySchema,
  })
  .strict();

export const conditionJudgmentSchema = z
  .object({
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
  })
  .strict();

export const conditionJudgmentRequestSchema = z
  .object({
    activity: z.enum(conditionActivities),
    location: z.enum(["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"]),
    date_range: z.enum(["today", "next_7_days"]),
    beach_name: z.string().min(1).nullable(),
    include_local_caveats: z.boolean().nullable(),
    constraints: z.array(z.string().min(1)).nullable(),
  })
  .strict();

export type ConditionSignal = z.infer<typeof conditionSignalSchema>;
export type ConditionJudgment = z.infer<typeof conditionJudgmentSchema>;
export type ConditionJudgmentRequest = z.infer<typeof conditionJudgmentRequestSchema>;

export type BuildConditionJudgmentInput = {
  request: ConditionJudgmentRequest;
  weatherSnapshot?: WeatherSnapshot | null;
  localGuideResult?: LocalGuideSearchResult | null;
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

export function buildConditionJudgment(input: BuildConditionJudgmentInput): ConditionJudgment {
  const request = conditionJudgmentRequestSchema.parse(input.request);
  const weatherSignal = buildWeatherSignal(input.weatherSnapshot);
  const signals = [
    weatherSignal,
    ...buildUncheckedMarineSignals(request.activity),
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
    alternatives: alternativesFor(request.activity, recommendation),
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

function buildWeatherSignal(weatherSnapshot: WeatherSnapshot | null | undefined): ConditionSignal {
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
  const level = highestRiskLevel([
    today.level,
    precipitationProbabilityRiskLevel(today.precipitationProbability),
    rainSumRiskLevel(today.rainSum ?? today.precipitationSum),
    windSpeedRiskLevel(today.windSpeed),
    windGustRiskLevel(today.windGust),
  ]);
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
    summary: weatherSignalSummary(weatherSnapshot, level),
    checked: source.checked,
    notChecked: source.notChecked,
    evidenceIds: weatherSnapshot.evidenceIds,
    source,
  };
}

function buildUncheckedMarineSignals(activity: ConditionJudgmentRequest["activity"]) {
  if (!["swimming", "surfing", "boat_trip"].includes(activity)) {
    return [];
  }
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
    summary: "No tide provider is integrated in this implementation slice.",
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
    summary: "No surf, swell, or current provider is integrated in this implementation slice.",
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
  if (!localGuideResult || request.include_local_caveats === false) {
    return [];
  }
  const candidate = localGuideResult.candidates[0];
  const source = localGuideResult.sourceSummary;
  return [
    {
      kind: "manual_caveat",
      status: "checked",
      level: candidate?.confidence === "high" ? "low" : "medium",
      label: "Curated local caveat",
      summary:
        candidate?.caveats[0] ??
        localGuideResult.caveats[0] ??
        "Curated local guide caveats apply.",
      checked: source.checked,
      notChecked: source.notChecked,
      evidenceIds: candidate ? [`curated_local_guide:${slugify(candidate.name)}`] : [],
      source,
    } satisfies ConditionSignal,
  ];
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
  if (activity === "surfing" || activity === "boat_trip") {
    return "needs_local_confirmation";
  }
  if (weatherSignal?.level === "medium" || hasUncheckedMarineSignal(signals)) {
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
    signals.some((signal) => signal.kind === "road")
      ? "Road flooding and closure signals are explicitly not checked."
      : undefined,
    request.constraints?.length
      ? `Traveler constraints preserved: ${request.constraints.join("; ")}.`
      : undefined,
    recommendation === "avoid"
      ? "The checked weather risk is high enough to favor a safer alternative."
      : undefined,
  ];
  return compact(reasons).slice(0, 5);
}

function alternativesFor(
  activity: ConditionJudgmentRequest["activity"],
  recommendation: ConditionJudgment["recommendation"],
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
    return ["Use a close sandy beach only after confirming tide, surf, and currents in person."];
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
    hasUncheckedMarineSignal(signals)
      ? "Tide, surf, swell, currents, and lifeguard status were not checked."
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

function weatherSignalSummary(weatherSnapshot: WeatherSnapshot, level: ConditionSignal["level"]) {
  const today = weatherSnapshot.today;
  return [
    `${today.condition} for ${weatherSnapshot.locationName}`,
    `risk ${level}`,
    `precipitation probability ${formatMetric(today.precipitationProbability, "%")}`,
    `rain ${formatMetric(today.rainSum ?? today.precipitationSum, "mm")}`,
    `wind gust ${formatMetric(today.windGust, "km/h")}`,
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_|_$/g, "");
}
