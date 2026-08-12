import { createCipheriv } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  reconcileLiveCommerce,
  reconciliationAlertKey,
} from "@/server/operations/live-reconciliation";
import {
  enqueueDueOperationalTasks,
  stableOperationalTaskId,
} from "@/server/operations/operational-task-producer";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  executeRepairAction,
  previewRepairAction,
  type RepairActionDispatcher,
} from "@/server/operations/repair-actions";
import { workerFailureAlertKey } from "@/server/operations/run-operational-worker";
import { deliverOperationalAlertOnce } from "@/server/operations/sentry-alerts";
import { createTripPassRepairActionDispatcher } from "@/server/operations/trip-pass-repair-executor";
import {
  enqueueOperationalTask,
  opaqueTaskKey,
  runOperationalWorker,
} from "@/server/operations/worker-runner";

type NativeOperationsClient = DatabaseQueryClient & { end(): Promise<void> };

export async function runOperationsPostgresIntegration(
  db: DatabaseQueryClient,
  createQueryClient: () => NativeOperationsClient,
) {
  await db.query("insert into users (id, email) values ('native_operations_account', null)");
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_version, stripe_price_id,
       amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, stripe_payment_intent_id
     ) values (
       'native_operations_order', 'native_operations_account', 'pending',
       'siargao_trip_pass_14d_v2', 2, 'price_native_operations', 999, 'usd',
       'native_operations_checkout_key', 'cs_native_operations', 'pi_native_operations'
     )`,
  );
  let providerLookupOutsideTransaction = false;
  let paymentState: "paid" | "unpaid" = "paid";
  let incidentPages = 0;
  const incidentSink = {
    async send() {
      assert(db.inTransaction !== true, "Sentry provider call ran inside a PostgreSQL transaction");
      incidentPages += 1;
    },
  };
  const createId = nativeIds();
  const reconcile = () =>
    reconcileLiveCommerce(
      { orderId: "native_operations_order", source: "worker" },
      {
        commerceReader: {
          async readPaymentFact() {
            providerLookupOutsideTransaction = db.inTransaction !== true;
            return { amountMinor: 999, currency: "usd", paymentState };
          },
        },
        createId,
        db,
        alertFinding: async (finding) => {
          await deliverOperationalAlertOnce(
            {
              alertKey: reconciliationAlertKey(finding),
              errorCode: finding.summaryCode,
              findingId: finding.findingId,
              findingObservationSequence: finding.observationSequence,
              impact: finding.impact,
              operation: "paid_without_pass",
            },
            { createId, db, sink: incidentSink },
          );
        },
      },
    );
  const reconciliation = await reconcile();
  assert(providerLookupOutsideTransaction, "provider lookup ran inside a PostgreSQL transaction");
  assert(reconciliation.findings.length === 1, "native reconciliation did not record its finding");
  const repeated = await reconcile();
  assert(
    repeated.findings[0]?.findingId === reconciliation.findings[0]?.findingId &&
      repeated.findings[0]?.lifecycle === 1,
    "native repeat created a different incident lifecycle",
  );
  paymentState = "unpaid";
  assert(
    (await reconcile()).findings.length === 0,
    "native reconciliation did not resolve incident",
  );
  paymentState = "paid";
  const recurred = await reconcile();
  assert(
    recurred.findings[0]?.findingId === reconciliation.findings[0]?.findingId &&
      recurred.findings[0]?.lifecycle === 2,
    "native recurrence did not reopen the stable incident",
  );
  assert(incidentPages === 2, "native incident paging did not deliver once per lifecycle");
  const unchanged = await db.query<{ status: string }>(
    "select status from trip_pass_orders where id = 'native_operations_order'",
  );
  assert(unchanged.rows[0]?.status === "pending", "reconciliation mutated Order state");

  await runObservationOrderingRegressions(db);
  await runPageIntentOrderingRegressions(db);

  await runRepairActionRegressions(db);
  await runReconciliationRepairLockOrderingRegressions(db, createQueryClient);
  await runOperationalProducerRegressions(db);
  await runClosureTaskCompletionRegression(db);

  await enqueueOperationalTask(
    {
      id: "native_operations_task",
      resourceRef: "native_opaque_resource",
      taskType: "retention_purge",
    },
    db,
  );
  const entered = deferred<void>();
  const release = deferred<void>();
  const first = runOperationalWorker(
    { batchSize: 1, leaseSeconds: 60 },
    {
      createLeaseToken: () => "native_operations_lease_one",
      db,
      handlers: {
        retention_purge: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    },
  );
  await entered.promise;
  const second = await runOperationalWorker(
    { batchSize: 1, leaseSeconds: 60 },
    {
      createLeaseToken: () => "native_operations_lease_two",
      db,
      handlers: { retention_purge: async () => undefined },
    },
  );
  assert(second.claimed === 0, "SKIP LOCKED worker double-claimed a leased task");
  release.resolve();
  const firstResult = await first;
  assert(firstResult.succeeded === 1, "native worker did not commit its fenced success");

  await enqueueOperationalTask(
    {
      id: "native_operations_selected_closure",
      resourceRef: "native_closure_resource",
      taskType: "account_closure",
    },
    db,
  );
  await enqueueOperationalTask(
    {
      id: "native_operations_selected_retention",
      resourceRef: "native_retention_resource",
      taskType: "retention_purge",
    },
    db,
  );
  const selected = await runOperationalWorker(
    { batchSize: 2, leaseSeconds: 60, taskTypes: ["retention_purge"] },
    {
      createLeaseToken: () => "native_operations_selected_lease",
      db,
      handlers: { retention_purge: async () => undefined },
    },
  );
  assert(selected.claimed === 1, "native worker claimed a task outside its selected task kinds");
  const unselected = await db.query<{ status: string }>(
    "select status from operational_worker_tasks where id = 'native_operations_selected_closure'",
  );
  assert(unselected.rows[0]?.status === "pending", "native worker mutated an unselected task");

  await enqueueOperationalTask(
    {
      id: "native_operations_expired_retry",
      resourceRef: "native_expired_retry_resource",
      taskType: "retention_purge",
    },
    db,
  );
  const expiredRetry = await runOperationalWorker(
    { batchSize: 1, leaseSeconds: 60, taskTypes: ["retention_purge"] },
    {
      createLeaseToken: () => "native_operations_expired_retry_lease",
      db,
      handlers: {
        retention_purge: async () => {
          await db.query(
            `update operational_worker_tasks
             set lease_expires_at = clock_timestamp() - interval '1 second'
             where id = 'native_operations_expired_retry'`,
          );
          throw new Error("native_expired_retry_crash");
        },
      },
    },
  );
  assert(expiredRetry.stale === 1, "expired native worker rescheduled after losing its lease");
  const retryTakeover = await runOperationalWorker(
    { batchSize: 1, leaseSeconds: 60, taskTypes: ["retention_purge"] },
    {
      createLeaseToken: () => "native_operations_retry_takeover_lease",
      db,
      handlers: { retention_purge: async () => undefined },
    },
  );
  assert(retryTakeover.succeeded === 1, "native takeover did not converge expired retry");

  let sent = 0;
  const alert = {
    alertKey: "native_operations_once",
    errorCode: "paid_without_pass",
    findingId: reconciliation.findings[0]?.findingId,
    impact: "high" as const,
    operation: "paid_without_pass" as const,
  };
  const sink = {
    async send() {
      sent += 1;
    },
  };
  await Promise.all([
    deliverOperationalAlertOnce(alert, {
      createId: () => "native_alert_one",
      createToken: () => "native_alert_token_one",
      db,
      sink,
    }),
    deliverOperationalAlertOnce(alert, {
      createId: () => "native_alert_two",
      createToken: () => "native_alert_token_two",
      db,
      sink,
    }),
  ]);
  assert(sent === 1, "concurrent high-impact alert delivery paged more than once");

  await db.query(
    `insert into operational_alert_deliveries (
       id, alert_key, finding_id, impact, destination, status, delivery_token,
       lease_expires_at, attempted_at
     ) values (
       'native_alert_crashed', 'native_alert_crash_reclaim', $1, 'high', 'sentry',
       'sending', 'native_crashed_token', clock_timestamp() - interval '1 second',
       clock_timestamp() - interval '2 minutes'
     )`,
    [reconciliation.findings[0]?.findingId],
  );
  const reclaimed = await deliverOperationalAlertOnce(
    { ...alert, alertKey: "native_alert_crash_reclaim" },
    {
      createId: () => "native_alert_reclaimed",
      createToken: () => "native_alert_reclaimed_token",
      db,
      sink: {
        async send() {
          assert(db.inTransaction !== true, "native alert reclaim called provider under a lock");
        },
      },
    },
  );
  assert(reclaimed.status === "sent", "native alert crash lease was not reclaimed");
  const staleDelivery = await deliverOperationalAlertOnce(
    { ...alert, alertKey: "native_alert_stale_completion" },
    {
      createId: () => "native_alert_stale",
      createToken: () => "native_alert_stale_token",
      db,
      sink: {
        async send() {
          assert(db.inTransaction !== true, "native alert provider ran under a database lock");
          await db.query(
            `update operational_alert_deliveries
             set lease_expires_at = clock_timestamp() - interval '1 second'
             where alert_key = 'native_alert_stale_completion'`,
          );
        },
      },
    },
  );
  assert(staleDelivery.status === "stale_delivery", "native stale alert completion was accepted");

  const nativeEventIds: string[] = [];
  const retriedAlert = { ...alert, alertKey: "native_alert_stable_event_identity" };
  const failedTransport = await deliverOperationalAlertOnce(retriedAlert, {
    createId: () => "native_alert_event_identity_one",
    createToken: () => "native_alert_event_identity_token_one",
    db,
    sink: {
      async send({ eventId }) {
        nativeEventIds.push(eventId);
        throw new Error("native_transport_response_lost");
      },
    },
  });
  assert(failedTransport.status === "failed", "native alert transport failure was not retryable");
  await deliverOperationalAlertOnce(retriedAlert, {
    createId: () => "native_alert_event_identity_two",
    createToken: () => "native_alert_event_identity_token_two",
    db,
    sink: {
      async send({ eventId }) {
        nativeEventIds.push(eventId);
      },
    },
  });
  await deliverOperationalAlertOnce(
    { ...retriedAlert, alertKey: "native_alert_stable_event_identity_lifecycle_two" },
    {
      createId: () => "native_alert_event_identity_three",
      createToken: () => "native_alert_event_identity_token_three",
      db,
      sink: {
        async send({ eventId }) {
          nativeEventIds.push(eventId);
        },
      },
    },
  );
  assert(
    nativeEventIds[0] === nativeEventIds[1] && nativeEventIds[2] !== nativeEventIds[0],
    "native alert retries did not reuse one event identity per lifecycle",
  );
}

async function runOperationalProducerRegressions(db: DatabaseQueryClient) {
  await db.query(
    `insert into account_closure_tombstones (
       id, subject_hash, subject_hash_version, subject_type, closure_policy_version
     ) values (
       'native_producer_tombstone', 'native_producer_subject', 1, 'clerk_user_id',
       'closure-v1'
     )`,
  );
  await db.query(
    `insert into account_closure_operations (
       id, tombstone_id, operation_type, status, phase_one_committed_at
     ) values (
       'native_producer_closure', 'native_producer_tombstone', 'traveler_requested_closure',
       'pending', clock_timestamp()
     )`,
  );
  await db.query(
    `insert into account_closure_steps (id, operation_id, step_type)
     values ('native_producer_closure_step', 'native_producer_closure', 'clerk_deletion')`,
  );
  await db.query(
    `insert into trip_pass_stripe_events (
       id, stripe_event_id, stripe_api_version, normalized_schema_version, event_type,
       object_type, object_id
     ) values (
       'native_producer_stripe_event', 'evt_native_producer', '2026-06-30.basil', 1,
       'checkout.session.completed', 'checkout.session', 'cs_native_producer'
     )`,
  );
  await db.query(
    `insert into account_closure_refund_obligations (
       id, tombstone_id, order_id, reason, policy_version, stripe_payment_intent_id,
       expected_amount_minor
     ) values (
       'native_producer_refund', 'native_producer_tombstone', 'native_producer_refund_order',
       'paid_after_closure', 'refund-v1', 'pi_native_producer_refund', 999
     )`,
  );
  await db.query(
    `insert into trip_passes (
       id, user_id, status, starts_at, expires_at
     ) values (
       'native_producer_pass', 'native_operations_account', 'active',
       clock_timestamp() - interval '2 days', clock_timestamp() + interval '12 days'
     )`,
  );
  await db.query(
    `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
     values ('native_producer_meter', 'native_producer_pass', 'chat_message', 1, 150)`,
  );
  await db.query(
    `insert into paid_answer_reservations (
       id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, lease_expires_at,
       details_purge_at, reserved_at, finalized_at
     ) values (
       'native_producer_reservation', 'native_producer_pass', 'native_producer_meter',
       'native_operations_account', 'native_producer_idempotency', 'native_producer_body',
       'native_producer_request', 'native_producer_lease', 'settled',
       clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 hour',
       clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day'
     )`,
  );

  const cycleKey = "native-cycle-20260808T12";
  const concurrent = await Promise.all([
    enqueueDueOperationalTasks({ cycleKey }, db),
    enqueueDueOperationalTasks({ cycleKey }, db),
  ]);
  for (const taskType of Object.keys(concurrent[0]) as (keyof (typeof concurrent)[0])[]) {
    assert(
      concurrent[0][taskType] + concurrent[1][taskType] >= 1,
      `native concurrent producer did not create the due ${taskType} task`,
    );
  }
  const expected = [
    ["account_closure", "native_producer_closure"],
    ["pending_stripe_event", "native_producer_stripe_event"],
    ["paid_after_closure_refund", "native_producer_refund"],
    ["retention_purge", "native_producer_reservation"],
    ["commerce_reconciliation", `all:${cycleKey}`],
  ] as const;
  const queued = await db.query<{ id: string; resource_ref: string; task_type: string }>(
    `select id, resource_ref, task_type from operational_worker_tasks
     where resource_ref like 'native_producer_%' or resource_ref = $1
     order by task_type`,
    [`all:${cycleKey}`],
  );
  assert(queued.rows.length === 5, "native producer did not create exactly five tasks");
  for (const [taskType, resourceRef] of expected) {
    assert(
      queued.rows.some(
        (row) =>
          row.id === stableOperationalTaskId(taskType, resourceRef) &&
          row.resource_ref === resourceRef &&
          row.task_type === taskType,
      ),
      `native producer task mismatch for ${taskType}`,
    );
  }
  await db.query(
    `delete from operational_worker_tasks
     where resource_ref not like 'native_producer_%' and resource_ref <> $1`,
    [`all:${cycleKey}`],
  );

  const drained = await runOperationalWorker(
    { batchSize: 5, leaseSeconds: 60 },
    {
      db,
      handlers: {
        account_closure: async () => undefined,
        commerce_reconciliation: async () => undefined,
        paid_after_closure_refund: async () => undefined,
        pending_stripe_event: async () => undefined,
        retention_purge: async () => Promise.reject(new Error("native_producer_crash")),
      },
    },
  );
  assert(
    drained.succeeded === 4 && drained.failed === 1,
    "native producer worker did not drain four tasks and retain one retry",
  );
  await db.query(
    `update operational_worker_tasks set next_attempt_at = clock_timestamp()
     where resource_ref = 'native_producer_reservation'`,
  );
  const recovered = await runOperationalWorker(
    { batchSize: 1, leaseSeconds: 60, taskTypes: ["retention_purge"] },
    {
      db,
      handlers: { retention_purge: async () => undefined },
    },
  );
  assert(recovered.succeeded === 1, "native producer task did not recover after worker crash");

  const terminalBeforeReplay = await db.query<{
    attempts: number;
    completed_at: Date | string | null;
    id: string;
    resource_ref: string;
    status: string;
  }>(
    `select id, resource_ref, status, attempts, completed_at
     from operational_worker_tasks
     where resource_ref like 'native_producer_%' or resource_ref = $1
     order by task_type`,
    [`all:${cycleKey}`],
  );
  assert(
    terminalBeforeReplay.rows.length === 5 &&
      terminalBeforeReplay.rows.every((row) => row.status === "succeeded"),
    "native producer tasks did not reach terminal success",
  );
  const terminalReplay = await Promise.all(
    expected.flatMap(([taskType, resourceRef]) => {
      const input = {
        id: stableOperationalTaskId(taskType, resourceRef),
        resourceRef,
        taskType,
      };
      return [enqueueOperationalTask(input, db), enqueueOperationalTask(input, db)];
    }),
  );
  assert(
    terminalReplay.every((inserted) => !inserted),
    "native terminal producer replay reported reopened work",
  );
  const terminalAfterReplay = await db.query<{
    attempts: number;
    completed_at: Date | string | null;
    id: string;
    resource_ref: string;
    status: string;
  }>(
    `select id, resource_ref, status, attempts, completed_at
     from operational_worker_tasks
     where resource_ref like 'native_producer_%' or resource_ref = $1
     order by task_type`,
    [`all:${cycleKey}`],
  );
  assert(
    JSON.stringify(terminalAfterReplay.rows) === JSON.stringify(terminalBeforeReplay.rows),
    "native terminal producer replay changed success or attempt evidence",
  );

  const nextCycleKey = "native-cycle-20260808T13";
  const nextCycle = await Promise.all([
    enqueueDueOperationalTasks(
      { cycleKey: nextCycleKey, taskTypes: ["commerce_reconciliation"] },
      db,
    ),
    enqueueDueOperationalTasks(
      { cycleKey: nextCycleKey, taskTypes: ["commerce_reconciliation"] },
      db,
    ),
  ]);
  assert(
    nextCycle.reduce((sum, result) => sum + result.commerce_reconciliation, 0) === 1,
    "native producer did not create exactly one task for a new reconciliation cycle",
  );
  await db.query(
    `delete from operational_worker_tasks
     where task_type = 'commerce_reconciliation' and resource_ref = $1`,
    [`all:${nextCycleKey}`],
  );
}

async function runObservationOrderingRegressions(db: DatabaseQueryClient) {
  for (const orderId of ["native_observation_old_mismatch", "native_observation_old_healthy"]) {
    await db.query(
      `insert into trip_pass_orders (
         id, user_id, status, product_code, product_version, stripe_price_id,
         amount_total_minor, currency, checkout_idempotency_key,
         stripe_checkout_session_id, stripe_payment_intent_id
       ) values (
         $1, 'native_operations_account', 'pending', 'siargao_trip_pass_14d_v2', 2,
         'price_native_observation', 999, 'usd', $2, $3, $4
       )`,
      [orderId, `checkout_key_${orderId}`, `cs_${orderId}`, `pi_${orderId}`],
    );
  }

  const olderMismatchAllocated = deferred<void>();
  const releaseOlderMismatch = deferred<void>();
  let olderMismatchPages = 0;
  const olderMismatch = reconcileLiveCommerce(
    { orderId: "native_observation_old_mismatch", source: "worker" },
    {
      commerceReader: {
        async readPaymentFact() {
          return { amountMinor: 999, currency: "usd", paymentState: "paid" };
        },
      },
      db,
      recordEvent: async (event) => {
        if (
          event.operation === "allocate_reconciliation_observation" &&
          event.result === "succeeded"
        ) {
          olderMismatchAllocated.resolve();
          await releaseOlderMismatch.promise;
        }
      },
      alertFinding: async () => {
        olderMismatchPages += 1;
      },
    },
  );
  await olderMismatchAllocated.promise;
  const newerHealthy = await reconcileLiveCommerce(
    { orderId: "native_observation_old_mismatch", source: "worker" },
    {
      commerceReader: {
        async readPaymentFact() {
          return { amountMinor: 999, currency: "usd", paymentState: "unpaid" };
        },
      },
      db,
    },
  );
  releaseOlderMismatch.resolve();
  const staleMismatch = await olderMismatch;
  assert(newerHealthy.findings.length === 0, "newer healthy observation created a finding");
  assert(staleMismatch.findings.length === 0, "older mismatch applied after newer healthy state");
  assert(olderMismatchPages === 0, "older mismatch paged after newer healthy state");

  const olderHealthyAllocated = deferred<void>();
  const releaseOlderHealthy = deferred<void>();
  const olderHealthy = reconcileLiveCommerce(
    { orderId: "native_observation_old_healthy", source: "worker" },
    {
      commerceReader: {
        async readPaymentFact() {
          return { amountMinor: 999, currency: "usd", paymentState: "unpaid" };
        },
      },
      db,
      recordEvent: async (event) => {
        if (
          event.operation === "allocate_reconciliation_observation" &&
          event.result === "succeeded"
        ) {
          olderHealthyAllocated.resolve();
          await releaseOlderHealthy.promise;
        }
      },
    },
  );
  await olderHealthyAllocated.promise;
  let newerMismatchPages = 0;
  const newerMismatch = await reconcileLiveCommerce(
    { orderId: "native_observation_old_healthy", source: "worker" },
    {
      commerceReader: {
        async readPaymentFact() {
          return { amountMinor: 999, currency: "usd", paymentState: "paid" };
        },
      },
      db,
      alertFinding: async () => {
        newerMismatchPages += 1;
      },
    },
  );
  releaseOlderHealthy.resolve();
  await olderHealthy;
  assert(newerMismatch.findings.length === 1, "newer mismatch did not open an incident");
  assert(newerMismatchPages === 1, "newer mismatch did not page exactly once");
  const finalFinding = await db.query<{ status: string }>(
    `select status from operational_findings
     where local_entity_ref = 'native_observation_old_healthy'`,
  );
  assert(finalFinding.rows[0]?.status === "open", "older healthy state resolved newer mismatch");
}

async function runPageIntentOrderingRegressions(db: DatabaseQueryClient) {
  await seedNativeRaceOrder(db, "page_stale");
  const stale = await reconcileNativeRaceOrder(db, "page_stale", "paid");
  const staleFinding = stale.findings[0];
  assert(staleFinding, "native stale page fixture did not create a finding");
  await reconcileNativeRaceOrder(db, "page_stale", "unpaid");
  let staleSends = 0;
  const staleResult = await deliverOperationalAlertOnce(
    {
      alertKey: reconciliationAlertKey(staleFinding),
      errorCode: staleFinding.summaryCode,
      findingId: staleFinding.findingId,
      findingObservationSequence: staleFinding.observationSequence,
      impact: staleFinding.impact,
      operation: "paid_without_pass",
    },
    {
      db,
      sink: {
        async send() {
          staleSends += 1;
        },
      },
    },
  );
  assert(
    staleResult.status === "already_delivered_or_in_flight" && staleSends === 0,
    "native newer healthy observation did not suppress stale page intent",
  );

  await seedNativeRaceOrder(db, "page_first");
  const pageClaimed = deferred<void>();
  const releasePage = deferred<void>();
  let legitimateSends = 0;
  const mismatch = reconcileLiveCommerce(
    { orderId: "native_race_order_page_first", source: "worker" },
    {
      commerceReader: nativePaymentReader("paid"),
      db,
      alertFinding: async (finding) => {
        await deliverOperationalAlertOnce(
          {
            alertKey: reconciliationAlertKey(finding),
            errorCode: finding.summaryCode,
            findingId: finding.findingId,
            findingObservationSequence: finding.observationSequence,
            impact: finding.impact,
            operation: "paid_without_pass",
          },
          {
            db,
            sink: {
              async send() {
                legitimateSends += 1;
                pageClaimed.resolve();
                await releasePage.promise;
              },
            },
          },
        );
      },
    },
  );
  await pageClaimed.promise;
  await reconcileNativeRaceOrder(db, "page_first", "unpaid");
  releasePage.resolve();
  await mismatch;
  assert(legitimateSends === 1, "native committed page intent did not deliver exactly once");

  const escalationTaskKey = opaqueTaskKey("native_escalation_task");
  const escalationEvents: string[] = [];
  for (const attempts of [3, 4, 5, 6]) {
    await deliverOperationalAlertOnce(
      {
        alertKey: workerFailureAlertKey(escalationTaskKey, attempts),
        errorCode: "operational_worker_repeated_failure",
        impact: attempts >= 5 ? "high" : "warning",
        operation: "live_reconciliation",
      },
      {
        db,
        sink: {
          async send({ eventId }) {
            escalationEvents.push(eventId);
          },
        },
      },
    );
  }
  assert(
    escalationEvents.length === 2 && escalationEvents[0] !== escalationEvents[1],
    "native warning delivery suppressed or duplicated high escalation",
  );
}

async function runRepairActionRegressions(db: DatabaseQueryClient) {
  const highImpactFinding = await db.query<{ id: string }>(
    `select id from operational_findings
     where local_entity_ref = 'native_operations_order' and kind = 'paid_without_pass'`,
  );
  const highImpactFindingId = highImpactFinding.rows[0]?.id;
  assert(highImpactFindingId, "native high-impact reconciliation finding unavailable");
  let repairProviderOutsideTransaction = false;
  const authoritativeExecutor = createTripPassRepairActionDispatcher({
    commerceReader: {
      async readPaymentFact() {
        repairProviderOutsideTransaction = db.inTransaction !== true;
        return { amountMinor: 999, currency: "usd", paymentState: "refunded" };
      },
    },
  });
  const highImpactPreview = await previewRepairAction(
    { actionType: "grant_missing_trip_pass", findingId: highImpactFindingId },
    { db, executor: authoritativeExecutor },
  );
  let reversedRepair: unknown;
  try {
    await executeRepairAction(
      {
        actionType: "grant_missing_trip_pass",
        auth: { accountId: "native_operator", mfaFresh: true },
        confirmation: "APPLY REPAIR",
        findingId: highImpactFindingId,
        idempotencyKey: "native-authoritative-reversal",
        previewDigest: highImpactPreview.digest,
        reasonCode: "verified_provider_reversal",
      },
      { allowlist: new Set(["native_operator"]), db, executor: authoritativeExecutor },
    );
  } catch (error) {
    reversedRepair = error;
  }
  assert(repairProviderOutsideTransaction, "repair provider proof ran inside native transaction");
  assert(
    reversedRepair instanceof Error &&
      reversedRepair.message === "repair_authoritative_state_changed",
    "native reversed provider fact did not abort repair",
  );
  const highImpactUnchanged = await db.query<{ audits: string; grants: string }>(
    `select
       (select count(*)::text from operator_repair_actions where finding_id = $1) as audits,
       (select count(*)::text from trip_pass_grants
        where order_id = 'native_operations_order') as grants`,
    [highImpactFindingId],
  );
  assert(
    highImpactUnchanged.rows[0]?.audits === "0" && highImpactUnchanged.rows[0]?.grants === "0",
    "native reversed provider proof left repair audit or access mutation",
  );

  await db.query("create table native_repair_probe (id text primary key, state text not null)");
  await db.query("insert into native_repair_probe (id, state) values ('race', 'before')");
  await seedNativeFinding(db, "native_finding_race", "native_order_race");
  const executor: RepairActionDispatcher = {
    actionTypes: ["manual_commerce_transition"],
    async preview({ db: client }) {
      const state = await client.query<{ state: string }>(
        "select state from native_repair_probe where id = 'race'",
      );
      return { before: state.rows[0] ?? {}, after: { state: "after" } };
    },
    async prepareExecution() {
      return {
        async executeInTransaction({ db: client, lockFindingOrReplay, reserveRepairAction }) {
          const locked = await lockFindingOrReplay();
          if (locked.status === "replayed") return locked;
          const state = await client.query<{ state: string }>(
            "select state from native_repair_probe where id = 'race'",
          );
          const stateChange = { before: state.rows[0] ?? {}, after: { state: "after" } };
          const decision = await reserveRepairAction(locked.finding, stateChange);
          if (decision.status === "replayed") return decision;
          await client.query("update native_repair_probe set state = 'after' where id = 'race'");
          return { actionId: decision.actionId, after: { state: "after" }, status: "applied" };
        },
      };
    },
  };
  const preview = await previewRepairAction(
    { actionType: "manual_commerce_transition", findingId: "native_finding_race" },
    { db, executor },
  );
  const command = {
    actionType: "manual_commerce_transition" as const,
    auth: { accountId: "native_operator", mfaFresh: true },
    confirmation: "APPLY REPAIR",
    findingId: "native_finding_race",
    idempotencyKey: "native-repair-idempotency-race",
    previewDigest: preview.digest,
    reasonCode: "verified_native_race",
  };
  const denied = await executeRepairAction(
    { ...command, auth: { accountId: "native_operator", mfaFresh: false } },
    { allowlist: new Set(["native_operator"]), db, executor },
  );
  assert(denied.status === "denied", "stale MFA reached native repair transaction");
  const concurrent = await Promise.all([
    executeRepairAction(command, {
      allowlist: new Set(["native_operator"]),
      createId: () => "native_repair_action_one",
      db,
      executor,
    }),
    executeRepairAction(command, {
      allowlist: new Set(["native_operator"]),
      createId: () => "native_repair_action_two",
      db,
      executor,
    }),
  ]);
  assert(
    concurrent
      .map((result) => result.status)
      .toSorted()
      .join(",") === "applied,replayed",
    "concurrent exact repair replay did not converge on one application",
  );
  let mismatch: unknown;
  try {
    await executeRepairAction(
      { ...command, reasonCode: "different_native_command" },
      { allowlist: new Set(["native_operator"]), db, executor },
    );
  } catch (error) {
    mismatch = error;
  }
  assert(
    mismatch instanceof Error && mismatch.message === "repair_idempotency_mismatch",
    "native idempotency key reuse did not reject a different command identity",
  );
  const audit = await db.query<{ count: string }>(
    "select count(*)::text as count from operator_repair_actions where finding_id = 'native_finding_race'",
  );
  assert(audit.rows[0]?.count === "1", "native concurrent repair wrote multiple audit rows");

  await db.query("insert into native_repair_probe (id, state) values ('rollback', 'before')");
  await seedNativeFinding(db, "native_finding_rollback", "native_order_rollback");
  const rollbackExecutor: RepairActionDispatcher = {
    actionTypes: ["manual_commerce_transition"],
    async preview() {
      return { before: { state: "before" }, after: { state: "after" } };
    },
    async prepareExecution() {
      return {
        async executeInTransaction({ db: client, lockFindingOrReplay, reserveRepairAction }) {
          const locked = await lockFindingOrReplay();
          if (locked.status === "replayed") return locked;
          const stateChange = { before: { state: "before" }, after: { state: "after" } };
          const decision = await reserveRepairAction(locked.finding, stateChange);
          if (decision.status === "replayed") return decision;
          await client.query(
            "update native_repair_probe set state = 'after' where id = 'rollback'",
          );
          throw new Error("synthetic_repair_crash");
        },
      };
    },
  };
  const rollbackPreview = await previewRepairAction(
    { actionType: "manual_commerce_transition", findingId: "native_finding_rollback" },
    { db, executor: rollbackExecutor },
  );
  await executeRepairAction(
    {
      ...command,
      findingId: "native_finding_rollback",
      idempotencyKey: "native-repair-idempotency-rollback",
      previewDigest: rollbackPreview.digest,
    },
    {
      allowlist: new Set(["native_operator"]),
      createId: () => "native_repair_action_rollback",
      db,
      executor: rollbackExecutor,
    },
  ).catch(() => undefined);
  const rollback = await db.query<{
    audit_count: string;
    finding_status: string;
    probe_state: string;
  }>(
    `select
       (select count(*)::text from operator_repair_actions
        where finding_id = 'native_finding_rollback') as audit_count,
       (select status from operational_findings where id = 'native_finding_rollback') as finding_status,
       (select state from native_repair_probe where id = 'rollback') as probe_state`,
  );
  assert(rollback.rows[0]?.audit_count === "0", "crashed repair retained an audit reservation");
  assert(rollback.rows[0]?.finding_status === "open", "crashed repair resolved its finding");
  assert(rollback.rows[0]?.probe_state === "before", "crashed repair retained target mutation");
}

async function runReconciliationRepairLockOrderingRegressions(
  db: DatabaseQueryClient,
  createQueryClient: () => NativeOperationsClient,
) {
  for (const ordering of ["reconciliation_first", "repair_first"] as const) {
    await seedNativeRaceOrder(db, ordering);
    const initial = await reconcileNativeRaceOrder(db, ordering, "paid");
    const finding = initial.findings[0];
    assert(finding, `native ${ordering} fixture did not create a finding`);
    const executor = createTripPassRepairActionDispatcher({
      commerceReader: nativePaymentReader("paid"),
    });
    const preview = await previewRepairAction(
      { actionType: "grant_missing_trip_pass", findingId: finding.findingId },
      { db, executor },
    );
    const command = {
      actionType: "grant_missing_trip_pass" as const,
      auth: { accountId: "native_operator", mfaFresh: true },
      confirmation: "APPLY REPAIR",
      findingId: finding.findingId,
      idempotencyKey: `native-lock-order-${ordering}`,
      previewDigest: preview.digest,
      reasonCode: "verified_lock_order",
    };
    const holderAcquired = deferred<void>();
    const releaseHolder = deferred<void>();
    const contenderReached = deferred<void>();
    const holderClient = createQueryClient();
    const contenderClient = createQueryClient();
    const observerClient = createQueryClient();
    const holderDb = instrumentFamilyLock(holderClient, {
      after: async () => {
        holderAcquired.resolve();
        await releaseHolder.promise;
      },
    });
    const contenderDb = instrumentFamilyLock(contenderClient, {
      before: async () => contenderReached.resolve(),
    });

    try {
      const first =
        ordering === "reconciliation_first"
          ? reconcileLiveCommerce(
              { orderId: `native_race_order_${ordering}`, source: "worker" },
              { commerceReader: nativePaymentReader("paid"), db: holderDb },
            )
          : executeRepairAction(command, {
              allowlist: new Set(["native_operator"]),
              db: holderDb,
              executor,
            });
      await holderAcquired.promise;
      const second =
        ordering === "reconciliation_first"
          ? executeRepairAction(command, {
              allowlist: new Set(["native_operator"]),
              db: contenderDb,
              executor,
            })
          : reconcileLiveCommerce(
              { orderId: `native_race_order_${ordering}`, source: "worker" },
              { commerceReader: nativePaymentReader("paid"), db: contenderDb },
            );
      await contenderReached.promise;
      assert(
        await hasBlockedAdvisoryLock(observerClient),
        `native ${ordering} race did not observe the contender blocked on Family lock`,
      );
      releaseHolder.resolve();
      await Promise.all([first, second]);
    } finally {
      releaseHolder.resolve();
      await Promise.all([holderClient.end(), contenderClient.end(), observerClient.end()]);
    }
    const outcome = await db.query<{ finding_status: string; grants: string }>(
      `select
         (select status from operational_findings where id = $1) as finding_status,
         (select count(*)::text from trip_pass_grants where order_id = $2) as grants`,
      [finding.findingId, `native_race_order_${ordering}`],
    );
    assert(
      outcome.rows[0]?.finding_status === "resolved" && outcome.rows[0]?.grants === "1",
      `native ${ordering} reconciliation/repair race did not converge`,
    );
  }
}

async function seedNativeFinding(db: DatabaseQueryClient, findingId: string, localRef: string) {
  const runId = `run_${findingId}`;
  await db.query(
    `insert into operational_reconciliation_runs (
       id, source, status, checked_count, finding_count, started_at, completed_at
     ) values ($1, 'authenticated_adapter', 'succeeded', 1, 1,
       clock_timestamp(), clock_timestamp())`,
    [runId],
  );
  await db.query(
    `insert into operational_findings (
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code,
       incident_key, last_detected_at
     ) values ($1, $2, 'payment_state_mismatch', 'high', 'trip_pass_order', $3,
       'authoritative_payment_terms_mismatch', $4, clock_timestamp())`,
    [findingId, runId, localRef, `incident_${findingId}`],
  );
}

async function runClosureTaskCompletionRegression(db: DatabaseQueryClient) {
  const encrypted = encryptLocalClosureSubject("native_closure_multistep_user");
  await db.query(
    `insert into account_closure_tombstones (
       id, subject_hash, subject_hash_version, subject_type, closure_policy_version
     ) values ('native_closure_multistep_tombstone', 'native_closure_multistep_hash', 1,
       'clerk_user_id', 'local-closure-v1')`,
  );
  await db.query(
    `insert into account_closure_operations (
       id, tombstone_id, operation_type, status, phase_one_committed_at
     ) values ('native_closure_multistep_operation', 'native_closure_multistep_tombstone',
       'traveler_requested_closure', 'pending', clock_timestamp())`,
  );
  await db.query(
    `insert into account_closure_provider_subjects (
       operation_id, ciphertext, iv, auth_tag, key_version
     ) values ('native_closure_multistep_operation', $1, $2, $3, 1)`,
    [encrypted.ciphertext, encrypted.iv, encrypted.authTag],
  );
  await db.query(
    `insert into account_closure_steps (id, operation_id, step_type)
     values
       ('native_closure_multistep_clerk', 'native_closure_multistep_operation',
         'clerk_deletion'),
       ('native_closure_multistep_checkout', 'native_closure_multistep_operation',
         'checkout_expiry')`,
  );
  await enqueueOperationalTask(
    {
      id: "native_closure_multistep_task",
      resourceRef: "native_closure_multistep_operation",
      taskType: "account_closure",
    },
    db,
  );
  const handlers = createProductionOperationalTaskHandlers({
    closureProviders: {
      async deleteClerkUser() {},
      async expireCheckoutSession() {},
    },
    db,
  });
  const partial = await runOperationalWorker({ batchSize: 1, leaseSeconds: 60 }, { db, handlers });
  assert(
    partial.failed === 1 && partial.succeeded === 0,
    "native partial closure incorrectly completed its durable task",
  );
  await db.query(
    `update operational_worker_tasks set next_attempt_at = clock_timestamp()
     where id = 'native_closure_multistep_task'`,
  );
  const terminal = await runOperationalWorker({ batchSize: 1, leaseSeconds: 60 }, { db, handlers });
  const state = await db.query<{ attempts: number; operation_status: string; task_status: string }>(
    `select t.attempts, o.status as operation_status, t.status as task_status
     from account_closure_operations o
     join operational_worker_tasks t on t.resource_ref = o.id
     where o.id = 'native_closure_multistep_operation'`,
  );
  assert(
    terminal.succeeded === 1 &&
      state.rows[0]?.attempts === 2 &&
      state.rows[0].operation_status === "succeeded" &&
      state.rows[0].task_status === "succeeded",
    "native multi-step closure did not converge on one terminal task",
  );
}

async function seedNativeRaceOrder(db: DatabaseQueryClient, suffix: string) {
  const accountId = `native_race_account_${suffix}`;
  const orderId = `native_race_order_${suffix}`;
  await db.query("insert into users (id, email) values ($1, null)", [accountId]);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_version, stripe_price_id,
       amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, stripe_payment_intent_id
     ) values ($1, $2, 'paid', 'siargao_trip_pass_14d_v2', 2, 'price_native_race',
       999, 'usd', $3, $4, $5)`,
    [orderId, accountId, `checkout_${suffix}`, `cs_${suffix}`, `pi_${suffix}`],
  );
}

