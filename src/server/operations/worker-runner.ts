import { createHash, randomUUID } from "node:crypto";

import { type DatabaseQueryClient, queryDatabaseWithSignal } from "@/server/db/query-client";
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
  options: { signal?: AbortSignal } = {},
) {
  const inserted = await queryDatabaseWithSignal<{ id: string }>(
    db,
    `insert into operational_worker_tasks (id, task_type, resource_ref)
     values ($1, $2, $3)
     on conflict (task_type, resource_ref) do nothing
     returning id`,
    [input.id, input.taskType, input.resourceRef],
    options.signal,
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
  validateWorkerInput(input);
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
    await processClaimedTask(task, results, dependencies);
  }
  return results;
}

export async function runOperationalWorkerConcurrently(
  input: {
    batchSize: number;
    completionAbortReserveMs?: number;
    deadlineAt?: number;
    leaseSeconds: number;
    minimumStartBudgetMs?: number;
    now?: () => number;
    taskTypes?: readonly OperationalTaskType[];
  },
  dependencies: Parameters<typeof runOperationalWorker>[1],
) {
  validateWorkerInput(input);
  const now = input.now ?? (() => performance.now());
  if (
    input.deadlineAt !== undefined &&
    now() + (input.minimumStartBudgetMs ?? 0) >= input.deadlineAt
  ) {
    return { claimed: 0, failed: 0, stale: 0, succeeded: 0 };
  }
  const controller = new AbortController();
  const deadline = createWorkerDeadline(
    controller,
    input.deadlineAt,
    input.completionAbortReserveMs ?? 1_000,
    now,
  );
  try {
    const leaseToken = dependencies.createLeaseToken?.() ?? randomUUID();
    const claimDeadline = createClaimDeadline(
      input.deadlineAt,
      input.minimumStartBudgetMs ?? 0,
      now,
    );
    let tasks: ClaimedTask[];
    try {
      tasks = await claimTaskBatch(
        dependencies.db,
        input.leaseSeconds,
        leaseToken,
        input.batchSize,
        input.taskTypes,
        claimDeadline?.signal,
      );
    } catch (error) {
      if (claimDeadline?.signal.aborted) {
        return { claimed: 0, failed: 0, stale: 0, succeeded: 0 };
      }
      throw error;
    } finally {
      claimDeadline?.clear();
    }
    if (
      input.deadlineAt !== undefined &&
      now() + (input.minimumStartBudgetMs ?? 0) >= input.deadlineAt
    ) {
      await releaseUnstartedTasks(tasks, leaseToken, dependencies.db);
      return { claimed: 0, failed: 0, stale: 0, succeeded: 0 };
    }

    const results = { claimed: tasks.length, failed: 0, stale: 0, succeeded: 0 };
    const processing = Promise.all(
      tasks.map((task) =>
        processClaimedTask(task, results, dependencies, {
          deadlineAt: input.deadlineAt,
          signal: controller.signal,
        }),
      ),
    );
    if (deadline) await Promise.race([processing, deadline.reached]);
    else await processing;
    return { ...results };
  } finally {
    deadline?.clear();
  }
}

function createClaimDeadline(
  deadlineAt: number | undefined,
  minimumStartBudgetMs: number,
  now: () => number,
) {
  if (deadlineAt === undefined) return undefined;
  const controller = new AbortController();
  const remainingMs = Math.max(0, deadlineAt - minimumStartBudgetMs - now());
  const abort = () => controller.abort(new Error("operational_worker_claim_deadline_reached"));
  const timer = remainingMs === 0 ? undefined : setTimeout(abort, remainingMs);
  if (remainingMs === 0) abort();
  return {
    clear: () => {
      if (timer) clearTimeout(timer);
    },
    signal: controller.signal,
  };
}

