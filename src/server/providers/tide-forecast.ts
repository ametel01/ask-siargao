import type { FetchLike } from "@/server/providers/open-meteo";
import { requireTideForecastEnabled } from "@/server/providers/production-provider-mode";
import { fetchWithProviderTimeout } from "@/server/providers/provider-fetch";

const tideForecastBaseUrl = "https://www.tide-forecast.com";
const timezone = "Asia/Manila";
const dateKeyFormatter = new Intl.DateTimeFormat("en", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const localTimeFormatter = new Intl.DateTimeFormat("en", {
  timeZone: timezone,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export const tideForecastSourceProfileId = "source_tide_forecast_dev";

export const tideForecastLocations = {
  dapa: {
    id: "dapa_tide_forecast",
    name: "Dapa tide station",
    stationSlug: "Dapa",
    stationUrl: `${tideForecastBaseUrl}/locations/Dapa/tides/latest`,
    latitude: 9.7594,
    longitude: 126.053,
    proxyFor: "Cloud 9, General Luna, and nearby Siargao east-coast surf planning",
  },
} as const;

export type TideForecastLocation =
  (typeof tideForecastLocations)[keyof typeof tideForecastLocations];

export type TideForecastDateRange = "today" | "tomorrow" | "next_7_days";

export type TideForecastEvent = {
  timestamp: number;
  time: string;
  heightMeters: number;
  type: "high" | "low" | null;
};

export type TideForecastDay = {
  date: string;
  sunriseTimestamp: number | null;
  sunsetTimestamp: number | null;
  tides: TideForecastEvent[];
};

export type TideForecastSeaPeriod = {
  timestamp: number;
  startsAt: string;
  localLabel: string;
  weatherSummary: string | null;
  windSpeedKmh: number | null;
  swellHeightMeters: number | null;
  swellPeriodSeconds: number | null;
  swellDirection: string | null;
};

export type TideForecastRecommendedWindow = {
  startsAt: string;
  endsAt: string;
  localLabel: string;
  score: number;
  tideHeightMeters: number | null;
  nearestTideType: "high" | "low" | null;
  nearestTideTime: string | null;
  swellHeightMeters: number | null;
  swellPeriodSeconds: number | null;
  windSpeedKmh: number | null;
  reason: string;
};

export type TideForecastSnapshot = {
  status: "live";
  sourceName: "Tide-Forecast Dapa page" | "NOAA/PacIOOS Pacific tide model";
  sourceProfileId: typeof tideForecastSourceProfileId | "source_pacioos_tide";
  stationName: string;
  stationUrl: string;
  stationLatitude: number | null;
  stationLongitude: number | null;
  requestedLocation: string;
  proxyFor: string;
  fetchedAt: string;
  serverTime: string | null;
  forecastUpdatedAt: string | null;
  dateRange: TideForecastDateRange;
  targetDates: string[];
  days: TideForecastDay[];
  seaPeriods: TideForecastSeaPeriod[];
  recommendedWindows: TideForecastRecommendedWindow[];
  caveats: string[];
};

type TideForecastFcgon = {
  tideDays: TideForecastRawDay[];
  serverTime?: number;
  forecast_update_ts?: number;
  maps?: { lat?: string; lng?: string; filename?: string }[];
};

type TideForecastRawDay = {
  date: string;
  sunrise?: number | null;
  sunset?: number | null;
  tides: TideForecastRawEvent[];
};

type TideForecastRawEvent = {
  timestamp: number;
  time: string;
  height: number;
  type?: "high" | "low" | null;
};

export function tideForecastLocationForSiargaoLabel(_label: string): TideForecastLocation {
  return tideForecastLocations.dapa;
}

export async function buildTideForecastSnapshot(input: {
  dateRange: TideForecastDateRange;
  env?: Record<string, string | undefined>;
  fetchedAt?: Date;
  fetcher?: FetchLike;
  location?: TideForecastLocation;
  requestedLocation: string;
}) {
  requireTideForecastEnabled(input.env);
  const fetchedAt = input.fetchedAt ?? new Date();
  const location = input.location ?? tideForecastLocations.dapa;
  const response = await fetchWithProviderTimeout(input.fetcher ?? fetch, location.stationUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "AskSiargaoDevBot/0.1 (+https://ask-siargao.local)",
    },
  });

  if (!response.ok) {
    throw new Error(`Tide-Forecast page request failed with HTTP ${response.status}.`);
  }

  return parseTideForecastPage({
    dateRange: input.dateRange,
    fetchedAt: fetchedAt.toISOString(),
    html: await response.text(),
    location,
    now: fetchedAt,
    requestedLocation: input.requestedLocation,
  });
}

export function parseTideForecastPage(input: {
  dateRange: TideForecastDateRange;
  fetchedAt: string;
  html: string;
  location?: TideForecastLocation;
  now: Date;
  requestedLocation: string;
}): TideForecastSnapshot {
  const location = input.location ?? tideForecastLocations.dapa;
  const fcgon = parseFcgon(input.html);
  const days = fcgon.tideDays.map(normalizeTideForecastDay);
  const seaPeriods = parseSeaPeriods(input.html);
  const targetDates = targetDatesForRange(input.dateRange, input.now, days);
  const targetDateSet = new Set(targetDates);
  const selectedDays = days.filter((day) => targetDateSet.has(day.date));
  if (selectedDays.length === 0) {
    throw new Error(`Tide-Forecast page does not contain tide days for ${targetDates.join(", ")}.`);
  }

  const targetSeaPeriods = seaPeriods.filter((period) =>
    targetDateSet.has(dateKeyFromTimestamp(period.timestamp)),
  );
  const stationMap = fcgon.maps?.[0];
  const snapshot: TideForecastSnapshot = {
    status: "live",
    sourceName: "Tide-Forecast Dapa page",
    sourceProfileId: tideForecastSourceProfileId,
    stationName: location.name,
    stationUrl: location.stationUrl,
    stationLatitude: parseNullableNumber(stationMap?.lat) ?? location.latitude,
    stationLongitude: parseNullableNumber(stationMap?.lng) ?? location.longitude,
    requestedLocation: input.requestedLocation,
    proxyFor: location.proxyFor,
    fetchedAt: input.fetchedAt,
    serverTime: epochSecondsToIso(fcgon.serverTime),
    forecastUpdatedAt: epochSecondsToIso(fcgon.forecast_update_ts),
    dateRange: input.dateRange,
    targetDates,
    days: selectedDays,
    seaPeriods: targetSeaPeriods,
    recommendedWindows: recommendSurfWindows(selectedDays, targetSeaPeriods),
    caveats: [
      "Tide-Forecast page data is enabled for development/testing and commercial production use needs an appropriate Tide-Forecast/Meteo365 license.",
      "Dapa is used as the nearby Tide-Forecast station proxy for Cloud 9 and General Luna surf timing.",
      "This is predicted tide and forecast sea-condition data, not an official tide-gauge, navigation aid, lifeguard check, local operator call, or safety clearance.",
    ],
  };
  return snapshot;
}

function parseFcgon(html: string): TideForecastFcgon {
  const marker = "window.FCGON = ";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Tide-Forecast page did not include window.FCGON data.");
  }
  const start = markerIndex + marker.length;
  const end = findFcgonEnd(html, start);
  const parsed = JSON.parse(html.slice(start, end)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.tideDays)) {
    throw new Error("Tide-Forecast FCGON data did not include tideDays.");
  }
  return {
    tideDays: parsed.tideDays.map(parseRawDay),
    serverTime: optionalNumber(parsed.serverTime),
    forecast_update_ts: optionalNumber(parsed.forecast_update_ts),
    maps: parseFcgonMaps(parsed.maps),
  };
}

