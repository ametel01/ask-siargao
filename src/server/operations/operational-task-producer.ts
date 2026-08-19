import { createHash } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { type OperationalTaskType, operationalTaskTypes } from "@/server/operations/contracts";
import { enqueueOperationalTask } from "@/server/operations/worker-runner";

type DueTarget = { resource_ref: string };

export async function enqueueDueOperationalTasks(
  input: {
    cycleKey?: string;
    limitPerType?: number;
    taskTypes?: readonly OperationalTaskType[];
  },
  db: DatabaseQueryClient,
) {
  const limit = input.limitPerType ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("invalid_operational_enqueue_limit");
  }
  const taskTypes = input.taskTypes ?? operationalTaskTypes;
  const supportedTaskTypes = new Set(operationalTaskTypes);
  const unsupported = taskTypes.find((taskType) => !supportedTaskTypes.has(taskType));
  if (unsupported) throw new Error("invalid_operational_task_type");
  const cycleKey = input.cycleKey ?? (await readDatabaseCycleKey(db));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(cycleKey)) {
    throw new Error("invalid_operational_cycle_key");
  }

  const enqueued: Record<OperationalTaskType, number> = {
    account_closure: 0,
    commerce_reconciliation: 0,
    pending_payment_event: 0,
    paid_after_closure_refund: 0,
    lemon_squeezy_refund: 0,
    pending_stripe_event: 0,
    retention_purge: 0,
  };
  for (const taskType of taskTypes) {
    const targets = await loadDueTargets(taskType, cycleKey, limit, db);
    const inserted = await Promise.all(
      targets.map((target) =>
        enqueueOperationalTask(
          {
            id: stableOperationalTaskId(taskType, target.resource_ref),
            resourceRef: target.resource_ref,
            taskType,
          },
          db,
        ),
      ),
    );
    enqueued[taskType] += inserted.filter(Boolean).length;
  }
  return enqueued;
}

export function stableOperationalTaskId(taskType: OperationalTaskType, resourceRef: string) {
  return `operational_task_${createHash("sha256")
    .update(`${taskType}\u001f${resourceRef}`)
    .digest("hex")
    .slice(0, 32)}`;
}

async function loadDueTargets(
  taskType: OperationalTaskType,
  cycleKey: string,
  limit: number,
  db: DatabaseQueryClient,
) {
  if (taskType === "account_closure") {
    return (
      await db.query<DueTarget>(
        `select distinct operation_id as resource_ref
         from account_closure_steps
         where (
           status = 'pending' and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
         ) or (
           status = 'running' and lease_expires_at <= clock_timestamp()
         )
         order by resource_ref
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "pending_stripe_event") {
    return (
      await db.query<DueTarget>(
        `select id as resource_ref from trip_pass_stripe_events
         where status = 'pending'
           and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
           and (claim_expires_at is null or claim_expires_at <= clock_timestamp())
         order by received_at, id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "pending_payment_event") {
    return (
      await db.query<DueTarget>(
        `select id as resource_ref from trip_pass_payment_event_receipts
         where provider = 'lemon_squeezy' and status = 'pending'
           and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
         order by created_at, id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "paid_after_closure_refund") {
    return (
      await db.query<DueTarget>(
        `select id as resource_ref from account_closure_refund_obligations
         where stripe_payment_intent_id is not null and expected_amount_minor is not null
           and (
             (status = 'pending'
               and (next_attempt_at is null or next_attempt_at <= clock_timestamp()))
             or (status = 'running' and lease_expires_at <= clock_timestamp())
           )
         order by id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "lemon_squeezy_refund") {
    return (
      await db.query<DueTarget>(
        `select id as resource_ref from trip_pass_refund_operations
         where (
           status = 'pending'
           and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
           and (lease_expires_at is null or lease_expires_at <= clock_timestamp())
         ) or (
           status = 'running' and lease_expires_at <= clock_timestamp()
         )
         order by coalesce(next_attempt_at, created_at), id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "retention_purge") {
    return (
      await db.query<DueTarget>(
        `select id as resource_ref from paid_answer_reservations
         where details_purged_at is null and details_purge_at <= clock_timestamp()
           and status <> 'open'
           and (purge_retry_at is null or purge_retry_at <= clock_timestamp())
         order by coalesce(purge_retry_at, details_purge_at), id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "commerce_reconciliation") {
    const dayKey = /^\d{8}/.test(cycleKey) ? cycleKey.slice(0, 8) : `day-${cycleKey}`;
    return [
      { resource_ref: `all:risk:${cycleKey}` },
      { resource_ref: `all:daily:${dayKey}` },
    ].slice(0, limit);
  }
  return [{ resource_ref: `all:${cycleKey}` }];
}

async function readDatabaseCycleKey(db: DatabaseQueryClient) {
  const result = await db.query<{ cycle_key: string }>(
    `select to_char(
       date_trunc('hour', clock_timestamp() at time zone 'UTC')
         + floor(extract(minute from clock_timestamp() at time zone 'UTC') / 5) * interval '5 minutes',
       'YYYYMMDDHH24MI'
     ) as cycle_key`,
  );
  const cycleKey = result.rows[0]?.cycle_key;
  if (!cycleKey) throw new Error("operational_cycle_key_unavailable");
  return cycleKey;
}
