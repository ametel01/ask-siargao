import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { RealPostgresHarness } from "@/server/integration/postgres-harness";
import type { StripeLifecycleObjectRetriever, StripeRefundClient } from "@/server/payments/stripe";
import {
  applyStripeInboxEvent,
  receiveStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/server/payments/stripe-event-inbox";
import { beginAccountClosure } from "@/server/privacy/account-closure";
import { runPaidAfterClosureRefundBatch } from "@/server/trip-pass/paid-after-closure-refund";
import {
  applyAuthoritativeDisputeFact,
  applyAuthoritativeRefundFact,
} from "@/server/trip-pass/payment-lifecycle";
import { tripPassCheckoutProductSnapshot } from "@/server/trip-pass/stripe-adapter";
import {
  applyTripPassStripeEvent,
  prepareTripPassStripeEvent,
} from "@/server/trip-pass/webhook-application";

const amountMinor = tripPassCheckoutProductSnapshot.amountTotalMinor;

type ActivatedPass = {
  meterId: string;
  orderId: string;
  passId: string;
  paymentIntentId: string;
  userId: string;
};

export async function runTripPassPaymentLifecyclePostgresRegression(harness: RealPostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await proveDatabaseTimeActivation(client);
    await proveDurableRefundResolutionOutsideTransaction(harness);
    await proveAuthoritativeRefundMatrix(client);
    await proveAuthoritativeDisputeMatrix(client);
    await proveNativeRollbackAndReplay(client);
    await proveControlledLifecycleLockOrder(harness);
    await proveControlledClosureSerialization(harness);
    await provePaidAfterClosureWorker(harness);
    console.log(
      JSON.stringify({
        checked: "trip-pass-payment-lifecycle-postgres",
        proofs: [
          "database-time-activation",
          "durable-provider-resolution-before-transaction",
          "refund-matrix",
          "dispute-matrix",
          "rollback-replay",
          "family-account-order-pass-lock-order",
          "closure-serialization",
          "paid-after-closure-worker",
        ],
      }),
    );
  } finally {
    await client.end();
  }
}

async function proveDatabaseTimeActivation(db: DatabaseQueryClient) {
  const before = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  const target = await activatePass(db, "database_time", new Date("2099-01-01T00:00:00.000Z"));
  const after = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  const pass = await db.query<{ starts_at: Date | string; expires_at: Date | string }>(
    "select starts_at, expires_at from trip_passes where id = $1",
    [target.passId],
  );
  const startsAt = dateValue(pass.rows[0]?.starts_at);
  const expiresAt = dateValue(pass.rows[0]?.expires_at);
  assert(
    startsAt.getTime() >= dateValue(before.rows[0]?.now).getTime() &&
      startsAt.getTime() <= dateValue(after.rows[0]?.now).getTime(),
    "Trip Pass activation did not use PostgreSQL transaction time",
  );
  assertEqual(
    expiresAt.getTime() - startsAt.getTime(),
    336 * 60 * 60_000,
    "Trip Pass term was not exactly 336 elapsed hours",
  );
}

