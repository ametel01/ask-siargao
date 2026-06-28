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
import type { FetchLike } from "@/server/providers/open-meteo";
import type { SourceRegistry } from "@/server/providers/source-registry";

const openMeteoMarineEndpoint = "https://marine-api.open-meteo.com/v1/marine";
const sourceProfileId = "source_open_meteo_marine";
const marineRecordId = "record_open_meteo_siargao_marine";
const rawSnapshotId = "raw_open_meteo_siargao_marine";
const marineProviderEntityId = "open_meteo_siargao_marine";
const timezone = "Asia/Manila";

export type OpenMeteoMarineLocation = {
  id: "siargao_general_luna_marine" | "siargao_del_carmen_marine";
  name: string;
  latitude: number;
  longitude: number;
};

export const siargaoMarineLocations = {
  generalLuna: {
    id: "siargao_general_luna_marine",
    name: "Siargao marine forecast near General Luna",
    latitude: 9.784,
    longitude: 126.158,
  },
  delCarmen: {
    id: "siargao_del_carmen_marine",
    name: "Siargao marine forecast near Del Carmen",
    latitude: 9.869,
    longitude: 125.969,
  },
} as const satisfies Record<string, OpenMeteoMarineLocation>;

const defaultSiargaoMarineLocation: OpenMeteoMarineLocation = siargaoMarineLocations.generalLuna;

const currentVariables = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "sea_level_height_msl",
  "sea_surface_temperature",
  "ocean_current_velocity",
  "ocean_current_direction",
] as const;

const hourlyVariables = [
  "wave_height",
  "swell_wave_height",
  "sea_level_height_msl",
  "ocean_current_velocity",
] as const;

type NullableNumber = number | null;

export type OpenMeteoMarineCurrent = {
  time: string;
  interval?: number;
  wave_height: NullableNumber;
  wave_direction: NullableNumber;
  wave_period: NullableNumber;
  swell_wave_height: NullableNumber;
  swell_wave_direction: NullableNumber;
  swell_wave_period: NullableNumber;
  sea_level_height_msl: NullableNumber;
  sea_surface_temperature: NullableNumber;
  ocean_current_velocity: NullableNumber;
  ocean_current_direction: NullableNumber;
};

export type OpenMeteoMarineHourly = {
  time: string[];
  wave_height: NullableNumber[];
  swell_wave_height: NullableNumber[];
  sea_level_height_msl: NullableNumber[];
  ocean_current_velocity: NullableNumber[];
};

export type OpenMeteoMarineResponse = {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  elevation?: number;
  current_units?: Record<string, string>;
  current: OpenMeteoMarineCurrent;
  hourly_units?: Record<string, string>;
  hourly: OpenMeteoMarineHourly;
};

export type OpenMeteoMarineSummary = {
  forecastHours: number;
  current: {
    time: string;
    waveHeight: NullableNumber;
    waveDirection: NullableNumber;
    wavePeriod: NullableNumber;
    swellWaveHeight: NullableNumber;
    swellWaveDirection: NullableNumber;
    swellWavePeriod: NullableNumber;
    seaLevelHeightMsl: NullableNumber;
    seaSurfaceTemperature: NullableNumber;
    oceanCurrentVelocity: NullableNumber;
    oceanCurrentDirection: NullableNumber;
  };
  maxWaveHeight: NullableNumber;
  maxWaveHeightTime: string;
  maxSwellWaveHeight: NullableNumber;
  maxSwellWaveHeightTime: string;
  maxOceanCurrentVelocity: NullableNumber;
  maxOceanCurrentVelocityTime: string;
  minSeaLevelHeightMsl: NullableNumber;
  minSeaLevelHeightMslTime: string;
  maxSeaLevelHeightMsl: NullableNumber;
  maxSeaLevelHeightMslTime: string;
  seaLevelHeightRangeMsl: NullableNumber;
};

export type OpenMeteoMarineIngestionBatch = {
  sourceRecord: NormalizedSourceRecord;
  rawSnapshot: RawSnapshotReference;
  rawPayload: OpenMeteoMarineResponse;
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
  summary: OpenMeteoMarineSummary;
};

export function buildOpenMeteoMarineUrl(location = defaultSiargaoMarineLocation) {
  const url = new URL(openMeteoMarineEndpoint);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("current", currentVariables.join(","));
  url.searchParams.set("hourly", hourlyVariables.join(","));
  return url.toString();
}

