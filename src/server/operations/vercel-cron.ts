import { timingSafeEqual } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { pruneGooglePlacesContent } from "@/server/jobs/prune-google-places";
import type { OperationalTaskHandlers, operationalTaskTypes } from "@/server/operations/contracts";
import {
  operationalCronInternalDeadlineMs,
  operationalWorkerMinimumStartBudgetMs,
  riskReconciliationBatchSize,
} from "@/server/operations/operational-capacity";
import {
  evaluateOperationalSchedules,
  runTrackedOperationalSchedule,
} from "@/server/operations/operational-schedule-sentinel";
import {
  enqueueAllDueReconciliationTasks,
  enqueueDueOperationalTasks,
} from "@/server/operations/operational-task-producer";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  createSentryHttpSink,
  deliverOperationalAlertOnce,
  deliverPendingPageWorthyAlerts,
  type SentryOperationalSink,
} from "@/server/operations/sentry-alerts";
import {
  createSentryCronHttpSink,
  type SentryCronSink,
  sentryEnvironment,
} from "@/server/operations/sentry-cron";
import { runOperationalWorkerConcurrently } from "@/server/operations/worker-runner";
import { buildOpenMeteoIngestionBatch } from "@/server/providers/open-meteo";
import { buildOpenMeteoMarineIngestionBatch } from "@/server/providers/open-meteo-marine";
import { readOpenMeteoApiMode } from "@/server/providers/production-provider-mode";
import { upsertProviderFactGraphBatch } from "@/server/providers/provider-write-batches";

