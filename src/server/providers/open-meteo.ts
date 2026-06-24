import { createHash } from "node:crypto";

import {
  createGovernedEvidence,
  createGovernedFact,
  normalizeSourceRecord,
} from "@/server/facts/fact-graph";
import {
  computeFactConfidence,
  computeSourceCredibility,
  toFactConfidenceScoreRecord,
  toSourceCredibilityScoreRecord,
} from "@/server/facts/scoring";
import type {
  GovernedEvidence,
  GovernedFact,
  NormalizedSourceRecord,
  RawSnapshotReference,
} from "@/server/facts/types";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type { SourceRegistry } from "@/server/providers/source-registry";

const openMeteoForecastEndpoint = "https://api.open-meteo.com/v1/forecast";
const sourceProfileId = "source_open_meteo";
const forecastRecordId = "record_open_meteo_siargao_forecast";
const rawSnapshotId = "raw_open_meteo_siargao_forecast";
const forecastProviderEntityId = "open_meteo_siargao_forecast";
const timezone = "Asia/Manila";

export type OpenMeteoForecastLocation = {
  id: "siargao_general_luna" | "siargao_del_carmen";
  name: string;
  latitude: number;
  longitude: number;
};

export const siargaoForecastLocations = {
  generalLuna: {
    id: "siargao_general_luna",
    name: "Siargao forecast near General Luna",
    latitude: 9.784,
    longitude: 126.158,
  },
  delCarmen: {
    id: "siargao_del_carmen",
    name: "Siargao forecast near Del Carmen",
    latitude: 9.869,
    longitude: 125.969,
  },
} as const satisfies Record<string, OpenMeteoForecastLocation>;

const defaultSiargaoForecastLocation: OpenMeteoForecastLocation =
  siargaoForecastLocations.generalLuna;

const dailyVariables = [
  "weather_code",
  "precipitation_sum",
  "precipitation_probability_max",
  "rain_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
] as const;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenMeteoForecastDaily = {
  time: string[];
  weather_code: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  rain_sum: number[];
  wind_speed_10m_max: number[];
  wind_gusts_10m_max: number[];
};

export type OpenMeteoForecastResponse = {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  elevation?: number;
  daily_units?: Record<string, string>;
  daily: OpenMeteoForecastDaily;
};

export type OpenMeteoWeatherSummary = {
  forecastDays: number;
  todayForecast: {
    date: string;
    weatherCode: number;
    precipitationProbability: number;
    precipitationSum: number;
    rainSum: number;
    windSpeed: number;
    windGust: number;
  };
  maxPrecipitationProbability: number;
  maxPrecipitationDate: string;
  maxRainSum: number;
  maxRainDate: string;
  maxWindGust: number;
  maxWindGustDate: string;
};

export type OpenMeteoIngestionBatch = {
  sourceRecord: NormalizedSourceRecord;
  rawSnapshot: RawSnapshotReference;
  rawPayload: OpenMeteoForecastResponse;
  facts: GovernedFact[];
  evidence: GovernedEvidence[];
  sourceCredibilityScore: ReturnType<typeof toSourceCredibilityScoreRecord>;
  factConfidenceScores: ReturnType<typeof toFactConfidenceScoreRecord>[];
  refreshJob: {
    id: string;
    factId: string;
    sourceProfileId: string;
    refreshReason: string;
    priority: number;
    providerBudget: Record<string, unknown>;
    scheduledAt: string;
    resultStatus: "scheduled";
  };
  requestUrl: string;
  summary: OpenMeteoWeatherSummary;
};

export function buildOpenMeteoForecastUrl(location = defaultSiargaoForecastLocation) {
  const url = new URL(openMeteoForecastEndpoint);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("daily", dailyVariables.join(","));
  return url.toString();
}

