import {
  buildTideForecastSnapshot,
  type TideForecastSnapshot,
  tideForecastLocationForSiargaoLabel,
} from "@/server/providers/tide-forecast";
import {
  openMeteoLocationForPublicLabel,
  type SiargaoPublicForecastLocation,
} from "@/server/public-pages/siargao-forecast-location";
import {
  getLatestSiargaoWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

export type SurfConditionsStatus = "live" | "partial" | "unavailable";
export type SurfConditionLevel = "low" | "medium" | "high";

export type SurfConditionsSnapshot = {
  status: SurfConditionsStatus;
  locationName: SiargaoPublicForecastLocation;
  sourceName: "Open-Meteo weather API + Tide-Forecast Dapa page";
  fetchedAt: string;
  confidence: "low";
  level: SurfConditionLevel;
  recommendation: string;
  summary: string;
  metrics: {
    waves: string;
    tide: string;
    wind: string;
  };
  weather: {
    status: WeatherSnapshot["status"] | "unavailable";
    condition: string;
    precipitationProbability: number | null;
    rainSum: number | null;
    windGust: number | null;
  };
  tide: {
    status: "live" | "unavailable";
    stationName: string;
    nextEvent: string | null;
    bestWindow: string | null;
  };
  caveats: string[];
};

type SurfSnapshotDependencies = {
  buildTideSnapshot?: typeof buildTideForecastSnapshot;
  getWeatherSnapshot?: typeof getLatestSiargaoWeatherSnapshot;
  now?: Date;
};

export async function getSiargaoSurfConditionsSnapshot({
  dependencies = {},
  location,
}: {
  dependencies?: SurfSnapshotDependencies;
  location: SiargaoPublicForecastLocation;
}): Promise<SurfConditionsSnapshot> {
  const now = dependencies.now ?? new Date();
  const [weatherSnapshot, tideSnapshot] = await Promise.all([
    fetchWeatherSnapshot(location, dependencies),
    fetchTideSnapshot(location, now, dependencies),
  ]);

  return buildSurfConditionsSnapshot({
    location,
    now,
    tideSnapshot,
    weatherSnapshot,
  });
}

export function buildSurfConditionsSnapshot({
  location,
  now,
  tideSnapshot,
  weatherSnapshot,
}: {
  location: SiargaoPublicForecastLocation;
  now: Date;
  tideSnapshot: TideForecastSnapshot | null;
  weatherSnapshot: WeatherSnapshot | null;
}): SurfConditionsSnapshot {
  const weatherLive = weatherSnapshot?.status === "live";
  const tideLive = Boolean(tideSnapshot);
  const bestWindow = tideSnapshot?.recommendedWindows[0] ?? null;
  const closestSeaPeriod = tideSnapshot ? closestTideSeaPeriod(tideSnapshot, now) : null;
  const nextTideEvent = tideSnapshot ? closestUpcomingTideEvent(tideSnapshot, now) : null;
  const windKmh = bestWindow?.windSpeedKmh ?? closestSeaPeriod?.windSpeedKmh ?? null;
  const swellMeters = bestWindow?.swellHeightMeters ?? closestSeaPeriod?.swellHeightMeters ?? null;
  const swellPeriodSeconds =
    bestWindow?.swellPeriodSeconds ?? closestSeaPeriod?.swellPeriodSeconds ?? null;
  const level = surfLevel({
    precipitationProbability: weatherSnapshot?.today.precipitationProbability ?? null,
    rainSum: weatherSnapshot?.today.rainSum ?? weatherSnapshot?.today.precipitationSum ?? null,
    swellMeters,
    weatherCondition: weatherSnapshot?.today.condition ?? null,
    windGust: weatherSnapshot?.today.windGust ?? null,
    windKmh,
  });
  const status = surfStatus({ tideLive, weatherLive });
  const metrics = {
    waves:
      swellMeters === null
        ? "Unavailable"
        : `${formatMetric(swellMeters, "m")} swell${
            swellPeriodSeconds === null ? "" : ` / ${formatMetric(swellPeriodSeconds, "s")}`
          }`,
    tide: nextTideEvent
      ? `${titleCase(nextTideEvent.type ?? "tide")} ${nextTideEvent.time} ${formatMetric(
          nextTideEvent.heightMeters,
          "m",
        )}`
      : tideLive
        ? "Checked"
        : "Unavailable",
    wind:
      windKmh !== null
        ? `${formatMetric(windKmh, "km/h")}`
        : weatherSnapshot?.today.windGust !== null && weatherSnapshot?.today.windGust !== undefined
          ? `gust ${formatMetric(weatherSnapshot.today.windGust, "km/h")}`
          : "Unavailable",
  };
  const recommendation = surfRecommendation({ level, status, tideLive, weatherLive });

  return {
    status,
    locationName: location,
    sourceName: "Open-Meteo weather API + Tide-Forecast Dapa page",
    fetchedAt: now.toISOString(),
    confidence: "low",
    level,
    recommendation,
    summary: [
      weatherLive
        ? `${weatherSnapshot.today.condition}; rain ${formatNullableMetric(
            weatherSnapshot.today.rainSum ?? weatherSnapshot.today.precipitationSum,
            "mm",
          )}; gust ${formatNullableMetric(weatherSnapshot.today.windGust, "km/h")}`
        : "weather unavailable",
      bestWindow ? `best daylight window ${bestWindow.localLabel}` : "tide window unavailable",
    ].join("; "),
    metrics,
    weather: {
      status: weatherSnapshot?.status ?? "unavailable",
      condition: weatherSnapshot?.today.condition ?? "Unavailable",
      precipitationProbability: weatherSnapshot?.today.precipitationProbability ?? null,
      rainSum: weatherSnapshot?.today.rainSum ?? weatherSnapshot?.today.precipitationSum ?? null,
      windGust: weatherSnapshot?.today.windGust ?? null,
    },
    tide: {
      status: tideLive ? "live" : "unavailable",
      stationName: tideSnapshot?.stationName ?? "Dapa tide station",
      nextEvent: nextTideEvent
        ? `${nextTideEvent.type ?? "tide"} ${nextTideEvent.time} ${nextTideEvent.heightMeters}m`
        : null,
      bestWindow: bestWindow ? `${bestWindow.localLabel}: ${bestWindow.reason}` : null,
    },
    caveats: surfCaveats({ tideLive, weatherLive }),
  };
}

async function fetchWeatherSnapshot(
  location: SiargaoPublicForecastLocation,
  dependencies: SurfSnapshotDependencies,
) {
  try {
    const getSnapshot = dependencies.getWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;
    const providerLocation = openMeteoLocationForPublicLabel(location);
    return await getSnapshot(providerLocation ? { location: providerLocation } : {});
  } catch {
    return null;
  }
}

async function fetchTideSnapshot(
  location: SiargaoPublicForecastLocation,
  now: Date,
  dependencies: SurfSnapshotDependencies,
) {
  try {
    const buildSnapshot = dependencies.buildTideSnapshot ?? buildTideForecastSnapshot;
    return await buildSnapshot({
      dateRange: "today",
      fetchedAt: now,
      location: tideForecastLocationForSiargaoLabel(location),
      requestedLocation: location,
    });
  } catch {
    return null;
  }
}

function surfStatus({
  tideLive,
  weatherLive,
}: {
  tideLive: boolean;
  weatherLive: boolean;
}): SurfConditionsStatus {
  if (tideLive && weatherLive) {
    return "live";
  }
  if (tideLive || weatherLive) {
    return "partial";
  }
  return "unavailable";
}

function surfLevel({
  precipitationProbability,
  rainSum,
  swellMeters,
  weatherCondition,
  windGust,
  windKmh,
}: {
  precipitationProbability: number | null;
  rainSum: number | null;
  swellMeters: number | null;
  weatherCondition: string | null;
  windGust: number | null;
  windKmh: number | null;
}): SurfConditionLevel {
  const normalizedCondition = weatherCondition?.toLowerCase() ?? "";
  if (
    normalizedCondition.includes("thunder") ||
    (windGust ?? 0) >= 55 ||
    (rainSum ?? 0) >= 18 ||
    (windKmh ?? 0) >= 40
  ) {
    return "high";
  }
  if (
    (precipitationProbability ?? 0) >= 45 ||
    (rainSum ?? 0) >= 6 ||
    (windGust ?? 0) >= 35 ||
    (windKmh ?? 0) >= 25 ||
    (swellMeters ?? 0) >= 1.5
  ) {
    return "medium";
  }
  return "low";
}

function surfRecommendation({
  level,
  status,
  tideLive,
  weatherLive,
}: {
  level: SurfConditionLevel;
  status: SurfConditionsStatus;
  tideLive: boolean;
  weatherLive: boolean;
}) {
  if (status === "unavailable") {
    return "Conditions unavailable; ask a local surf operator before paddling out.";
  }
  if (level === "high") {
    return "Avoid committing until a local surf operator confirms the break.";
  }
  if (!weatherLive || !tideLive || level === "medium") {
    return "Keep it flexible and confirm at the break before paddling out.";
  }
  return "Reasonable window from weather and Dapa tide data; still confirm locally.";
}

function closestUpcomingTideEvent(snapshot: TideForecastSnapshot, now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const events = snapshot.days
    .flatMap((day) => day.tides)
    .filter((event) => event.type === "high" || event.type === "low")
    .sort((left, right) => left.timestamp - right.timestamp);
  return events.find((event) => event.timestamp >= nowSeconds) ?? events[0] ?? null;
}

function closestTideSeaPeriod(snapshot: TideForecastSnapshot, now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return snapshot.seaPeriods.reduce<(typeof snapshot.seaPeriods)[number] | null>((best, period) => {
    if (!best) {
      return period;
    }
    return Math.abs(period.timestamp - nowSeconds) < Math.abs(best.timestamp - nowSeconds)
      ? period
      : best;
  }, null);
}

function surfCaveats({ tideLive, weatherLive }: { tideLive: boolean; weatherLive: boolean }) {
  return [
    "Surf conditions are inferred from Open-Meteo weather and Tide-Forecast Dapa station page data.",
    "This is not an official surf report, tide-gauge reading, lifeguard check, local operator call, or safety clearance.",
    tideLive
      ? "Dapa is used as the nearby tide-station proxy for Cloud 9 and General Luna surf timing."
      : "Dapa tide-station page data could not be checked.",
    weatherLive ? undefined : "Open-Meteo weather could not be checked.",
  ].filter((caveat): caveat is string => Boolean(caveat));
}

function formatMetric(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
}

function formatNullableMetric(value: number | null, unit: string) {
  return value === null ? "unavailable" : formatMetric(value, unit);
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