async function proveDurableRefundResolutionOutsideTransaction(harness: RealPostgresHarness) {
  const application = harness.createQueryClient({ max: 1 });
  const observer = harness.createQueryClient({ max: 1 });
  const providerStarted = deferred<void>();
  const providerRelease = deferred<void>();
  try {
    const target = await activatePass(application, "durable_refund_resolution");
    await insertOpenReservation(application, target, "durable_refund_resolution");
    const backend = await application.query<{ pid: number }>("select pg_backend_pid() as pid");
    const event = refundWebhookEvent(
      "evt_durable_refund_pending",
      "refund.created",
      "re_durable_refund",
    );
    const retriever = refundStatusRetriever(target, "pending", 0, {
      async beforeRefund() {
        providerStarted.resolve();
        await providerRelease.promise;
      },
    });
    const pendingApplication = receiveStripeWebhookEvent(event, {
      db: application,
      prepareEvent: (received) => prepareTripPassStripeEvent(received, retriever),
      applyEvent: (prepared, options) =>
        applyTripPassStripeEvent(prepared.event, {
          db: options.db,
          now: options.now,
          preparedEvent: prepared,
        }),
    });
    await providerStarted.promise;

    const backendState = await observer.query<{ state: string }>(
      "select state from pg_stat_activity where pid = $1",
      [backend.rows[0]?.pid],
    );
    assertEqual(
      backendState.rows[0]?.state,
      "idle",
      "Stripe retrieval left the durable inbox connection inside a transaction",
    );
    await observer.query(
      "select id from trip_pass_stripe_events where stripe_event_id = $1 for update nowait",
      [event.id],
    );
    await observer.query(
      `update trip_pass_stripe_events
       set claim_token = 'replacement_during_lookup',
         claim_expires_at = clock_timestamp() + interval '1 minute'
       where stripe_event_id = $1`,
      [event.id],
    );
    providerRelease.resolve();
    const stale = await pendingApplication;
    assert(
      stale.status === "pending" && stale.reason === "stripe_inbox_claim_not_owned",
      "provider result crossed a replaced durable inbox claim",
    );
    const staleFacts = await observer.query<{ count: string }>(
      "select count(*)::text as count from trip_pass_refund_facts where order_id = $1",
      [target.orderId],
    );
    assertEqual(staleFacts.rows[0]?.count, "0", "stale provider resolution applied a refund fact");

    await observer.query(
      `update trip_pass_stripe_events set claim_expires_at = clock_timestamp() - interval '1 second'
       where stripe_event_id = $1`,
      [event.id],
    );
    await applyDurableRefundEvent(application, event, refundStatusRetriever(target, "pending", 0));
    await assertLifecycle(application, target, {
      disputeState: "none",
      orderStatus: "paid",
      passStatus: "active",
      refundState: "review",
      refundedMinor: 0,
      reservationStatus: "open",
    });

    await applyDurableRefundEvent(
      application,
      refundWebhookEvent("evt_durable_refund_failed", "refund.failed", "re_durable_refund"),
      refundStatusRetriever(target, "failed", 0),
    );
    await assertLifecycle(application, target, {
      disputeState: "none",
      orderStatus: "paid",
      passStatus: "active",
      refundState: "none",
      refundedMinor: 0,
      reservationStatus: "open",
    });

    await applyDurableRefundEvent(
      application,
      refundWebhookEvent(
        "evt_durable_refund_updated_pending",
        "refund.updated",
        "re_durable_refund",
      ),
      refundStatusRetriever(target, "pending", 0),
    );
    await applyDurableRefundEvent(
      application,
      refundWebhookEvent(
        "evt_durable_refund_updated_cancelled",
        "refund.updated",
        "re_durable_refund",
      ),
      refundStatusRetriever(target, "canceled", 0),
    );
    await assertLifecycle(application, target, {
      disputeState: "none",
      orderStatus: "paid",
      passStatus: "active",
      refundState: "none",
      refundedMinor: 0,
      reservationStatus: "open",
    });

    const inboxRows = await observer.query<{ count: string }>(
      `select count(*)::text as count from trip_pass_stripe_events
       where stripe_event_id = any($1::text[]) and status = 'applied'`,
      [
        [
          "evt_durable_refund_pending",
          "evt_durable_refund_failed",
          "evt_durable_refund_updated_pending",
          "evt_durable_refund_updated_cancelled",
        ],
      ],
    );
    assertEqual(
      inboxRows.rows[0]?.count,
      "4",
      "durable refund transition inboxes were not applied",
    );
  } finally {
    providerRelease.resolve();
    await Promise.allSettled([application.end(), observer.end()]);
  }
}

async function applyDurableRefundEvent(
  db: DatabaseQueryClient,
  event: Stripe.Event,
  retriever: StripeLifecycleObjectRetriever,
) {
  const receipt = await receiveStripeWebhookEvent(event, { db });
  assert(
    receipt.status === "received" || receipt.status === "duplicate",
    `durable refund receipt was unavailable: ${event.id}`,
  );
  const result = await applyStripeInboxEvent(`stripe_event_${event.id}`, {
    db,
    prepareEvent: (received) => prepareTripPassStripeEvent(received, retriever),
    applyEvent: (prepared, options) =>
      applyTripPassStripeEvent(prepared.event, {
        db: options.db,
        now: options.now,
        preparedEvent: prepared,
      }),
  });
  assert(result.status === "applied", `durable refund event did not apply: ${event.id}`);
}