function parseFcgonMaps(value: unknown): TideForecastFcgon["maps"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const maps: NonNullable<TideForecastFcgon["maps"]> = [];
  for (const map of value) {
    if (!isRecord(map)) {
      continue;
    }
    maps.push({
      lat: optionalString(map.lat),
      lng: optionalString(map.lng),
      filename: optionalString(map.filename),
    });
  }
  return maps;
}

function findFcgonEnd(html: string, start: number) {
  const scriptEnd = html.indexOf("</script>", start);
  const searchEnd = scriptEnd < 0 ? html.length : scriptEnd;
  const semicolon = html.lastIndexOf(";", searchEnd);
  if (semicolon < start) {
    throw new Error("Tide-Forecast FCGON script did not end with a semicolon.");
  }
  return semicolon;
}

function parseRawDay(value: unknown): TideForecastRawDay {
  if (!isRecord(value)) {
    throw new Error("Tide-Forecast tide day must be an object.");
  }
  const tides = value.tides;
  if (!Array.isArray(tides)) {
    throw new Error("Tide-Forecast tide day missing tides.");
  }
  return {
    date: requireString(value.date, "tideDays.date"),
    sunrise: optionalNullableNumber(value.sunrise),
    sunset: optionalNullableNumber(value.sunset),
    tides: tides.map(parseRawEvent),
  };
}

