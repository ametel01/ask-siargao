import postgres from "postgres";

import type { ConfidenceLabel } from "@/server/audit/enums";

export type WeatherSnapshotStatus = "live" | "fallback";
export type WeatherFreshness = "fresh" | "stale" | "unknown";
export type WeatherRiskLevel = "low" | "medium" | "high";

export type WeatherRiskMetric = {
  id: "precipitation_probability" | "rain_sum" | "wind_gust";
  label: string;
  value: number;
  unit: "%" | "mm" | "km/h";
  peakDate: string;
  level: WeatherRiskLevel;
  claim: string;
  evidenceId: string;
};

export type WeatherTodayForecast = {
  date: string;
  weatherCode: number | null;
  condition: string;
  precipitationProbability: number | null;
  precipitationSum: number | null;
  rainSum: number | null;
  windSpeed: number | null;
  windGust: number | null;
  level: WeatherRiskLevel;
  evidenceId: string;
};

export type WeatherSnapshot = {
  status: WeatherSnapshotStatus;
  locationName: string;
  sourceName: string;
  sourceProfileId: "source_open_meteo";
  fetchedAt: string;
  expiresAt: string | null;
  freshness: WeatherFreshness;
  confidence: ConfidenceLabel;
  citationUrl: string | null;
  evidenceIds: string[];
  summary: string;
  today: WeatherTodayForecast;
  metrics: WeatherRiskMetric[];
};

type WeatherFactRow = {
  factId: string;
  factType: string;
  claim: string;
  fetchedAt: Date | string;
  expiresAt: Date | string | null;
  confidenceLabel: string;
  evidenceId: string | null;
  citationUrl: string | null;
  sourceName: string;
  recordName: string;
  normalizedPayload: unknown;
  rawPayload: unknown;
};

type MetricDefinition = {
  factType: string;
  id: WeatherRiskMetric["id"];
  label: string;
  unit: WeatherRiskMetric["unit"];
  valueKey: string;
  dateKey: string;
  mediumAt: number;
  highAt: number;
};

const metricDefinitions: MetricDefinition[] = [
  {
    factType: "weather_precipitation_risk",
    id: "precipitation_probability",
    label: "Peak precipitation probability",
    unit: "%",
    valueKey: "maxPrecipitationProbability",
    dateKey: "maxPrecipitationDate",
    mediumAt: 45,
    highAt: 75,
  },
  {
    factType: "weather_rain_volume_risk",
    id: "rain_sum",
    label: "Peak daily rain",
    unit: "mm",
    valueKey: "maxRainSum",
    dateKey: "maxRainDate",
    mediumAt: 6,
    highAt: 18,
  },
  {
    factType: "weather_wind_risk",
    id: "wind_gust",
    label: "Peak wind gust",
    unit: "km/h",
    valueKey: "maxWindGust",
    dateKey: "maxWindGustDate",
    mediumAt: 35,
    highAt: 55,
  },
];

export const fallbackWeatherSnapshot: WeatherSnapshot = {
  status: "fallback",
  locationName: "Siargao Island",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-23T00:00:00.000Z",
  expiresAt: null,
  freshness: "unknown",
  confidence: "medium",
  citationUrl: null,
  evidenceIds: ["ev_open_meteo_profile"],
  summary: "Open-Meteo is configured, but no live forecast snapshot has been loaded yet.",
  today: {
    date: "pending",
    weatherCode: null,
    condition: "Forecast unavailable",
    precipitationProbability: null,
    precipitationSum: null,
    rainSum: null,
    windSpeed: null,
    windGust: null,
    level: "medium",
    evidenceId: "ev_open_meteo_profile",
  },
  metrics: [
    {
      id: "precipitation_probability",
      label: "Peak precipitation probability",
      value: 0,
      unit: "%",
      peakDate: "pending",
      level: "medium",
      claim: "Run Open-Meteo ingestion to publish the latest precipitation probability.",
      evidenceId: "ev_open_meteo_profile",
    },
    {
      id: "rain_sum",
      label: "Peak daily rain",
      value: 0,
      unit: "mm",
      peakDate: "pending",
      level: "medium",
      claim: "Run Open-Meteo ingestion to publish the latest rain-volume risk.",
      evidenceId: "ev_open_meteo_profile",
    },
    {
      id: "wind_gust",
      label: "Peak wind gust",
      value: 0,
      unit: "km/h",
      peakDate: "pending",
      level: "medium",
      claim: "Run Open-Meteo ingestion to publish the latest wind-gust risk.",
      evidenceId: "ev_open_meteo_profile",
    },
  ],
};

