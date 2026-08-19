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

  test("leaves durable tasks pending when too little function budget remains", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query(
        `insert into operational_worker_tasks (id, task_type, resource_ref)
         values ('deadline_task', 'retention_purge', 'deadline_resource')`,
      );
      let handled = 0;
      const result = await enqueueAndRunOperationalWorker({
        db,
        deadlineAt: 100_000,
        handlers: {
          retention_purge: async () => {
            handled += 1;
          },
        },
        now: () => 60_000,
        sentry: { send: async () => undefined },
      });

      expect(result.worker).toEqual({ claimed: 0, failed: 0, stale: 0, succeeded: 0 });
      expect(handled).toBe(0);
      const task = await db.query<{ status: string }>(
        "select status from operational_worker_tasks where id = 'deadline_task'",
      );
      expect(task.rows[0]?.status).toBe("pending");
    } finally {
      await db.close();
    }
  });

  test("runs bounded reconciliation and maintenance batches concurrently under slow failure", async () => {
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
      let maintained = 0;
      let releaseHandlers!: () => void;
      let allStarted!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseHandlers = resolve;
      });
      const started = new Promise<void>((resolve) => {
        allStarted = resolve;
      });
      const handlers = Object.fromEntries(
        operationalTaskTypes.map((taskType) => [
          taskType,
          async () => {
            let fail = false;
            if (taskType === "commerce_reconciliation") {
              reconciled += 1;
              fail = reconciled === 1;
            }
            if (taskType === "retention_purge") maintained += 1;
            if (reconciled === 50 && maintained === 25) allStarted();
            await release;
            if (fail) throw new Error("slow_provider_failure");
          },
        ]),
      );

      const running = enqueueAndRunOperationalWorker({
        db,
        handlers,
        sentry: { send: async () => undefined },
      });
      let startError: unknown;
      try {
        await Promise.race([
          started,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("concurrent_workers_did_not_start")), 2_000),
          ),
        ]);
      } catch (error) {
        startError = error;
      } finally {
        releaseHandlers();
      }
      const result = await running;
      if (startError) throw startError;

      expect(result.enqueued.commerce_reconciliation).toBe(151);
      expect(reconciled).toBe(50);
      expect(maintained).toBe(25);
      expect(result.worker).toEqual({ claimed: 75, failed: 1, stale: 0, succeeded: 74 });
      const state = await db.query<{
        pending_other: string;
        pending_reconciliation: string;
        succeeded_reconciliation: string;
      }>(
        `select
           count(*) filter (where task_type = 'retention_purge' and status = 'pending')::text
             as pending_other,
           count(*) filter (where task_type = 'commerce_reconciliation' and status = 'pending')::text
             as pending_reconciliation,
           count(*) filter (where task_type = 'commerce_reconciliation' and status = 'succeeded')::text
             as succeeded_reconciliation
         from operational_worker_tasks`,
      );
      expect(state.rows[0]).toEqual({
        pending_other: "95",
        pending_reconciliation: "102",
        succeeded_reconciliation: "49",
      });
    } finally {
      await db.close();
    }
  });

  test("attempts 151 due risk Orders within four one-minute bounded worker cycles", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query("insert into users (id, email) values ('account_cron_cadence', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, created_at, updated_at
         ) select 'order_cadence_' || value, 'account_cron_cadence', 'pending',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
           'checkout_cadence_' || value, now() - interval '1 hour', now() - interval '1 minute'
         from generate_series(1, 151) value`,
      );
      let attempts = 0;
      const handlers = {
        commerce_reconciliation: async () => {
          attempts += 1;
        },
      };
      const results = [];
      for (let minute = 0; minute < 4; minute += 1) {
        results.push(
          await enqueueAndRunOperationalWorker({
            db,
            handlers,
            sentry: { send: async () => undefined },
          }),
        );
      }

      expect(results.map((result) => result.worker.claimed)).toEqual([50, 50, 50, 1]);
      expect(attempts).toBe(151);
      const remaining = await db.query<{ pending: string }>(
        `select count(*)::text as pending from operational_worker_tasks
         where task_type = 'commerce_reconciliation' and status = 'pending'`,
      );
      expect(remaining.rows[0]?.pending).toBe("0");
    } finally {
      await db.close();
    }
  });
});
