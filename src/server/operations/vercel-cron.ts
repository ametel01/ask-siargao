import { timingSafeEqual } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { pruneGooglePlacesContent } from "@/server/jobs/prune-google-places";
import { enqueueDueOperationalTasks } from "@/server/operations/operational-task-producer";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  createSentryHttpSink,
  deliverOperationalAlertOnce,
  deliverPendingPageWorthyAlerts,
  type SentryOperationalSink,
} from "@/server/operations/sentry-alerts";
import { runOperationalWorker } from "@/server/operations/worker-runner";
import { buildOpenMeteoIngestionBatch } from "@/server/providers/open-meteo";
import { buildOpenMeteoMarineIngestionBatch } from "@/server/providers/open-meteo-marine";
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
  dependencies: { db?: DatabaseQueryClient; sentry?: SentryOperationalSink } = {},
) {
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const sentry = dependencies.sentry ?? sentryFromEnvironment();
  if (!sentry) {
    throw new Error("sentry_configuration_unavailable");
  }
  const enqueued = await enqueueDueOperationalTasks(
    { limitPerType: 25, taskTypes: ["account_closure"] },
    db,
  );
  const worker = await runOperationalWorker(
    { batchSize: 25, leaseSeconds: 60, taskTypes: ["account_closure"] },
    {
      db,
      handlers: createProductionOperationalTaskHandlers({ db }),
      onRepeatedFailure: async ({ attempts, taskKey }) => {
        await deliverOperationalAlertOnce(
          {
            alertKey: `worker:${taskKey}:tier:${attempts >= 5 ? "high" : "warning"}`,
            errorCode: "operational_worker_repeated_failure",
            impact: attempts >= 5 ? "high" : "warning",
            operation: "account_closure",
          },
          { db, sink: sentry },
        );
      },
    },
  );
  const alerts = await deliverPendingPageWorthyAlerts({ db, sink: sentry });
  return { alerts: alerts.checked, enqueued, worker };
}

export async function runWeatherCron(
  kind: "marine" | "weather",
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  const batch =
    kind === "marine"
      ? await buildOpenMeteoMarineIngestionBatch({})
      : await buildOpenMeteoIngestionBatch({});
  const write = async (transaction: DatabaseQueryClient) =>
    upsertProviderFactGraphBatch(transaction, batch);
  if (db.transaction) {
    await db.transaction(write);
  } else {
    await write(db);
  }
  return { evidence: batch.evidence.length, facts: batch.facts.length, kind };
}

export async function runPlacesPruneCron(
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  return pruneGooglePlacesContent({ db, batchSize: 100, maxBatches: 10 });
}

export function cronJson(result: unknown) {
  return Response.json(result, { headers: { "cache-control": "no-store" } });
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
