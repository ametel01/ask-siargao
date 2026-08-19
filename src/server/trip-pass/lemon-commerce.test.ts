import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { receiveLemonSqueezyPaymentEvent } from "@/server/payments/payment-event-receipts";
import {
  type LemonTripPassCheckoutOptions,
  startLemonSqueezyTripPassCheckout,
} from "@/server/trip-pass/lemon-commerce";
import { applyLemonSqueezyPaymentFact } from "@/server/trip-pass/lemon-squeezy-webhook-application";

const now = new Date("2026-08-19T00:00:00.000Z");
const env = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  LEMON_SQUEEZY_API_KEY: "test_api_key",
  LEMON_SQUEEZY_STORE_ID: "store_test",
  LEMON_SQUEEZY_PRODUCT_ID: "product_test",
  LEMON_SQUEEZY_VARIANT_ID: "variant_test",
} as const;

describe("Lemon Squeezy Trip Pass commerce", () => {
  test("persists a pending Order and Checkout Attempt before exposing the URL", async () => {
    const queries: string[] = [];
    await withTestDb(
      async (db) => {
        await db.query("insert into users (id, email) values ($1, $2)", [
          "account_lemon_1",
          "traveler@example.com",
        ]);
        const calls: string[] = [];
        const client = fakeClient({
          createCheckout: async ({ order }) => {
            const pending = await db.query<{ count: string }>(
              "select count(*)::text as count from trip_pass_orders where id = $1 and status = 'pending'",
              [order.id],
            );
            calls.push(`pending:${pending.rows[0]?.count}`);
            return {
              id: "checkout_test_1",
              url: "https://checkout.lemonsqueezy.test/1",
              orderId: order.id,
              storeId: order.storeId,
              variantId: order.variantId,
              productId: order.productId ?? "product_test",
              customPrice: null,
              enabledVariants: [order.variantId],
              quantity: 1,
              discountEnabled: false,
              previewSubtotal: 999,
              previewDiscountTotal: 0,
              previewTax: 0,
              previewTotal: 999,
              testMode: false,
              expiresAt: order.checkoutSessionExpiresAt,
            };
          },
        });

        await expect(
          startLemonSqueezyTripPassCheckout(
            {
              userId: "account_lemon_1",
              email: "traveler@example.com",
              appUrl: "https://www.asksiargao.com",
            },
            { db, env, now, createId: () => "trip_pass_order_lemon_1", client },
          ),
        ).resolves.toEqual({
          status: "started",
          orderId: "trip_pass_order_lemon_1",
          checkoutUrl: "https://checkout.lemonsqueezy.test/1",
        });
        expect(calls).toEqual(["pending:1"]);
        const familyLockQueryIndex = queries.findIndex((query) =>
          query.includes("pg_advisory_xact_lock"),
        );
        const activePassQueryIndex = queries.findIndex((query) =>
          query.includes("from trip_passes p left join trip_usage_meters"),
        );
        const pendingOrderQueryIndex = queries.findIndex((query) =>
          query.includes("from trip_pass_orders"),
        );
        expect(familyLockQueryIndex).toBeGreaterThanOrEqual(0);
        expect(familyLockQueryIndex).toBeLessThan(activePassQueryIndex);
        expect(familyLockQueryIndex).toBeLessThan(pendingOrderQueryIndex);
        const order = await db.query<{
          payment_provider: string;
          provider_store_id: string;
          provider_variant_id: string;
          provider_checkout_id: string;
          email: string | null;
        }>(
          "select payment_provider, provider_store_id, provider_variant_id, provider_checkout_id, email from trip_pass_orders where id = $1",
          ["trip_pass_order_lemon_1"],
        );
        expect(order.rows[0]).toEqual({
          payment_provider: "lemon_squeezy",
          provider_store_id: "store_test",
          provider_variant_id: "variant_test",
          provider_checkout_id: "checkout_test_1",
          email: "traveler@example.com",
        });
        const attempt = await db.query<{ status: string; checkout_url: string }>(
          "select status, checkout_url from trip_pass_checkout_attempts where order_id = $1",
          ["trip_pass_order_lemon_1"],
        );
        expect(attempt.rows[0]).toEqual({
          status: "created",
          checkout_url: "https://checkout.lemonsqueezy.test/1",
        });
      },
      { queryLog: queries },
    );
  });

  test("applies one paid fact to one local Grant and deduplicates the exact receipt", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ($1, $2)", [
        "account_lemon_paid",
        "paid@example.com",
      ]);
      await insertLemonOrder(db, "trip_pass_order_paid", "account_lemon_paid");
      const payload = {
        meta: { event_name: "order_created", custom_data: { order_id: "trip_pass_order_paid" } },
        data: {
          id: "provider_order_paid",
          attributes: {
            status: "paid",
            total: 999,
            refunded: 0,
            currency: "usd",
            store_id: "store_test",
            variant_id: "variant_test",
            updated_at: "2026-08-19T00:00:00Z",
            test_mode: false,
            first_order_item: { quantity: 1 },
            discount_total: 0,
            custom_price: null,
            license_key: null,
          },
        },
      };
      const applyFact = ({
        fact,
        db: factDb,
        now,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentEvent>[1]["applyFact"]>
      >[0]) => applyLemonSqueezyPaymentFact(fact, { db: factDb, now });
      const first = await receiveLemonSqueezyPaymentEvent(payload, {
        db,
        applyFact,
        now,
      });
      const second = await receiveLemonSqueezyPaymentEvent(payload, {
        db,
        applyFact,
        now,
      });

      expect(first.status).toBe("applied");
      expect(second.status).toBe("duplicate");
      const grants = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_pass_grants where order_id = $1",
        ["trip_pass_order_paid"],
      );
      expect(grants.rows[0]?.count).toBe("1");
      const order = await db.query<{ status: string; accepted_payment_fact_id: string | null }>(
        "select status, accepted_payment_fact_id from trip_pass_orders where id = $1",
        ["trip_pass_order_paid"],
      );
      expect(order.rows[0]?.status).toBe("paid");
      expect(order.rows[0]?.accepted_payment_fact_id).toBeTruthy();
    });
  });

  test("refunds each additional provider Order without refunding lifecycle updates", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ($1, $2)", [
        "account_lemon_extra_payment",
        "extra@example.com",
      ]);
      await insertLemonOrder(db, "trip_pass_order_extra_payment", "account_lemon_extra_payment");
      const applyFact = ({
        fact,
        db: factDb,
        now: factNow,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentEvent>[1]["applyFact"]>
      >[0]) => applyLemonSqueezyPaymentFact(fact, { db: factDb, now: factNow });
      const payload = (providerOrderId: string, updatedAt: string, objectId: string) => ({
        meta: {
          event_name: "order_created",
          custom_data: { order_id: "trip_pass_order_extra_payment" },
        },
        data: {
          id: providerOrderId,
          attributes: {
            status: "paid",
            total: 999,
            refunded: 0,
            currency: "usd",
            store_id: "store_test",
            variant_id: "variant_test",
            updated_at: updatedAt,
            test_mode: false,
            first_order_item: { quantity: 1 },
            discount_total: 0,
            custom_price: null,
            license_key: null,
            object_id: objectId,
          },
        },
      });

      const original = await receiveLemonSqueezyPaymentEvent(
        payload("provider_order_original", "2026-08-19T00:00:00Z", "original"),
        { db, applyFact, now },
      );
      const extra = await receiveLemonSqueezyPaymentEvent(
        payload("provider_order_extra", "2026-08-19T00:01:00Z", "extra"),
        { db, applyFact, now },
      );
      const extraReplay = await receiveLemonSqueezyPaymentEvent(
        payload("provider_order_extra", "2026-08-19T00:01:00Z", "extra"),
        { db, applyFact, now },
      );
      const originalLifecycleUpdate = await receiveLemonSqueezyPaymentEvent(
        payload("provider_order_original", "2026-08-19T00:02:00Z", "original_update"),
        { db, applyFact, now },
      );

      expect(original.status).toBe("applied");
      expect(extra).toMatchObject({ status: "applied", applicationResult: { action: "refunded" } });
      expect(extraReplay.status).toBe("duplicate");
      expect(originalLifecycleUpdate).toMatchObject({
        status: "applied",
        applicationResult: { status: "duplicate" },
      });
      const refunds = await db.query<{ provider_order_id: string; count: string }>(
        `select provider_order_id, count(*)::text as count
         from trip_pass_refund_operations where order_id = $1 group by provider_order_id`,
        ["trip_pass_order_extra_payment"],
      );
      expect(refunds.rows).toEqual([{ provider_order_id: "provider_order_extra", count: "1" }]);
    });
  });

  test("ignores provider facts older than the Order lifecycle watermark", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ($1, $2)", [
        "account_lemon_monotonic",
        "monotonic@example.com",
      ]);
      await insertLemonOrder(db, "trip_pass_order_monotonic", "account_lemon_monotonic");
      const applyFact = ({
        fact,
        db: factDb,
        now: factNow,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentEvent>[1]["applyFact"]>
      >[0]) => applyLemonSqueezyPaymentFact(fact, { db: factDb, now: factNow });
      const payload = (status: "paid" | "fraudulent", updatedAt: string, objectId: string) => ({
        meta: {
          event_name: "order_created",
          custom_data: { order_id: "trip_pass_order_monotonic" },
        },
        data: {
          id: "provider_order_monotonic",
          attributes: {
            status,
            total: 999,
            refunded: 0,
            currency: "usd",
            store_id: "store_test",
            variant_id: "variant_test",
            updated_at: updatedAt,
            test_mode: false,
            first_order_item: { quantity: 1 },
            discount_total: 0,
            custom_price: null,
            license_key: null,
            object_id: objectId,
          },
        },
      });

      await receiveLemonSqueezyPaymentEvent(payload("paid", "2026-08-19T00:00:00Z", "paid"), {
        db,
        applyFact,
        now,
      });
      await receiveLemonSqueezyPaymentEvent(
        payload("fraudulent", "2026-08-19T00:02:00Z", "fraudulent"),
        { db, applyFact, now },
      );
      const stale = await receiveLemonSqueezyPaymentEvent(
        payload("paid", "2026-08-19T00:01:00Z", "stale_paid"),
        { db, applyFact, now },
      );

      expect(stale).toMatchObject({
        status: "applied",
        applicationResult: { status: "duplicate" },
      });
      const state = await db.query<{
        payment_suspension_state: string;
        provider_updated_at: Date | string | null;
        pass_status: string;
      }>(
        `select o.payment_suspension_state, o.provider_updated_at, p.status as pass_status
         from trip_pass_orders o join trip_pass_grants g on g.order_id = o.id
         join trip_passes p on p.id = g.trip_pass_id where o.id = $1`,
        ["trip_pass_order_monotonic"],
      );
      expect(state.rows[0]?.payment_suspension_state).toBe("fraudulent");
      expect(new Date(String(state.rows[0]?.provider_updated_at)).toISOString()).toBe(
        "2026-08-19T00:02:00.000Z",
      );
      expect(state.rows[0]?.pass_status).toBe("suspended");
    });
  });

  test("opens a durable partial-refund review and schedules the remaining refund", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ($1, $2)", [
        "account_lemon_partial_refund",
        "partial@example.com",
      ]);
      await insertLemonOrder(db, "trip_pass_order_partial_refund", "account_lemon_partial_refund");
      const reviews: Array<{ orderId: string; remainingAmountMinor: number; deadlineAt: Date }> =
        [];
      const payload = {
        meta: {
          event_name: "order_refunded",
          custom_data: { order_id: "trip_pass_order_partial_refund" },
        },
        data: {
          id: "provider_order_partial",
          attributes: {
            status: "partial_refund",
            total: 999,
            refunded_amount: 300,
            currency: "usd",
            store_id: "store_test",
            variant_id: "variant_test",
            updated_at: "2026-08-19T00:00:00.000Z",
            test_mode: false,
            first_order_item: { quantity: 1 },
            discount_total: 0,
            custom_price: null,
            license_key: null,
          },
        },
      };
      const applyFact = ({
        fact,
        db: factDb,
        now: factNow,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentEvent>[1]["applyFact"]>
      >[0]) =>
        applyLemonSqueezyPaymentFact(fact, {
          db: factDb,
          now: factNow,
          onPartialRefundReview: async (review) => {
            reviews.push(review);
          },
        });
      const partialResult = await receiveLemonSqueezyPaymentEvent(payload, {
        db,
        applyFact,
        now,
      });
      expect(partialResult).toMatchObject({
        status: "applied",
        applicationResult: { status: "applied", action: "refund_review" },
      });
      const order = await db.query<{
        refund_state: string;
        refund_remaining_amount_minor: number;
        refund_review_deadline_at: Date;
      }>(
        "select refund_state, refund_remaining_amount_minor, refund_review_deadline_at from trip_pass_orders where id = $1",
        ["trip_pass_order_partial_refund"],
      );
      expect(order.rows[0]?.refund_state).toBe("review");
      expect(order.rows[0]?.refund_remaining_amount_minor).toBe(699);
      expect(new Date(order.rows[0]?.refund_review_deadline_at).getTime()).toBe(
        now.getTime() + 24 * 60 * 60_000,
      );
      const operation = await db.query<{
        reason: string;
        amount_minor: number;
        next_attempt_at: Date;
      }>(
        "select reason, amount_minor, next_attempt_at from trip_pass_refund_operations where order_id = $1",
        ["trip_pass_order_partial_refund"],
      );
      expect(operation.rows[0]).toMatchObject({
        reason: "partial_refund_deadline",
        amount_minor: 699,
      });
      expect(new Date(operation.rows[0]?.next_attempt_at).getTime()).toBe(
        now.getTime() + 24 * 60 * 60_000,
      );
      expect(reviews).toHaveLength(1);
    });
  });

  test("retries a pending receipt instead of treating it as an applied duplicate", async () => {
    await withTestDb(async (db) => {
      const payload = {
        meta: { event_name: "order_created", custom_data: { order_id: "trip_pass_order_retry" } },
        data: {
          id: "provider_order_retry",
          attributes: {
            status: "paid",
            total: 999,
            refunded: 0,
            currency: "usd",
            store_id: "store_test",
            variant_id: "variant_test",
            updated_at: "2026-08-19T00:00:00Z",
            test_mode: false,
          },
        },
      };
      let attempts = 0;
      const applyFact = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("activation temporarily unavailable");
        return { status: "applied" as const };
      };

      const first = await receiveLemonSqueezyPaymentEvent(payload, { db, applyFact, now });
      const second = await receiveLemonSqueezyPaymentEvent(payload, { db, applyFact, now });
      const third = await receiveLemonSqueezyPaymentEvent(payload, {
        db,
        applyFact,
        now: new Date(now.getTime() + 60_000),
      });

      expect(first).toMatchObject({ status: "pending" });
      expect(second).toMatchObject({ status: "pending", reason: "payment_receipt_retry_not_due" });
      expect(third).toMatchObject({ status: "applied" });
      expect(attempts).toBe(2);
    });
  });
});

