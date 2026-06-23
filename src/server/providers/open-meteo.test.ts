import { describe, expect, test } from "bun:test";

import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import {
  buildOpenMeteoForecastUrl,
  createOpenMeteoIngestionBatch,
  parseOpenMeteoForecastResponse,
  summarizeOpenMeteoForecast,
} from "@/server/providers/open-meteo";
import { SourceRegistry } from "@/server/providers/source-registry";

const fixture = {
  latitude: 9.75,
  longitude: 126.125,
  generationtime_ms: 0.12,
  utc_offset_seconds: 28_800,
  timezone: "Asia/Manila",
  timezone_abbreviation: "GMT+8",
  elevation: 7,
  daily_units: {
    time: "iso8601",
    weather_code: "wmo code",
    precipitation_sum: "mm",
    precipitation_probability_max: "%",
    rain_sum: "mm",
    wind_speed_10m_max: "km/h",
    wind_gusts_10m_max: "km/h",
  },
  daily: {
    time: ["2026-06-24", "2026-06-25", "2026-06-26"],
    weather_code: [61, 80, 3],
    precipitation_sum: [2.1, 9.4, 0.3],
    precipitation_probability_max: [44, 82, 19],
    rain_sum: [1.8, 8.6, 0.1],
    wind_speed_10m_max: [18.2, 21.4, 17.1],
    wind_gusts_10m_max: [33.5, 42.7, 30.2],
  },
};

describe("Open-Meteo adapter", () => {
  test("builds the forecast URL with the intended coordinates and daily variables", () => {
    const url = new URL(buildOpenMeteoForecastUrl());

    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.pathname).toBe("/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("9.784");
    expect(url.searchParams.get("longitude")).toBe("126.158");
    expect(url.searchParams.get("timezone")).toBe("Asia/Manila");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("daily")).toContain("precipitation_probability_max");
    expect(url.searchParams.get("daily")).toContain("wind_gusts_10m_max");
  });

  test("summarizes peak precipitation, rain, and wind risk from daily forecast data", () => {
    const summary = summarizeOpenMeteoForecast(fixture);

    expect(summary.forecastDays).toBe(3);
    expect(summary.todayForecast).toEqual({
      date: "2026-06-24",
      precipitationProbability: 44,
      precipitationSum: 2.1,
      rainSum: 1.8,
      weatherCode: 61,
      windGust: 33.5,
      windSpeed: 18.2,
    });
    expect(summary.maxPrecipitationProbability).toBe(82);
    expect(summary.maxPrecipitationDate).toBe("2026-06-25");
    expect(summary.maxRainSum).toBe(8.6);
    expect(summary.maxRainDate).toBe("2026-06-25");
    expect(summary.maxWindGust).toBe(42.7);
    expect(summary.maxWindGustDate).toBe("2026-06-25");
  });

  test("creates governed source record, facts, evidence, scores, and refresh job", () => {
    const batch = createOpenMeteoIngestionBatch({
      fetchedAt: "2026-06-24T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://api.open-meteo.com/v1/forecast?example=true",
    });

    expect(batch.rawSnapshot.contentHash).toHaveLength(64);
    expect(batch.sourceRecord.id).toBe("record_open_meteo_siargao_forecast");
    expect(batch.sourceRecord.normalizedPayload.todayForecast).toEqual({
      date: "2026-06-24",
      precipitationProbability: 44,
      precipitationSum: 2.1,
      rainSum: 1.8,
      weatherCode: 61,
      windGust: 33.5,
      windSpeed: 18.2,
    });
    expect(batch.sourceRecord.allowedUse).toBe("public_republish");
    expect(batch.sourceRecord.rawStorageAllowed).toBe(true);
    expect(batch.facts).toHaveLength(4);
    expect(batch.evidence).toHaveLength(4);
    expect(batch.factConfidenceScores).toHaveLength(4);
    expect(batch.sourceCredibilityScore.label).toBe("medium");
    expect(batch.refreshJob.scheduledAt).toBe("2026-06-25T04:00:00.000Z");
    expect(batch.facts.every((fact) => fact.auditUseAllowed)).toBe(true);
    expect(batch.facts.every((fact) => fact.publicRepublishAllowed)).toBe(true);
    expect(batch.evidence.every((evidence) => evidence.publicRepublishAllowed)).toBe(true);
    expect(batch.facts.map((fact) => fact.factType)).toEqual([
      "weather_forecast_freshness",
      "weather_precipitation_risk",
      "weather_rain_volume_risk",
      "weather_wind_risk",
    ]);
  });

  test("rejects malformed daily arrays before fact extraction", () => {
    expect(() =>
      parseOpenMeteoForecastResponse({
        ...fixture,
        daily: {
          ...fixture.daily,
          rain_sum: [1],
        },
      }),
    ).toThrow("daily.rain_sum length does not match daily.time");
  });

  test("requires source_open_meteo to be registered and fact-graph eligible", () => {
    const registry = new SourceRegistry(
      createDefaultSourceRegistry()
        .list()
        .filter((profile) => profile.id !== "source_open_meteo"),
    );

    expect(() =>
      createOpenMeteoIngestionBatch({
        fetchedAt: "2026-06-24T04:00:00.000Z",
        payload: fixture,
        registry,
      }),
    ).toThrow("No explicit source profile is registered for source_open_meteo");
  });
});
