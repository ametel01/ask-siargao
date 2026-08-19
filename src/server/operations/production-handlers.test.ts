import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import { createOperationTrace, operationalTaskTypes } from "@/server/operations/contracts";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";

describe("production operational task handlers", () => {
  test("binds every durable task kind to its concrete scoped production path", async () => {
    for (const taskType of operationalTaskTypes) {
      const queries: string[] = [];
      const db = recordingDatabase(queries);
      const handlers = createProductionOperationalTaskHandlers({
        closureProviders: {
          deleteClerkUser: async () => undefined,
          expireCheckoutSession: async () => undefined,
        },
        commerceReader: {
          readPaymentFact: async () => ({
            amountMinor: null,
            currency: null,
            paymentState: "unpaid",
          }),
        },
        db,
        lemonRefundClient: {
          createCheckout: async () => {
            throw new Error("not used");
          },
          retrieveOrder: async () => {
            throw new Error("not used");
          },
          refundOrder: async () => {
            throw new Error("not used");
          },
        },
        refundClient: {
          createFullRefund: async () => ({ id: "refund", status: "succeeded" }),
          retrieveRefund: async () => ({ id: "refund", status: "succeeded" }),
        },
      });
      const handler = handlers[taskType];
      expect(handler).toBeFunction();
      const resourceRef =
        taskType === "commerce_reconciliation" ? "risk:cycle:opaque_resource" : "opaque_resource";
      const result = handler?.({ resourceRef, trace: createOperationTrace() });
      if (taskType === "commerce_reconciliation") await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow();

      const sql = queries.join("\n");
      if (taskType === "account_closure") expect(sql).toContain("account_closure_steps");
      if (taskType === "pending_payment_event") {
        expect(sql).toContain("trip_pass_payment_event_receipts");
      }
      if (taskType === "pending_stripe_event") expect(sql).toContain("trip_pass_stripe_events");
      if (taskType === "paid_after_closure_refund") {
        expect(sql).toContain("account_closure_refund_obligations");
      }
      if (taskType === "retention_purge") expect(sql).toContain("paid_answer_reservations");
      if (taskType === "commerce_reconciliation") {
        expect(sql).toContain("operational_reconciliation_runs");
      }
      expect(sql).toContain("opaque_resource");
    }
  });

  test("correlates an authoritative Lemon Order lookup before applying a refund", async () => {
    const db = new PGlite();
    try {
      await runInitialMigration(db);
      await db.query("insert into users (id, email) values ('account_reconcile_refund', null)");
      await db.query(
        `insert into trip_pass_orders (
           id, user_id, status, product_code, product_family, product_version,
           amount_total_minor, captured_amount_minor, currency, checkout_idempotency_key,
           payment_provider, provider_store_id, provider_product_id, provider_variant_id,
           provider_order_id, checkout_commercial_terms_verified_at, created_at, updated_at
         ) values ('order_reconcile_refund', 'account_reconcile_refund', 'paid',
           'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 999, 999, 'usd',
           'checkout:reconcile-refund', 'lemon_squeezy', '7', '88', '99', '12345',
           now(), now() - interval '1 hour', now() - interval '1 hour')`,
      );
      const handlers = createProductionOperationalTaskHandlers({
        commerceReader: {
          readPaymentFact: async () => ({
            amountMinor: 999,
            currency: "usd",
            paymentState: "refunded",
            providerFact: {
              provider: "lemon_squeezy",
              eventName: "order_lookup",
              objectId: "12345",
              providerUpdatedAt: "2026-08-20T00:00:00.000Z",
              orderId: null,
              providerOrderId: "12345",
              paymentId: "104e18a2-d755-4d4b-80c4-a6c1dcbe1c10",
              storeId: "7",
              productId: "88",
              variantId: "99",
              status: "refunded",
              amountTotalMinor: 999,
              refundedAmountMinor: 999,
              currency: "usd",
              testMode: false,
              discountTotalMinor: 0,
            },
          }),
        },
        db,
      });

      await handlers.commerce_reconciliation?.({
        resourceRef: "risk:cycle-refund:order_reconcile_refund",
        trace: createOperationTrace(),
      });

      const order = await db.query<{ refund_state: string; status: string }>(
        "select refund_state, status from trip_pass_orders where id = 'order_reconcile_refund'",
      );
      expect(order.rows[0]).toEqual({ refund_state: "full", status: "refunded" });
      const receipt = await db.query<{ event_name: string; order_id: string; status: string }>(
        `select event_name, order_id, status from trip_pass_payment_event_receipts
         where order_id = 'order_reconcile_refund'`,
      );
      expect(receipt.rows).toEqual([
        { event_name: "order_lookup", order_id: "order_reconcile_refund", status: "applied" },
      ]);
    } finally {
      await db.close();
    }
  });
});

function recordingDatabase(queries: string[]): DatabaseQueryClient {
  const db: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      queries.push(`${query} ${params.map(String).join(" ")}`);
      if (query.includes("clock_timestamp() as now")) {
        return { rows: [{ now: new Date("2026-08-08T00:00:00.000Z") }] as T[] };
      }
      if (query.includes("nextval('operational_reconciliation_observation_sequence')")) {
        return { rows: [{ sequence: "1" }] as T[] };
      }
      return { rows: [] as T[] };
    },
    async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
      return callback({ ...db, inTransaction: true });
    },
  };
  return db;
}
