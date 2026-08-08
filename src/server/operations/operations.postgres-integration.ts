import type { DatabaseQueryClient } from "@/server/db/query-client";
import { reconcileLiveCommerce } from "@/server/operations/live-reconciliation";
import {
  executeRepairAction,
  type LocalRepairExecutor,
  previewRepairAction,
} from "@/server/operations/repair-actions";
import { deliverOperationalAlertOnce } from "@/server/operations/sentry-alerts";
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
  const reconciliation = await reconcileLiveCommerce(
    { orderId: "native_operations_order", source: "worker" },
    {
      commerceReader: {
        async readPaymentFact() {
          providerLookupOutsideTransaction = db.inTransaction !== true;
          return { amountMinor: 999, currency: "usd", paymentState: "paid" };
        },
      },
      createId: nativeIds(),
      db,
    },
  );
  assert(providerLookupOutsideTransaction, "provider lookup ran inside a PostgreSQL transaction");
  assert(reconciliation.findings.length === 1, "native reconciliation did not record its finding");
  const unchanged = await db.query<{ status: string }>(
    "select status from trip_pass_orders where id = 'native_operations_order'",
  );
  assert(unchanged.rows[0]?.status === "pending", "reconciliation mutated Order state");

  await runRepairActionRegressions(db);

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
}

async function runRepairActionRegressions(db: DatabaseQueryClient) {
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
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code
     ) values ($1, $2, 'payment_state_mismatch', 'high', 'trip_pass_order', $3,
       'authoritative_payment_terms_mismatch')`,
    [findingId, runId, localRef],
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
