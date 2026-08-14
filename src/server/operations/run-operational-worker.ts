import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { type OperationalTaskType, operationalTaskTypes } from "@/server/operations/contracts";
import { reconciliationAlertKey } from "@/server/operations/live-reconciliation";
import { enqueueDueOperationalTasks } from "@/server/operations/operational-task-producer";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  createSentryHttpSink,
  deliverOperationalAlertOnce,
} from "@/server/operations/sentry-alerts";
import { runOperationalWorker } from "@/server/operations/worker-runner";

const operationalTaskTypeSet = new Set(operationalTaskTypes);

if (import.meta.main) await main();

async function main() {
  const db = getDefaultDatabaseQueryClient();
  const options = parseOperationalWorkerArguments(process.argv.slice(2));
  const sentry = process.env.SENTRY_DSN
    ? createSentryHttpSink({ dsn: process.env.SENTRY_DSN })
    : null;
  const enqueued = options.enqueue
    ? await enqueueDueOperationalTasks(
        {
          cycleKey: options.cycleKey,
          limitPerType: options.enqueueLimit,
          taskTypes: options.taskTypes,
        },
        db,
      )
    : undefined;
  const result = await runOperationalWorker(
    {
      batchSize: options.batchSize,
      leaseSeconds: options.leaseSeconds,
      taskTypes: options.taskTypes,
    },
    {
      db,
      handlers: createProductionOperationalTaskHandlers({
        alertFinding: sentry
          ? async (finding) => {
              await deliverOperationalAlertOnce(
                {
                  alertKey: reconciliationAlertKey(finding),
                  errorCode: finding.summaryCode,
                  findingId: finding.findingId,
                  findingObservationSequence: finding.observationSequence,
                  impact: finding.impact,
                  operation:
                    finding.kind === "paid_without_pass"
                      ? "paid_without_pass"
                      : "live_reconciliation",
                },
                { db, sink: sentry },
              );
            }
          : undefined,
        db,
      }),
      onRepeatedFailure: sentry
        ? async ({ attempts, taskKey, taskType }) => {
            await deliverOperationalAlertOnce(
              {
                alertKey: workerFailureAlertKey(taskKey, attempts),
                errorCode: "operational_worker_repeated_failure",
                impact: attempts >= 5 ? "high" : "warning",
                operation: operationForTask(taskType),
              },
              { db, sink: sentry },
            );
          }
        : undefined,
    },
  );

  console.info(JSON.stringify({ checked: "operational-worker", enqueued, ...result }));
}

export function workerFailureAlertKey(taskKey: string, attempts: number) {
  return `worker:${taskKey}:tier:${attempts >= 5 ? "high" : "warning"}`;
}

export function parseOperationalWorkerArguments(arguments_: string[]) {
  let batchSize = 100;
  let cycleKey: string | undefined;
  let enqueue = false;
  let enqueueLimit = 100;
  let leaseSeconds = 60;
  let taskTypes: OperationalTaskType[] | undefined;
  for (const argument of arguments_) {
    if (argument === "--enqueue") enqueue = true;
    else if (argument.startsWith("--batch=")) batchSize = positiveInteger(argument.slice(8));
    else if (argument.startsWith("--cycle-key=")) cycleKey = argument.slice(12);
    else if (argument.startsWith("--enqueue-limit=")) {
      enqueueLimit = positiveInteger(argument.slice(16));
    } else if (argument.startsWith("--lease-seconds=")) {
      leaseSeconds = positiveInteger(argument.slice(16));
    } else if (argument.startsWith("--task=")) {
      const task = argument.slice(7);
      if (task === "all") taskTypes = undefined;
      else if (operationalTaskTypeSet.has(task as OperationalTaskType)) {
        taskTypes = [task as OperationalTaskType];
      } else throw new Error("invalid_operational_task_type");
    } else throw new Error("invalid_operational_worker_argument");
  }
  if (cycleKey && !enqueue) throw new Error("operational_cycle_key_requires_enqueue");
  return { batchSize, cycleKey, enqueue, enqueueLimit, leaseSeconds, taskTypes };
}

function positiveInteger(raw: string) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error("invalid_positive_integer");
  return value;
}

function operationForTask(taskType: OperationalTaskType) {
  if (taskType === "account_closure") return "account_closure" as const;
  if (taskType === "pending_stripe_event") return "stripe_application" as const;
  if (taskType === "paid_after_closure_refund") return "paid_after_closure_refund" as const;
  return "live_reconciliation" as const;
}