function parseRawEvent(value: unknown): TideForecastRawEvent {
  if (!isRecord(value)) {
    throw new Error("Tide-Forecast tide event must be an object.");
  }
  const type = value.type;
  return {
    timestamp: requireNumber(value.timestamp, "tides.timestamp"),
    time: requireString(value.time, "tides.time"),
    height: requireNumber(value.height, "tides.height"),
    type: type === "high" || type === "low" ? type : null,
  };
}

function normalizeTideForecastDay(day: TideForecastRawDay): TideForecastDay {
  return {
    date: day.date,
    sunriseTimestamp: day.sunrise ?? null,
    sunsetTimestamp: day.sunset ?? null,
    tides: day.tides.map((tide) => ({
      timestamp: tide.timestamp,
      time: tide.time.trim(),
      heightMeters: roundMetric(tide.height),
      type: tide.type ?? null,
    })),
  };
}

function parseSeaPeriods(html: string): TideForecastSeaPeriod[] {
  const tag = html.match(/<div[^>]*\blive-conditions\b[^>]*>/u)?.[0];
  if (!tag) {
    return [];
  }
  const firstPeriodStart = parseNullableNumber(readHtmlAttribute(tag, "data-first-period-start"));
  const periodDuration = parseNullableNumber(readHtmlAttribute(tag, "data-period-duration"));
  const rawPeriodsAttribute = readHtmlAttribute(tag, "data-periods");
  if (firstPeriodStart === null || periodDuration === null || !rawPeriodsAttribute) {
    return [];
  }
  const rawPeriods = JSON.parse(decodeHtmlAttribute(rawPeriodsAttribute)) as unknown;
  if (!Array.isArray(rawPeriods)) {
    return [];
  }
  const periods: TideForecastSeaPeriod[] = [];
  for (const period of rawPeriods) {
    if (!isRecord(period)) {
      continue;
    }
    const timestamp = firstPeriodStart + periodDuration * periods.length;
    periods.push({
      timestamp,
      startsAt: epochSecondsToIso(timestamp) ?? "",
      localLabel: localTimeLabel(timestamp),
      weatherSummary: optionalString(period.weather_summary) ?? null,
      windSpeedKmh: parseNullableNumber(period.wind_speed),
      swellHeightMeters: parseNullableNumber(period.swell_height),
      swellPeriodSeconds: parseNullableNumber(period.swell_period),
      swellDirection: optionalString(period.swell_direction) ?? null,
    });
  }
  return periods;
}

function readHtmlAttribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag);
  return match?.[1];
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function targetDatesForRange(
  range: TideForecastDateRange,
  now: Date,
  days: readonly TideForecastDay[],
) {
  if (range === "next_7_days") {
    const today = dateKeyInTimezone(now);
    const targetDates: string[] = [];
    for (const day of days) {
      if (day.date < today) {
        continue;
      }
      targetDates.push(day.date);
      if (targetDates.length === 7) {
        break;
      }
    }
    return targetDates;
  }
  const offsetDays = range === "tomorrow" ? 1 : 0;
  return [dateKeyInTimezone(addUtcDays(now, offsetDays))];
}

function recommendSurfWindows(
  days: readonly TideForecastDay[],
  seaPeriods: readonly TideForecastSeaPeriod[],
): TideForecastRecommendedWindow[] {
  const detailedTides = days
    .flatMap((day) => day.tides)
    .sort((left, right) => left.timestamp - right.timestamp);
  const candidatePeriods = seaPeriods.length > 0 ? seaPeriods : highTideFallbackPeriods(days);
  const windows: TideForecastRecommendedWindow[] = [];
  for (const period of candidatePeriods) {
    if (!isDaylightPeriod(period.timestamp, days)) {
      continue;
    }
    const tide = closestTide(period.timestamp, detailedTides);
    const nearestEvent = closestTideEvent(period.timestamp, detailedTides);
    const endsAtTimestamp = period.timestamp + 3 * 60 * 60;
    const score = scoreSurfWindow(period, tide?.heightMeters ?? null, nearestEvent?.type ?? null);
    windows.push({
      startsAt: epochSecondsToIso(period.timestamp) ?? "",
      endsAt: epochSecondsToIso(endsAtTimestamp) ?? "",
      localLabel: `${localTimeLabel(period.timestamp)}-${localTimeLabel(endsAtTimestamp)}`,
      score,
      tideHeightMeters: tide?.heightMeters ?? null,
      nearestTideType: nearestEvent?.type ?? null,
      nearestTideTime: nearestEvent?.time ?? null,
      swellHeightMeters: period.swellHeightMeters,
      swellPeriodSeconds: period.swellPeriodSeconds,
      windSpeedKmh: period.windSpeedKmh,
      reason: surfWindowReason(period, tide?.heightMeters ?? null, nearestEvent),
    });
  }
  return windows
    .sort((left, right) => right.score - left.score || left.startsAt.localeCompare(right.startsAt))
    .slice(0, 3);
}

