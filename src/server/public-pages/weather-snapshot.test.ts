import { describe, expect, test } from "bun:test";

import {
  buildWeatherSnapshotFromRows,
  fallbackWeatherSnapshot,
  getLatestSiargaoWeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

const fetchedAt = "2026-06-24T04:00:00.000Z";
const expiresAt = "2026-06-25T04:00:00.000Z";
const normalizedPayload = {
  forecastDays: 3,
  maxPrecipitationDate: "2026-06-25",
  maxPrecipitationProbability: 82,
  maxRainDate: "2026-06-25",
  maxRainSum: 8.6,
  maxWindGust: 42.7,
  maxWindGustDate: "2026-06-25",
  todayForecast: {
    date: "2026-06-24",
    precipitationProbability: 44,
    precipitationSum: 2.1,
    rainSum: 1.8,
    weatherCode: 61,
    windGust: 33.5,
    windSpeed: 18.2,
  },
};
const rawPayload = {
  daily: {
    precipitation_probability_max: [44, 82, 19],
    precipitation_sum: [2.1, 9.4, 0.3],
    rain_sum: [1.8, 8.6, 0.1],
    time: ["2026-06-24", "2026-06-25", "2026-06-26"],
    weather_code: [61, 80, 3],
    wind_gusts_10m_max: [33.5, 42.7, 30.2],
    wind_speed_10m_max: [18.2, 21.4, 17.1],
  },
};
const openMeteoResponseFixture = {
  latitude: 9.75,
  longitude: 126.125,
  timezone: "Asia/Manila",
  daily: rawPayload.daily,
};

describe("weather public snapshot", () => {
  test("builds a frontend-safe Open-Meteo snapshot from governed facts", () => {
    const snapshot = buildWeatherSnapshotFromRows(
      [
        weatherRow({
          evidenceId: "ev_forecast",
          factType: "weather_forecast_freshness",
          claim: "Open-Meteo forecast for Siargao was fetched.",
        }),
        weatherRow({
          evidenceId: "ev_precipitation",
          factType: "weather_precipitation_risk",
          claim: "Maximum daily precipitation probability in the next 3 days is 82%.",
        }),
        weatherRow({
          evidenceId: "ev_rain",
          factType: "weather_rain_volume_risk",
          claim: "Maximum forecast daily rain sum in the next 3 days is 8.6 mm.",
        }),
        weatherRow({
          evidenceId: "ev_wind",
          factType: "weather_wind_risk",
          claim: "Maximum forecast wind gust in the next 3 days is 42.7 km/h.",
        }),
      ],
      new Date("2026-06-24T08:00:00.000Z"),
    );

    expect(snapshot.status).toBe("live");
    expect(snapshot.freshness).toBe("fresh");
    expect(snapshot.confidence).toBe("medium");
    expect(snapshot.metrics).toHaveLength(3);
    expect(snapshot.metrics[0]).toMatchObject({
      id: "precipitation_probability",
      value: 82,
      unit: "%",
      level: "high",
      evidenceId: "ev_precipitation",
    });
    expect(snapshot.summary).toContain("82%");
    expect(snapshot.today).toMatchObject({
      condition: "Rain",
      date: "2026-06-24",
      precipitationProbability: 44,
      rainSum: 1.8,
      windGust: 33.5,
    });
    expect(snapshot.evidenceIds).toEqual(["ev_forecast", "ev_precipitation", "ev_rain", "ev_wind"]);
  });

  test("falls back when no public weather fact rows exist", () => {
    expect(buildWeatherSnapshotFromRows([])).toBe(fallbackWeatherSnapshot);
  });

  test("fetches a live Open-Meteo snapshot when no database is configured", async () => {
    const snapshot = await getLatestSiargaoWeatherSnapshot({
      databaseUrl: "",
      fetcher: async () => Response.json(openMeteoResponseFixture),
      now: new Date("2026-06-24T08:00:00.000Z"),
    });

    expect(snapshot.status).toBe("live");
    expect(snapshot.sourceProfileId).toBe("source_open_meteo");
    expect(snapshot.freshness).toBe("fresh");
    expect(snapshot.today).toMatchObject({
      condition: "Rain",
      date: "2026-06-24",
      precipitationProbability: 44,
      windGust: 33.5,
    });
    expect(snapshot.summary).toContain("82%");
    expect(snapshot.citationUrl).toContain("api.open-meteo.com");
  });

  test("keeps the safe fallback when direct Open-Meteo fetch fails", async () => {
    const snapshot = await getLatestSiargaoWeatherSnapshot({
      databaseUrl: "",
      fetcher: async () => new Response("unavailable", { status: 503 }),
      now: new Date("2026-06-24T08:00:00.000Z"),
    });

    expect(snapshot).toBe(fallbackWeatherSnapshot);
  });

  test("uses MET Norway instead of the noncommercial adapter in production", async () => {
    let requestedUrl = "";
    const snapshot = await getLatestSiargaoWeatherSnapshot({
      databaseUrl: "postgres://must-not-be-read-in-production-routing",
      env: { VERCEL_ENV: "production" },
      fetcher: async (url) => {
        requestedUrl = String(url);
        return Response.json({
          type: "Feature",
          properties: {
            meta: { updated_at: "2026-08-15T01:17:04Z" },
            timeseries: [
              {
                time: "2026-08-15T00:00:00Z",
                data: {
                  instant: { details: { wind_speed: 3.2 } },
                  next_1_hours: {
                    summary: { symbol_code: "rainshowers_day" },
                    details: { precipitation_amount: 0.8 },
                  },
                },
              },
              {
                time: "2026-08-15T01:00:00Z",
                data: {
                  instant: { details: { wind_speed: 4.5 } },
                  next_1_hours: {
                    summary: { symbol_code: "rainshowers_day" },
                    details: { precipitation_amount: 1.4 },
                  },
                },
              },
            ],
          },
        });
      },
      now: new Date("2026-08-15T02:00:00Z"),
    });

    expect(requestedUrl).toContain("api.met.no");
    expect(snapshot).toMatchObject({
      status: "live",
      sourceName: "MET Norway Locationforecast",
      sourceProfileId: "source_met_norway",
      freshness: "fresh",
      today: {
        condition: "Rain showers",
        precipitationProbability: null,
        rainSum: 2.2,
        windGust: null,
        windSpeed: 16.2,
      },
    });
    expect(snapshot.summary).toContain("Norwegian Meteorological Institute");
  });
});

function weatherRow({
  claim,
  evidenceId,
  factType,
}: {
  factType: string;
  claim: string;
  evidenceId: string;
}) {
  return {
    factId: `fact_${factType}`,
    factType,
    claim,
    fetchedAt,
    expiresAt,
    confidenceLabel: "medium",
    evidenceId,
    citationUrl: "https://api.open-meteo.com/v1/forecast?example=true",
    sourceName: "Open-Meteo weather API",
    recordName: "Siargao Island forecast",
    normalizedPayload,
    rawPayload,
  };
}
