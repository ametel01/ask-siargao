import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration, withTestDatabase } from "@/server/db/test-database";
import {
  evaluateOperationalSchedules,
  recordOperationalScheduleFailure,
  recordOperationalScheduleSuccess,
  runTrackedOperationalSchedule,
} from "@/server/operations/operational-schedule-sentinel";
import { createSentryCronHttpSink, sentryEnvironment } from "@/server/operations/sentry-cron";
import { runMonitoredOperationalCron } from "@/server/operations/vercel-cron";

describe("quota-efficient operational schedule sentinel", () => {
  test("observes all schedules without inventing a success during the initial grace window", async () => {
    await withMigratedDatabase(async (db) => {
      const result = await evaluateOperationalSchedules({
        db,
        now: new Date("2026-08-11T00:00:00.000Z"),
      });

      expect(result).toEqual({
        issues: [],
        ok: true,
        states: [
          { scheduleKey: "marine", status: "observing" },
          { scheduleKey: "places_prune", status: "observing" },
          { scheduleKey: "weather", status: "observing" },
        ],
      });
    });
  });

  test("opens one failure lifecycle until recovery and a new lifecycle after recurrence", async () => {
    await withMigratedDatabase(async (db) => {
      await recordOperationalScheduleFailure("weather", db, new Date("2026-08-11T01:00:00.000Z"));
      await recordOperationalScheduleFailure("weather", db, new Date("2026-08-11T01:05:00.000Z"));

      const failed = await evaluateOperationalSchedules({
        db,
        now: new Date("2026-08-11T01:06:00.000Z"),
      });
      expect(failed.issues).toEqual([
        {
          errorCode: "scheduled_weather_failed",
          lifecycle: 1,
          scheduleKey: "weather",
          status: "failed",
        },
      ]);

      await recordOperationalScheduleSuccess("weather", db, new Date("2026-08-11T01:10:00.000Z"));
      await recordOperationalScheduleFailure("weather", db, new Date("2026-08-11T04:00:00.000Z"));
      const recurred = await evaluateOperationalSchedules({
        db,
        now: new Date("2026-08-11T04:01:00.000Z"),
      });
      expect(recurred.issues).toContainEqual({
        errorCode: "scheduled_weather_failed",
        lifecycle: 2,
        scheduleKey: "weather",
        status: "failed",
      });
    });
  });

  test("marks three-hour schedules stale after their bounded grace period", async () => {
    await withMigratedDatabase(async (db) => {
      await evaluateOperationalSchedules({ db, now: new Date("2026-08-11T00:00:00.000Z") });
      const stale = await evaluateOperationalSchedules({
        db,
        now: new Date("2026-08-11T03:31:00.001Z"),
      });

      expect(stale.issues).toEqual([
        {
          errorCode: "scheduled_marine_stale",
          lifecycle: 1,
          scheduleKey: "marine",
          status: "stale",
        },
        {
          errorCode: "scheduled_weather_stale",
          lifecycle: 1,
          scheduleKey: "weather",
          status: "stale",
        },
      ]);
      expect(stale.states).toContainEqual({ scheduleKey: "places_prune", status: "observing" });
    });
  });

  test("records tracked success and failure without retaining raw exception text", async () => {
    await withMigratedDatabase(async (db) => {
      await expect(
        runTrackedOperationalSchedule(
          "marine",
          async () => {
            throw new Error("https://provider.invalid/private?query=raw traveler text");
          },
          { db, now: () => new Date("2026-08-11T05:00:00.000Z") },
        ),
      ).rejects.toThrow("raw traveler text");
      const failed = await db.query<{ last_error_code: string }>(
        "select last_error_code from operational_schedule_states where schedule_key = 'marine'",
      );
      expect(failed.rows).toEqual([{ last_error_code: "scheduled_marine_failed" }]);

      await expect(
        runTrackedOperationalSchedule("marine", async () => "ok", {
          db,
          now: () => new Date("2026-08-11T05:01:00.000Z"),
        }),
      ).resolves.toBe("ok");
      const recovered = await db.query<{
        consecutive_failures: number;
        last_error_code: string | null;
        status: string;
      }>(
        "select status, consecutive_failures, last_error_code from operational_schedule_states where schedule_key = 'marine'",
      );
      expect(recovered.rows).toEqual([
        { consecutive_failures: 0, last_error_code: null, status: "healthy" },
      ]);
    });
  });

  test("reports one aggregate check-in and pages the exact unhealthy schedule", async () => {
    await withMigratedDatabase(async (db) => {
      await recordOperationalScheduleFailure(
        "places_prune",
        db,
        new Date("2026-08-11T06:00:00.000Z"),
      );
      const checkIns: string[] = [];
      const pages: string[] = [];
      const result = await runMonitoredOperationalCron({
        cron: {
          async send(input) {
            checkIns.push(`${input.environment}:${input.status}`);
          },
        },
        db,
        environment: "staging",
        now: new Date("2026-08-11T06:01:00.000Z"),
        sentry: {
          async send(event) {
            pages.push(`${event.operation}:${event.errorCode}`);
          },
        },
      });

      expect(result.schedules.ok).toBe(false);
      expect(checkIns).toEqual(["staging:error"]);
      expect(pages).toContain("scheduled_maintenance:scheduled_places_prune_failed");
    });
  });
});

describe("Sentry Cron ingestion", () => {
  test("sends a bounded scrubbed check-in to the DSN-derived Cron endpoint", async () => {
    const requests: Array<{ init: RequestInit; url: string }> = [];
    const sink = createSentryCronHttpSink({
      dsn: "https://public@example.invalid/42",
      fetchImpl: async (url, init) => {
        requests.push({ init, url });
        return new Response(null, { status: 202 });
      },
      monitorSlug: "ask-siargao-account-closure",
    });

    await sink.send({ durationMs: 1_250, environment: "Staging Custom", status: "ok" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://example.invalid/api/42/cron/ask-siargao-account-closure/public/?status=ok&environment=staging-custom&duration=1.250",
    );
    expect(requests[0]?.init.method).toBe("GET");
  });

  test("prefers an explicit Sentry environment over Vercel environment aliases", () => {
    expect(
      sentryEnvironment({
        SENTRY_ENVIRONMENT: "Production",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "staging",
      }),
    ).toBe("production");
  });
});

async function withMigratedDatabase(work: (db: DatabaseQueryClient) => Promise<void>) {
  await withTestDatabase(async (database) => {
    await runInitialMigration(database);
    await work(createPgliteQueryClient(database));
  });
}

function createPgliteQueryClient(database: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return database.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await database.exec("begin");
      try {
        const result = await callback(client);
        await database.exec("commit");
        return result;
      } catch (error) {
        await database.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}