async function fetchOpenMeteoMarine(
  fetcher: FetchLike = fetch,
  location = defaultSiargaoMarineLocation,
): Promise<{ requestUrl: string; payload: OpenMeteoMarineResponse }> {
  const requestUrl = buildOpenMeteoMarineUrl(location);
  const response = await fetcher(requestUrl, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo marine request failed with HTTP ${response.status}.`);
  }

  const payload = parseOpenMeteoMarineResponse(await response.json());
  return { requestUrl, payload };
}

export async function buildOpenMeteoMarineIngestionBatch(input: {
  fetchedAt?: Date;
  fetcher?: FetchLike;
  location?: OpenMeteoMarineLocation;
  registry?: SourceRegistry;
}) {
  const fetchedAt = input.fetchedAt ?? new Date();
  const fetchedAtIso = fetchedAt.toISOString();
  const registry = input.registry ?? createDefaultSourceRegistry();
  const location = input.location ?? defaultSiargaoMarineLocation;
  const { requestUrl, payload } = await fetchOpenMeteoMarine(input.fetcher, location);
  return createOpenMeteoMarineIngestionBatch({
    fetchedAt: fetchedAtIso,
    location,
    payload,
    registry,
    requestUrl,
  });
}

export function createOpenMeteoMarineIngestionBatch(input: {
  fetchedAt: string;
  location?: OpenMeteoMarineLocation;
  payload: OpenMeteoMarineResponse;
  registry?: SourceRegistry;
  requestUrl?: string;
}): OpenMeteoMarineIngestionBatch {
  const registry = input.registry ?? createDefaultSourceRegistry();
  const profile = registry.require(sourceProfileId);
  const location = input.location ?? defaultSiargaoMarineLocation;
  const requestUrl = input.requestUrl ?? buildOpenMeteoMarineUrl(location);
  const fetchedAt = new Date(input.fetchedAt);
  const expiresAt = addDays(fetchedAt, profile.freshnessWindowDays).toISOString();
  const payload = parseOpenMeteoMarineResponse(input.payload);
  const summary = summarizeOpenMeteoMarine(payload);
  const rawSnapshot: RawSnapshotReference = {
    id: rawSnapshotId,
    sourceProfileId,
    fetchedAt: input.fetchedAt,
    contentHash: sha256(JSON.stringify(payload)),
    allowedUse: profile.allowedUse,
  };
  const sourceRecord = normalizeSourceRecord(registry, {
    id: marineRecordId,
    sourceProfileId,
    providerEntityId: marineProviderEntityId,
    entityType: "marine_forecast",
    name: location.name,
    sourceUrl: requestUrl,
    fetchedAt: input.fetchedAt,
    normalizedPayload: {
      forecastHours: summary.forecastHours,
      location,
      maxOceanCurrentVelocity: summary.maxOceanCurrentVelocity,
      maxOceanCurrentVelocityTime: summary.maxOceanCurrentVelocityTime,
      maxSeaLevelHeightMsl: summary.maxSeaLevelHeightMsl,
      maxSeaLevelHeightMslTime: summary.maxSeaLevelHeightMslTime,
      maxSwellWaveHeight: summary.maxSwellWaveHeight,
      maxSwellWaveHeightTime: summary.maxSwellWaveHeightTime,
      maxWaveHeight: summary.maxWaveHeight,
      maxWaveHeightTime: summary.maxWaveHeightTime,
      minSeaLevelHeightMsl: summary.minSeaLevelHeightMsl,
      minSeaLevelHeightMslTime: summary.minSeaLevelHeightMslTime,
      seaLevelHeightRangeMsl: summary.seaLevelHeightRangeMsl,
      timezone: payload.timezone ?? timezone,
      current: summary.current,
    },
    rawSnapshot,
  });
  const factInputs = [
    {
      id: "fact_open_meteo_siargao_marine_freshness",
      claim: `Open-Meteo Marine forecast for Siargao was fetched on ${input.fetchedAt}.`,
      factType: "marine_forecast_freshness",
      notes:
        "Open-Meteo Marine data is modelled forecast data, not official tide-gauge, navigation, or safety authority data.",
    },
    {
      id: "fact_open_meteo_siargao_sea_level_msl",
      claim: `Modelled sea level height near Siargao is ${formatNullable(
        summary.current.seaLevelHeightMsl,
        "m",
      )} at ${summary.current.time}; next ${summary.forecastHours} hours range from ${formatNullable(
        summary.minSeaLevelHeightMsl,
        "m",
      )} to ${formatNullable(summary.maxSeaLevelHeightMsl, "m")} MSL.`,
      factType: "marine_tide_sea_level_range",
      notes:
        "Use as Open-Meteo modelled sea-level/tide context only; do not present as official tide-table or live tide-gauge measurement.",
    },
    {
      id: "fact_open_meteo_siargao_wave_height",
      claim: `Maximum modelled wave height near Siargao in the next ${summary.forecastHours} hours is ${formatNullable(
        summary.maxWaveHeight,
        "m",
      )}.`,
      factType: "marine_wave_height_risk",
      notes: `Peak wave-height time: ${summary.maxWaveHeightTime}.`,
    },
    {
      id: "fact_open_meteo_siargao_swell_height",
      claim: `Maximum modelled swell wave height near Siargao in the next ${summary.forecastHours} hours is ${formatNullable(
        summary.maxSwellWaveHeight,
        "m",
      )}.`,
      factType: "marine_swell_height_risk",
      notes: `Peak swell-height time: ${summary.maxSwellWaveHeightTime}.`,
    },
    {
      id: "fact_open_meteo_siargao_ocean_current",
      claim: `Maximum modelled ocean current velocity near Siargao in the next ${summary.forecastHours} hours is ${formatNullable(
        summary.maxOceanCurrentVelocity,
        "km/h",
      )}.`,
      factType: "marine_current_velocity_risk",
      notes: `Peak ocean-current time: ${summary.maxOceanCurrentVelocityTime}.`,
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
      label: "Open-Meteo Marine API response",
      citationUrl: requestUrl,
      citationText: "Open-Meteo Marine API response for Siargao coordinates.",
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
      id: "refresh_open_meteo_siargao_marine",
      factId: facts[0]?.id ?? "fact_open_meteo_siargao_marine_freshness",
      sourceProfileId,
      refreshReason: "scheduled_marine_forecast_refresh",
      priority: 95,
      providerBudget: {
        adapterId: "adapter_open_meteo_marine",
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

export function parseOpenMeteoMarineResponse(payload: unknown): OpenMeteoMarineResponse {
  if (!isRecord(payload)) {
    throw new Error("Open-Meteo Marine response must be an object.");
  }

  const current = payload.current;
  if (!isRecord(current)) {
    throw new Error("Open-Meteo Marine response missing current marine data.");
  }

  const hourly = payload.hourly;
  if (!isRecord(hourly)) {
    throw new Error("Open-Meteo Marine response missing hourly marine data.");
  }

  const parsed: OpenMeteoMarineResponse = {
    latitude: requireNumber(payload.latitude, "latitude"),
    longitude: requireNumber(payload.longitude, "longitude"),
    generationtime_ms: optionalNumber(payload.generationtime_ms, "generationtime_ms"),
    utc_offset_seconds: optionalNumber(payload.utc_offset_seconds, "utc_offset_seconds"),
    timezone: optionalString(payload.timezone, "timezone"),
    timezone_abbreviation: optionalString(payload.timezone_abbreviation, "timezone_abbreviation"),
    elevation: optionalNumber(payload.elevation, "elevation"),
    current_units: stringRecord(payload.current_units),
    current: {
      time: requireString(current.time, "current.time"),
      interval: optionalNumber(current.interval, "current.interval"),
      wave_height: optionalNullableNumber(current.wave_height, "current.wave_height"),
      wave_direction: optionalNullableNumber(current.wave_direction, "current.wave_direction"),
      wave_period: optionalNullableNumber(current.wave_period, "current.wave_period"),
      swell_wave_height: optionalNullableNumber(
        current.swell_wave_height,
        "current.swell_wave_height",
      ),
      swell_wave_direction: optionalNullableNumber(
        current.swell_wave_direction,
        "current.swell_wave_direction",
      ),
      swell_wave_period: optionalNullableNumber(
        current.swell_wave_period,
        "current.swell_wave_period",
      ),
      sea_level_height_msl: optionalNullableNumber(
        current.sea_level_height_msl,
        "current.sea_level_height_msl",
      ),
      sea_surface_temperature: optionalNullableNumber(
        current.sea_surface_temperature,
        "current.sea_surface_temperature",
      ),
      ocean_current_velocity: optionalNullableNumber(
        current.ocean_current_velocity,
        "current.ocean_current_velocity",
      ),
      ocean_current_direction: optionalNullableNumber(
        current.ocean_current_direction,
        "current.ocean_current_direction",
      ),
    },
    hourly_units: stringRecord(payload.hourly_units),
    hourly: {
      time: requireStringArray(hourly.time, "hourly.time"),
      wave_height: requireNullableNumberArray(hourly.wave_height, "hourly.wave_height"),
      swell_wave_height: requireNullableNumberArray(
        hourly.swell_wave_height,
        "hourly.swell_wave_height",
      ),
      sea_level_height_msl: requireNullableNumberArray(
        hourly.sea_level_height_msl,
        "hourly.sea_level_height_msl",
      ),
      ocean_current_velocity: requireNullableNumberArray(
        hourly.ocean_current_velocity,
        "hourly.ocean_current_velocity",
      ),
    },
  };

  const expectedLength = parsed.hourly.time.length;
  for (const variable of hourlyVariables) {
    if (parsed.hourly[variable].length !== expectedLength) {
      throw new Error(`Open-Meteo Marine hourly.${variable} length does not match hourly.time.`);
    }
  }
  if (expectedLength === 0) {
    throw new Error("Open-Meteo Marine response contains no forecast hours.");
  }

  return parsed;
}

export function summarizeOpenMeteoMarine(payload: OpenMeteoMarineResponse): OpenMeteoMarineSummary {
  const parsed = parseOpenMeteoMarineResponse(payload);
  const maxWaveHeight = maxValueWithTime(parsed.hourly.wave_height, parsed.hourly.time);
  const maxSwellWaveHeight = maxValueWithTime(parsed.hourly.swell_wave_height, parsed.hourly.time);
  const maxOceanCurrentVelocity = maxValueWithTime(
    parsed.hourly.ocean_current_velocity,
    parsed.hourly.time,
  );
  const minSeaLevelHeightMsl = minValueWithTime(
    parsed.hourly.sea_level_height_msl,
    parsed.hourly.time,
  );
  const maxSeaLevelHeightMsl = maxValueWithTime(
    parsed.hourly.sea_level_height_msl,
    parsed.hourly.time,
  );

  return {
    forecastHours: parsed.hourly.time.length,
    current: {
      time: parsed.current.time,
      waveHeight: parsed.current.wave_height,
      waveDirection: parsed.current.wave_direction,
      wavePeriod: parsed.current.wave_period,
      swellWaveHeight: parsed.current.swell_wave_height,
      swellWaveDirection: parsed.current.swell_wave_direction,
      swellWavePeriod: parsed.current.swell_wave_period,
      seaLevelHeightMsl: parsed.current.sea_level_height_msl,
      seaSurfaceTemperature: parsed.current.sea_surface_temperature,
      oceanCurrentVelocity: parsed.current.ocean_current_velocity,
      oceanCurrentDirection: parsed.current.ocean_current_direction,
    },
    maxWaveHeight: maxWaveHeight.value,
    maxWaveHeightTime: maxWaveHeight.time,
    maxSwellWaveHeight: maxSwellWaveHeight.value,
    maxSwellWaveHeightTime: maxSwellWaveHeight.time,
    maxOceanCurrentVelocity: maxOceanCurrentVelocity.value,
    maxOceanCurrentVelocityTime: maxOceanCurrentVelocity.time,
    minSeaLevelHeightMsl: minSeaLevelHeightMsl.value,
    minSeaLevelHeightMslTime: minSeaLevelHeightMsl.time,
    maxSeaLevelHeightMsl: maxSeaLevelHeightMsl.value,
    maxSeaLevelHeightMslTime: maxSeaLevelHeightMsl.time,
    seaLevelHeightRangeMsl:
      minSeaLevelHeightMsl.value === null || maxSeaLevelHeightMsl.value === null
        ? null
        : roundMetric(maxSeaLevelHeightMsl.value - minSeaLevelHeightMsl.value),
  };
}

function maxValueWithTime(values: readonly NullableNumber[], times: readonly string[]) {
  return extremumValueWithTime(values, times, (candidate, best) => candidate > best);
}

function minValueWithTime(values: readonly NullableNumber[], times: readonly string[]) {
  return extremumValueWithTime(values, times, (candidate, best) => candidate < best);
}

function extremumValueWithTime(
  values: readonly NullableNumber[],
  times: readonly string[],
  isBetter: (candidate: number, best: number) => boolean,
) {
  let bestValue: number | null = null;
  let bestTime = "unknown";
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    if (candidate === null) {
      continue;
    }
    if (bestValue === null || isBetter(candidate, bestValue)) {
      bestValue = candidate;
      bestTime = times[index] ?? "unknown";
    }
  }
  return {
    value: bestValue,
    time: bestTime,
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

function stringRecord(value: unknown) {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => {
          return typeof entry[1] === "string";
        }),
      )
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Open-Meteo Marine ${label} must be a finite number.`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }
  return requireNumber(value, label);
}

function optionalNullableNumber(value: unknown, label: string): NullableNumber {
  if (value === null || value === undefined) {
    return null;
  }
  return requireNumber(value, label);
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, label);
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`Open-Meteo Marine ${label} must be a string.`);
  }
  return value;
}

function requireNullableNumberArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => item !== null && typeof item !== "number")) {
    throw new Error(`Open-Meteo Marine ${label} must be a nullable number array.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Open-Meteo Marine ${label} must be a string array.`);
  }
  return value;
}

function formatNullable(value: NullableNumber, unit: string) {
  return value === null ? "unavailable" : `${roundMetric(value)} ${unit}`;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}