export function authorizeVercelCron(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret) {
    return false;
  }
  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;
  if (!authorization || authorization.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

export async function runOperationalCron(
  dependencies: { db?: DatabaseQueryClient; now?: Date; sentry?: SentryOperationalSink } = {},
) {
  const startedAt = performance.now();
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const sentry = dependencies.sentry ?? sentryFromEnvironment();
  if (!sentry) {
    throw new Error("sentry_configuration_unavailable");
  }
  const workerPromise = enqueueAndRunOperationalWorker({
    db,
    deadlineAt: startedAt + operationalCronInternalDeadlineMs,
    sentry,
  });
  const alertsAndSchedules = Promise.all([
    deliverPendingPageWorthyAlerts({ db, sink: sentry }),
    evaluateOperationalSchedules({ db, now: dependencies.now }),
  ]);
  const [{ enqueued, worker }, [alerts, schedules]] = await Promise.all([
    workerPromise,
    alertsAndSchedules,
  ]);
  const scheduleAlerts = await Promise.all(
    schedules.issues.map((issue) =>
      deliverOperationalAlertOnce(
        {
          alertKey: `scheduled-operation:${issue.scheduleKey}:${issue.status}:lifecycle:${issue.lifecycle}`,
          errorCode: issue.errorCode,
          impact: "high",
          operation: "scheduled_maintenance",
        },
        { db, sink: sentry },
      ),
    ),
  );
  return {
    alerts: { pending: alerts.checked, schedules: scheduleAlerts },
    enqueued,
    schedules,
    worker,
  };
}

export async function enqueueAndRunOperationalWorker({
  db,
  deadlineAt,
  handlers = createProductionOperationalTaskHandlers({ db }),
  now,
  sentry,
}: {
  db: DatabaseQueryClient;
  deadlineAt?: number;
  handlers?: OperationalTaskHandlers;
  now?: () => number;
  sentry: SentryOperationalSink;
}) {
  const recoveryTaskTypes = [
    "account_closure",
    "checkout_return_lookup",
    "pending_payment_event",
    "pending_stripe_event",
    "paid_after_closure_refund",
    "lemon_squeezy_refund",
  ] as const;
  const maintenanceTaskTypes = ["retention_purge"] as const;
  const nonReconciliationTaskTypes = [...recoveryTaskTypes, ...maintenanceTaskTypes];
  const enqueued = await enqueueDueOperationalTasks(
    { limitPerType: 25, taskTypes: nonReconciliationTaskTypes },
    db,
  );
  enqueued.commerce_reconciliation = await enqueueAllDueReconciliationTasks(
    {
      deadlineAt,
      minimumRemainingMs: operationalWorkerMinimumStartBudgetMs,
      now,
      pageSize: 100,
    },
    db,
  );
  const workerDependencies = {
    db,
    handlers,
    onRepeatedFailure: async ({
      attempts,
      taskKey,
      taskType,
    }: {
      attempts: number;
      taskKey: string;
      taskType: (typeof operationalTaskTypes)[number];
    }) => {
      await deliverOperationalAlertOnce(
        {
          alertKey: `worker:${taskKey}:tier:${attempts >= 5 ? "high" : "warning"}`,
          errorCode: "operational_worker_repeated_failure",
          impact: attempts >= 5 ? "high" : "warning",
          operation: taskTypeOperation(taskType),
        },
        { db, sink: sentry },
      );
    },
  };
  const workerResults = await Promise.all([
    runOperationalWorkerConcurrently(
      {
        batchSize: riskReconciliationBatchSize,
        deadlineAt,
        leaseSeconds: 60,
        minimumStartBudgetMs: operationalWorkerMinimumStartBudgetMs,
        now,
        taskTypes: ["commerce_reconciliation"],
      },
      workerDependencies,
    ),
    ...recoveryTaskTypes.map((taskType) =>
      runOperationalWorkerConcurrently(
        {
          batchSize: 25,
          deadlineAt,
          leaseSeconds: 60,
          minimumStartBudgetMs: operationalWorkerMinimumStartBudgetMs,
          now,
          taskTypes: [taskType],
        },
        workerDependencies,
      ),
    ),
    runOperationalWorkerConcurrently(
      {
        batchSize: 25,
        deadlineAt,
        leaseSeconds: 60,
        minimumStartBudgetMs: operationalWorkerMinimumStartBudgetMs,
        now,
        taskTypes: maintenanceTaskTypes,
      },
      workerDependencies,
    ),
  ]);
  return {
    enqueued,
    worker: workerResults.reduce(
      (total, result) => ({
        claimed: total.claimed + result.claimed,
        failed: total.failed + result.failed,
        stale: total.stale + result.stale,
        succeeded: total.succeeded + result.succeeded,
      }),
      { claimed: 0, failed: 0, stale: 0, succeeded: 0 },
    ),
  };
}

function taskTypeOperation(taskType: (typeof operationalTaskTypes)[number]) {
  if (taskType === "checkout_return_lookup") return "payment_event_application" as const;
  if (taskType === "pending_payment_event") return "payment_event_application" as const;
  if (taskType === "pending_stripe_event") return "stripe_application" as const;
  if (taskType === "lemon_squeezy_refund") return "paid_after_closure_refund" as const;
  if (taskType === "paid_after_closure_refund") return "paid_after_closure_refund" as const;
  if (taskType === "retention_purge") return "account_closure" as const;
  if (taskType === "commerce_reconciliation") return "live_reconciliation" as const;
  return "account_closure" as const;
}

export async function runMonitoredOperationalCron(
  dependencies: {
    cron?: SentryCronSink;
    db?: DatabaseQueryClient;
    environment?: string;
    now?: Date;
    sentry?: SentryOperationalSink;
  } = {},
) {
  const startedAt = performance.now();
  const cron = dependencies.cron ?? sentryCronFromEnvironment();
  let result: Awaited<ReturnType<typeof runOperationalCron>>;
  try {
    result = await runOperationalCron(dependencies);
  } catch (error) {
    try {
      await cron?.send({
        durationMs: performance.now() - startedAt,
        environment: dependencies.environment ?? sentryEnvironment(),
        status: "error",
      });
    } catch {
      // The missing check-in is itself the signal; preserve the application failure.
    }
    throw error;
  }
  await cron?.send({
    durationMs: performance.now() - startedAt,
    environment: dependencies.environment ?? sentryEnvironment(),
    status: result.schedules.ok ? "ok" : "error",
  });
  return result;
}

export async function runWeatherCron(
  kind: "marine" | "weather",
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
  env: Record<string, string | undefined> = process.env,
) {
  if (readOpenMeteoApiMode(env) === "off") {
    return { kind, status: "disabled" as const };
  }
  return runTrackedOperationalSchedule(
    kind,
    async () => {
      const batch =
        kind === "marine"
          ? await buildOpenMeteoMarineIngestionBatch({ env })
          : await buildOpenMeteoIngestionBatch({ env });
      const write = async (transaction: DatabaseQueryClient) =>
        upsertProviderFactGraphBatch(transaction, batch);
      if (db.transaction) {
        await db.transaction(write);
      } else {
        await write(db);
      }
      return { evidence: batch.evidence.length, facts: batch.facts.length, kind };
    },
    { db },
  );
}

export async function runPlacesPruneCron(
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  return runTrackedOperationalSchedule(
    "places_prune",
    () => pruneGooglePlacesContent({ db, batchSize: 100, maxBatches: 10 }),
    { db },
  );
}

export function cronJson(result: unknown, status = 200) {
  return Response.json(result, { status, headers: { "cache-control": "no-store" } });
}

export function cronUnauthorized() {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function sentryFromEnvironment() {
  return process.env.SENTRY_DSN ? createSentryHttpSink({ dsn: process.env.SENTRY_DSN }) : undefined;
}

function sentryCronFromEnvironment() {
  return process.env.SENTRY_DSN
    ? createSentryCronHttpSink({
        dsn: process.env.SENTRY_DSN,
        monitorSlug: process.env.SENTRY_CRON_MONITOR_SLUG ?? "ask-siargao-account-closure",
      })
    : undefined;
}
