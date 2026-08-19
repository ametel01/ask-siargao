import { createHash, randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  createOperationTrace,
  type OperationalTaskHandlers,
  type OperationalTaskType,
  type OperationEventRecorder,
} from "@/server/operations/contracts";

type ClaimedTask = {
  id: string;
  task_type: OperationalTaskType;
  resource_ref: string;
  attempts: number;
  lease_token: string;
};

export async function enqueueOperationalTask(
  input: { id: string; resourceRef: string; taskType: OperationalTaskType },
  db: DatabaseQueryClient,
) {
  const inserted = await db.query<{ id: string }>(
    `insert into operational_worker_tasks (id, task_type, resource_ref)
     values ($1, $2, $3)
     on conflict (task_type, resource_ref) do nothing
     returning id`,
    [input.id, input.taskType, input.resourceRef],
  );
  return Boolean(inserted.rows[0]);
}

export async function runOperationalWorker(
  input: {
    batchSize: number;
    leaseSeconds: number;
    taskTypes?: readonly OperationalTaskType[];
  },
  dependencies: {
    createLeaseToken?: () => string;
    db: DatabaseQueryClient;
    handlers: OperationalTaskHandlers;
    onRepeatedFailure?: (input: {
      attempts: number;
      resourceRef: string;
      taskKey: string;
      taskType: OperationalTaskType;
    }) => Promise<void>;
    recordEvent?: OperationEventRecorder;
  },
) {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1)
    throw new Error("invalid_batch_size");
  if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
    throw new Error("invalid_lease_seconds");
  }
  const results = { claimed: 0, failed: 0, stale: 0, succeeded: 0 };
  for (let index = 0; index < input.batchSize; index += 1) {
    const task = await claimTask(
      dependencies.db,
      input.leaseSeconds,
      dependencies.createLeaseToken?.() ?? randomUUID(),
      input.taskTypes,
    );
    if (!task) break;
    results.claimed += 1;
    const trace = createOperationTrace(dependencies.recordEvent);
    const handler = dependencies.handlers[task.task_type];
    if (!handler) {
      const fenced = await retryTask(task, "handler_unavailable", dependencies.db);
      if (fenced) results.failed += 1;
      else results.stale += 1;
      continue;
    }
    try {
      await trace.record({ index: 0, operation: task.task_type, result: "started" });
      await handler({ resourceRef: task.resource_ref, trace });
      const fenced = await succeedTask(task, dependencies.db);
      if (fenced) {
        results.succeeded += 1;
        await trace.record({ index: 0, operation: task.task_type, result: "succeeded" });
      } else {
        results.stale += 1;
      }
    } catch {
      const fenced = await retryTask(task, "task_failed", dependencies.db);
      if (fenced) {
        results.failed += 1;
        await trace.record({ index: 0, operation: task.task_type, result: "failed" });
        if (task.attempts >= 3) {
          await dependencies.onRepeatedFailure?.({
            attempts: task.attempts,
            resourceRef: task.resource_ref,
            taskKey: opaqueTaskKey(task.id),
            taskType: task.task_type,
          });
        }
      } else {
        results.stale += 1;
      }
    }
  }
  return results;
}

export async function drainOperationalWorker(
  input: {
    batchSize: number;
    leaseSeconds: number;
    taskTypes?: readonly OperationalTaskType[];
  },
  dependencies: Parameters<typeof runOperationalWorker>[1],
) {
  const totals = { claimed: 0, failed: 0, stale: 0, succeeded: 0 };
  while (true) {
    const batch = await runOperationalWorker(input, dependencies);
    totals.claimed += batch.claimed;
    totals.failed += batch.failed;
    totals.stale += batch.stale;
    totals.succeeded += batch.succeeded;
    if (batch.claimed < input.batchSize) return totals;
  }
}

async function claimTask(
  db: DatabaseQueryClient,
  leaseSeconds: number,
  leaseToken: string,
  taskTypes?: readonly OperationalTaskType[],
) {
  if (!db.transaction) throw new Error("database_transactions_required");
  return db.transaction(async (transaction) => {
    const result = await transaction.query<ClaimedTask>(
      `with due as (
         select id from operational_worker_tasks
         where ((
           status = 'pending' and next_attempt_at <= clock_timestamp()
         ) or (
           status = 'running' and lease_expires_at <= clock_timestamp()
         ))
         and ($3::text[] is null or task_type = any($3::text[]))
         order by next_attempt_at, id
         for update skip locked
         limit 1
       )
       update operational_worker_tasks task
       set status = 'running', attempts = task.attempts + 1, lease_token = $1,
         lease_expires_at = clock_timestamp() + ($2::text || ' seconds')::interval,
         updated_at = clock_timestamp()
       from due where task.id = due.id
       returning task.id, task.task_type, task.resource_ref, task.attempts, task.lease_token`,
      [leaseToken, leaseSeconds, taskTypes ? [...taskTypes] : null],
    );
    return result.rows[0] ?? null;
  });
}

async function succeedTask(task: ClaimedTask, db: DatabaseQueryClient) {
  const result = await db.query<{ id: string }>(
    `update operational_worker_tasks set status = 'succeeded', lease_token = null,
       lease_expires_at = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [task.id, task.lease_token],
  );
  return Boolean(result.rows[0]);
}

async function retryTask(task: ClaimedTask, errorCode: string, db: DatabaseQueryClient) {
  const result = await db.query<{ id: string }>(
    `update operational_worker_tasks set status = 'pending', lease_token = null,
       lease_expires_at = null, last_error_code = $3,
       next_attempt_at = clock_timestamp() +
         (least(300, (power(2, least(attempts, 8))::integer))::text || ' seconds')::interval,
       updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [task.id, task.lease_token, errorCode],
  );
  return Boolean(result.rows[0]);
}

export function opaqueTaskKey(taskId: string) {
  return `worker_task_${createHash("sha256").update(taskId).digest("hex").slice(0, 32)}`;
}