function fakeClient(
  overrides: Partial<NonNullable<LemonTripPassCheckoutOptions["client"]>> = {},
): NonNullable<LemonTripPassCheckoutOptions["client"]> {
  return {
    createCheckout: async () => ({
      id: "checkout_default",
      url: "https://checkout.lemonsqueezy.test/default",
      orderId: null,
      storeId: null,
      variantId: null,
      customPrice: null,
      enabledVariants: null,
      quantity: null,
      discountEnabled: null,
      previewSubtotal: null,
      previewDiscountTotal: null,
      previewTax: null,
      previewTotal: null,
      testMode: null,
      expiresAt: null,
    }),
    retrieveOrder: async () => {
      throw new Error("not used");
    },
    refundOrder: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

async function withTestDb(
  work: (db: DatabaseQueryClient) => Promise<void>,
  options: { queryLog?: string[] } = {},
) {
  await resetTestDatabase();
  const database = await openTestDatabase();
  try {
    await runInitialMigration(database);
    await work(createPgliteQueryClient(database, options.queryLog));
  } finally {
    await database.close();
  }
}

async function insertLemonOrder(db: DatabaseQueryClient, orderId: string, userId: string) {
  await db.query(
    `insert into trip_pass_orders (
      id, user_id, status, product_code, product_family, product_version, stripe_price_id,
      amount_total_minor, currency, checkout_idempotency_key, payment_provider,
      provider_store_id, provider_variant_id, provider_order_id, created_at, updated_at
    ) values ($1, $2, 'checkout_created', 'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2,
      null, 999, 'usd', $3, 'lemon_squeezy', 'store_test', 'variant_test', null, $4, $4)`,
    [orderId, userId, `trip_pass_checkout:${orderId}`, now],
  );
}

function createPgliteQueryClient(database: PGlite, queryLog: string[] = []): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      queryLog.push(query);
      return database.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await database.exec("begin");
      try {
        const result = await callback({ ...client, inTransaction: true });
        await database.exec("commit");
        return result;
      } catch (error) {
        await database.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}
