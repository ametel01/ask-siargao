import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { beginAccountClosure, runClosureCleanupBatch } from "@/server/privacy/account-closure";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

const now = new Date("2026-07-03T08:00:00.000Z");
const env = { TRIP_PASS_CHECKOUT_MODE: "on", STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass" };

describe("Trip Pass Stripe webhook application", () => {
  test("activates a matched paid checkout session through one grant and meter allocation", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_paid", "user_paid");

      const result = await applyTripPassStripeEvent(
        checkoutSessionEvent("evt_paid", "order_paid"),
        {
          db,
          env,
          now,
        },
      );

      expect(result).toEqual({
        status: "applied",
        action: "activated",
        orderId: "order_paid",
        stripeEventId: "evt_paid",
      });
      await expectOrderStatus(db, "order_paid", "paid");
      await expectCounts(db, { passes: "1", grants: "1", meters: "5" });
      await expectPassStatus(db, "pi_order_paid", "active");
    });
  });

  test("treats replayed and concurrent paid deliveries as one effective activation", async () => {
    await resetTestDatabase();
    const firstDb = await openTestDatabase();
    await runInitialMigration(firstDb);
    const firstClient = createPgliteQueryClient(firstDb);
    await insertCheckoutCreatedOrder(firstClient, "order_race", "user_race");
    const secondDb = await openTestDatabase();
    const secondClient = createPgliteQueryClient(secondDb);

    try {
      const event = checkoutSessionEvent("evt_race", "order_race");
      const [first, second] = await Promise.all([
        applyTripPassStripeEvent(event, { db: firstClient, env, now }),
        applyTripPassStripeEvent(event, { db: secondClient, env, now }),
      ]);

      expect([first.status, second.status].toSorted()).toEqual(["applied", "duplicate"]);
      await expectCounts(firstClient, { passes: "1", grants: "1", meters: "5" });
      await expectOrderStatus(firstClient, "order_race", "paid");
    } finally {
      await firstDb.close();
      await secondDb.close();
    }
  });

  test("rejects forged or mismatched checkout sessions without granting access", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_forged", "user_forged");

      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_wrong_session", "order_forged", { sessionId: "cs_wrong" }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "trip_pass_checkout_session_mismatch",
        orderId: "order_forged",
      });
      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_wrong_product", "order_forged", {
            metadata: { productCode: "siargao_trip_risk_audit" },
          }),
          { db, env, now },
        ),
      ).resolves.toEqual({ status: "ignored", reason: "not_trip_pass_event" });
      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_wrong_amount", "order_forged", { amountTotal: 1 }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "trip_pass_payment_fact_mismatch",
      });

      await expectOrderStatus(db, "order_forged", "checkout_created");
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
    });
  });

  test("applies failed and expired checkout outcomes without activation", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_failed", "user_failed");
      await insertCheckoutCreatedOrder(db, "order_expired", "user_expired");

      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_failed", "order_failed", {
            type: "checkout.session.async_payment_failed",
            paymentStatus: "unpaid",
          }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({ status: "applied", action: "failed" });
      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_expired", "order_expired", {
            type: "checkout.session.expired",
            paymentStatus: "unpaid",
          }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({ status: "applied", action: "expired" });

      await expectOrderStatus(db, "order_failed", "failed");
      await expectOrderStatus(db, "order_expired", "expired");
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
    });
  });

  test("classifies authoritative payment after closure and creates one refund without access", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_closed", "user_closed");
      await beginAccountClosure(
        { userId: "user_closed", now },
        {
          db,
          policy: closurePolicy,
          createId: (prefix) => `${prefix}_webhook`,
        },
      );
      const closure = await db.query<{ closed_at: Date | string }>(
        "select closed_at from account_closure_tombstones where id = 'closure_tombstone_webhook'",
      );
      const closedSecond = Math.floor(new Date(closure.rows[0]?.closed_at ?? 0).getTime() / 1_000);
      const event = checkoutSessionEvent("evt_closed_paid", "order_closed", {
        created: closedSecond + 60,
      });

      await expect(applyTripPassStripeEvent(event, { db, env, now })).resolves.toMatchObject({
        status: "applied",
        action: "paid_after_closure",
      });
      await expect(applyTripPassStripeEvent(event, { db, env, now })).resolves.toMatchObject({
        status: "duplicate",
      });
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
      expect(
        (
          await db.query<{ count: string }>(
            "select count(*)::text as count from account_closure_refund_obligations where order_id = 'order_closed'",
          )
        ).rows[0]?.count,
      ).toBe("1");
    });
  });

  test("treats Stripe payment in the database-recorded closure second as Paid After Closure", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_closed_same_second", "user_closed_same_second");
      await beginAccountClosure(
        { userId: "user_closed_same_second", now },
        {
          db,
          policy: closurePolicy,
          createId: (prefix) => `${prefix}_same_second`,
        },
      );
      const closure = await db.query<{ closed_at: Date | string }>(
        "select closed_at from account_closure_tombstones where id = 'closure_tombstone_same_second'",
      );
      const signedSecond = Math.floor(new Date(closure.rows[0]?.closed_at ?? 0).getTime() / 1_000);

      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_closed_same_second", "order_closed_same_second", {
            created: signedSecond,
          }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({ status: "applied", action: "paid_after_closure" });
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
    });
  });

  test("classifies a provider event created during the precommit hold as Before Closure", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_precommit_paid", "user_precommit_paid");
      let providerEventSecond = 0;
      await beginAccountClosure(
        { userId: "user_precommit_paid", now },
        {
          db,
          policy: closurePolicy,
          createId: (prefix) => `${prefix}_precommit_paid`,
          beforeCommit: async () => {
            providerEventSecond = Math.floor(Date.now() / 1_000);
            while (Math.floor(Date.now() / 1_000) <= providerEventSecond) {
              await Bun.sleep(10);
            }
          },
        },
      );

      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_precommit_paid", "order_precommit_paid", {
            created: providerEventSecond,
          }),
          { db, env, now },
        ),
      ).resolves.toMatchObject({
        status: "noop",
        reason: "activation_blocked_by_account_closure",
      });
      expect(
        (
          await db.query<{ count: string }>(
            `select count(*)::text as count from account_closure_refund_obligations
             where order_id = 'order_precommit_paid'`,
          )
        ).rows[0]?.count,
      ).toBe("0");
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
    });
  });

  test("retains a minimized Session reconciliation row after expiry failure for delayed payment", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_delayed_closed_paid", "user_delayed_closed_paid");
      const closure = await beginAccountClosure(
        { userId: "user_delayed_closed_paid", now },
        {
          db,
          policy: closurePolicy,
          createId: (prefix) => `${prefix}_delayed_closed_paid`,
        },
      );
      await runClosureCleanupBatch({
        db,
        now,
        policy: closurePolicy,
        providers: {
          deleteClerkUser: async () => undefined,
          expireCheckoutSession: async () => {
            throw new Error("controlled expiry failure");
          },
        },
      });
      const timestamp = await db.query<{ closed_at: Date | string }>(
        "select closed_at from account_closure_tombstones where id = $1",
        [closure.tombstoneRef],
      );
      const closedSecond = Math.floor(
        new Date(timestamp.rows[0]?.closed_at ?? 0).getTime() / 1_000,
      );

      await expect(
        applyTripPassStripeEvent(
          checkoutSessionEvent("evt_delayed_closed_paid", "order_delayed_closed_paid", {
            created: closedSecond + 60,
          }),
          { db, env, now: new Date(now.getTime() + 60_000) },
        ),
      ).resolves.toMatchObject({ status: "applied", action: "paid_after_closure" });
      expect(
        (
          await db.query<{ count: string }>(
            `select count(*)::text as count from account_closure_refund_obligations
             where order_id = 'order_delayed_closed_paid'`,
          )
        ).rows[0]?.count,
      ).toBe("1");
      await expectCounts(db, { passes: "0", grants: "0", meters: "0" });
    });
  });

  test("refund and dispute events revoke only the matched Trip Pass payment intent", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_refund", "user_refund");
      await insertCheckoutCreatedOrder(db, "order_dispute", "user_dispute");
      await applyTripPassStripeEvent(checkoutSessionEvent("evt_refund_paid", "order_refund"), {
        db,
        env,
        now,
      });
      await applyTripPassStripeEvent(checkoutSessionEvent("evt_dispute_paid", "order_dispute"), {
        db,
        env,
        now,
      });

      await expect(
        applyTripPassStripeEvent(refundEvent("evt_refund", "pi_order_refund"), {
          db,
          env,
          now,
          stripeObjects: stripeObjectRetriever({ paymentIntentId: "pi_order_refund" }),
        }),
      ).resolves.toEqual({
        status: "applied",
        action: "refunded",
        orderId: "order_refund",
        stripeEventId: "evt_refund",
      });
      await expect(
        applyTripPassStripeEvent(disputeEvent("evt_dispute", "pi_order_dispute"), {
          db,
          env,
          now,
          stripeObjects: stripeObjectRetriever({ paymentIntentId: "pi_order_dispute" }),
        }),
      ).resolves.toEqual({
        status: "applied",
        action: "disputed",
        orderId: "order_dispute",
        stripeEventId: "evt_dispute",
      });
      await expect(
        applyTripPassStripeEvent(refundEvent("evt_refund_replay", "pi_order_refund"), {
          db,
          env,
          now,
          stripeObjects: stripeObjectRetriever({ paymentIntentId: "pi_order_refund" }),
        }),
      ).resolves.toMatchObject({ status: "duplicate", orderId: "order_refund" });

      await expectOrderStatus(db, "order_refund", "refunded");
      await expectPassStatus(db, "pi_order_refund", "refunded");
      await expectOrderStatus(db, "order_dispute", "disputed");
      await expectPassStatus(db, "pi_order_dispute", "cancelled");
    });
  });

  test("replays reversed refund and dispute events after the payment intent link exists", async () => {
    await withTestDb(async (db) => {
      await insertCheckoutCreatedOrder(db, "order_reversed_refund", "user_reversed_refund");
      await insertCheckoutCreatedOrder(db, "order_reversed_dispute", "user_reversed_dispute");
      const refundRetriever = stripeObjectRetriever({
        paymentIntentId: "pi_order_reversed_refund",
      });
      const disputeRetriever = stripeObjectRetriever({
        paymentIntentId: "pi_order_reversed_dispute",
      });

      await expect(
        applyTripPassStripeEvent(refundEvent("evt_reversed_refund", "pi_order_reversed_refund"), {
          db,
          env,
          now,
          stripeObjects: refundRetriever,
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "trip_pass_payment_intent_not_found",
      });
      await expect(
        applyTripPassStripeEvent(
          disputeEvent("evt_reversed_dispute", "pi_order_reversed_dispute"),
          {
            db,
            env,
            now,
            stripeObjects: disputeRetriever,
          },
        ),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "trip_pass_payment_intent_not_found",
      });

      await applyTripPassStripeEvent(
        checkoutSessionEvent("evt_reversed_refund_paid", "order_reversed_refund"),
        { db, env, now },
      );
      await applyTripPassStripeEvent(
        checkoutSessionEvent("evt_reversed_dispute_paid", "order_reversed_dispute"),
        { db, env, now },
      );

      await expect(
        applyTripPassStripeEvent(refundEvent("evt_reversed_refund", "pi_order_reversed_refund"), {
          db,
          env,
          now,
          stripeObjects: refundRetriever,
        }),
      ).resolves.toMatchObject({
        status: "applied",
        action: "refunded",
        orderId: "order_reversed_refund",
      });
      await expect(
        applyTripPassStripeEvent(
          disputeEvent("evt_reversed_dispute", "pi_order_reversed_dispute"),
          {
            db,
            env,
            now,
            stripeObjects: disputeRetriever,
          },
        ),
      ).resolves.toMatchObject({
        status: "applied",
        action: "disputed",
        orderId: "order_reversed_dispute",
      });

      expect(refundRetriever.calls).toEqual([
        "charge:re_evt_reversed_refund",
        "charge:re_evt_reversed_refund",
      ]);
      expect(disputeRetriever.calls).toEqual([
        "dispute:du_evt_reversed_dispute",
        "dispute:du_evt_reversed_dispute",
      ]);
      await expectOrderStatus(db, "order_reversed_refund", "refunded");
      await expectPassStatus(db, "pi_order_reversed_refund", "refunded");
      await expectOrderStatus(db, "order_reversed_dispute", "disputed");
      await expectPassStatus(db, "pi_order_reversed_dispute", "cancelled");
    });
  });

  test("ignores unrelated refund or event payloads instead of mutating audit payment state", async () => {
    await withTestDb(async (db) => {
      await expect(
        applyTripPassStripeEvent(refundEvent("evt_unrelated_refund", "pi_audit_payment"), {
          db,
          env,
          now,
          stripeObjects: stripeObjectRetriever({ paymentIntentId: "pi_audit_payment" }),
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "trip_pass_payment_intent_not_found",
      });
      await expect(
        applyTripPassStripeEvent(
          {
            id: "evt_customer_created",
            type: "customer.created",
            data: { object: { id: "cus_123", object: "customer" } },
          } as Stripe.Event,
          { db, env, now },
        ),
      ).resolves.toEqual({ status: "ignored", reason: "not_relevant_event" });
    });
  });

  test("completes authoritative provider lookup before any lifecycle database application", async () => {
    const lookup = deferred<Stripe.Charge>();
    const calls: string[] = [];
    const db: DatabaseQueryClient = {
      async query<T>() {
        calls.push("database");
        return { rows: [] as T[] };
      },
    };
    const application = applyTripPassStripeEvent(
      refundEvent("evt_ordered_lookup", "pi_ordered_lookup"),
      {
        db,
        stripeObjects: {
          retrieveCharge: async () => {
            calls.push("lookup:start");
            return lookup.promise;
          },
          retrieveDispute: async () => {
            throw new Error("unexpected dispute lookup");
          },
          retrieveRefund: async () => {
            throw new Error("unexpected refund lookup");
          },
        },
      },
    );
    await Bun.sleep(0);
    expect(calls).toEqual(["lookup:start"]);

    lookup.resolve({
      id: "re_evt_ordered_lookup",
      object: "charge",
      payment_intent: "pi_ordered_lookup",
      amount: 49_900,
      amount_refunded: 10_000,
      created: 1_783_068_000,
    } as Stripe.Charge);
    await expect(application).resolves.toMatchObject({
      status: "rejected",
      reason: "trip_pass_payment_intent_not_found",
    });
    expect(calls[0]).toBe("lookup:start");
    expect(calls.indexOf("database")).toBeGreaterThan(0);
  });

  test("provider lookup failure leaves lifecycle application completely unstarted", async () => {
    let databaseStarted = false;
    const db: DatabaseQueryClient = {
      async query<T>() {
        databaseStarted = true;
        return { rows: [] as T[] };
      },
    };
    await expect(
      applyTripPassStripeEvent(refundEvent("evt_lookup_failure", "pi_lookup_failure"), {
        db,
        stripeObjects: {
          retrieveCharge: async () => {
            throw new TypeError("authoritative lookup unavailable");
          },
          retrieveDispute: async () => {
            throw new Error("unexpected dispute lookup");
          },
          retrieveRefund: async () => {
            throw new Error("unexpected refund lookup");
          },
        },
      }),
    ).rejects.toThrow("authoritative lookup unavailable");
    expect(databaseStarted).toBe(false);
  });
});

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(createPgliteQueryClient(db));
  } finally {
    await db.close();
  }
}

