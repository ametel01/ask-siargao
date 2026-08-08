import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  reconcileLiveCommerce,
  reconciliationAlertKey,
} from "@/server/operations/live-reconciliation";
import {
  enqueueDueOperationalTasks,
  stableOperationalTaskId,
} from "@/server/operations/operational-task-producer";
import {
  executeRepairAction,
  type LocalRepairExecutor,
  previewRepairAction,
} from "@/server/operations/repair-actions";
import { deliverOperationalAlertOnce } from "@/server/operations/sentry-alerts";
import { createTripPassLocalRepairExecutor } from "@/server/operations/trip-pass-repair-executor";
import { enqueueOperationalTask, runOperationalWorker } from "@/server/operations/worker-runner";

export async function runOperationsPostgresIntegration(db: DatabaseQueryClient) {
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

  await runRepairActionRegressions(db);
  await runOperationalProducerRegressions(db);

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
  const first = await enqueueDueOperationalTasks({ cycleKey }, db);
  const duplicate = await enqueueDueOperationalTasks({ cycleKey }, db);
  for (const count of Object.values(first)) {
    assert(count >= 1, "native producer did not enqueue every due obligation kind");
  }
  for (const count of Object.values(duplicate)) {
    assert(count === 0, "native duplicate producer invocation enqueued a second task");
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

async function runRepairActionRegressions(db: DatabaseQueryClient) {
  const highImpactFinding = await db.query<{ id: string }>(
    `select id from operational_findings
     where local_entity_ref = 'native_operations_order' and kind = 'paid_without_pass'`,
  );
  const highImpactFindingId = highImpactFinding.rows[0]?.id;
  assert(highImpactFindingId, "native high-impact reconciliation finding unavailable");
  let repairProviderOutsideTransaction = false;
  const authoritativeExecutor = createTripPassLocalRepairExecutor({
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
  const executor: LocalRepairExecutor = {
    async preview({ db: client }) {
      const state = await client.query<{ state: string }>(
        "select state from native_repair_probe where id = 'race'",
      );
      return { before: state.rows[0] ?? {}, after: { state: "after" } };
    },
    async apply({ db: client }) {
      await client.query("update native_repair_probe set state = 'after' where id = 'race'");
      return { state: "after" };
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
  const rollbackExecutor: LocalRepairExecutor = {
    async preview() {
      return { before: { state: "before" }, after: { state: "after" } };
    },
    async apply({ db: client }) {
      await client.query("update native_repair_probe set state = 'after' where id = 'rollback'");
      throw new Error("synthetic_repair_crash");
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
