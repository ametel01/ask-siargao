import { createHash } from "node:crypto";

import { type DatabaseQueryClient, queryDatabaseWithSignal } from "@/server/db/query-client";
import { type OperationalTaskType, operationalTaskTypes } from "@/server/operations/contracts";
import { riskReconciliationEligibilityMs } from "@/server/operations/operational-capacity";
import { enqueueOperationalTask } from "@/server/operations/worker-runner";

type DueTarget = { resource_ref: string };
type DueReconciliationOrder = { cadence: "risk" | "daily"; order_id: string };

export async function enqueueDueOperationalTasks(
  input: {
    cycleKey?: string;
    deadlineAt?: number;
    limitPerType?: number;
    minimumRemainingMs?: number;
    now?: () => number;
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
  const enqueued: Record<OperationalTaskType, number> = {
    account_closure: 0,
    checkout_return_lookup: 0,
    commerce_reconciliation: 0,
    pending_payment_event: 0,
    paid_after_closure_refund: 0,
    lemon_squeezy_refund: 0,
    pending_stripe_event: 0,
    retention_purge: 0,
  };
  const deadline = createProducerDeadline(input);
  const deadlineSignal = deadline?.signal;
  try {
    let cycleKey: string;
    try {
      cycleKey = input.cycleKey ?? (await readDatabaseCycleKey(db, deadlineSignal));
    } catch (error) {
      if (deadlineSignal?.aborted) return enqueued;
      throw error;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(cycleKey)) {
      throw new Error("invalid_operational_cycle_key");
    }

    for (const taskType of taskTypes) {
      if (deadlineSignal?.aborted) break;
      let targets: DueTarget[];
      try {
        targets = await loadDueTargets(taskType, cycleKey, limit, db, deadlineSignal);
      } catch (error) {
        if (deadlineSignal?.aborted) break;
        throw error;
      }
      const inserted = await Promise.allSettled(
        targets.map((target) =>
          enqueueOperationalTask(
            {
              id: stableOperationalTaskId(taskType, target.resource_ref),
              resourceRef: target.resource_ref,
              taskType,
            },
            db,
            { signal: deadlineSignal },
          ),
        ),
      );
      enqueued[taskType] += inserted.filter(
        (result) => result.status === "fulfilled" && result.value,
      ).length;
      const rejected = inserted.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected" && !deadlineSignal?.aborted) throw rejected.reason;
    }
    return enqueued;
  } finally {
    deadline?.clear();
  }
}

export async function enqueueAllDueReconciliationTasks(
  input: {
    cycleKey?: string;
    deadlineAt?: number;
    minimumRemainingMs?: number;
    now?: () => number;
    pageSize?: number;
  },
  db: DatabaseQueryClient,
) {
  const pageSize = input.pageSize ?? 100;
  const now = input.now ?? (() => performance.now());
  let enqueued = 0;
  while (true) {
    if (
      input.deadlineAt !== undefined &&
      now() + (input.minimumRemainingMs ?? 0) >= input.deadlineAt
    ) {
      return enqueued;
    }
    const page = await enqueueDueOperationalTasks(
      {
        cycleKey: input.cycleKey,
        deadlineAt: input.deadlineAt,
        limitPerType: pageSize,
        minimumRemainingMs: input.minimumRemainingMs,
        now,
        taskTypes: ["commerce_reconciliation"],
      },
      db,
    );
    enqueued += page.commerce_reconciliation;
    if (page.commerce_reconciliation === 0) return enqueued;
  }
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
  signal?: AbortSignal,
) {
  const query = <T>(statement: string, params: unknown[] = []) =>
    queryDatabaseWithSignal<T>(db, statement, params, signal);
  if (taskType === "account_closure") {
    return (
      await query<DueTarget>(
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
  if (taskType === "checkout_return_lookup") {
    return (
      await query<DueTarget>(
        `select orders.id as resource_ref from trip_pass_orders orders
         where orders.payment_provider = 'lemon_squeezy'
           and orders.accepted_payment_fact_id is null
           and orders.checkout_return_lookup_attempts > 0
           and orders.checkout_return_lookup_status = 'pending'
           and orders.checkout_return_provider_order_id is not null
           and orders.checkout_return_provider_order_identifier is not null
           and not exists (
             select 1 from operational_worker_tasks task
             where task.task_type = 'checkout_return_lookup'
               and task.resource_ref = orders.id
           )
         order by orders.updated_at, orders.id
         limit $1`,
        [limit],
      )
    ).rows;
  }
  if (taskType === "pending_stripe_event") {
    return (
      await query<DueTarget>(
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
      await query<DueTarget>(
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
      await query<DueTarget>(
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
      await query<DueTarget>(
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
      await query<DueTarget>(
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
    const rows = (
      await query<DueReconciliationOrder>(
        `select o.id as order_id,
           case when o.status in ('pending', 'checkout_created', 'paid', 'disputed')
             then 'risk' else 'daily' end as cadence
         from trip_pass_orders o
         left join operational_reconciliation_observations observation
           on observation.local_entity_type = 'trip_pass_order'
          and observation.local_entity_ref = o.id
         where o.updated_at <= statement_timestamp()
           and not exists (
             select 1 from operational_worker_tasks task
             where task.task_type = 'commerce_reconciliation'
               and (
                 (task.status in ('pending', 'running')
                   and substring(task.resource_ref from '^[^:]+:[^:]+:(.*)$') = o.id)
                 or task.resource_ref = (
                   case when o.status in ('pending', 'checkout_created', 'paid', 'disputed')
                     then 'risk' else 'daily' end
                   || ':' || $2 || ':' || o.id
                 )
               )
           )
           and (
             (o.status in ('pending', 'checkout_created', 'paid', 'disputed')
               and (observation.observed_at is null
                 or observation.observed_at <= clock_timestamp() - ($3 * interval '1 millisecond')))
             or
             (o.status not in ('pending', 'checkout_created', 'paid', 'disputed')
               and (observation.observed_at is null
                 or observation.observed_at <= clock_timestamp() - interval '24 hours'))
           )
         order by observation.observed_at nulls first, o.updated_at, o.created_at, o.id
         limit $1`,
        [limit, encodeURIComponent(cycleKey), riskReconciliationEligibilityMs],
      )
    ).rows;
    return rows.map((row) => ({
      resource_ref: `${row.cadence}:${encodeURIComponent(cycleKey)}:${row.order_id}`,
    }));
  }
  return [{ resource_ref: `all:${cycleKey}` }];
}

async function readDatabaseCycleKey(db: DatabaseQueryClient, signal?: AbortSignal) {
  const result = await queryDatabaseWithSignal<{ cycle_key: string }>(
    db,
    `select to_char(
       date_trunc('hour', clock_timestamp() at time zone 'UTC')
         + floor(extract(minute from clock_timestamp() at time zone 'UTC') / 5) * interval '5 minutes',
       'YYYYMMDDHH24MI'
     ) as cycle_key`,
    [],
    signal,
  );
  const cycleKey = result.rows[0]?.cycle_key;
  if (!cycleKey) throw new Error("operational_cycle_key_unavailable");
  return cycleKey;
}

function createProducerDeadline(input: {
  deadlineAt?: number;
  minimumRemainingMs?: number;
  now?: () => number;
}) {
  if (input.deadlineAt === undefined) return undefined;
  const now = input.now ?? (() => performance.now());
  const controller = new AbortController();
  const remainingMs = Math.max(0, input.deadlineAt - (input.minimumRemainingMs ?? 0) - now());
  const abort = () => controller.abort(new Error("operational_producer_deadline_reached"));
  const timer = remainingMs === 0 ? undefined : setTimeout(abort, remainingMs);
  if (remainingMs === 0) abort();
  return {
    clear: () => {
      if (timer) clearTimeout(timer);
    },
    signal: controller.signal,
  };
}