async function proveAuthoritativeRefundMatrix(db: DatabaseQueryClient) {
  const target = await activatePass(db, "refund_matrix");
  await insertOpenReservation(db, target, "refund_matrix");

  await applyAuthoritativeRefundFact(refundFact(target, "pending", "pending", 100, 0), db);
  await assertLifecycle(db, target, {
    disputeState: "none",
    orderStatus: "paid",
    passStatus: "active",
    refundState: "review",
    refundedMinor: 0,
    reservationStatus: "open",
  });

  await applyAuthoritativeRefundFact(refundFact(target, "pending", "failed", 100, 0), db);
  await applyAuthoritativeRefundFact(refundFact(target, "canceled", "canceled", 100, 0), db);
  await assertLifecycle(db, target, {
    disputeState: "none",
    orderStatus: "paid",
    passStatus: "active",
    refundState: "none",
    refundedMinor: 0,
    reservationStatus: "open",
  });

  await applyAuthoritativeRefundFact(refundFact(target, "partial_one", "succeeded", 100, 100), db);
  await applyAuthoritativeRefundFact(refundFact(target, "partial_two", "succeeded", 200, 300), db);
  await assertLifecycle(db, target, {
    disputeState: "none",
    orderStatus: "paid",
    passStatus: "active",
    refundState: "review",
    refundedMinor: 300,
    reservationStatus: "open",
  });

  await applyAuthoritativeRefundFact(
    refundFact(target, "terminal", "succeeded", amountMinor - 300, amountMinor),
    db,
  );
  await assertLifecycle(db, target, {
    disputeState: "none",
    invalidationReason: "full_refund",
    orderStatus: "refunded",
    passStatus: "refunded",
    refundState: "full",
    refundedMinor: amountMinor,
    reservationStatus: "invalidated",
  });

  await applyAuthoritativeRefundFact(refundFact(target, "terminal", "failed", 100, 0), db);
  await assertLifecycle(db, target, {
    disputeState: "none",
    invalidationReason: "full_refund",
    orderStatus: "refunded",
    passStatus: "refunded",
    refundState: "full",
    refundedMinor: amountMinor,
    reservationStatus: "invalidated",
  });
}

async function proveAuthoritativeDisputeMatrix(db: DatabaseQueryClient) {
  const target = await activatePass(db, "dispute_matrix");
  await insertOpenReservation(db, target, "dispute_matrix");
  const original = await db.query<{ expires_at: Date | string }>(
    "select expires_at from trip_passes where id = $1",
    [target.passId],
  );

  await applyAuthoritativeDisputeFact(disputeFact(target, "one", "open"), db);
  await applyAuthoritativeDisputeFact(disputeFact(target, "two", "open"), db);
  await assertLifecycle(db, target, {
    disputeState: "open",
    orderStatus: "disputed",
    passStatus: "suspended",
    refundState: "none",
    refundedMinor: 0,
    reservationStatus: "open",
  });
  await applyAuthoritativeDisputeFact(disputeFact(target, "one", "won"), db);
  await assertPassStatus(db, target.passId, "suspended");
  await applyAuthoritativeDisputeFact(disputeFact(target, "two", "won"), db);
  await assertPassStatus(db, target.passId, "active");
  const restored = await db.query<{ expires_at: Date | string }>(
    "select expires_at from trip_passes where id = $1",
    [target.passId],
  );
  assertEqual(
    dateValue(restored.rows[0]?.expires_at).getTime(),
    dateValue(original.rows[0]?.expires_at).getTime(),
    "dispute win extended original expiry",
  );

  await applyAuthoritativeDisputeFact(disputeFact(target, "two", "lost"), db);
  await applyAuthoritativeDisputeFact(disputeFact(target, "two", "won"), db);
  await assertLifecycle(db, target, {
    disputeState: "lost",
    invalidationReason: "dispute_lost",
    orderStatus: "disputed",
    passStatus: "cancelled",
    refundState: "none",
    refundedMinor: 0,
    reservationStatus: "invalidated",
  });

  const expired = await activatePass(db, "dispute_expiry");
  await applyAuthoritativeDisputeFact(disputeFact(expired, "expiry", "open"), db);
  await db.query(
    `update trip_passes set starts_at = clock_timestamp() - interval '2 seconds',
       expires_at = clock_timestamp() - interval '1 second' where id = $1`,
    [expired.passId],
  );
  await applyAuthoritativeDisputeFact(disputeFact(expired, "expiry", "won"), db);
  await assertPassStatus(db, expired.passId, "expired");
}

async function proveNativeRollbackAndReplay(db: DatabaseQueryClient) {
  const target = await activatePass(db, "rollback");
  await insertOpenReservation(db, target, "rollback");
  await db.query(`
    create or replace function fail_issue152_terminal_projection() returns trigger
    language plpgsql as $$ begin
      if new.terminal_revocation_reason is not null then
        raise exception 'forced native lifecycle rollback';
      end if;
      return new;
    end $$;
    create trigger issue152_terminal_projection_failure
    before update on trip_pass_orders for each row
    execute function fail_issue152_terminal_projection()
  `);
  try {
    await expectRejects(
      applyAuthoritativeRefundFact(
        refundFact(target, "rollback", "succeeded", amountMinor, amountMinor),
        db,
      ),
      "forced native lifecycle rollback",
    );
  } finally {
    await db.query("drop trigger issue152_terminal_projection_failure on trip_pass_orders");
    await db.query("drop function fail_issue152_terminal_projection()");
  }
  await assertLifecycle(db, target, {
    disputeState: "none",
    orderStatus: "paid",
    passStatus: "active",
    refundState: "none",
    refundedMinor: 0,
    reservationStatus: "open",
  });
  const facts = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_refund_facts where order_id = $1",
    [target.orderId],
  );
  assertEqual(facts.rows[0]?.count, "0", "rolled-back lifecycle fact remained durable");

  await applyAuthoritativeRefundFact(
    refundFact(target, "rollback", "succeeded", amountMinor, amountMinor),
    db,
  );
  await assertLifecycle(db, target, {
    disputeState: "none",
    invalidationReason: "full_refund",
    orderStatus: "refunded",
    passStatus: "refunded",
    refundState: "full",
    refundedMinor: amountMinor,
    reservationStatus: "invalidated",
  });
}