export async function getLatestSiargaoWeatherSnapshot({
  databaseUrl = process.env.DATABASE_URL,
  now = new Date(),
}: {
  databaseUrl?: string;
  now?: Date;
} = {}): Promise<WeatherSnapshot> {
  if (!databaseUrl) {
    return fallbackWeatherSnapshot;
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    const rows = await sql<WeatherFactRow[]>`
      select
        facts.id as "factId",
        facts.fact_type as "factType",
        facts.claim,
        facts.fetched_at as "fetchedAt",
        facts.expires_at as "expiresAt",
        facts.confidence_label as "confidenceLabel",
        evidence.id as "evidenceId",
        evidence.citation_url as "citationUrl",
        source_profiles.source_name as "sourceName",
        source_records.name as "recordName",
        source_records.normalized_payload as "normalizedPayload",
        raw_snapshots.raw_payload as "rawPayload"
      from facts
      left join evidence on evidence.fact_id = facts.id
      left join source_profiles on source_profiles.id = facts.source_profile_id
      left join source_records on source_records.id = facts.source_record_id
      left join raw_snapshots on raw_snapshots.id = source_records.raw_snapshot_id
      where facts.source_profile_id = 'source_open_meteo'
        and facts.public_republish_allowed = true
        and facts.fact_type in (
          'weather_forecast_freshness',
          'weather_precipitation_risk',
          'weather_rain_volume_risk',
          'weather_wind_risk'
        )
      order by facts.fetched_at desc, facts.fact_type asc
    `;

    return buildWeatherSnapshotFromRows(rows, now);
  } catch {
    return fallbackWeatherSnapshot;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export function buildWeatherSnapshotFromRows(
  rows: readonly WeatherFactRow[],
  now = new Date(),
): WeatherSnapshot {
  if (rows.length === 0) {
    return fallbackWeatherSnapshot;
  }

  const latestFetchedTime = Math.max(...rows.map((row) => dateTime(row.fetchedAt)));
  const latestRows = rows.filter((row) => dateTime(row.fetchedAt) === latestFetchedTime);
  const firstRow = latestRows[0];

  if (!firstRow) {
    return fallbackWeatherSnapshot;
  }

  const normalizedPayload = asRecord(firstRow.normalizedPayload);
  const rawPayload = asRecord(firstRow.rawPayload);
  const metrics = metricDefinitions
    .map((definition) => metricFromRows(definition, latestRows, normalizedPayload))
    .filter((metric): metric is WeatherRiskMetric => Boolean(metric));

  if (metrics.length === 0) {
    return fallbackWeatherSnapshot;
  }

  const expiresAt = latestRows
    .map((row) => row.expiresAt)
    .filter((value): value is Date | string => Boolean(value))
    .map(toIsoString)
    .sort()[0];
  const evidenceIds = Array.from(
    new Set(latestRows.map((row) => row.evidenceId).filter((id): id is string => Boolean(id))),
  );

  return {
    status: "live",
    locationName: firstRow.recordName || "Siargao Island",
    sourceName: firstRow.sourceName || "Open-Meteo weather API",
    sourceProfileId: "source_open_meteo",
    fetchedAt: toIsoString(firstRow.fetchedAt),
    expiresAt: expiresAt ?? null,
    freshness: expiresAt
      ? new Date(expiresAt).getTime() > now.getTime()
        ? "fresh"
        : "stale"
      : "unknown",
    confidence: lowestConfidence(latestRows.map((row) => row.confidenceLabel)),
    citationUrl: latestRows.find((row) => row.citationUrl)?.citationUrl ?? null,
    evidenceIds,
    summary: buildSummary(metrics),
    today: todayForecastFromPayload({
      evidenceId: evidenceIds[0] ?? "ev_open_meteo_profile",
      normalizedPayload,
      now,
      rawPayload,
    }),
    metrics,
  };
}

function todayForecastFromPayload({
  evidenceId,
  normalizedPayload,
  now,
  rawPayload,
}: {
  evidenceId: string;
  normalizedPayload: Record<string, unknown>;
  now: Date;
  rawPayload: Record<string, unknown>;
}): WeatherTodayForecast {
  const normalizedToday = asRecord(normalizedPayload.todayForecast);
  const rawDaily = asRecord(rawPayload.daily);
  const dates = stringArray(rawDaily.time);
  const todayDate = manilaDate(now);
  const todayIndex = Math.max(0, dates.indexOf(todayDate));
  const date = dates[todayIndex] ?? stringValue(normalizedToday.date) ?? todayDate;
  const precipitationProbability =
    numberArray(rawDaily.precipitation_probability_max)[todayIndex] ??
    numericValue(normalizedToday.precipitationProbability);
  const precipitationSum =
    numberArray(rawDaily.precipitation_sum)[todayIndex] ??
    numericValue(normalizedToday.precipitationSum);
  const rainSum =
    numberArray(rawDaily.rain_sum)[todayIndex] ?? numericValue(normalizedToday.rainSum);
  const windSpeed =
    numberArray(rawDaily.wind_speed_10m_max)[todayIndex] ?? numericValue(normalizedToday.windSpeed);
  const windGust =
    numberArray(rawDaily.wind_gusts_10m_max)[todayIndex] ?? numericValue(normalizedToday.windGust);
  const weatherCode =
    numberArray(rawDaily.weather_code)[todayIndex] ?? numericValue(normalizedToday.weatherCode);

  return {
    date,
    weatherCode: weatherCode ?? null,
    condition: weatherCondition(weatherCode),
    precipitationProbability: precipitationProbability ?? null,
    precipitationSum: precipitationSum ?? null,
    rainSum: rainSum ?? null,
    windSpeed: windSpeed ?? null,
    windGust: windGust ?? null,
    level: todayRiskLevel({ precipitationProbability, rainSum, windGust }),
    evidenceId,
  };
}

function metricFromRows(
  definition: MetricDefinition,
  rows: readonly WeatherFactRow[],
  normalizedPayload: Record<string, unknown>,
): WeatherRiskMetric | undefined {
  const row = rows.find((candidate) => candidate.factType === definition.factType);
  const value = numericValue(normalizedPayload[definition.valueKey]);
  const peakDate = stringValue(normalizedPayload[definition.dateKey]);

  if (!row || value === undefined || !peakDate || !row.evidenceId) {
    return undefined;
  }

  return {
    id: definition.id,
    label: definition.label,
    value,
    unit: definition.unit,
    peakDate,
    level: riskLevel(value, definition),
    claim: row.claim,
    evidenceId: row.evidenceId,
  };
}

function buildSummary(metrics: readonly WeatherRiskMetric[]) {
  const highestLevel = metrics.reduce<WeatherRiskLevel>(
    (current, metric) => (riskRank(metric.level) > riskRank(current) ? metric.level : current),
    "low",
  );
  const lead = metrics.find((metric) => metric.level === highestLevel) ?? metrics[0];

  return lead
    ? `${lead.label} is the current weather watch item for Siargao: ${lead.value}${lead.unit} on ${lead.peakDate}.`
    : fallbackWeatherSnapshot.summary;
}

function riskLevel(value: number, definition: MetricDefinition): WeatherRiskLevel {
  if (value >= definition.highAt) {
    return "high";
  }
  if (value >= definition.mediumAt) {
    return "medium";
  }
  return "low";
}

function riskRank(level: WeatherRiskLevel) {
  return { low: 0, medium: 1, high: 2 }[level];
}

function todayRiskLevel({
  precipitationProbability,
  rainSum,
  windGust,
}: {
  precipitationProbability?: number;
  rainSum?: number;
  windGust?: number;
}): WeatherRiskLevel {
  if ((precipitationProbability ?? 0) >= 75 || (rainSum ?? 0) >= 18 || (windGust ?? 0) >= 55) {
    return "high";
  }
  if ((precipitationProbability ?? 0) >= 45 || (rainSum ?? 0) >= 6 || (windGust ?? 0) >= 35) {
    return "medium";
  }
  return "low";
}

function lowestConfidence(labels: readonly string[]): ConfidenceLabel {
  if (labels.includes("low")) {
    return "low";
  }
  if (labels.includes("medium")) {
    return "medium";
  }
  return "high";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function weatherCondition(code: number | undefined) {
  if (code === undefined) {
    return "Forecast unavailable";
  }
  if (code === 0) {
    return "Clear";
  }
  if (code <= 3) {
    return "Cloudy breaks";
  }
  if (code === 45 || code === 48) {
    return "Fog";
  }
  if (code >= 51 && code <= 57) {
    return "Drizzle";
  }
  if (code >= 61 && code <= 67) {
    return "Rain";
  }
  if (code >= 71 && code <= 77) {
    return "Heavy cloud";
  }
  if (code >= 80 && code <= 82) {
    return "Showers";
  }
  if (code >= 95) {
    return "Thunderstorm";
  }
  return "Variable";
}

function manilaDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Manila",
    year: "numeric",
  }).format(date);
}

function dateTime(value: Date | string) {
  return new Date(value).getTime();
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
