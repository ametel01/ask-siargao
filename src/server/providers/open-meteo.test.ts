import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import {
  buildOpenMeteoForecastUrl,
  buildOpenMeteoIngestionBatch,
  createOpenMeteoIngestionBatch,
  parseOpenMeteoForecastResponse,
  summarizeOpenMeteoForecast,
} from "@/server/providers/open-meteo";
import { upsertProviderFactGraphBatch } from "@/server/providers/provider-write-batches";
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
  test("does not call the noncommercial API when production mode is off", async () => {
    let fetchCalls = 0;

    await expect(
      buildOpenMeteoIngestionBatch({
        env: { VERCEL_ENV: "production" },
        fetcher: async () => {
          fetchCalls += 1;
          return Response.json(fixture);
        },
      }),
    ).rejects.toThrow("open_meteo_api_disabled");
    expect(fetchCalls).toBe(0);
  });

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

  test("keeps default profile freshness deterministic after profile consumers mutate snapshots", () => {
    const profile = createDefaultSourceRegistry().require("source_open_meteo");
    profile.freshnessWindowDays = Number.NaN;

    const batch = createOpenMeteoIngestionBatch({
      fetchedAt: "2026-06-24T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://api.open-meteo.com/v1/forecast?example=true",
    });

    expect(batch.refreshJob.scheduledAt).toBe("2026-06-25T04:00:00.000Z");
    expect(batch.facts.every((fact) => fact.expiresAt === "2026-06-25T04:00:00.000Z")).toBe(true);
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

  test("persists weather fact graph batches inside the caller transaction", async () => {
    const db = await openOpenMeteoStoreTestDatabase();
    const countedDb = countQueries(db);
    const batch = createOpenMeteoIngestionBatch({
      fetchedAt: "2026-06-24T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://api.open-meteo.com/v1/forecast?example=true",
    });

    await db.exec("begin");
    await upsertProviderFactGraphBatch(countedDb, batch);
    await db.exec("commit");

    const counts = await db.query<{
      raw_snapshots: number;
      source_records: number;
      facts: number;
      evidence: number;
      fact_confidence_scores: number;
      refresh_jobs: number;
    }>(`
      select
        (select count(*)::int from raw_snapshots) as raw_snapshots,
        (select count(*)::int from source_records) as source_records,
        (select count(*)::int from facts) as facts,
        (select count(*)::int from evidence) as evidence,
        (select count(*)::int from fact_confidence_scores) as fact_confidence_scores,
        (select count(*)::int from refresh_jobs) as refresh_jobs
    `);

    expect(counts.rows[0]).toEqual({
      raw_snapshots: 1,
      source_records: 1,
      facts: 4,
      evidence: 4,
      fact_confidence_scores: 4,
      refresh_jobs: 1,
    });
    expect(countedDb.countInsertInto("facts")).toBe(1);
    expect(countedDb.countInsertInto("evidence")).toBe(1);
    expect(countedDb.countInsertInto("fact_confidence_scores")).toBe(1);
    expect(countedDb.firstInsertIndex("facts")).toBeLessThan(
      countedDb.firstInsertIndex("evidence"),
    );
    expect(countedDb.firstInsertIndex("facts")).toBeLessThan(
      countedDb.firstInsertIndex("fact_confidence_scores"),
    );

    await db.close();
  });

  test("rolls back weather fact graph batches when a dependent score row fails", async () => {
    const db = await openOpenMeteoStoreTestDatabase();
    const batch = createOpenMeteoIngestionBatch({
      fetchedAt: "2026-06-24T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://api.open-meteo.com/v1/forecast?example=true",
    });

    await db.exec("begin");
    try {
      await upsertProviderFactGraphBatch(db, {
        ...batch,
        factConfidenceScores: batch.factConfidenceScores.map((score, index) =>
          index === 0 ? { ...score, factId: "missing_fact_for_score" } : score,
        ),
      });
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      expect(error).toBeInstanceOf(Error);
    }

    const counts = await db.query<{
      raw_snapshots: number;
      source_records: number;
      facts: number;
      evidence: number;
      fact_confidence_scores: number;
    }>(`
      select
        (select count(*)::int from raw_snapshots) as raw_snapshots,
        (select count(*)::int from source_records) as source_records,
        (select count(*)::int from facts) as facts,
        (select count(*)::int from evidence) as evidence,
        (select count(*)::int from fact_confidence_scores) as fact_confidence_scores
    `);

    expect(counts.rows[0]).toEqual({
      raw_snapshots: 0,
      source_records: 0,
      facts: 0,
      evidence: 0,
      fact_confidence_scores: 0,
    });

    await db.close();
  });
});

async function openOpenMeteoStoreTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  await seedOpenMeteoProfiles(db);
  return db;
}

async function seedOpenMeteoProfiles(db: PGlite) {
  await db.query(`
    insert into providers (id, slug, name, provider_type)
    values ('provider_open_meteo', 'open-meteo', 'Open-Meteo', 'weather_api')
    on conflict (id) do nothing
  `);
  await db.query(`
    insert into source_profiles (
      id,
      provider_id,
      source_name,
      source_type,
      access_method,
      allowed_use,
      freshness_window_days,
      authority_level,
      stores_raw_allowed,
      publishes_raw_allowed
    )
    values (
      'source_open_meteo',
      'provider_open_meteo',
      'Open-Meteo weather API profile',
      'licensed_api',
      'api',
      'public_republish',
      1,
      4,
      true,
      true
    )
    on conflict (id) do nothing
  `);
}

function countQueries(db: PGlite) {
  const queries: string[] = [];

  return {
    queries,
    async query<T>(query: string, params?: unknown[]) {
      queries.push(query);
      return db.query<T>(query, params);
    },
    countInsertInto(tableName: string) {
      return queries.filter((query) =>
        new RegExp(`insert\\s+into\\s+${tableName}`, "i").test(query),
      ).length;
    },
    firstInsertIndex(tableName: string) {
      return queries.findIndex((query) =>
        new RegExp(`insert\\s+into\\s+${tableName}`, "i").test(query),
      );
    },
  };
}