async function proveControlledLifecycleLockOrder(harness: RealPostgresHarness) {
  const first = harness.createQueryClient({ max: 1 });
  const second = harness.createQueryClient({ max: 1 });
  const observer = harness.createQueryClient({ max: 1 });
  const reached = deferred<void>();
  const release = deferred<void>();
  try {
    const target = await activatePass(first, "controlled_terminal");
    await insertOpenReservation(first, target, "controlled_terminal");
    await applyAuthoritativeDisputeFact(disputeFact(target, "controlled", "open"), first);
    const gated = gateAfterAccountLock(first, reached, release);
    const refund = applyAuthoritativeRefundFact(
      refundFact(target, "controlled", "succeeded", amountMinor, amountMinor),
      gated.db,
    );
    await reached.promise;

    const granted = await observer.query<{ count: string }>(
      `select count(*)::text as count from pg_locks
       where pid = $1 and locktype = 'advisory' and granted`,
      [gated.pid()],
    );
    assert(
      Number(granted.rows[0]?.count ?? 0) >= 2,
      "lifecycle did not hold family and account locks before the Order lock",
    );
    await observer.query("select id from trip_pass_orders where id = $1 for update nowait", [
      target.orderId,
    ]);

    const secondPid = await second.query<{ pid: number }>("select pg_backend_pid() as pid");
    const win = applyAuthoritativeDisputeFact(disputeFact(target, "controlled", "won"), second);
    await waitForLockWait(observer, Number(secondPid.rows[0]?.pid));
    release.resolve();
    await Promise.all([refund, win]);
    await assertLifecycle(first, target, {
      disputeState: "won",
      invalidationReason: "full_refund",
      orderStatus: "refunded",
      passStatus: "refunded",
      refundState: "full",
      refundedMinor: amountMinor,
      reservationStatus: "invalidated",
    });
  } finally {
    release.resolve();
    await Promise.allSettled([first.end(), second.end(), observer.end()]);
  }
}

async function proveControlledClosureSerialization(harness: RealPostgresHarness) {
  const closureClient = harness.createQueryClient({ max: 1 });
  const lifecycleClient = harness.createQueryClient({ max: 1 });
  const observer = harness.createQueryClient({ max: 1 });
  const reached = deferred<void>();
  const release = deferred<void>();
  try {
    const target = await activatePass(closureClient, "closure_serialized");
    const gatedClosure = gateQuery(
      closureClient,
      /select clock_timestamp\(\) as now/i,
      reached,
      release,
    );
    const closing = beginAccountClosure(
      { userId: target.userId, now: new Date("2099-01-01T00:00:00.000Z") },
      {
        db: gatedClosure.db,
        policy: closurePolicy,
        createId: (prefix) => `${prefix}_issue152_native`,
      },
    );
    await reached.promise;
    const lifecyclePid = await lifecycleClient.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const lifecycle = applyAuthoritativeRefundFact(
      refundFact(target, "closure_pending", "pending", 100, 0),
      lifecycleClient,
    );
    await waitForLockWait(observer, Number(lifecyclePid.rows[0]?.pid));
    release.resolve();
    await closing;
    const outcome = await lifecycle.then(
      (value) => value.status,
      (error) =>
        error instanceof Error && error.message.includes("terminally closed") ? "closed" : "error",
    );
    assert(
      outcome === "rejected" || outcome === "closed",
      `post-closure lifecycle unexpectedly applied: ${outcome}`,
    );
    const facts = await observer.query<{ count: string }>(
      "select count(*)::text as count from trip_pass_refund_facts where order_id = $1",
      [target.orderId],
    );
    assertEqual(facts.rows[0]?.count, "0", "closure race committed a late lifecycle fact");
  } finally {
    release.resolve();
    await Promise.allSettled([closureClient.end(), lifecycleClient.end(), observer.end()]);
  }
}