function highTideFallbackPeriods(days: readonly TideForecastDay[]): TideForecastSeaPeriod[] {
  const periods: TideForecastSeaPeriod[] = [];
  for (const day of days) {
    for (const tide of day.tides) {
      if (tide.type !== "high") {
        continue;
      }
      periods.push({
        timestamp: tide.timestamp - 60 * 60,
        startsAt: epochSecondsToIso(tide.timestamp - 60 * 60) ?? "",
        localLabel: localTimeLabel(tide.timestamp - 60 * 60),
        weatherSummary: null,
        windSpeedKmh: null,
        swellHeightMeters: null,
        swellPeriodSeconds: null,
        swellDirection: null,
      });
    }
  }
  return periods;
}

function scoreSurfWindow(
  period: TideForecastSeaPeriod,
  tideHeightMeters: number | null,
  nearestTideType: "high" | "low" | null,
) {
  const swellScore = (period.swellHeightMeters ?? 0) * 8;
  const periodScore = (period.swellPeriodSeconds ?? 0) * 0.2;
  const windPenalty = (period.windSpeedKmh ?? 0) * 0.04;
  const tideScore =
    tideHeightMeters === null
      ? nearestTideType === "high"
        ? 1.5
        : 0
      : Math.max(0, 2 - Math.abs(tideHeightMeters - 1.35));
  return roundMetric(swellScore + periodScore + tideScore - windPenalty);
}

function surfWindowReason(
  period: TideForecastSeaPeriod,
  tideHeightMeters: number | null,
  nearestEvent: TideForecastEvent | undefined,
) {
  const parts = [
    nearestEvent
      ? `near ${nearestEvent.type ?? "tide"} tide at ${nearestEvent.time} (${nearestEvent.heightMeters}m)`
      : tideHeightMeters !== null
        ? `estimated tide height ${tideHeightMeters}m`
        : "tide timing available",
    period.swellHeightMeters !== null ? `swell ${period.swellHeightMeters}m` : "swell unavailable",
    period.swellPeriodSeconds !== null ? `${period.swellPeriodSeconds}s period` : undefined,
    period.windSpeedKmh !== null ? `wind ${period.windSpeedKmh}km/h` : undefined,
  ];
  return parts.filter(Boolean).join("; ");
}

function isDaylightPeriod(timestamp: number, days: readonly TideForecastDay[]) {
  const day = days.find((candidate) => candidate.date === dateKeyFromTimestamp(timestamp));
  if (!day?.sunriseTimestamp || !day.sunsetTimestamp) {
    return true;
  }
  return timestamp + 90 * 60 >= day.sunriseTimestamp && timestamp <= day.sunsetTimestamp;
}

function closestTide(timestamp: number, tides: readonly TideForecastEvent[]) {
  return tides.reduce<TideForecastEvent | undefined>((best, tide) => {
    if (!best) {
      return tide;
    }
    return Math.abs(tide.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
      ? tide
      : best;
  }, undefined);
}

function closestTideEvent(timestamp: number, tides: readonly TideForecastEvent[]) {
  return closestTide(
    timestamp,
    tides.filter((tide) => tide.type === "high" || tide.type === "low"),
  );
}

function dateKeyFromTimestamp(timestamp: number) {
  return dateKeyInTimezone(new Date(timestamp * 1000));
}

function dateKeyInTimezone(date: Date) {
  const parts = dateKeyFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localTimeLabel(timestamp: number) {
  return localTimeFormatter.format(new Date(timestamp * 1000));
}

function epochSecondsToIso(value: number | undefined) {
  return value === undefined ? null : new Date(value * 1000).toISOString();
}

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNullableNumber(value: unknown) {
  return value === null || value === undefined ? null : requireNumber(value, "number");
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Tide-Forecast ${label} must be a finite number.`);
  }
  return value;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`Tide-Forecast ${label} must be a string.`);
  }
  return value;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
