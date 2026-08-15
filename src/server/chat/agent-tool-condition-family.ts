import { z } from "zod";
import type { AgentToolResult } from "@/server/chat/agent-runtime";

import {
  type AgentToolDependencies,
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { formatNullableNumber, safeProviderUnavailableText } from "@/server/chat/agent-tool-utils";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  conditionJudgmentRequestSchema,
  conditionJudgmentToolParameters,
  judgeConditions,
  type MarineConditionsSnapshot,
} from "@/server/chat/condition-tools";
import { searchSiargaoLocalGuide } from "@/server/local/siargao-beaches";
import {
  type OpenMeteoForecastLocation,
  siargaoForecastLocations,
} from "@/server/providers/open-meteo";
import {
  buildOpenMeteoMarineIngestionBatch,
  type OpenMeteoMarineIngestionBatch,
  type OpenMeteoMarineLocation,
  siargaoMarineLocations,
} from "@/server/providers/open-meteo-marine";
import { isProductionProviderEnvironment } from "@/server/providers/production-provider-mode";
import { buildSiargaoTideSnapshot } from "@/server/providers/siargao-tide";
import {
  type TideForecastDateRange,
  type TideForecastSnapshot,
  tideForecastLocationForSiargaoLabel,
} from "@/server/providers/tide-forecast";
import {
  getLatestSiargaoWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

const weatherForecastLocations = [
  "Siargao Island",
  "Cloud 9",
  "General Luna",
  "Del Carmen",
] as const;
const marineConditionsLocations = weatherForecastLocations;
const tideForecastLocations = ["Siargao Island", "Cloud 9", "General Luna", "Dapa"] as const;

const weatherForecastSchema = z.strictObject({
  location: z.enum(weatherForecastLocations),
  date_range: z.enum(["today", "next_7_days"]),
});
const marineConditionsSchema = z.strictObject({
  location: z.enum(marineConditionsLocations),
  date_range: z.enum(["today", "next_48_hours"]),
});
const tideForecastSchema = z.strictObject({
  location: z.enum(tideForecastLocations),
  date_range: z.enum(["today", "tomorrow", "next_7_days"]),
});

export type WeatherForecastArguments = z.infer<typeof weatherForecastSchema>;
export type MarineConditionsArguments = z.infer<typeof marineConditionsSchema>;
export type TideForecastArguments = z.infer<typeof tideForecastSchema>;
export type ConditionJudgmentArguments = z.infer<typeof conditionJudgmentRequestSchema>;

export type ConditionToolHandlers = {
  getWeatherForecast: ToolHandler<WeatherForecastArguments>;
  getMarineConditions: ToolHandler<MarineConditionsArguments>;
  getTideForecast: ToolHandler<TideForecastArguments>;
  getConditionJudgment: ToolHandler<ConditionJudgmentArguments>;
};

export function createConditionToolFamily(
  handlers: ConditionToolHandlers = {
    getWeatherForecast: (args, _request, dependencies) =>
      getWeatherForecastToolResult(args, dependencies),
    getMarineConditions: (args, _request, dependencies) =>
      getMarineConditionsToolResult(args, dependencies),
    getTideForecast: (args, _request, dependencies) =>
      getTideForecastToolResult(args, dependencies),
    getConditionJudgment: (args, _request, dependencies) =>
      getConditionJudgmentToolResult(args, dependencies),
  },
): AgentToolFamily {
  return {
    id: "conditions",
    toolNames: [
      "get_weather_forecast",
      "get_marine_conditions",
      "get_tide_forecast",
      "get_condition_judgment",
    ],
    tools: {
      get_weather_forecast: defineTool({
        definition: {
          type: "function",
          name: "get_weather_forecast",
          description:
            "Get the governed Open-Meteo weather forecast snapshot for a known Siargao location.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: weatherForecastLocations,
                description: "Known Siargao forecast location label.",
              },
              date_range: {
                type: "string",
                enum: ["today", "next_7_days"],
                description: "Forecast range to summarize.",
              },
            },
            required: ["location", "date_range"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: weatherForecastSchema,
        execute: handlers.getWeatherForecast,
      }),
      get_marine_conditions: defineTool({
        definition: {
          type: "function",
          name: "get_marine_conditions",
          description:
            "Get governed Open-Meteo Marine model data for Siargao tide-proxy sea level, waves, swell, and ocean current. This is not official tide-table, navigation, or safety authority data.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: marineConditionsLocations,
                description: "Known Siargao marine forecast location label.",
              },
              date_range: {
                type: "string",
                enum: ["today", "next_48_hours"],
                description: "Marine model range to summarize.",
              },
            },
            required: ["location", "date_range"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: marineConditionsSchema,
        execute: handlers.getMarineConditions,
      }),
      get_tide_forecast: defineTool({
        definition: {
          type: "function",
          name: "get_tide_forecast",
          description:
            "Get Tide-Forecast Dapa predicted tide table data and embedded sea-condition periods for Siargao surf/tide timing during development/testing. This is not an official tide gauge, navigation aid, or safety clearance.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: tideForecastLocations,
                description: "Known Siargao tide forecast location label.",
              },
              date_range: {
                type: "string",
                enum: ["today", "tomorrow", "next_7_days"],
                description: "Tide forecast range to summarize.",
              },
            },
            required: ["location", "date_range"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: tideForecastSchema,
        execute: handlers.getTideForecast,
      }),
      get_condition_judgment: defineTool({
        definition: {
          type: "function",
          name: "get_condition_judgment",
          description:
            "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, checked Tide-Forecast tide/sea-period data when available, checked Open-Meteo Marine model data when available, curated local caveats, and explicit unchecked road, official-warning, lifeguard, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
          parameters: conditionJudgmentToolParameters,
          strict: true,
        },
        schema: conditionJudgmentRequestSchema,
        argumentDefaults: {
          beach_name: null,
          include_local_caveats: null,
          constraints: null,
        },
        execute: handlers.getConditionJudgment,
      }),
    },
  };
}

export async function getWeatherForecastToolResult(
  args: WeatherForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const getSnapshot =
    dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;

  try {
    const location = weatherForecastLocationForLabel(args.location);
    const snapshot = await getSnapshot(location ? { location } : {});
    const sourceSummary = weatherForecastSourceSummary(snapshot);
    return {
      name: "get_weather_forecast",
      status: snapshot.status === "live" ? "success" : "error",
      text: renderWeatherForecastText(snapshot, args),
      ...(snapshot.status === "live" ? {} : { errorCode: "provider_unavailable" }),
      data: normalizeWeatherSnapshot(snapshot, args),
      sources: [sourceSummary],
    };
  } catch {
    return {
      name: "get_weather_forecast",
      status: "error",
      text: safeProviderUnavailableText(weatherProviderName()),
      errorCode: "provider_unavailable",
      sources: [weatherProviderUnavailableSourceSummary(args.location)],
    };
  }
}

export async function getMarineConditionsToolResult(
  args: MarineConditionsArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  try {
    const snapshot = await getMarineConditionsSnapshot(args, dependencies);
    const sourceSummary = marineConditionsSourceSummary(snapshot);
    return {
      name: "get_marine_conditions",
      status: "success",
      text: renderMarineConditionsText(snapshot, args),
      data: normalizeMarineConditionsSnapshot(snapshot, args),
      sources: [sourceSummary],
    };
  } catch {
    return {
      name: "get_marine_conditions",
      status: "error",
      text: safeProviderUnavailableText("Open-Meteo Marine conditions", "are"),
      errorCode: "provider_unavailable",
      sources: [marineProviderUnavailableSourceSummary(args.location)],
    };
  }
}

export async function getTideForecastToolResult(
  args: TideForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  try {
    const snapshot = await getTideForecastSnapshot(args, dependencies);
    const sourceSummary = tideForecastSourceSummary(snapshot);
    return {
      name: "get_tide_forecast",
      status: "success",
      text: renderTideForecastText(snapshot),
      data: normalizeTideForecastSnapshot(snapshot),
      sources: [sourceSummary],
    };
  } catch {
    return {
      name: "get_tide_forecast",
      status: "error",
      text: safeProviderUnavailableText(tideProviderName()),
      errorCode: "provider_unavailable",
      sources: [tideForecastProviderUnavailableSourceSummary(args.location)],
    };
  }
}

export async function getConditionJudgmentToolResult(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const { decisionSummary, judgment, text } = await judgeConditions(args, {
    getWeatherSnapshot: async ({ location }) => {
      const getSnapshot =
        dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;
      const providerLocation = weatherForecastLocationForLabel(location);
      return getSnapshot(providerLocation ? { location: providerLocation } : {});
    },
    getMarineSnapshot: ({ dateRange, location }) =>
      getMarineConditionsSnapshot({ location, date_range: dateRange }, dependencies),
    getTideForecastSnapshot: ({ dateRange, location }) =>
      getTideForecastSnapshot(
        { location: tideForecastLocationForCondition(location), date_range: dateRange },
        dependencies,
      ),
    searchLocalGuide: searchSiargaoLocalGuide,
  });

  return {
    name: "get_condition_judgment",
    status: "success",
    text,
    data: {
      status: "available",
      judgment,
      decisionSummary,
    },
    sources: judgment.sources,
    decisionSummaries: [decisionSummary],
  };
}

async function getMarineConditionsSnapshot(
  args: MarineConditionsArguments,
  dependencies: AgentToolDependencies,
): Promise<MarineConditionsSnapshot> {
  const buildMarineBatch =
    dependencies.buildOpenMeteoMarineIngestionBatch ?? buildOpenMeteoMarineIngestionBatch;
  const location = marineConditionsLocationForLabel(args.location);
  const batch = await buildMarineBatch({
    fetchedAt: dependencies.now?.() ?? new Date(),
    ...(location ? { location } : {}),
  });
  return marineSnapshotFromBatch(batch);
}

async function getTideForecastSnapshot(
  args: TideForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<TideForecastSnapshot> {
  const buildSnapshot = dependencies.buildTideForecastSnapshot ?? buildSiargaoTideSnapshot;
  const location = tideForecastLocationForSiargaoLabel(args.location);
  return buildSnapshot({
    dateRange: args.date_range as TideForecastDateRange,
    fetchedAt: dependencies.now?.() ?? new Date(),
    location,
    requestedLocation: args.location,
  });
}

function weatherForecastLocationForLabel(
  label: WeatherForecastArguments["location"],
): OpenMeteoForecastLocation | undefined {
  if (label === "Del Carmen") {
    return siargaoForecastLocations.delCarmen;
  }

  if (label === "Cloud 9" || label === "General Luna") {
    return siargaoForecastLocations.generalLuna;
  }

  return undefined;
}

function marineConditionsLocationForLabel(
  label: MarineConditionsArguments["location"],
): OpenMeteoMarineLocation | undefined {
  if (label === "Del Carmen") {
    return siargaoMarineLocations.delCarmen;
  }

  if (label === "Cloud 9" || label === "General Luna") {
    return siargaoMarineLocations.generalLuna;
  }

  return undefined;
}

function tideForecastLocationForCondition(
  label: ConditionJudgmentArguments["location"],
): TideForecastArguments["location"] {
  return label === "Del Carmen" ? "Siargao Island" : label;
}

function marineSnapshotFromBatch(batch: OpenMeteoMarineIngestionBatch): MarineConditionsSnapshot {
  const summary = batch.summary;
  return {
    status: "live",
    locationName: batch.sourceRecord.name,
    sourceName: "Open-Meteo Marine API",
    sourceProfileId: "source_open_meteo_marine",
    fetchedAt: batch.rawSnapshot.fetchedAt,
    expiresAt: batch.refreshJob.scheduledAt,
    confidence: marineConfidenceFromBatch(batch),
    citationUrl: batch.requestUrl,
    evidenceIds: batch.evidence.map((evidence) => evidence.id),
    summary: renderMarineSummary(summary),
    current: {
      time: summary.current.time,
      seaLevelHeightMsl: summary.current.seaLevelHeightMsl,
      waveHeight: summary.current.waveHeight,
      swellWaveHeight: summary.current.swellWaveHeight,
      wavePeriod: summary.current.wavePeriod,
      swellWavePeriod: summary.current.swellWavePeriod,
      oceanCurrentVelocity: summary.current.oceanCurrentVelocity,
      seaSurfaceTemperature: summary.current.seaSurfaceTemperature,
    },
    metrics: {
      maxWaveHeight: summary.maxWaveHeight,
      maxSwellWaveHeight: summary.maxSwellWaveHeight,
      maxOceanCurrentVelocity: summary.maxOceanCurrentVelocity,
      minSeaLevelHeightMsl: summary.minSeaLevelHeightMsl,
      maxSeaLevelHeightMsl: summary.maxSeaLevelHeightMsl,
      seaLevelHeightRangeMsl: summary.seaLevelHeightRangeMsl,
    },
  };
}

function marineConfidenceFromBatch(batch: OpenMeteoMarineIngestionBatch) {
  return batch.facts.some((fact) => fact.confidenceLabel === "low") ? "low" : "medium";
}

function normalizeMarineConditionsSnapshot(
  snapshot: MarineConditionsSnapshot,
  args: MarineConditionsArguments,
) {
  return {
    requestedLocation: args.location,
    dateRange: args.date_range,
    status: snapshot.status,
    locationName: snapshot.locationName,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
    confidence: snapshot.confidence,
    citationUrl: snapshot.citationUrl,
    evidenceIds: snapshot.evidenceIds,
    summary: snapshot.summary,
    current: snapshot.current,
    metrics: snapshot.metrics,
    caveats: marineConditionsCaveats,
  };
}

function normalizeTideForecastSnapshot(snapshot: TideForecastSnapshot) {
  return {
    requestedLocation: snapshot.requestedLocation,
    dateRange: snapshot.dateRange,
    status: snapshot.status,
    stationName: snapshot.stationName,
    stationUrl: snapshot.stationUrl,
    stationLatitude: snapshot.stationLatitude,
    stationLongitude: snapshot.stationLongitude,
    proxyFor: snapshot.proxyFor,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    serverTime: snapshot.serverTime,
    forecastUpdatedAt: snapshot.forecastUpdatedAt,
    confidence: "low",
    targetDates: snapshot.targetDates,
    days: snapshot.days,
    seaPeriods: snapshot.seaPeriods,
    recommendedWindows: snapshot.recommendedWindows,
    caveats: snapshot.caveats,
  };
}

function normalizeWeatherSnapshot(snapshot: WeatherSnapshot, args: WeatherForecastArguments) {
  return {
    requestedLocation: args.location,
    dateRange: args.date_range,
    status: snapshot.status,
    locationName: snapshot.locationName,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
    freshness: snapshot.freshness,
    confidence: snapshot.confidence,
    citationUrl: snapshot.citationUrl,
    evidenceIds: snapshot.evidenceIds,
    summary: snapshot.summary,
    signals: weatherSignals(snapshot),
    today: snapshot.today,
    metrics: args.date_range === "next_7_days" ? snapshot.metrics : [],
  };
}

function renderWeatherForecastText(snapshot: WeatherSnapshot, args: WeatherForecastArguments) {
  const signals = weatherSignals(snapshot);
  if (snapshot.status !== "live") {
    return [
      `${weatherForecastDisplayName(snapshot)} is unavailable for ${args.location}.`,
      snapshot.summary,
      signals.length ? `Signals: ${signals.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const today = snapshot.today;
  return [
    `${snapshot.sourceName} forecast for ${snapshot.locationName}.`,
    `Today: ${today.condition}; precipitation probability ${formatNullableNumber(
      today.precipitationProbability,
      "%",
    )}; rain ${formatNullableNumber(today.rainSum, "mm")}; wind gust ${formatNullableNumber(
      today.windGust,
      "km/h",
    )}.`,
    args.date_range === "next_7_days" && snapshot.metrics.length
      ? `Seven-day signals: ${snapshot.metrics
          .map((metric) => `${metric.label} ${metric.value}${metric.unit} on ${metric.peakDate}`)
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const marineConditionsCaveats = [
  "Open-Meteo Marine is modelled marine forecast data, not an official tide table or tide-gauge measurement.",
  "Navigation, lifeguard or swimming safety, rip currents, official marine warnings, and local operator calls were not checked.",
];

function renderMarineConditionsText(
  snapshot: MarineConditionsSnapshot,
  args: MarineConditionsArguments,
) {
  return [
    `${snapshot.sourceName} modelled marine conditions for ${snapshot.locationName}.`,
    `Current: sea level ${formatNullableNumber(
      snapshot.current.seaLevelHeightMsl,
      "m MSL",
    )}; wave ${formatNullableNumber(snapshot.current.waveHeight, "m")}; swell ${formatNullableNumber(
      snapshot.current.swellWaveHeight,
      "m",
    )}; ocean current ${formatNullableNumber(snapshot.current.oceanCurrentVelocity, "km/h")}.`,
    args.date_range === "next_48_hours"
      ? `Next-48-hour signals: max wave ${formatNullableNumber(
          snapshot.metrics.maxWaveHeight,
          "m",
        )}; max swell ${formatNullableNumber(
          snapshot.metrics.maxSwellWaveHeight,
          "m",
        )}; sea-level range ${formatNullableNumber(
          snapshot.metrics.seaLevelHeightRangeMsl,
          "m",
        )}; max ocean current ${formatNullableNumber(
          snapshot.metrics.maxOceanCurrentVelocity,
          "km/h",
        )}.`
      : "",
    `Caveat: ${marineConditionsCaveats.join(" ")}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function renderTideForecastText(snapshot: TideForecastSnapshot) {
  const tideLines = snapshot.days.map((day) => {
    const events = day.tides
      .filter((tide) => tide.type === "high" || tide.type === "low")
      .slice(0, 4)
      .map((tide) => `${tide.type} ${tide.time} ${formatNullableNumber(tide.heightMeters, "m")}`)
      .join("; ");
    return `${day.date}: ${events || "no high/low tide events available"}`;
  });
  const windowLines = snapshot.recommendedWindows.map(
    (window) => `${window.localLabel} (${window.reason})`,
  );
  return [
    `${snapshot.sourceName} predicted tide data for ${snapshot.requestedLocation} using ${snapshot.stationName}.`,
    `Tides: ${tideLines.join(" | ")}.`,
    windowLines.length
      ? `Best daylight surf/tide windows from available tide and sea-period data: ${windowLines.join(" | ")}.`
      : "No ranked daylight tide window was available from the modeled data.",
    `Caveat: ${snapshot.caveats.join(" ")}`,
  ].join(" ");
}

function renderMarineSummary(summary: OpenMeteoMarineIngestionBatch["summary"]) {
  return [
    `current modelled sea level ${formatNullableNumber(
      summary.current.seaLevelHeightMsl,
      "m MSL",
    )}`,
    `wave ${formatNullableNumber(summary.current.waveHeight, "m")}`,
    `swell ${formatNullableNumber(summary.current.swellWaveHeight, "m")}`,
    `ocean current ${formatNullableNumber(summary.current.oceanCurrentVelocity, "km/h")}`,
    `forecast sea-level range ${formatNullableNumber(summary.seaLevelHeightRangeMsl, "m")}`,
  ].join("; ");
}

function weatherSignals(snapshot: WeatherSnapshot) {
  const today = snapshot.today;
  const signals = [today.condition];
  if (today.precipitationProbability !== null) {
    signals.push(`precipitation probability ${today.precipitationProbability}%`);
  }
  if (today.rainSum !== null) {
    signals.push(`rain ${today.rainSum}mm`);
  }
  if (today.windGust !== null) {
    signals.push(`wind gust ${today.windGust}km/h`);
  }
  signals.push(`${today.level} weather risk`);
  return signals;
}

function weatherForecastSourceSummary(snapshot: WeatherSnapshot): AnswerSourceSummary {
  if (snapshot.status === "live") {
    return {
      label: "weather_checked",
      sourceName: snapshot.sourceName,
      sourceProfileId: snapshot.sourceProfileId,
      fetchedAt: snapshot.fetchedAt,
      confidence: snapshot.confidence,
      checked: [`forecast for ${snapshot.locationName}`],
      notChecked: ["surf/swell reports", "tides", "road flooding", "bookings", "review text"],
    };
  }

  return weatherProviderUnavailableSourceSummary(snapshot.locationName);
}

function marineConditionsSourceSummary(snapshot: MarineConditionsSnapshot): AnswerSourceSummary {
  return {
    label: "marine_checked",
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    confidence: snapshot.confidence,
    checked: [
      `modelled sea level height MSL (tide proxy) for ${snapshot.locationName}`,
      "modelled wave height",
      "modelled swell wave height",
      "modelled ocean current velocity",
    ],
    notChecked: [
      "official tide table",
      "tide-gauge measurement",
      "navigation safety",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
      "local operator call",
    ],
  };
}

function tideForecastSourceSummary(snapshot: TideForecastSnapshot): AnswerSourceSummary {
  const checked =
    snapshot.sourceProfileId === "source_tide_forecast_dev"
      ? [
          `Tide-Forecast ${snapshot.stationName} predicted tide table for ${snapshot.targetDates.join(", ")}`,
          "predicted high and low tide times",
          "predicted tide heights",
          ...(snapshot.seaPeriods.length > 0
            ? ["embedded Tide-Forecast 3-hour swell and wind periods"]
            : []),
        ]
      : [
          `${snapshot.sourceName} high and low water times for ${snapshot.targetDates.join(", ")}`,
          "modeled tide heights",
        ];
  return {
    label: "tide_forecast_checked",
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    confidence: "low",
    checked,
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
}

function weatherForecastDisplayName(snapshot: WeatherSnapshot) {
  return snapshot.sourceProfileId === "source_open_meteo"
    ? "Open-Meteo weather forecast"
    : "MET Norway weather forecast";
}

function weatherProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  const production = isProductionProviderEnvironment();
  return {
    label: "provider_unavailable",
    sourceName: production ? "MET Norway Locationforecast" : "Open-Meteo weather API",
    sourceProfileId: production ? "source_met_norway" : "source_open_meteo",
    confidence: "low",
    checked: [],
    notChecked: [
      `${production ? "MET Norway" : "Open-Meteo"} forecast for ${locationName}`,
      "surf/swell reports",
      "tides",
      "road flooding",
      "bookings",
      "review text",
    ],
  };
}

function marineProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Open-Meteo Marine API",
    sourceProfileId: "source_open_meteo_marine",
    confidence: "low",
    checked: [],
    notChecked: [
      `Open-Meteo Marine modelled conditions for ${locationName}`,
      "modelled sea level height MSL",
      "modelled wave height",
      "modelled swell wave height",
      "modelled ocean current velocity",
      "official tide table",
      "navigation safety",
      "official marine warnings",
    ],
  };
}

function tideForecastProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  const production = isProductionProviderEnvironment();
  return {
    label: "provider_unavailable",
    sourceName: production ? "NOAA/PacIOOS Pacific tide model" : "Tide-Forecast Dapa page",
    sourceProfileId: production ? "source_pacioos_tide" : "source_tide_forecast_dev",
    confidence: "low",
    checked: [],
    notChecked: [
      `Modeled tide data for ${locationName}`,
      "modeled high and low water times",
      "modeled tide heights",
      "official tide-gauge measurement",
      "official marine warnings",
    ],
  };
}

function weatherProviderName() {
  return isProductionProviderEnvironment()
    ? "MET Norway weather forecast"
    : "Open-Meteo weather forecast";
}

function tideProviderName() {
  return isProductionProviderEnvironment()
    ? "NOAA/PacIOOS modeled tide data"
    : "Tide-Forecast tide data";
}