async function provePaidAfterClosureWorker(harness: RealPostgresHarness) {
  const db = harness.createQueryClient({ max: 1 });
  const observer = harness.createQueryClient({ max: 1 });
  const providerStarted = deferred<void>();
  const providerRelease = deferred<void>();
  const slowStarted = deferred<void>();
  const slowRelease = deferred<void>();
  try {
    const recovered = await createPaidAfterClosureObligation(db, "worker_recovered");
    await observer.query(
      `update account_closure_refund_obligations
       set status = 'running', attempts = 2, lease_token = 'crashed_native_lease',
         lease_expires_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [recovered],
    );
    const recoveredBatch = await runPaidAfterClosureRefundBatch({
      db,
      stripe: {
        createFullRefund: async () => ({ id: "re_recovered_native", status: "succeeded" }),
        retrieveRefund: async (id) => ({ id, status: "succeeded" }),
      },
      limit: 1,
      createLeaseToken: () => "recovery_native_lease",
    });
    assertEqual(recoveredBatch.confirmed, 1, "expired running refund obligation was not reclaimed");
    const recoveredRow = await observer.query<{ attempts: number; status: string }>(
      "select attempts, status from account_closure_refund_obligations where id = $1",
      [recovered],
    );
    assertDeepEqual(
      recoveredRow.rows[0],
      { attempts: 3, status: "succeeded" },
      "crashed refund obligation recovery was not durable",
    );

    const first = await createPaidAfterClosureObligation(db, "worker_one");
    const second = await createPaidAfterClosureObligation(db, "worker_two");
    await observer.query(
      `update account_closure_refund_obligations
       set next_attempt_at = clock_timestamp() + interval '1 day' where id = $1`,
      [second],
    );
    const ambiguousCalls: string[] = [];
    const staleStripe: StripeRefundClient = {
      async createFullRefund(input) {
        ambiguousCalls.push(input.idempotencyKey);
        providerStarted.resolve();
        await providerRelease.promise;
        return { id: "re_stale_native", status: "succeeded" };
      },
      async retrieveRefund(id) {
        return { id, status: "succeeded" };
      },
    };
    const staleRun = runPaidAfterClosureRefundBatch({
      db,
      stripe: staleStripe,
      limit: 1,
      createLeaseToken: () => "stale_native_lease",
    });
    await providerStarted.promise;
    await observer.query(
      `update account_closure_refund_obligations set lease_token = 'replacement_native_lease',
       lease_expires_at = clock_timestamp() + interval '5 minutes' where id = $1`,
      [first],
    );
    providerRelease.resolve();
    const stale = await staleRun;
    assertEqual(stale.stale, 1, "stale refund worker crossed its replacement lease fence");
    await observer.query(
      `update account_closure_refund_obligations set status = 'pending', lease_token = null,
       lease_expires_at = null, next_attempt_at = clock_timestamp() where id = $1`,
      [first],
    );

    let providerStatus: "pending" | "succeeded" = "pending";
    const calls: string[] = [];
    const retryStripe: StripeRefundClient = {
      async createFullRefund(input) {
        calls.push(`create:${input.idempotencyKey}`);
        return { id: `re_${input.paymentIntentId}`, status: providerStatus };
      },
      async retrieveRefund(id) {
        calls.push(`retrieve:${id}`);
        return { id, status: providerStatus };
      },
    };
    const pending = await runPaidAfterClosureRefundBatch({
      db,
      stripe: retryStripe,
      limit: 1,
      alertAfterAttempts: 1,
      jitterUnit: 0.5,
      createLeaseToken: () => "pending_native_lease",
    });
    assertEqual(pending.retrying, 1, "pending Stripe refund was not kept retryable");
    await observer.query(
      "update account_closure_refund_obligations set next_attempt_at = clock_timestamp() where id = $1",
      [first],
    );
    providerStatus = "succeeded";
    const confirmed = await runPaidAfterClosureRefundBatch({
      db,
      stripe: retryStripe,
      limit: 1,
      createLeaseToken: () => "confirmed_native_lease",
    });
    assertEqual(confirmed.confirmed, 1, "retry did not wait for Stripe confirmation");

    await observer.query(
      "update account_closure_refund_obligations set next_attempt_at = clock_timestamp() where id = $1",
      [second],
    );
    const nextPage = await runPaidAfterClosureRefundBatch({
      db,
      stripe: retryStripe,
      limit: 1,
      createLeaseToken: () => "page_two_native_lease",
    });
    assertEqual(nextPage.claimed, 1, "bounded worker page did not claim the next obligation");
    assertEqual(nextPage.confirmed, 1, "second worker page was not confirmed");
    const rows = await observer.query<{
      alerted_at: Date | string | null;
      confirmed_at: Date | string | null;
      id: string;
      status: string;
    }>(
      `select id, status, alerted_at, confirmed_at from account_closure_refund_obligations
       where id in ($1, $2) order by id`,
      [first, second],
    );
    assert(
      rows.rows.every((row) => row.status === "succeeded" && row.confirmed_at),
      "Paid After Closure paging left an obligation unconfirmed",
    );
    assert(
      rows.rows.some((row) => row.id === first && row.alerted_at),
      "retry threshold did not persist durable page state",
    );
    assertEqual(
      new Set(ambiguousCalls).size,
      1,
      "ambiguous worker attempt did not use one stable idempotency key",
    );
    assert(
      calls.some((call) => call.startsWith("retrieve:")),
      "worker recreated instead of retrieving the durable pending refund",
    );

    const slow = await createPaidAfterClosureObligation(db, "worker_slow_page");
    const expiringBehind = await createPaidAfterClosureObligation(db, "worker_expiring_page");
    await observer.query(
      `update account_closure_refund_obligations
       set status = 'running', attempts = 1, lease_token = 'crashed_page_lease',
         lease_expires_at = clock_timestamp() + interval '1 day'
       where id = $1`,
      [expiringBehind],
    );
    let pageCalls = 0;
    const pageRun = runPaidAfterClosureRefundBatch({
      db,
      stripe: {
        async createFullRefund(input) {
          pageCalls += 1;
          if (pageCalls === 1) {
            slowStarted.resolve();
            await slowRelease.promise;
          }
          return { id: `re_${input.paymentIntentId}`, status: "succeeded" };
        },
        retrieveRefund: async (id) => ({ id, status: "succeeded" }),
      },
      limit: 2,
      createLeaseToken: () => `page_native_lease_${pageCalls + 1}`,
    });
    await slowStarted.promise;
    const behindBeforeExpiry = await observer.query<{ lease_token: string; status: string }>(
      "select lease_token, status from account_closure_refund_obligations where id = $1",
      [expiringBehind],
    );
    assertDeepEqual(
      behindBeforeExpiry.rows[0],
      { lease_token: "crashed_page_lease", status: "running" },
      "later page row was claimed before the earlier provider call completed",
    );
    await observer.query(
      `update account_closure_refund_obligations
       set lease_expires_at = clock_timestamp() - interval '1 second' where id = $1`,
      [expiringBehind],
    );
    slowRelease.resolve();
    const paged = await pageRun;
    assertDeepEqual(
      paged,
      { claimed: 2, confirmed: 2, retrying: 0, stale: 0 },
      "just-in-time paging did not recover a row that expired behind a slow provider call",
    );
    const pagedRows = await observer.query<{ count: string }>(
      `select count(*)::text as count from account_closure_refund_obligations
       where id = any($1::text[]) and status = 'succeeded'`,
      [[slow, expiringBehind]],
    );
    assertEqual(pagedRows.rows[0]?.count, "2", "worker page recovery left rows incomplete");
  } finally {
    providerRelease.resolve();
    slowRelease.resolve();
    await Promise.allSettled([db.end(), observer.end()]);
  }
}

async function activatePass(
  db: DatabaseQueryClient,
  suffix: string,
  suppliedNow = new Date("2026-08-08T00:00:00.000Z"),
): Promise<ActivatedPass> {
  const userId = `user_lifecycle_${suffix}`;
  const orderId = `order_lifecycle_${suffix}`;
  const paymentIntentId = `pi_${orderId}`;
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${suffix}@example.com`,
  ]);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, email, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, metadata_json
     ) values ($1, $2, $3, 'checkout_created', $4, $5, $6, 'price_trip_pass',
       $7, $8, $9, $10, '{}'::jsonb)`,
    [
      orderId,
      userId,
      `${suffix}@example.com`,
      tripPassCheckoutProductSnapshot.productCode,
      tripPassCheckoutProductSnapshot.productFamily,
      tripPassCheckoutProductSnapshot.productVersion,
      amountMinor,
      tripPassCheckoutProductSnapshot.currency,
      `trip_pass_checkout:${suffix}`,
      `cs_${orderId}`,
    ],
  );
  const activation = await applyTripPassStripeEvent(checkoutEvent(orderId), {
    db,
    now: suppliedNow,
  });
  assertEqual(activation.status, "applied", `activation failed for ${suffix}`);
  const target = await db.query<{ meter_id: string; pass_id: string }>(
    `select p.id as pass_id, m.id as meter_id from trip_passes p
     join trip_usage_meters m on m.trip_pass_id = p.id and m.meter_type = 'chat_message'
     where p.stripe_payment_intent_id = $1`,
    [paymentIntentId],
  );
  const row = target.rows[0];
  if (!row) throw new Error(`activation target missing for ${suffix}`);
  return { meterId: row.meter_id, orderId, passId: row.pass_id, paymentIntentId, userId };
}

async function insertOpenReservation(
  db: DatabaseQueryClient,
  target: ActivatedPass,
  suffix: string,
) {
  await db.query(
    `insert into paid_answer_reservations (
       id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, lease_expires_at,
       details_purge_at, reserved_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'open',
       clock_timestamp() + interval '5 minutes', clock_timestamp() + interval '1 day',
       clock_timestamp(), clock_timestamp())`,
    [
      `reservation_${suffix}`,
      target.passId,
      target.meterId,
      target.userId,
      `idempotency_hash_${suffix}`,
      `body_hash_${suffix}`,
      `request_${suffix}`,
      `lease_${suffix}`,
    ],
  );
}

async function createPaidAfterClosureObligation(db: DatabaseQueryClient, suffix: string) {
  const userId = `user_paid_after_closure_${suffix}`;
  const orderId = `order_paid_after_closure_${suffix}`;
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${suffix}@example.com`,
  ]);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, email, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, metadata_json
     ) values ($1, $2, $3, 'checkout_created', $4, $5, $6, 'price_trip_pass',
       $7, $8, $9, $10, '{}'::jsonb)`,
    [
      orderId,
      userId,
      `${suffix}@example.com`,
      tripPassCheckoutProductSnapshot.productCode,
      tripPassCheckoutProductSnapshot.productFamily,
      tripPassCheckoutProductSnapshot.productVersion,
      amountMinor,
      tripPassCheckoutProductSnapshot.currency,
      `trip_pass_checkout:${suffix}`,
      `cs_${orderId}`,
    ],
  );
  const closure = await beginAccountClosure(
    { userId, now: new Date("2099-01-01T00:00:00.000Z") },
    {
      db,
      policy: closurePolicy,
      createId: (prefix) => `${prefix}_${suffix}`,
    },
  );
  const closed = await db.query<{ closed_at: Date | string }>(
    "select closed_at from account_closure_tombstones where id = $1",
    [closure.tombstoneRef],
  );
  const event = checkoutEvent(orderId);
  event.created = Math.floor(dateValue(closed.rows[0]?.closed_at).getTime() / 1_000) + 1;
  const applied = await applyTripPassStripeEvent(event, { db, now: new Date() });
  assert(
    applied.status === "applied" && applied.action === "paid_after_closure",
    `Paid After Closure event did not create an obligation for ${suffix}`,
  );
  const obligation = await db.query<{ id: string }>(
    "select id from account_closure_refund_obligations where order_id = $1",
    [orderId],
  );
  if (!obligation.rows[0]) throw new Error(`refund obligation missing for ${suffix}`);
  return obligation.rows[0].id;
}

function gateAfterAccountLock(
  db: DatabaseQueryClient,
  reached: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
) {
  return gateQuery(db, /ask-siargao-account-write/i, reached, release);
}

function gateQuery(
  db: DatabaseQueryClient,
  pattern: RegExp,
  reached: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
) {
  let backendPid = 0;
  let gated = false;
  const wrap = (client: DatabaseQueryClient): DatabaseQueryClient => ({
    inTransaction: true,
    async query<T>(query: string, params: unknown[] = []) {
      const result = await client.query<T>(query, params);
      if (!gated && pattern.test(query)) {
        gated = true;
        reached.resolve();
        await release.promise;
      }
      return result;
    },
  });
  return {
    db: {
      query: db.query.bind(db),
      transaction: async <T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) =>
        db.transaction?.(async (transaction) => {
          const pid = await transaction.query<{ pid: number }>("select pg_backend_pid() as pid");
          backendPid = Number(pid.rows[0]?.pid);
          return callback(wrap(transaction));
        }) as Promise<T>,
    } satisfies DatabaseQueryClient,
    pid: () => backendPid,
  };
}

async function waitForLockWait(db: DatabaseQueryClient, pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await db.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    if (state.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} did not reach the controlled lock wait`);
}