function createPgliteQueryClient(db: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback({ ...client, inTransaction: true });
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };

  return client;
}

function stripeObjectRetriever(input: { paymentIntentId: string | null }) {
  const calls: string[] = [];
  return {
    calls,
    retrieveCharge: async (chargeId: string) => {
      calls.push(`charge:${chargeId}`);
      return {
        id: chargeId,
        object: "charge",
        payment_intent: input.paymentIntentId,
        amount: 49_900,
        amount_refunded: 49_900,
        created: 1_783_068_000,
      } as Stripe.Charge;
    },
    retrieveDispute: async (disputeId: string) => {
      calls.push(`dispute:${disputeId}`);
      return {
        id: disputeId,
        object: "dispute",
        payment_intent: input.paymentIntentId,
        charge: `ch_${disputeId}`,
        amount: 49_900,
        created: 1_783_068_000,
        status: "lost",
      } as Stripe.Dispute;
    },
    retrieveRefund: async (refundId: string) => {
      calls.push(`refund:${refundId}`);
      return {
        id: refundId,
        object: "refund",
        payment_intent: input.paymentIntentId,
        charge: `ch_${refundId}`,
        amount: 49_900,
        created: 1_783_068_000,
        status: "succeeded",
      } as Stripe.Refund;
    },
  };
}

