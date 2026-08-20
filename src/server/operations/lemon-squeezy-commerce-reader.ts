import type { AuthoritativeCommerceReader } from "@/server/operations/live-reconciliation";
import { createLemonSqueezyCheckoutClient } from "@/server/trip-pass/lemon-squeezy-adapter";

/** Read-only reconciliation adapter. It never mutates provider or local state. */
export function createLemonSqueezyCommerceReader(
  client = createLemonSqueezyCheckoutClient(),
): AuthoritativeCommerceReader {
  return {
    async readPaymentFact(input) {
      if (!input.providerOrderId) {
        return { amountMinor: null, currency: null, paymentState: "pending" };
      }
      const order = await client.retrieveOrder(input.providerOrderId, { signal: input.signal });
      return {
        amountMinor: order.amountTotalMinor,
        currency: order.currency,
        paymentState: toPaymentState(order.status),
        providerFact: order,
      };
    },
  };
}

function toPaymentState(status: string): "pending" | "paid" | "refunded" | "disputed" | "unpaid" {
  if (status === "paid") return "paid";
  if (status === "refunded" || status === "partial_refund") return "refunded";
  if (status === "fraudulent") return "disputed";
  if (status === "failed") return "unpaid";
  return "pending";
}