async function assertLifecycle(
  db: DatabaseQueryClient,
  target: ActivatedPass,
  expected: {
    disputeState: string;
    invalidationReason?: string;
    orderStatus: string;
    passStatus: string;
    refundState: string;
    refundedMinor: number;
    reservationStatus: string;
  },
) {
  const result = await db.query<{
    dispute_state: string;
    invalidation_reason: string | null;
    meter_used: number;
    order_status: string;
    pass_status: string;
    refund_state: string;
    reservation_status: string;
    successful_refund_amount_minor: number;
  }>(
    `select o.status as order_status, p.status as pass_status, o.refund_state,
       o.dispute_state, o.successful_refund_amount_minor, m.used as meter_used,
       r.status as reservation_status, r.invalidation_reason
     from trip_pass_orders o join trip_passes p on p.id = $2
     join trip_usage_meters m on m.id = $3
     join paid_answer_reservations r on r.trip_pass_id = p.id
     where o.id = $1`,
    [target.orderId, target.passId, target.meterId],
  );
  const row = result.rows[0];
  assertEqual(row?.order_status, expected.orderStatus, "unexpected lifecycle Order status");
  assertEqual(row?.pass_status, expected.passStatus, "unexpected lifecycle Pass status");
  assertEqual(row?.refund_state, expected.refundState, "unexpected lifecycle refund state");
  assertEqual(row?.dispute_state, expected.disputeState, "unexpected lifecycle dispute state");
  assertEqual(
    row?.successful_refund_amount_minor,
    expected.refundedMinor,
    "unexpected cumulative successful refund",
  );
  assertEqual(row?.meter_used, 0, "lifecycle transition changed the Usage Meter");
  assertEqual(row?.reservation_status, expected.reservationStatus, "unexpected reservation status");
  assertEqual(
    row?.invalidation_reason ?? undefined,
    expected.invalidationReason,
    "unexpected reservation invalidation reason",
  );
}