async function insertCheckoutCreatedOrder(
  db: DatabaseQueryClient,
  orderId: string,
  userId: string,
) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
  await db.query(
    `
      insert into trip_pass_orders (
        id,
        user_id,
        email,
        status,
        product_code,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        metadata_json,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 'checkout_created', 'siargao_trip_pass_14d_v1', 1, 'price_trip_pass', 49900, 'php', $4, $5, '{}'::jsonb, $6, $6)
    `,
    [
      orderId,
      userId,
      `${userId}@example.com`,
      `trip_pass_checkout:${orderId}`,
      `cs_${orderId}`,
      now,
    ],
  );
}

function checkoutSessionEvent(
  eventId: string,
  orderId: string,
  options: {
    metadata?: Record<string, string>;
    paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
    sessionId?: string;
    type?: string;
    created?: number;
    amountTotal?: number;
    currency?: string;
  } = {},
) {
  const metadata = {
    tripPassOrderId: orderId,
    productCode: "siargao_trip_pass_14d_v1",
    productVersion: "1",
    ...(options.metadata ?? {}),
  };

  return {
    id: eventId,
    created: options.created,
    object: "event",
    type: options.type ?? "checkout.session.completed",
    data: {
      object: {
        id: options.sessionId ?? `cs_${orderId}`,
        object: "checkout.session",
        mode: "payment",
        client_reference_id: orderId,
        metadata,
        payment_intent: `pi_${orderId}`,
        payment_status: options.paymentStatus ?? "paid",
        amount_total: options.amountTotal ?? 49_900,
        currency: options.currency ?? "php",
      },
    },
  } as unknown as Stripe.Event;
}

