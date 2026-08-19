import { describe, expect, test } from "bun:test";

import type { DatabaseQueryClient } from "@/server/db/query-client";
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
