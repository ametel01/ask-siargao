import { siteConfig } from "@/lib/site";
import type { FetchLike } from "@/server/providers/open-meteo";
import { fetchWithProviderTimeout } from "@/server/providers/provider-fetch";

const metNorwayEndpoint = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const timezone = "Asia/Manila";
const userAgent = `AskSiargao/1.0 (+https://www.asksiargao.com; ${siteConfig.contact.primaryEmail})`;

export const metNorwaySourceProfileId = "source_met_norway";
export const metNorwaySourceName = "MET Norway Locationforecast";

export type MetNorwayForecastLocation = {
  id?: string;
  name?: string;
  latitude: number;
  longitude: number;
};

export type MetNorwayForecast = {
  sourceName: typeof metNorwaySourceName;
  sourceProfileId: typeof metNorwaySourceProfileId;
  locationName: string;
  fetchedAt: string;
  updatedAt: string;
  expiresAt: string;
  citationUrl: string;
  attribution: string;
  today: {
    date: string;
    condition: string;
    precipitationAmount: number;
    windSpeedKmh: number;
  };
  maxDailyRain: { date: string; value: number };
  maxWindSpeed: { date: string; value: number };
};

type MetNorwayResponse = {
  properties: {
    meta: { updated_at: string };
    timeseries: MetNorwayPeriod[];
  };
};

type MetNorwayPeriod = {
  time: string;
  data: {
    instant: { details: { wind_speed?: number } };
    next_1_hours?: {
      details?: { precipitation_amount?: number };
      summary?: { symbol_code?: string };
    };
    next_6_hours?: {
      details?: { precipitation_amount?: number };
      summary?: { symbol_code?: string };
    };
  };
};

type DailyForecast = {
  date: string;
  precipitationAmount: number;
  windSpeedKmh: number;
  condition: string;
  conditionPrecipitation: number;
};

const defaultLocation: Required<MetNorwayForecastLocation> = {
  id: "siargao_general_luna",
  name: "Siargao forecast near General Luna",
  latitude: 9.784,
  longitude: 126.158,
};

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: timezone,
  year: "numeric",
});

export function buildMetNorwayForecastUrl(
  location: Pick<MetNorwayForecastLocation, "latitude" | "longitude"> = defaultLocation,
) {
  const url = new URL(metNorwayEndpoint);
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));
  return url.toString();
}

export async function fetchMetNorwayForecast({
  fetchedAt = new Date(),
  fetcher = fetch,
  location = defaultLocation,
}: {
  fetchedAt?: Date;
  fetcher?: FetchLike;
  location?: MetNorwayForecastLocation;
} = {}): Promise<MetNorwayForecast> {
  const requestUrl = buildMetNorwayForecastUrl(location);
  const response = await fetchWithProviderTimeout(fetcher, requestUrl, {
    headers: {
      accept: "application/json",
      "user-agent": userAgent,
    },
    next: { revalidate: 1_800 },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`MET Norway forecast request failed with HTTP ${response.status}.`);
  }

  const payload = parseMetNorwayResponse(await response.json());
  const todayDate = manilaDate(fetchedAt);
  const daily = summarizeDailyForecast(payload.properties.timeseries).filter(
    (forecast) => forecast.date >= todayDate,
  );
  const today = daily.find((forecast) => forecast.date === todayDate);
  if (!today) {
    throw new Error(`MET Norway forecast did not include ${todayDate}.`);
  }
  const maxDailyRain = maximumBy(daily, (forecast) => forecast.precipitationAmount);
  const maxWindSpeed = maximumBy(daily, (forecast) => forecast.windSpeedKmh);
  if (!maxDailyRain || !maxWindSpeed) {
    throw new Error("MET Norway forecast did not include usable daily weather signals.");
  }
  const updatedAt = new Date(payload.properties.meta.updated_at).toISOString();

  return {
    sourceName: metNorwaySourceName,
    sourceProfileId: metNorwaySourceProfileId,
    locationName: location.name ?? defaultLocation.name,
    fetchedAt: fetchedAt.toISOString(),
    updatedAt,
    expiresAt: new Date(fetchedAt.getTime() + 60 * 60 * 1000).toISOString(),
    citationUrl: requestUrl,
    attribution:
      "Weather forecast from the Norwegian Meteorological Institute (MET Norway), licensed under CC BY 4.0.",
    today: {
      date: today.date,
      condition: today.condition,
      precipitationAmount: roundMetric(today.precipitationAmount),
      windSpeedKmh: roundMetric(today.windSpeedKmh),
    },
    maxDailyRain: {
      date: maxDailyRain.date,
      value: roundMetric(maxDailyRain.precipitationAmount),
    },
    maxWindSpeed: {
      date: maxWindSpeed.date,
      value: roundMetric(maxWindSpeed.windSpeedKmh),
    },
  };
}

