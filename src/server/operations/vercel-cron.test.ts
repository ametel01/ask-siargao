import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import { operationalTaskTypes } from "@/server/operations/contracts";
import {
  operationalWorkerMinimumStartBudgetMs,
  riskReconciliationApplicationBudgetMs,
  riskReconciliationBatchSize,
  riskReconciliationCronAlignmentBudgetMs,
  riskReconciliationEligibilityMs,
  riskReconciliationOrderCapacity,
  riskReconciliationRequiredIntervalMs,
} from "@/server/operations/operational-capacity";
import {
  enqueueAllDueReconciliationTasks,
  enqueueDueOperationalTasks,
} from "@/server/operations/operational-task-producer";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  authorizeVercelCron,
  enqueueAndRunOperationalWorker,
  runWeatherCron,
} from "@/server/operations/vercel-cron";
import { providerRequestTimeoutMs } from "@/server/providers/provider-abort";

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

  test("stops reconciliation production before the worker reserve and resumes next cycle", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query("insert into users (id, email) values ('account_producer_deadline', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, created_at, updated_at
         ) select 'order_producer_deadline_' || value, 'account_producer_deadline', 'pending',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
           'checkout_producer_deadline_' || value, now() - interval '1 hour',
           now() - interval '1 minute'
         from generate_series(1, 151) value`,
      );
      let budgetChecks = 0;
      const first = await enqueueAllDueReconciliationTasks(
        {
          deadlineAt: 55_000,
          minimumRemainingMs: operationalWorkerMinimumStartBudgetMs,
          now: () => (budgetChecks++ < 2 ? 0 : 10_000),
          pageSize: 100,
        },
        db,
      );
      expect(first).toBe(100);
      const afterFirst = await db.query<{ pending: string }>(
        `select count(*)::text as pending from operational_worker_tasks
         where task_type = 'commerce_reconciliation' and status = 'pending'`,
      );
      expect(afterFirst.rows[0]?.pending).toBe("100");

      await expect(enqueueAllDueReconciliationTasks({}, db)).resolves.toBe(51);
      const afterSecond = await db.query<{ pending: string }>(
        `select count(*)::text as pending from operational_worker_tasks
         where task_type = 'commerce_reconciliation' and status = 'pending'`,
      );
      expect(afterSecond.rows[0]?.pending).toBe("151");
    } finally {
      await db.close();
    }
  });

  test("bounds every producer family before the worker reserve", async () => {
    let queries = 0;
    const db: DatabaseQueryClient = {
      async query<_T>(): Promise<{ rows: _T[] }> {
        throw new Error("uncancellable query must not be used");
      },
      async queryWithSignal<T>(
        _query: string,
        _params: unknown[],
        signal: AbortSignal,
      ): Promise<{ rows: T[] }> {
        queries += 1;
        return new Promise<{ rows: T[] }>((_resolve, reject) => {
          const abort = () => reject(signal.reason ?? new Error("aborted"));
          signal.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const startedAt = performance.now();
    const result = await enqueueDueOperationalTasks(
      {
        cycleKey: "producer-deadline",
        deadlineAt: startedAt + 40,
        minimumRemainingMs: 20,
        now: () => performance.now(),
      },
      db,
    );

    expect(performance.now() - startedAt).toBeLessThan(300);
    expect(queries).toBe(1);
    expect(Object.values(result).every((count) => count === 0)).toBe(true);
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

  test("attempts the entire safe risk population early enough for provider latency", async () => {
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
         from generate_series(1, $1::integer) value`,
        [riskReconciliationOrderCapacity],
      );
      await db.query(
        `insert into operational_reconciliation_observations (
           local_entity_type, local_entity_ref, last_applied_sequence, observed_at
         ) select 'trip_pass_order', 'order_cadence_' || value, value,
           clock_timestamp() - interval '2 minutes 30 seconds'
         from generate_series(1, $1::integer) value`,
        [riskReconciliationOrderCapacity],
      );
      await expect(
        enqueueDueOperationalTasks(
          {
            cycleKey: "cadence-before-boundary",
            taskTypes: ["commerce_reconciliation"],
          },
          db,
        ),
      ).resolves.toMatchObject({ commerce_reconciliation: 0 });
      await db.query(
        `update operational_reconciliation_observations
         set observed_at = clock_timestamp() - interval '3 minutes 30 seconds'`,
      );

      let attempts = 0;
      const handlers = {
        commerce_reconciliation: async () => {
          attempts += 1;
        },
      };
      const result = await enqueueAndRunOperationalWorker({
        db,
        handlers,
        sentry: { send: async () => undefined },
      });

      expect(result.worker.claimed).toBe(riskReconciliationBatchSize);
      expect(attempts).toBe(riskReconciliationOrderCapacity);
      const remaining = await db.query<{ pending: string }>(
        `select count(*)::text as pending from operational_worker_tasks
         where task_type = 'commerce_reconciliation' and status = 'pending'`,
      );
      expect(remaining.rows[0]?.pending).toBe("0");
    } finally {
      await db.close();
    }
  });

  test("records a completed slow-provider observation within the five-minute cadence", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query("insert into users (id, email) values ('account_slow_cadence', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, payment_provider,
           created_at, updated_at
         ) values ('order_slow_cadence', 'account_slow_cadence', 'pending',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
           'checkout_slow_cadence', 'lemon_squeezy',
           clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 minute')`,
      );
      await db.query(
        `insert into operational_reconciliation_observations (
           local_entity_type, local_entity_ref, last_applied_sequence, observed_at
         ) values ('trip_pass_order', 'order_slow_cadence', 1,
           clock_timestamp() - interval '3 minutes 5 seconds')`,
      );
      const before = await db.query<{ observed_at: Date | string }>(
        `select observed_at from operational_reconciliation_observations
         where local_entity_ref = 'order_slow_cadence'`,
      );
      let providerSettled = false;
      const commerceReader = {
        async readPaymentFact() {
          await Bun.sleep(100);
          providerSettled = true;
          return { amountMinor: 999, currency: "usd", paymentState: "pending" as const };
        },
      };
      const handlers = createProductionOperationalTaskHandlers({
        commerceReader,
        commerceReaders: { lemon_squeezy: commerceReader },
        db,
      });

      const result = await enqueueAndRunOperationalWorker({
        db,
        handlers,
        sentry: { send: async () => undefined },
      });
      const after = await db.query<{ observed_at: Date | string }>(
        `select observed_at from operational_reconciliation_observations
         where local_entity_ref = 'order_slow_cadence'`,
      );
      const completedIntervalMs =
        new Date(after.rows[0]?.observed_at ?? 0).getTime() -
        new Date(before.rows[0]?.observed_at ?? 0).getTime();

      expect(riskReconciliationEligibilityMs).toBe(3 * 60_000);
      expect(
        riskReconciliationEligibilityMs +
          riskReconciliationCronAlignmentBudgetMs +
          providerRequestTimeoutMs +
          riskReconciliationApplicationBudgetMs,
      ).toBe(riskReconciliationRequiredIntervalMs);
      expect(providerSettled).toBe(true);
      expect(result.worker.succeeded).toBeGreaterThanOrEqual(1);
      expect(completedIntervalMs).toBeLessThan(riskReconciliationRequiredIntervalMs);
    } finally {
      await db.close();
    }
  });
});