async function fetchOpenMeteoForecast(
  fetcher: FetchLike = fetch,
  location = defaultSiargaoForecastLocation,
): Promise<{ requestUrl: string; payload: OpenMeteoForecastResponse }> {
  const requestUrl = buildOpenMeteoForecastUrl(location);
  const response = await fetcher(requestUrl, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo forecast request failed with HTTP ${response.status}.`);
  }

  const payload = parseOpenMeteoForecastResponse(await response.json());
  return { requestUrl, payload };
}

export async function buildOpenMeteoIngestionBatch(input: {
  fetchedAt?: Date;
  fetcher?: FetchLike;
  location?: OpenMeteoForecastLocation;
  registry?: SourceRegistry;
}) {
  const fetchedAt = input.fetchedAt ?? new Date();
  const fetchedAtIso = fetchedAt.toISOString();
  const registry = input.registry ?? createDefaultSourceRegistry();
  const location = input.location ?? defaultSiargaoForecastLocation;
  const { requestUrl, payload } = await fetchOpenMeteoForecast(input.fetcher, location);
  return createOpenMeteoIngestionBatch({
    fetchedAt: fetchedAtIso,
    location,
    payload,
    registry,
    requestUrl,
  });
}

export function createOpenMeteoIngestionBatch(input: {
  fetchedAt: string;
  location?: OpenMeteoForecastLocation;
  payload: OpenMeteoForecastResponse;
  registry?: SourceRegistry;
  requestUrl?: string;
}): OpenMeteoIngestionBatch {
  const registry = input.registry ?? createDefaultSourceRegistry();
  const profile = registry.require(sourceProfileId);
  const location = input.location ?? defaultSiargaoForecastLocation;
  const requestUrl = input.requestUrl ?? buildOpenMeteoForecastUrl(location);
  const fetchedAt = new Date(input.fetchedAt);
  const expiresAt = addDays(fetchedAt, profile.freshnessWindowDays).toISOString();
  const payload = parseOpenMeteoForecastResponse(input.payload);
  const summary = summarizeOpenMeteoForecast(payload);
  const rawSnapshot: RawSnapshotReference = {
    id: rawSnapshotId,
    sourceProfileId,
    fetchedAt: input.fetchedAt,
    contentHash: sha256(JSON.stringify(payload)),
    allowedUse: profile.allowedUse,
  };
  const sourceRecord = normalizeSourceRecord(registry, {
    id: forecastRecordId,
    sourceProfileId,
    providerEntityId: forecastProviderEntityId,
    entityType: "weather",
    name: location.name,
    sourceUrl: requestUrl,
    fetchedAt: input.fetchedAt,
    normalizedPayload: {
      forecastDays: summary.forecastDays,
      location,
      maxPrecipitationDate: summary.maxPrecipitationDate,
      maxPrecipitationProbability: summary.maxPrecipitationProbability,
      maxRainDate: summary.maxRainDate,
      maxRainSum: summary.maxRainSum,
      maxWindGust: summary.maxWindGust,
      maxWindGustDate: summary.maxWindGustDate,
      timezone: payload.timezone ?? timezone,
      todayForecast: summary.todayForecast,
    },
    rawSnapshot,
  });
  const factInputs = [
    {
      id: "fact_open_meteo_siargao_forecast_freshness",
      claim: `Open-Meteo forecast for Siargao was fetched on ${input.fetchedAt}.`,
      factType: "weather_forecast_freshness",
      notes:
        "Forecast facts expire daily and should be refreshed before payment when weather is critical.",
    },
    {
      id: "fact_open_meteo_siargao_precipitation_probability",
      claim: `Maximum daily precipitation probability in the next ${summary.forecastDays} days is ${summary.maxPrecipitationProbability}%.`,
      factType: "weather_precipitation_risk",
      notes: `Peak probability date: ${summary.maxPrecipitationDate}.`,
    },
    {
      id: "fact_open_meteo_siargao_rain_sum",
      claim: `Maximum forecast daily rain sum in the next ${summary.forecastDays} days is ${summary.maxRainSum} mm.`,
      factType: "weather_rain_volume_risk",
      notes: `Peak rain date: ${summary.maxRainDate}.`,
    },
    {
      id: "fact_open_meteo_siargao_wind_gusts",
      claim: `Maximum forecast wind gust in the next ${summary.forecastDays} days is ${summary.maxWindGust} km/h.`,
      factType: "weather_wind_risk",
      notes: `Peak gust date: ${summary.maxWindGustDate}.`,
    },
  ];
  const facts = factInputs.map((fact) =>
    createGovernedFact(registry, sourceRecord, {
      ...fact,
      fetchedAt: input.fetchedAt,
      verifiedAt: input.fetchedAt,
      expiresAt,
    }),
  );
  const evidence = facts.map((fact) =>
    createGovernedEvidence(registry, fact, {
      id: `ev_${fact.id.replace(/^fact_/, "")}`,
      factId: fact.id,
      sourceRecordId: sourceRecord.id,
      label: "Open-Meteo forecast API response",
      citationUrl: requestUrl,
      citationText: "Open-Meteo forecast API response for Siargao coordinates.",
    }),
  );
  const sourceCredibility = computeSourceCredibility(profile);
  const sourceCredibilityScore = toSourceCredibilityScoreRecord(sourceProfileId, sourceCredibility);
  const factConfidenceScores = facts.map((fact) =>
    toFactConfidenceScoreRecord(
      fact.id,
      computeFactConfidence({
        fact,
        sourceCredibility,
        corroboratingSources: 1,
        matchStatus: "confident",
        isFresh: true,
        hasConflict: false,
        directlyStated: true,
      }),
    ),
  );

  return {
    sourceRecord,
    rawSnapshot,
    rawPayload: payload,
    facts,
    evidence,
    sourceCredibilityScore,
    factConfidenceScores,
    refreshJob: {
      id: "refresh_open_meteo_siargao_forecast",
      factId: facts[0]?.id ?? "fact_open_meteo_siargao_forecast_freshness",
      sourceProfileId,
      refreshReason: "scheduled_weather_forecast_refresh",
      priority: 90,
      providerBudget: {
        adapterId: "adapter_open_meteo",
        maxAttempts: 3,
        sourceRecordId: sourceRecord.id,
      },
      scheduledAt: expiresAt,
      resultStatus: "scheduled",
    },
    requestUrl,
    summary,
  };
}

export function parseOpenMeteoForecastResponse(payload: unknown): OpenMeteoForecastResponse {
  if (!isRecord(payload)) {
    throw new Error("Open-Meteo response must be an object.");
  }

  const daily = payload.daily;
  if (!isRecord(daily)) {
    throw new Error("Open-Meteo response missing daily forecast data.");
  }

  const parsed: OpenMeteoForecastResponse = {
    latitude: requireNumber(payload.latitude, "latitude"),
    longitude: requireNumber(payload.longitude, "longitude"),
    generationtime_ms: optionalNumber(payload.generationtime_ms, "generationtime_ms"),
    utc_offset_seconds: optionalNumber(payload.utc_offset_seconds, "utc_offset_seconds"),
    timezone: optionalString(payload.timezone, "timezone"),
    timezone_abbreviation: optionalString(payload.timezone_abbreviation, "timezone_abbreviation"),
    elevation: optionalNumber(payload.elevation, "elevation"),
    daily_units: isRecord(payload.daily_units)
      ? Object.fromEntries(
          Object.entries(payload.daily_units).filter((entry): entry is [string, string] => {
            return typeof entry[1] === "string";
          }),
        )
      : undefined,
    daily: {
      time: requireStringArray(daily.time, "daily.time"),
      weather_code: requireNumberArray(daily.weather_code, "daily.weather_code"),
      precipitation_sum: requireNumberArray(daily.precipitation_sum, "daily.precipitation_sum"),
      precipitation_probability_max: requireNumberArray(
        daily.precipitation_probability_max,
        "daily.precipitation_probability_max",
      ),
      rain_sum: requireNumberArray(daily.rain_sum, "daily.rain_sum"),
      wind_speed_10m_max: requireNumberArray(daily.wind_speed_10m_max, "daily.wind_speed_10m_max"),
      wind_gusts_10m_max: requireNumberArray(daily.wind_gusts_10m_max, "daily.wind_gusts_10m_max"),
    },
  };

  const expectedLength = parsed.daily.time.length;
  for (const variable of dailyVariables) {
    if (parsed.daily[variable].length !== expectedLength) {
      throw new Error(`Open-Meteo daily.${variable} length does not match daily.time.`);
    }
  }
  if (expectedLength === 0) {
    throw new Error("Open-Meteo response contains no forecast days.");
  }

  return parsed;
}

export function summarizeOpenMeteoForecast(
  payload: OpenMeteoForecastResponse,
): OpenMeteoWeatherSummary {
  const parsed = parseOpenMeteoForecastResponse(payload);
  const maxPrecipitation = maxValueWithDate(
    parsed.daily.precipitation_probability_max,
    parsed.daily.time,
  );
  const maxRain = maxValueWithDate(parsed.daily.rain_sum, parsed.daily.time);
  const maxWindGust = maxValueWithDate(parsed.daily.wind_gusts_10m_max, parsed.daily.time);

  return {
    forecastDays: parsed.daily.time.length,
    todayForecast: {
      date: parsed.daily.time[0] ?? "unknown",
      weatherCode: parsed.daily.weather_code[0] ?? 0,
      precipitationProbability: parsed.daily.precipitation_probability_max[0] ?? 0,
      precipitationSum: parsed.daily.precipitation_sum[0] ?? 0,
      rainSum: parsed.daily.rain_sum[0] ?? 0,
      windSpeed: parsed.daily.wind_speed_10m_max[0] ?? 0,
      windGust: parsed.daily.wind_gusts_10m_max[0] ?? 0,
    },
    maxPrecipitationProbability: maxPrecipitation.value,
    maxPrecipitationDate: maxPrecipitation.date,
    maxRainSum: maxRain.value,
    maxRainDate: maxRain.date,
    maxWindGust: maxWindGust.value,
    maxWindGustDate: maxWindGust.date,
  };
}

function maxValueWithDate(values: readonly number[], dates: readonly string[]) {
  let maxIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (
      (values[index] ?? Number.NEGATIVE_INFINITY) > (values[maxIndex] ?? Number.NEGATIVE_INFINITY)
    ) {
      maxIndex = index;
    }
  }
  return {
    value: values[maxIndex] ?? 0,
    date: dates[maxIndex] ?? "unknown",
  };
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Open-Meteo ${label} must be a finite number.`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }
  return requireNumber(value, label);
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Open-Meteo ${label} must be a string.`);
  }
  return value;
}

function requireNumberArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new Error(`Open-Meteo ${label} must be a number array.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Open-Meteo ${label} must be a string array.`);
  }
  return value;
}
