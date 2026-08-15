import type { FetchLike } from "@/server/providers/open-meteo";
import { fetchWithProviderTimeout } from "@/server/providers/provider-fetch";
import type {
  TideForecastDateRange,
  TideForecastDay,
  TideForecastEvent,
  TideForecastRecommendedWindow,
  TideForecastSnapshot,
} from "@/server/providers/tide-forecast";

const endpoint = "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/tide_pac.json";
const timezone = "Asia/Manila";

export const pacioosTideSourceProfileId = "source_pacioos_tide";
export const pacioosTideSourceName = "NOAA/PacIOOS Pacific tide model";

type PacioosLocation = { latitude: number; longitude: number };
type PacioosRow = {
  time: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  heightMeters: number;
};

const defaultLocation: PacioosLocation = { latitude: 9.7594, longitude: 126.053 };
const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "2-digit",
  timeZone: timezone,
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  timeZone: timezone,
});

export function buildPacioosTideQueryUrl({
  dateRange,
  location = defaultLocation,
  now,
}: {
  dateRange: TideForecastDateRange;
  location?: PacioosLocation;
  now: Date;
}) {
  const targetDates = targetDatesForRange(dateRange, now);
  const firstDate = targetDates[0];
  const lastDate = targetDates.at(-1);
  if (!firstDate || !lastDate) {
    throw new Error("PacIOOS tide query requires at least one target date.");
  }
  const start = new Date(localMidnightUtc(firstDate).getTime() - 60 * 60 * 1000).toISOString();
  const end = new Date(localMidnightUtc(addDateKeyDays(lastDate, 1)).getTime() + 60 * 60 * 1000);
  const query = `ssh[(${trimMillis(start)}):1:(${trimMillis(end.toISOString())})][(${location.latitude}):1:(${location.latitude})][(${location.longitude}):1:(${location.longitude})]`;
  return `${endpoint}?${query}`;
}

export async function buildPacioosTideSnapshot(input: {
  dateRange: TideForecastDateRange;
  fetchedAt?: Date;
  fetcher?: FetchLike;
  location?: PacioosLocation;
  requestedLocation: string;
}): Promise<TideForecastSnapshot> {
  const fetchedAt = input.fetchedAt ?? new Date();
  const location = input.location ?? defaultLocation;
  const requestUrl = buildPacioosTideQueryUrl({
    dateRange: input.dateRange,
    location,
    now: fetchedAt,
  });
  const response = await fetchWithProviderTimeout(input.fetcher ?? fetch, requestUrl, {
    headers: { accept: "application/json" },
    next: { revalidate: 86_400 },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`PacIOOS tide model request failed with HTTP ${response.status}.`);
  }
  const rows = parseRows(await response.json());
  if (rows.length < 3) {
    throw new Error("PacIOOS tide model returned no usable grid rows.");
  }
  const targetDates = targetDatesForRange(input.dateRange, fetchedAt);
  const events = extractTideEvents(rows).filter((event) =>
    targetDates.includes(dateKey(new Date(event.timestamp * 1000))),
  );
  const days = targetDates.map<TideForecastDay>((date) => ({
    date,
    sunriseTimestamp: null,
    sunsetTimestamp: null,
    tides: events.filter((event) => dateKey(new Date(event.timestamp * 1000)) === date),
  }));
  if (!days.some((day) => day.tides.length > 0)) {
    throw new Error("PacIOOS tide model did not contain extrema for the requested dates.");
  }
  const gridPoint = rows[0];
  if (!gridPoint) {
    throw new Error("PacIOOS tide model did not identify a grid point.");
  }

  return {
    status: "live",
    sourceName: pacioosTideSourceName,
    sourceProfileId: pacioosTideSourceProfileId,
    stationName: `PacIOOS Pacific tide grid (${gridPoint.latitude}°N, ${gridPoint.longitude}°E)`,
    stationUrl: requestUrl,
    stationLatitude: gridPoint.latitude,
    stationLongitude: gridPoint.longitude,
    requestedLocation: input.requestedLocation,
    proxyFor: "Siargao planning using the nearest available Pacific model grid point",
    fetchedAt: fetchedAt.toISOString(),
    serverTime: null,
    forecastUpdatedAt: null,
    dateRange: input.dateRange,
    targetDates,
    days,
    seaPeriods: [],
    recommendedWindows: recommendModeledTideWindows(days),
    caveats: [
      "NOAA/PacIOOS provides this public-domain barotropic tide-model output for the Pacific Ocean.",
      "The nearest model point is on a coarse 2-degree grid and is a planning proxy, not a Dapa or Cloud 9 station prediction.",
      "Heights are modelled sea-surface-height values, not official tide-gauge observations or a local hydrographic tide table.",
      "This model does not check waves, swell, currents, reefs, weather warnings, lifeguards, or local operators and is not a safety clearance.",
    ],
  };
}