async function assertPassStatus(db: DatabaseQueryClient, passId: string, expected: string) {
  const result = await db.query<{ status: string }>(
    "select status from trip_passes where id = $1",
    [passId],
  );
  assertEqual(result.rows[0]?.status, expected, "unexpected Pass status");
}

function refundFact(
  target: ActivatedPass,
  suffix: string,
  providerStatus: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
  refundAmountMinor: number,
  successfulAmountMinor: number,
) {
  return {
    amountMinor: refundAmountMinor,
    paymentIntentId: target.paymentIntentId,
    providerCreatedAt: new Date("2026-08-08T00:00:00.000Z"),
    providerStatus,
    stripeChargeId: `ch_${target.orderId}`,
    stripeEventId: `evt_refund_${target.orderId}_${suffix}_${providerStatus}`,
    stripeRefundId: `re_${target.orderId}_${suffix}`,
    successfulAmountMinor,
  } as const;
}

function disputeFact(target: ActivatedPass, suffix: string, status: "open" | "won" | "lost") {
  return {
    amountMinor,
    applicationStatus: status,
    paymentIntentId: target.paymentIntentId,
    providerCreatedAt: new Date("2026-08-08T00:00:00.000Z"),
    providerStatus: status === "open" ? "under_review" : status,
    stripeChargeId: `ch_${target.orderId}`,
    stripeDisputeId: `du_${target.orderId}_${suffix}`,
    stripeEventId: `evt_dispute_${target.orderId}_${suffix}_${status}`,
  } as const;
}

