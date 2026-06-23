import { describe, expect, test } from "bun:test";

import {
  buildWeatherSnapshotFromRows,
  fallbackWeatherSnapshot,
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
    expect(snapshot.evidenceIds).toEqual(["ev_forecast", "ev_precipitation", "ev_rain", "ev_wind"]);
  });

  test("falls back when no public weather fact rows exist", () => {
    expect(buildWeatherSnapshotFromRows([])).toBe(fallbackWeatherSnapshot);
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
  };
}