function nativePaymentReader(paymentState: "paid" | "unpaid") {
  return {
    async readPaymentFact() {
      return { amountMinor: 999, currency: "usd", paymentState } as const;
    },
  };
}

function reconcileNativeRaceOrder(
  db: DatabaseQueryClient,
  suffix: string,
  paymentState: "paid" | "unpaid",
) {
  return reconcileLiveCommerce(
    { orderId: `native_race_order_${suffix}`, source: "worker" },
    { commerceReader: nativePaymentReader(paymentState), db },
  );
}

function instrumentFamilyLock(
  db: DatabaseQueryClient,
  hooks: { after?: () => Promise<void>; before?: () => Promise<void> },
): DatabaseQueryClient {
  if (!db.transaction) throw new Error("database_transactions_required");
  let observed = false;
  return {
    ...db,
    async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
      return db.transaction?.(async (transaction) => {
        const instrumented: DatabaseQueryClient = {
          ...transaction,
          async query<Result>(query: string, params: unknown[] = []) {
            const familyLock =
              !observed && query.includes("pg_advisory_xact_lock(hashtext($1), hashtext($2))");
            if (familyLock) {
              observed = true;
              await hooks.before?.();
            }
            const result = await transaction.query<Result>(query, params);
            if (familyLock) await hooks.after?.();
            return result;
          },
        };
        return callback(instrumented);
      }) as Promise<T>;
    },
  };
}

async function hasBlockedAdvisoryLock(db: DatabaseQueryClient) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const blocked = await db.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where cardinality(pg_blocking_pids(pid)) > 0
           and query like '%pg_advisory_xact_lock%'
       ) as blocked`,
    );
    if (blocked.rows[0]?.blocked) return true;
  }
  return false;
}

function encryptLocalClosureSubject(value: string) {
  const iv = Buffer.alloc(12, 2);
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
  };
}

function nativeIds() {
  let index = 0;
  return (prefix: string) => `native_${prefix}_${++index}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