function createWorkerDeadline(
  controller: AbortController,
  deadlineAt: number | undefined,
  completionAbortReserveMs: number,
  now: () => number,
) {
  if (deadlineAt === undefined) return undefined;
  const remainingMs = Math.max(0, deadlineAt - now());
  const abortDelayMs = Math.max(0, remainingMs - completionAbortReserveMs);
  const abort = () => controller.abort(new Error("operational_worker_deadline_reached"));
  const abortTimer = setTimeout(abort, abortDelayMs);
  let hardDeadlineTimer: ReturnType<typeof setTimeout>;
  const reached = new Promise<void>((resolve) => {
    hardDeadlineTimer = setTimeout(() => {
      abort();
      resolve();
    }, remainingMs);
  });
  return {
    clear() {
      clearTimeout(abortTimer);
      clearTimeout(hardDeadlineTimer);
    },
    reached,
  };
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
    const result = await queryDatabaseWithSignal<ClaimedTask>(
      transaction,
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

async function claimTaskBatch(
  db: DatabaseQueryClient,
  leaseSeconds: number,
  leaseToken: string,
  batchSize: number,
  taskTypes?: readonly OperationalTaskType[],
  signal?: AbortSignal,
) {
  if (!db.transaction) throw new Error("database_transactions_required");
  return db.transaction(async (transaction) => {
    const result = await queryDatabaseWithSignal<ClaimedTask>(
      transaction,
      `with due as (
         select id from operational_worker_tasks
         where ((
           status = 'pending' and next_attempt_at <= clock_timestamp()
         ) or (
           status = 'running' and lease_expires_at <= clock_timestamp()
         ))
         and ($3::text[] is null or task_type = any($3::text[]))
         order by case when $3::text[] is null then 1
           else array_position($3::text[], task_type) end,
           next_attempt_at, id
         for update skip locked
         limit $4
       )
       update operational_worker_tasks task
       set status = 'running', attempts = task.attempts + 1, lease_token = $1,
         lease_expires_at = clock_timestamp() + ($2::text || ' seconds')::interval,
         updated_at = clock_timestamp()
       from due where task.id = due.id
      returning task.id, task.task_type, task.resource_ref, task.attempts, task.lease_token`,
      [leaseToken, leaseSeconds, taskTypes ? [...taskTypes] : null, batchSize],
      signal,
    );
    return result.rows;
  });
}

async function releaseUnstartedTasks(
  tasks: readonly ClaimedTask[],
  leaseToken: string,
  db: DatabaseQueryClient,
) {
  if (tasks.length === 0) return;
  await db.query(
    `update operational_worker_tasks set status = 'pending', attempts = greatest(attempts - 1, 0),
       lease_token = null, lease_expires_at = null, next_attempt_at = clock_timestamp(),
       updated_at = clock_timestamp()
     where id = any($1::text[]) and status = 'running' and lease_token = $2`,
    [tasks.map((task) => task.id), leaseToken],
  );
}

async function processClaimedTask(
  task: ClaimedTask,
  results: { claimed: number; failed: number; stale: number; succeeded: number },
  dependencies: Parameters<typeof runOperationalWorker>[1],
  execution: { deadlineAt?: number; signal?: AbortSignal } = {},
) {
  const trace = createOperationTrace(dependencies.recordEvent);
  const handler = dependencies.handlers[task.task_type];
  if (!handler) {
    const fenced = await retryTask(task, "handler_unavailable", dependencies.db);
    if (fenced) results.failed += 1;
    else results.stale += 1;
    return;
  }
  try {
    await trace.record({ index: 0, operation: task.task_type, result: "started" });
    await handler({
      deadlineAt: execution.deadlineAt,
      resourceRef: task.resource_ref,
      signal: execution.signal,
      trace,
    });
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

function validateWorkerInput(input: {
  batchSize: number;
  completionAbortReserveMs?: number;
  leaseSeconds: number;
}) {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error("invalid_batch_size");
  }
  if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
    throw new Error("invalid_lease_seconds");
  }
  if (
    input.completionAbortReserveMs !== undefined &&
    (!Number.isInteger(input.completionAbortReserveMs) || input.completionAbortReserveMs < 0)
  ) {
    throw new Error("invalid_completion_abort_reserve");
  }
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
