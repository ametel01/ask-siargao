import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import {
  buildOpenMeteoMarineUrl,
  createOpenMeteoMarineIngestionBatch,
  parseOpenMeteoMarineResponse,
  summarizeOpenMeteoMarine,
} from "@/server/providers/open-meteo-marine";
import { upsertProviderFactGraphBatch } from "@/server/providers/provider-write-batches";
import { SourceRegistry } from "@/server/providers/source-registry";

const fixture = {
  latitude: 9.791664,
  longitude: 126.125015,
  generationtime_ms: 0.42,
  utc_offset_seconds: 28_800,
  timezone: "Asia/Manila",
  timezone_abbreviation: "GMT+8",
  elevation: 5,
  current_units: {
    time: "iso8601",
    interval: "seconds",
    wave_height: "m",
    wave_direction: "°",
    wave_period: "s",
    swell_wave_height: "m",
    swell_wave_direction: "°",
    swell_wave_period: "s",
    sea_level_height_msl: "m",
    sea_surface_temperature: "°C",
    ocean_current_velocity: "km/h",
    ocean_current_direction: "°",
  },
  current: {
    time: "2026-06-28T12:15",
    interval: 900,
    wave_height: 0.48,
    wave_direction: 84,
    wave_period: 8.35,
    swell_wave_height: 0.38,
    swell_wave_direction: 76,
    swell_wave_period: 6.75,
    sea_level_height_msl: 0.26,
    sea_surface_temperature: 30.7,
    ocean_current_velocity: 1.3,
    ocean_current_direction: 180,
  },
  hourly_units: {
    time: "iso8601",
    wave_height: "m",
    swell_wave_height: "m",
    sea_level_height_msl: "m",
    ocean_current_velocity: "km/h",
  },
  hourly: {
    time: ["2026-06-28T12:00", "2026-06-28T13:00", "2026-06-28T14:00"],
    wave_height: [0.48, 0.58, 0.51],
    swell_wave_height: [0.38, 0.52, 0.45],
    sea_level_height_msl: [0.24, 0.33, 0.18],
    ocean_current_velocity: [1.3, 1.1, 1.6],
  },
};

