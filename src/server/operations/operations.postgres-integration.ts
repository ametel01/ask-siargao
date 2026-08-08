import type { DatabaseQueryClient } from "@/server/db/query-client";
import { reconcileLiveCommerce } from "@/server/operations/live-reconciliation";
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
