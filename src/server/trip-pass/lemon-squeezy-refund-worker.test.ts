import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import type { LemonSqueezyCheckoutClient } from "@/server/trip-pass/lemon-squeezy-adapter";
import { runLemonSqueezyRefundBatch } from "@/server/trip-pass/lemon-squeezy-refund-worker";

describe("Lemon Squeezy refund worker", () => {
  test("executes a due operation with its provider order and verifies the refund", async () => {
    await withTestDb(async (db) => {
      await insertOperation(db, "refund_operation_1");
      const calls: string[] = [];
      const client = fakeClient({
        refundOrder: async (providerOrderId, input) => {
          calls.push(`${providerOrderId}:${input.amountMinor}:${input.idempotencyKey}`);
          return {
            provider: "lemon_squeezy",
            eventName: "order_refunded",
            objectId: providerOrderId,
            providerUpdatedAt: "2026-08-19T00:00:00.000Z",
            orderId: "trip_pass_order_refund",
            providerOrderId,
            checkoutId: null,
            paymentId: null,
            storeId: "store_test",
            variantId: "variant_test",
            status: "refunded",
            amountTotalMinor: 999,
            refundedAmountMinor: 999,
            currency: "usd",
            testMode: false,
          };
        },
      });

      const result = await runLemonSqueezyRefundBatch({
          client,
          createLeaseToken: () => "lease_1",
          db,
          limit: 1,
        });
      expect(result).toEqual({ claimed: 1, confirmed: 1, retrying: 0, stale: 0 });
      expect(calls).toEqual(["provider_order_refund:999:refund:refund_operation_1"]);
      const operation = await db.query<{ status: string; completed_at: Date | null }>(
        "select status, completed_at from trip_pass_refund_operations where id = $1",
        ["refund_operation_1"],
      );
      expect(operation.rows[0]?.status).toBe("succeeded");
      expect(operation.rows[0]?.completed_at).toBeTruthy();
    });
  });

  test("does not mark an unverified provider response successful", async () => {
    await withTestDb(async (db) => {
      await insertOperation(db, "refund_operation_unverified");
      const result = await runLemonSqueezyRefundBatch({
        client: fakeClient({
          refundOrder: async () => ({
            provider: "lemon_squeezy",
            eventName: "order_refunded",
            objectId: "wrong_order",
            providerUpdatedAt: "2026-08-19T00:00:00.000Z",
            orderId: "trip_pass_order_refund",
            providerOrderId: "wrong_order",
            checkoutId: null,
            paymentId: null,
            storeId: "store_test",
            variantId: "variant_test",
            status: "refunded",
            amountTotalMinor: 999,
            refundedAmountMinor: 999,
            currency: "usd",
            testMode: false,
          }),
        }),
        createLeaseToken: () => "lease_unverified",
        db,
        limit: 1,
      });
      expect(result).toEqual({ claimed: 1, confirmed: 0, retrying: 1, stale: 0 });
      const operation = await db.query<{ status: string; last_error_code: string }>(
        "select status, last_error_code from trip_pass_refund_operations where id = $1",
        ["refund_operation_unverified"],
      );
      expect(operation.rows[0]).toMatchObject({
        status: "pending",
        last_error_code: "refund_response_unverified",
      });
    });
  });
});

function fakeClient(
  overrides: Partial<LemonSqueezyCheckoutClient> = {},
): LemonSqueezyCheckoutClient {
  return {
    createCheckout: async () => ({
      id: "checkout",
      url: "https://checkout.test",
      orderId: "trip_pass_order_refund",
      storeId: "store_test",
      variantId: "variant_test",
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

async function insertOperation(db: DatabaseQueryClient, id: string) {
  await db.query(
    `insert into users (id, email) values ('refund_user', 'refund@example.com')
     on conflict (id) do nothing`,
  );
  await db.query(
    `insert into trip_pass_orders (
      id, user_id, status, product_code, product_family, product_version,
      amount_total_minor, currency, checkout_idempotency_key, payment_provider,
      provider_store_id, provider_variant_id, provider_order_id, created_at, updated_at
    ) values ('trip_pass_order_refund', 'refund_user', 'paid', 'siargao_trip_pass_14d_v2',
      'siargao_trip_pass', 2, 999, 'usd', 'refund:order', 'lemon_squeezy',
      'store_test', 'variant_test', 'provider_order_original', now(), now())
     on conflict (id) do nothing`,
  );
  await db.query(
    `insert into trip_pass_refund_operations (
      id, order_id, provider, provider_order_id, reason, amount_minor,
      idempotency_key, created_at, updated_at
    ) values ($1, 'trip_pass_order_refund', 'lemon_squeezy', 'provider_order_refund',
      'duplicate_payment', 999, $2, now(), now())`,
    [id, `refund:${id}`],
  );
}

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const database = await openTestDatabase();
  try {
    await runInitialMigration(database);
    await work(createPgliteQueryClient(database));
  } finally {
    await database.close();
  }
}

function createPgliteQueryClient(database: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
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