describe("Open-Meteo Marine adapter", () => {
  test("builds the marine URL with current and hourly sea-condition variables", () => {
    const url = new URL(buildOpenMeteoMarineUrl());

    expect(url.origin).toBe("https://marine-api.open-meteo.com");
    expect(url.pathname).toBe("/v1/marine");
    expect(url.searchParams.get("latitude")).toBe("9.784");
    expect(url.searchParams.get("longitude")).toBe("126.158");
    expect(url.searchParams.get("timezone")).toBe("Asia/Manila");
    expect(url.searchParams.get("forecast_days")).toBe("2");
    expect(url.searchParams.get("current")).toContain("sea_level_height_msl");
    expect(url.searchParams.get("current")).toContain("ocean_current_velocity");
    expect(url.searchParams.get("hourly")).toContain("wave_height");
    expect(url.searchParams.get("hourly")).toContain("sea_level_height_msl");
  });

  test("summarizes modelled tide proxy and sea-condition extremes", () => {
    const summary = summarizeOpenMeteoMarine(fixture);

    expect(summary.forecastHours).toBe(3);
    expect(summary.current).toEqual({
      oceanCurrentDirection: 180,
      oceanCurrentVelocity: 1.3,
      seaLevelHeightMsl: 0.26,
      seaSurfaceTemperature: 30.7,
      swellWaveDirection: 76,
      swellWaveHeight: 0.38,
      swellWavePeriod: 6.75,
      time: "2026-06-28T12:15",
      waveDirection: 84,
      waveHeight: 0.48,
      wavePeriod: 8.35,
    });
    expect(summary.maxWaveHeight).toBe(0.58);
    expect(summary.maxWaveHeightTime).toBe("2026-06-28T13:00");
    expect(summary.maxSwellWaveHeight).toBe(0.52);
    expect(summary.maxOceanCurrentVelocity).toBe(1.6);
    expect(summary.minSeaLevelHeightMsl).toBe(0.18);
    expect(summary.maxSeaLevelHeightMsl).toBe(0.33);
    expect(summary.seaLevelHeightRangeMsl).toBe(0.15);
  });

  test("creates governed marine source record, facts, evidence, scores, and refresh job", () => {
    const batch = createOpenMeteoMarineIngestionBatch({
      fetchedAt: "2026-06-28T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://marine-api.open-meteo.com/v1/marine?example=true",
    });

    expect(batch.rawSnapshot.contentHash).toHaveLength(64);
    expect(batch.rawSnapshot.sourceProfileId).toBe("source_open_meteo_marine");
    expect(batch.sourceRecord.id).toBe("record_open_meteo_siargao_marine");
    expect(batch.sourceRecord.entityType).toBe("marine_forecast");
    expect(batch.sourceRecord.normalizedPayload.current).toEqual({
      oceanCurrentDirection: 180,
      oceanCurrentVelocity: 1.3,
      seaLevelHeightMsl: 0.26,
      seaSurfaceTemperature: 30.7,
      swellWaveDirection: 76,
      swellWaveHeight: 0.38,
      swellWavePeriod: 6.75,
      time: "2026-06-28T12:15",
      waveDirection: 84,
      waveHeight: 0.48,
      wavePeriod: 8.35,
    });
    expect(batch.facts.map((fact) => fact.factType)).toEqual([
      "marine_forecast_freshness",
      "marine_tide_sea_level_range",
      "marine_wave_height_risk",
      "marine_swell_height_risk",
      "marine_current_velocity_risk",
    ]);
    expect(batch.facts[1]?.claim).toContain("Modelled sea level height");
    expect(batch.facts[1]?.notes).toContain("not present as official tide-table");
    expect(batch.evidence).toHaveLength(5);
    expect(batch.factConfidenceScores).toHaveLength(5);
    expect(batch.sourceCredibilityScore.label).toBe("medium");
    expect(batch.refreshJob.id).toBe("refresh_open_meteo_siargao_marine");
    expect(batch.refreshJob.scheduledAt).toBe("2026-06-29T04:00:00.000Z");
    expect(batch.facts.every((fact) => fact.auditUseAllowed)).toBe(true);
    expect(batch.facts.every((fact) => fact.publicRepublishAllowed)).toBe(true);
  });

  test("accepts null marine model values but still validates hourly array lengths", () => {
    const parsed = parseOpenMeteoMarineResponse({
      ...fixture,
      current: {
        ...fixture.current,
        sea_level_height_msl: null,
      },
      hourly: {
        ...fixture.hourly,
        sea_level_height_msl: [null, 0.33, 0.18],
      },
    });

    expect(parsed.current.sea_level_height_msl).toBeNull();
    expect(() =>
      parseOpenMeteoMarineResponse({
        ...fixture,
        hourly: {
          ...fixture.hourly,
          wave_height: [0.48],
        },
      }),
    ).toThrow("hourly.wave_height length does not match hourly.time");
  });

  test("requires source_open_meteo_marine to be registered and fact-graph eligible", () => {
    const registry = new SourceRegistry(
      createDefaultSourceRegistry()
        .list()
        .filter((profile) => profile.id !== "source_open_meteo_marine"),
    );

    expect(() =>
      createOpenMeteoMarineIngestionBatch({
        fetchedAt: "2026-06-28T04:00:00.000Z",
        payload: fixture,
        registry,
      }),
    ).toThrow("No explicit source profile is registered for source_open_meteo_marine");
  });

  test("persists marine fact graph batches after facts and before dependent rows", async () => {
    const db = await openOpenMeteoMarineStoreTestDatabase();
    const countedDb = countQueries(db);
    const batch = createOpenMeteoMarineIngestionBatch({
      fetchedAt: "2026-06-28T04:00:00.000Z",
      payload: fixture,
      requestUrl: "https://marine-api.open-meteo.com/v1/marine?example=true",
    });

    await db.exec("begin");
    await upsertProviderFactGraphBatch(countedDb, batch);
    await db.exec("commit");

    const counts = await db.query<{
      facts: number;
      evidence: number;
      fact_confidence_scores: number;
      refresh_jobs: number;
    }>(`
      select
        (select count(*)::int from facts) as facts,
        (select count(*)::int from evidence) as evidence,
        (select count(*)::int from fact_confidence_scores) as fact_confidence_scores,
        (select count(*)::int from refresh_jobs) as refresh_jobs
    `);

    expect(counts.rows[0]).toEqual({
      facts: 5,
      evidence: 5,
      fact_confidence_scores: 5,
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
});

async function openOpenMeteoMarineStoreTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  await seedOpenMeteoMarineProfiles(db);
  return db;
}

async function seedOpenMeteoMarineProfiles(db: PGlite) {
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
      'source_open_meteo_marine',
      'provider_open_meteo',
      'Open-Meteo Marine API profile',
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