function parseMetNorwayResponse(value: unknown): MetNorwayResponse {
  if (!isRecord(value) || !isRecord(value.properties)) {
    throw new Error("MET Norway response did not include forecast properties.");
  }
  const meta = value.properties.meta;
  const timeseries = value.properties.timeseries;
  if (!isRecord(meta) || typeof meta.updated_at !== "string" || !Array.isArray(timeseries)) {
    throw new Error("MET Norway response did not include forecast metadata and periods.");
  }
  const parsedPeriods = timeseries.map(parsePeriod);
  if (parsedPeriods.length === 0) {
    throw new Error("MET Norway response did not include forecast periods.");
  }
  return { properties: { meta: { updated_at: meta.updated_at }, timeseries: parsedPeriods } };
}

function parsePeriod(value: unknown): MetNorwayPeriod {
  if (!isRecord(value) || typeof value.time !== "string" || !isRecord(value.data)) {
    throw new Error("MET Norway forecast period is malformed.");
  }
  const instant = value.data.instant;
  if (!isRecord(instant) || !isRecord(instant.details)) {
    throw new Error("MET Norway forecast period is missing instant details.");
  }
  const windSpeed = optionalNumber(instant.details.wind_speed);
  const nextHour = value.data.next_1_hours;
  const nextHourRecord = isRecord(nextHour) ? nextHour : undefined;
  const nextSixHours = value.data.next_6_hours;
  const nextSixHoursRecord = isRecord(nextSixHours) ? nextSixHours : undefined;
  return {
    time: value.time,
    data: {
      instant: { details: { ...(windSpeed === undefined ? {} : { wind_speed: windSpeed }) } },
      ...parseForecastBlock("next_1_hours", nextHourRecord),
      ...parseForecastBlock("next_6_hours", nextSixHoursRecord),
    },
  };
}

function summarizeDailyForecast(periods: readonly MetNorwayPeriod[]) {
  const forecasts = new Map<string, DailyForecast>();
  for (const period of periods) {
    const date = manilaDate(new Date(period.time));
    const forecastBlock = period.data.next_1_hours ?? period.data.next_6_hours;
    const precipitation = forecastBlock?.details?.precipitation_amount ?? 0;
    const windSpeedKmh = (period.data.instant.details.wind_speed ?? 0) * 3.6;
    const symbol = forecastBlock?.summary?.symbol_code;
    const current = forecasts.get(date) ?? {
      date,
      precipitationAmount: 0,
      windSpeedKmh: 0,
      condition: "Variable conditions",
      conditionPrecipitation: -1,
    };
    current.precipitationAmount += precipitation;
    current.windSpeedKmh = Math.max(current.windSpeedKmh, windSpeedKmh);
    if (symbol && precipitation >= current.conditionPrecipitation) {
      current.condition = conditionFromSymbol(symbol);
      current.conditionPrecipitation = precipitation;
    }
    forecasts.set(date, current);
  }
  return [...forecasts.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function parseForecastBlock(
  key: "next_1_hours" | "next_6_hours",
  block: Record<string, unknown> | undefined,
) {
  if (!block) {
    return {};
  }
  const details = isRecord(block.details) ? block.details : undefined;
  const summary = isRecord(block.summary) ? block.summary : undefined;
  const precipitationAmount = optionalNumber(details?.precipitation_amount);
  return {
    [key]: {
      details: {
        ...(precipitationAmount === undefined ? {} : { precipitation_amount: precipitationAmount }),
      },
      summary: {
        ...(typeof summary?.symbol_code === "string" ? { symbol_code: summary.symbol_code } : {}),
      },
    },
  };
}

function conditionFromSymbol(symbol: string) {
  const normalized = symbol.replace(/_(day|night|polartwilight)$/u, "");
  const known: Record<string, string> = {
    clearsky: "Clear",
    cloudy: "Cloudy",
    fair: "Fair",
    fog: "Fog",
    heavyrain: "Heavy rain",
    heavyrainshowers: "Heavy rain showers",
    lightrain: "Light rain",
    lightrainshowers: "Light rain showers",
    partlycloudy: "Partly cloudy",
    rain: "Rain",
    rainshowers: "Rain showers",
  };
  return known[normalized] ?? normalized.replaceAll(/([a-z])([A-Z])/gu, "$1 $2");
}

function maximumBy<T>(values: readonly T[], score: (value: T) => number) {
  return values.reduce<T | undefined>(
    (best, value) => (!best || score(value) > score(best) ? value : best),
    undefined,
  );
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10;
}

function manilaDate(date: Date) {
  const parts = manilaDateFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