function parseRows(value: unknown): PacioosRow[] {
  if (!isRecord(value) || !isRecord(value.table)) {
    throw new Error("PacIOOS tide model response did not include a table.");
  }
  const columns = value.table.columnNames;
  const rows = value.table.rows;
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    throw new Error("PacIOOS tide model table is malformed.");
  }
  const timeIndex = columns.indexOf("time");
  const latitudeIndex = columns.indexOf("latitude");
  const longitudeIndex = columns.indexOf("longitude");
  const heightIndex = columns.indexOf("ssh");
  if ([timeIndex, latitudeIndex, longitudeIndex, heightIndex].some((index) => index < 0)) {
    throw new Error("PacIOOS tide model table is missing required columns.");
  }
  const parsed: PacioosRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) {
      continue;
    }
    const time = row[timeIndex];
    const latitude = row[latitudeIndex];
    const longitude = row[longitudeIndex];
    const heightMeters = row[heightIndex];
    if (
      typeof time !== "string" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof heightMeters !== "number"
    ) {
      continue;
    }
    const timestamp = Math.floor(new Date(time).getTime() / 1000);
    if (!Number.isFinite(timestamp) || !Number.isFinite(heightMeters)) {
      continue;
    }
    parsed.push({ time, timestamp, latitude, longitude, heightMeters });
  }
  return parsed.sort((left, right) => left.timestamp - right.timestamp);
}

function extractTideEvents(rows: readonly PacioosRow[]) {
  const events: TideForecastEvent[] = [];
  for (let index = 1; index < rows.length - 1; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const next = rows[index + 1];
    if (!previous || !current || !next) {
      continue;
    }
    const high =
      current.heightMeters >= previous.heightMeters && current.heightMeters > next.heightMeters;
    const low =
      current.heightMeters <= previous.heightMeters && current.heightMeters < next.heightMeters;
    if (!high && !low) {
      continue;
    }
    events.push({
      timestamp: current.timestamp,
      time: timeFormatter.format(new Date(current.timestamp * 1000)),
      heightMeters: roundMetric(current.heightMeters),
      type: high ? "high" : "low",
    });
  }
  return events;
}

function recommendModeledTideWindows(days: readonly TideForecastDay[]) {
  const windows: TideForecastRecommendedWindow[] = [];
  for (const event of days.flatMap((day) => day.tides)) {
    if (event.type !== "high") {
      continue;
    }
    const localHour = Number(
      new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }).format(new Date(event.timestamp * 1000)),
    );
    if (localHour < 5 || localHour >= 18) {
      continue;
    }
    const startsAtTimestamp = event.timestamp - 60 * 60;
    const endsAtTimestamp = event.timestamp + 2 * 60 * 60;
    windows.push({
      startsAt: new Date(startsAtTimestamp * 1000).toISOString(),
      endsAt: new Date(endsAtTimestamp * 1000).toISOString(),
      localLabel: `${timeFormatter.format(new Date(startsAtTimestamp * 1000))}-${timeFormatter.format(
        new Date(endsAtTimestamp * 1000),
      )}`,
      score: roundMetric(event.heightMeters),
      tideHeightMeters: event.heightMeters,
      nearestTideType: "high",
      nearestTideTime: event.time,
      swellHeightMeters: null,
      swellPeriodSeconds: null,
      windSpeedKmh: null,
      reason: `near modeled high water at ${event.time} (${event.heightMeters}m); waves, swell, and local break conditions unavailable`,
    });
  }
  return windows.sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, 3);
}

function targetDatesForRange(range: TideForecastDateRange, now: Date) {
  const startOffset = range === "tomorrow" ? 1 : 0;
  const count = range === "next_7_days" ? 7 : 1;
  const start = dateKey(now);
  return Array.from({ length: count }, (_, index) => addDateKeyDays(start, startOffset + index));
}

function dateKey(date: Date) {
  const parts = dateFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDateKeyDays(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function localMidnightUtc(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function trimMillis(value: string) {
  return value.replace(".000Z", "Z");
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