const closurePolicy = {
  alertAfterAttempts: 2,
  closurePolicyVersion: "closure-test-v1",
  closureRetentionMs: 86_400_000,
  commercePolicyVersion: "commerce-test-v1",
  commerceRetentionMs: 86_400_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 9).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "closure-test-key",
  tombstoneHashVersion: 1,
};

function refundEvent(eventId: string, paymentIntentId: string) {
  return {
    id: eventId,
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: `re_${eventId}`,
        object: "refund",
        payment_intent: paymentIntentId,
      },
    },
  } as unknown as Stripe.Event;
}

function disputeEvent(eventId: string, paymentIntentId: string) {
  return {
    id: eventId,
    object: "event",
    type: "charge.dispute.created",
    data: {
      object: {
        id: `du_${eventId}`,
        object: "dispute",
        payment_intent: paymentIntentId,
      },
    },
  } as Stripe.Event;
}

async function expectCounts(
  db: DatabaseQueryClient,
  expected: { passes: string; grants: string; meters: string },
) {
  const passes = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_passes",
  );
  const grants = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_grants",
  );
  const meters = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_usage_meters",
  );

  expect(passes.rows[0]?.count).toBe(expected.passes);
  expect(grants.rows[0]?.count).toBe(expected.grants);
  expect(meters.rows[0]?.count).toBe(expected.meters);
}

async function expectOrderStatus(db: DatabaseQueryClient, orderId: string, status: string) {
  const result = await db.query<{ status: string }>(
    "select status from trip_pass_orders where id = $1",
    [orderId],
  );

  expect(result.rows[0]?.status).toBe(status);
}

async function expectPassStatus(db: DatabaseQueryClient, paymentIntentId: string, status: string) {
  const result = await db.query<{ status: string }>(
    "select status from trip_passes where stripe_payment_intent_id = $1",
    [paymentIntentId],
  );

  expect(result.rows[0]?.status).toBe(status);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
