import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { riskReconciliationOrderCapacity } from "@/server/operations/operational-capacity";
import { executeOperatorRefund, previewOperatorRefund } from "@/server/operations/operator-refunds";
import {
  receiveLemonSqueezyPaymentEvent,
  receiveLemonSqueezyPaymentFact,
} from "@/server/payments/payment-event-receipts";
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
  test("refuses a new Order when the five-minute risk reconciliation capacity is full", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ('account_capacity_blocked', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, payment_provider,
           created_at, updated_at
         ) select 'capacity_order_' || value, null, 'paid', 'siargao_trip_pass_14d_v2',
           'siargao_trip_pass', 2, 999, 'usd', 'capacity_checkout_' || value,
           'lemon_squeezy', $1, $1
         from generate_series(1, $2::integer) value`,
        [now, riskReconciliationOrderCapacity],
      );
      let providerCalls = 0;

      await expect(
        startLemonSqueezyTripPassCheckout(
          {
            userId: "account_capacity_blocked",
            email: "capacity@example.com",
            appUrl: "https://www.asksiargao.com",
          },
          {
            client: fakeClient({
              createCheckout: async () => {
                providerCalls += 1;
                throw new Error("provider_must_not_be_called");
              },
            }),
            createId: () => "capacity_order_new",
            db,
            env,
            now,
          },
        ),
      ).resolves.toEqual({
        status: "blocked",
        reason: "trip_pass_reconciliation_capacity_reached",
      });
      expect(providerCalls).toBe(0);
      const inserted = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_pass_orders where id = 'capacity_order_new'",
      );
      expect(inserted.rows[0]?.count).toBe("0");
    });
  });

  test("fails checkout closed when the production capacity lock is unavailable", async () => {
    await withTestDb(async (db) => {
      await db.query(
        "insert into users (id, email) values ('account_capacity_lock_failure', null)",
      );
      if (!db.transaction) throw new Error("test transaction unavailable");
      const lockFailureDb: DatabaseQueryClient = {
        ...db,
        dialect: "postgres",
        async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
          return db.transaction?.(async (transaction) =>
            callback({
              ...transaction,
              dialect: "postgres",
              async query<Result>(query: string, params: unknown[] = []) {
                if (query.includes("ask-siargao-reconciliation-capacity")) {
                  throw new Error("permission denied for function pg_advisory_xact_lock");
                }
                if (query.includes("pg_advisory_xact_lock")) return { rows: [] as Result[] };
                return transaction.query<Result>(query, params);
              },
            }),
          ) as Promise<T>;
        },
      };
      let providerCalls = 0;

      await expect(
        startLemonSqueezyTripPassCheckout(
          {
            userId: "account_capacity_lock_failure",
            appUrl: "https://www.asksiargao.com",
          },
          {
            client: fakeClient({
              createCheckout: async () => {
                providerCalls += 1;
                throw new Error("provider_must_not_be_called");
              },
            }),
            createId: () => "capacity_lock_failure_order",
            db: lockFailureDb,
            env,
            now,
          },
        ),
      ).rejects.toThrow("permission denied for function pg_advisory_xact_lock");
      expect(providerCalls).toBe(0);
    });
  });

  test("expires abandoned unpaid Orders before admitting a deliberate retry", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ('account_after_abandonment', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, payment_provider,
           checkout_session_expires_at, checkout_session_status, created_at, updated_at
         ) select 'abandoned_order_' || value, null, 'checkout_created',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
           'abandoned_checkout_' || value, 'lemon_squeezy', $1::timestamptz - interval '6 minutes',
           'open', $1::timestamptz - interval '36 minutes',
           $1::timestamptz - interval '36 minutes'
         from generate_series(1, $2::integer) value`,
        [now, riskReconciliationOrderCapacity],
      );
      const client = fakeClient({
        createCheckout: async ({ order }) => ({
          id: "checkout_after_abandonment",
          url: "https://checkout.lemonsqueezy.test/after-abandonment",
          orderId: order.id,
          storeId: order.storeId,
          productId: order.productId ?? "product_test",
          variantId: order.variantId,
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
        }),
      });

      await expect(
        startLemonSqueezyTripPassCheckout(
          {
            userId: "account_after_abandonment",
            appUrl: "https://www.asksiargao.com",
          },
          {
            client,
            createId: () => "order_after_abandonment",
            db,
            env,
            now,
          },
        ),
      ).resolves.toMatchObject({ status: "started", orderId: "order_after_abandonment" });
      const state = await db.query<{ expired: string; risk: string }>(
        `select count(*) filter (where status = 'expired')::text as expired,
           count(*) filter (where status in ('pending', 'checkout_created', 'paid', 'disputed'))::text as risk
         from trip_pass_orders`,
      );
      expect(state.rows[0]).toEqual({
        expired: String(riskReconciliationOrderCapacity),
        risk: "1",
      });
    });
  });

  test("fences expired checkout settlement by grace and durable provider evidence", async () => {
    await withTestDb(async (db) => {
      await db.query(
        `insert into users (id, email) values
         ('account_expiry_grace', null), ('account_expiry_evidence', null)`,
      );
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, currency, checkout_idempotency_key, payment_provider,
           checkout_session_expires_at, checkout_session_status,
           checkout_return_lookup_attempts, checkout_return_lookup_status,
           created_at, updated_at
         ) values
         ('order_expiry_grace', 'account_expiry_grace', 'checkout_created',
          'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
          'checkout_expiry_grace', 'lemon_squeezy', $1::timestamptz - interval '1 minute',
          'open', 0, 'pending', $1::timestamptz - interval '31 minutes', $1),
         ('order_expiry_evidence', 'account_expiry_evidence', 'checkout_created',
          'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 'usd',
          'checkout_expiry_evidence', 'lemon_squeezy', $1::timestamptz - interval '10 minutes',
          'open', 1, 'pending', $1::timestamptz - interval '40 minutes', $1)`,
        [now],
      );
      let providerCalls = 0;
      const client = fakeClient({
        createCheckout: async () => {
          providerCalls += 1;
          throw new Error("provider_must_not_be_called");
        },
      });

      for (const userId of ["account_expiry_grace", "account_expiry_evidence"]) {
        await expect(
          startLemonSqueezyTripPassCheckout(
            { userId, appUrl: "https://www.asksiargao.com" },
            { client, createId: () => `new_${userId}`, db, env, now },
          ),
        ).resolves.toEqual({ status: "blocked", reason: "trip_pass_checkout_settling" });
      }
      expect(providerCalls).toBe(0);
      const state = await db.query<{ status: string }>(
        "select status from trip_pass_orders where id in ('order_expiry_grace', 'order_expiry_evidence') order by id",
      );
      expect(state.rows).toEqual([{ status: "checkout_created" }, { status: "checkout_created" }]);
    });
  });

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
          checkout_commercial_terms_verified_at: Date | string | null;
          email: string | null;
        }>(
          "select payment_provider, provider_store_id, provider_variant_id, provider_checkout_id, checkout_commercial_terms_verified_at, email from trip_pass_orders where id = $1",
          ["trip_pass_order_lemon_1"],
        );
        expect(order.rows[0]).toEqual({
          payment_provider: "lemon_squeezy",
          provider_store_id: "store_test",
          provider_variant_id: "variant_test",
          provider_checkout_id: "checkout_test_1",
          checkout_commercial_terms_verified_at: now,
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

  test("rejects commercially invalid additional provider Orders before durable side effects", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ('account_invalid_extra', null)");
      await insertLemonOrder(db, "order_invalid_extra", "account_invalid_extra");
      await db.query(
        "update trip_pass_orders set provider_product_id = 'product_test' where id = 'order_invalid_extra'",
      );
      const applyFact = ({
        fact,
        db: factDb,
        now: factNow,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentFact>[1]["applyFact"]>
      >[0]) => applyLemonSqueezyPaymentFact(fact, { db: factDb, now: factNow });
      const validFact = {
        provider: "lemon_squeezy" as const,
        eventName: "order_lookup",
        objectId: "provider_order_valid",
        providerUpdatedAt: "2026-08-19T00:00:00.000Z",
        orderId: "order_invalid_extra",
        providerOrderId: "provider_order_valid",
        paymentId: null,
        storeId: "store_test",
        productId: "product_test",
        variantId: "variant_test",
        status: "paid" as const,
        amountTotalMinor: 999,
        refundedAmountMinor: 0,
        currency: "usd",
        testMode: false,
        discountTotalMinor: 0,
      };
      await receiveLemonSqueezyPaymentFact(validFact, { db, applyFact, now });

      const invalidFacts = [
        { amountTotalMinor: 998 },
        { currency: "eur" },
        { productId: "product_wrong" },
        { variantId: "variant_wrong" },
        { storeId: "store_wrong" },
      ];
      for (const [index, mismatch] of invalidFacts.entries()) {
        const result = await receiveLemonSqueezyPaymentFact(
          {
            ...validFact,
            ...mismatch,
            objectId: `provider_order_invalid_${index}`,
            providerOrderId: `provider_order_invalid_${index}`,
            providerUpdatedAt: `2026-08-19T00:0${index + 1}:00.000Z`,
          },
          { db, applyFact, now },
        );
        expect(result.status).toBe("blocked");
      }

      const sideEffects = await db.query<{ facts: string; refunds: string }>(
        `select
           (select count(*)::text from trip_pass_payment_facts
            where order_id = 'order_invalid_extra') as facts,
           (select count(*)::text from trip_pass_refund_operations
            where order_id = 'order_invalid_extra') as refunds`,
      );
      expect(sideEffects.rows[0]).toEqual({ facts: "1", refunds: "0" });
    });
  });

  test("grants one delayed competing Order and refunds the other", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ('account_competing_orders', null)");
      await insertLemonOrder(db, "order_competing_old", "account_competing_orders");
      await insertLemonOrder(db, "order_competing_new", "account_competing_orders");
      const applyFact = ({
        fact,
        db: factDb,
        now: factNow,
      }: Parameters<
        NonNullable<Parameters<typeof receiveLemonSqueezyPaymentFact>[1]["applyFact"]>
      >[0]) => applyLemonSqueezyPaymentFact(fact, { db: factDb, now: factNow });
      const factFor = (orderId: string, suffix: string, providerUpdatedAt: string) => ({
        provider: "lemon_squeezy" as const,
        eventName: "order_lookup",
        objectId: `provider_order_${suffix}`,
        providerUpdatedAt,
        orderId,
        providerOrderId: `provider_order_${suffix}`,
        paymentId: null,
        storeId: "store_test",
        variantId: "variant_test",
        status: "paid" as const,
        amountTotalMinor: 999,
        refundedAmountMinor: 0,
        currency: "usd",
        testMode: false,
        discountTotalMinor: 0,
      });

      const newPayment = await receiveLemonSqueezyPaymentFact(
        factFor("order_competing_new", "new", "2026-08-19T00:02:00.000Z"),
        { db, applyFact, now },
      );
      const delayedOldPayment = await receiveLemonSqueezyPaymentFact(
        factFor("order_competing_old", "old", "2026-08-19T00:03:00.000Z"),
        { db, applyFact, now },
      );

      expect(newPayment).toMatchObject({
        status: "applied",
        applicationResult: { action: "activated" },
      });
      expect(delayedOldPayment).toMatchObject({
        status: "applied",
        applicationResult: { action: "refunded" },
      });
      const outcome = await db.query<{ grants: string; refunds: string }>(
        `select
           (select count(*)::text from trip_pass_grants
            where order_id in ('order_competing_old', 'order_competing_new')) as grants,
           (select count(*)::text from trip_pass_refund_operations
            where order_id in ('order_competing_old', 'order_competing_new')
              and reason = 'duplicate_payment') as refunds`,
      );
      expect(outcome.rows[0]).toEqual({ grants: "1", refunds: "1" });
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

      const preview = await previewOperatorRefund(
        { decision: "accept_partial_refund", orderId: "trip_pass_order_partial_refund" },
        db,
      );
      await executeOperatorRefund(
        {
          auth: { accountId: "operator_partial_final", mfaFresh: true },
          confirmation: "APPLY REFUND",
          decision: "accept_partial_refund",
          idempotencyKey: "partial-final-idempotency-key",
          orderId: "trip_pass_order_partial_refund",
          previewDigest: preview.digest,
          reasonCode: "accept_partial_resolution",
        },
        { allowlist: new Set(["operator_partial_final"]), db },
      );
      const lookup = await receiveLemonSqueezyPaymentFact(
        {
          provider: "lemon_squeezy",
          eventName: "order_lookup",
          objectId: "provider_order_partial",
          providerUpdatedAt: "2026-08-19T00:05:00.000Z",
          orderId: "trip_pass_order_partial_refund",
          providerOrderId: "provider_order_partial",
          paymentId: null,
          storeId: "store_test",
          variantId: "variant_test",
          status: "partial_refund",
          amountTotalMinor: 999,
          refundedAmountMinor: 300,
          currency: "usd",
          testMode: false,
          discountTotalMinor: 0,
        },
        { db, applyFact, now },
      );
      expect(lookup).toMatchObject({
        status: "applied",
        applicationResult: { status: "duplicate" },
      });
      const final = await db.query<{ refund_state: string; status: string }>(
        `select o.refund_state, operation.status from trip_pass_orders o
         join trip_pass_refund_operations operation on operation.order_id = o.id
         where o.id = 'trip_pass_order_partial_refund'`,
      );
      expect(final.rows[0]).toEqual({ refund_state: "partial_final", status: "cancelled" });

      const increased = await receiveLemonSqueezyPaymentFact(
        {
          provider: "lemon_squeezy",
          eventName: "order_lookup",
          objectId: "provider_order_partial",
          providerUpdatedAt: "2026-08-19T00:06:00.000Z",
          orderId: "trip_pass_order_partial_refund",
          providerOrderId: "provider_order_partial",
          paymentId: null,
          storeId: "store_test",
          variantId: "variant_test",
          status: "partial_refund",
          amountTotalMinor: 999,
          refundedAmountMinor: 400,
          currency: "usd",
          testMode: false,
          discountTotalMinor: 0,
        },
        { db, applyFact, now },
      );
      expect(increased).toMatchObject({
        status: "applied",
        applicationResult: { status: "applied", action: "refund_review" },
      });
      const reopened = await db.query<{
        amount_minor: number;
        refund_state: string;
        status: string;
      }>(
        `select o.refund_state, operation.status, operation.amount_minor
         from trip_pass_orders o
         join trip_pass_refund_operations operation on operation.order_id = o.id
         where o.id = 'trip_pass_order_partial_refund'`,
      );
      expect(reopened.rows[0]).toEqual({
        amount_minor: 599,
        refund_state: "review",
        status: "pending",
      });
      expect(reviews).toHaveLength(2);
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
      provider_store_id, provider_variant_id, provider_order_id,
      checkout_commercial_terms_verified_at, created_at, updated_at
    ) values ($1, $2, 'checkout_created', 'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2,
      null, 999, 'usd', $3, 'lemon_squeezy', 'store_test', 'variant_test', null, $4, $4, $4)`,
    [orderId, userId, `trip_pass_checkout:${orderId}`, now],
  );
}

function createPgliteQueryClient(database: PGlite, queryLog: string[] = []): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    dialect: "pglite",
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
