import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import { operationalTaskTypes } from "@/server/operations/contracts";
import {
  authorizeVercelCron,
  enqueueAndRunOperationalWorker,
  runWeatherCron,
} from "@/server/operations/vercel-cron";

describe("authenticated Vercel Cron adapters", () => {
  test("returns a no-op without touching the database when forecasts are disabled", async () => {
    const db: DatabaseQueryClient = {
      async query() {
        throw new Error("database must not be touched");
      },
    };

    await expect(runWeatherCron("weather", db, { VERCEL_ENV: "production" })).resolves.toEqual({
      kind: "weather",
      status: "disabled",
    });
  });

  test("uses the selected environment for the ingestion provider guard", async () => {
    const db: DatabaseQueryClient = {
      async query() {
        throw new Error("database must not be touched");
      },
    };

    await expect(
      runWeatherCron("weather", db, {
        APP_ENV: "production",
        OPEN_METEO_API_MODE: "noncommercial",
      }),
    ).rejects.toThrow("OPEN_METEO_API_MODE must be off in production");
  });

  test("requires the exact bearer secret", () => {
    const request = (authorization?: string) =>
      new Request("https://siargao.test/api/cron/operations", {
        headers: authorization ? { authorization } : {},
      });

    expect(authorizeVercelCron(request(), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer wrong-secret"), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), "cron-secret-value")).toBe(
      true,
    );
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), undefined)).toBe(false);
  });

  test("drains more than 125 due reconciliations ahead of unrelated worker backlog", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query("insert into users (id, email) values ('account_cron_drain', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, created_at, updated_at
         ) select 'order_cron_' || value, 'account_cron_drain', 'pending',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
           'checkout_cron_' || value, now() - interval '1 hour', now() - interval '1 minute'
         from generate_series(1, 151) value`,
      );
      await db.query(
        `insert into operational_worker_tasks (id, task_type, resource_ref)
         select 'unrelated_task_' || value, 'retention_purge', 'unrelated_' || value
         from generate_series(1, 120) value`,
      );
      let reconciled = 0;
      const handlers = Object.fromEntries(
        operationalTaskTypes.map((taskType) => [
          taskType,
          async () => {
            if (taskType === "commerce_reconciliation") reconciled += 1;
          },
        ]),
      );

      const result = await enqueueAndRunOperationalWorker({
        db,
        handlers,
        sentry: { send: async () => undefined },
      });

      expect(result.enqueued.commerce_reconciliation).toBe(151);
      expect(reconciled).toBe(151);
      expect(result.worker).toEqual({ claimed: 251, failed: 0, stale: 0, succeeded: 251 });
      const state = await db.query<{ pending_other: string; succeeded_reconciliation: string }>(
        `select
           count(*) filter (where task_type = 'retention_purge' and status = 'pending')::text
             as pending_other,
           count(*) filter (where task_type = 'commerce_reconciliation' and status = 'succeeded')::text
             as succeeded_reconciliation
         from operational_worker_tasks`,
      );
      expect(state.rows[0]).toEqual({ pending_other: "20", succeeded_reconciliation: "151" });
    } finally {
      await db.close();
    }
  });
});
