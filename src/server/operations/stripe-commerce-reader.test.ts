import { describe, expect, test } from "bun:test";

import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";

describe("Stripe commerce reader", () => {
  test("prefers the Payment Intent and recognizes refunded or disputed charges", async () => {
    const retrieved: unknown[] = [];
    let checkoutCalled = false;
    const reader = createStripeCommerceReader({
      checkout: {
        sessions: {
          async retrieve() {
            checkoutCalled = true;
            throw new Error("checkout lookup must not hide refund state");
          },
        },
      },
      paymentIntents: {
        async retrieve(...input: unknown[]) {
          retrieved.push(input);
          return {
            amount: 999,
            amount_received: 999,
            currency: "usd",
            latest_charge: { disputed: false, refunded: true },
            status: "succeeded",
          };
        },
      },
    } as never);

    await expect(
      reader.readPaymentFact({
        checkoutSessionId: "cs_private",
        paymentIntentId: "pi_private",
      }),
    ).resolves.toEqual({ amountMinor: 999, currency: "usd", paymentState: "refunded" });
    expect(retrieved).toEqual([["pi_private", { expand: ["latest_charge"] }]]);
    expect(checkoutCalled).toBe(false);
  });

  test("gives an active dispute precedence over a refund marker", async () => {
    const reader = createStripeCommerceReader({
      checkout: { sessions: { retrieve: async () => ({}) } },
      paymentIntents: {
        async retrieve() {
          return {
            amount: 999,
            amount_received: 999,
            currency: "usd",
            latest_charge: { disputed: true, refunded: true },
            status: "succeeded",
          };
        },
      },
    } as never);
    await expect(
      reader.readPaymentFact({ checkoutSessionId: null, paymentIntentId: "pi_disputed" }),
    ).resolves.toMatchObject({ paymentState: "disputed" });
  });
});