function refundStatusRetriever(
  target: ActivatedPass,
  status: "pending" | "failed" | "canceled",
  successfulAmountMinor: number,
  hooks: { beforeRefund?: () => Promise<void> } = {},
): StripeLifecycleObjectRetriever {
  return {
    async retrieveRefund(refundId) {
      await hooks.beforeRefund?.();
      return {
        id: refundId,
        object: "refund",
        amount: 100,
        charge: `ch_${target.orderId}`,
        created: 1_786_080_000,
        status,
      } as Stripe.Refund;
    },
    async retrieveCharge(chargeId) {
      return {
        id: chargeId,
        object: "charge",
        amount: amountMinor,
        amount_refunded: successfulAmountMinor,
        created: 1_786_080_000,
        payment_intent: target.paymentIntentId,
      } as Stripe.Charge;
    },
    async retrieveDispute() {
      throw new Error("unexpected dispute lookup for refund lifecycle proof");
    },
  };
}

function refundWebhookEvent(
  eventId: string,
  type: "refund.created" | "refund.updated" | "refund.failed",
  refundId: string,
) {
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_786_080_000,
    data: {
      object: {
        amount: 100,
        currency: tripPassCheckoutProductSnapshot.currency,
        id: refundId,
        object: "refund",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as Stripe.Event;
}

function checkoutEvent(orderId: string) {
  return {
    id: `evt_${orderId}`,
    object: "event",
    created: 1_786_080_000,
    data: {
      object: {
        amount_total: amountMinor,
        client_reference_id: orderId,
        currency: tripPassCheckoutProductSnapshot.currency,
        id: `cs_${orderId}`,
        metadata: {
          productCode: tripPassCheckoutProductSnapshot.productCode,
          productVersion: String(tripPassCheckoutProductSnapshot.productVersion),
          tripPassOrderId: orderId,
        },
        mode: "payment",
        object: "checkout.session",
        payment_intent: `pi_${orderId}`,
        payment_status: "paid",
      },
    },
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

async function expectRejects(promise: Promise<unknown>, expectedMessage: string) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}

function dateValue(value: Date | string | undefined) {
  if (!value) throw new Error("database timestamp was unavailable");
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("database timestamp was invalid");
  return date;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const closurePolicy = {
  alertAfterAttempts: 2,
  closurePolicyVersion: "closure-issue152-native-v1",
  closureRetentionMs: 86_400_000,
  commercePolicyVersion: "commerce-issue152-native-v1",
  commerceRetentionMs: 86_400_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 12).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "issue152-native-closure-key",
  tombstoneHashVersion: 1,
};
