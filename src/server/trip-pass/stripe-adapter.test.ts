import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";

import { createTripPassCheckoutClient } from "@/server/trip-pass/stripe-adapter";

describe("Trip Pass Stripe adapter", () => {
  test("retrieves authoritative Checkout state when an already-terminal Session rejects expiry", async () => {
    const calls: string[] = [];
    const stripe = checkoutStripe({
      expire: async () => {
        calls.push("expire");
        throw Object.assign(new Error("Checkout Session is not open"), {
          type: "StripeInvalidRequestError",
        });
      },
      retrieve: async () => {
        calls.push("retrieve");
        return checkoutSession("expired");
      },
    });

    const session = await createTripPassCheckoutClient(stripe).expireCheckoutSession("cs_expired");

    expect(calls).toEqual(["expire", "retrieve"]);
    expect(session).toMatchObject({ id: "cs_expired", status: "expired" });
  });

  test("does not mask ambiguous Stripe expiry failures with a retrieval", async () => {
    const calls: string[] = [];
    const error = Object.assign(new Error("Stripe request timed out"), {
      type: "StripeConnectionError",
    });
    const stripe = checkoutStripe({
      expire: async () => {
        calls.push("expire");
        throw error;
      },
      retrieve: async () => {
        calls.push("retrieve");
        return checkoutSession("expired");
      },
    });

    await expect(
      createTripPassCheckoutClient(stripe).expireCheckoutSession("cs_ambiguous"),
    ).rejects.toBe(error);
    expect(calls).toEqual(["expire"]);
  });
});

function checkoutStripe(input: {
  expire: () => Promise<Stripe.Checkout.Session>;
  retrieve: () => Promise<Stripe.Checkout.Session>;
}) {
  return {
    checkout: {
      sessions: {
        create: async () => checkoutSession("open"),
        expire: input.expire,
        retrieve: input.retrieve,
      },
    },
  } as unknown as Stripe;
}

function checkoutSession(status: Stripe.Checkout.Session.Status) {
  return {
    id: status === "expired" ? "cs_expired" : "cs_open",
    amount_total: 999,
    client_reference_id: "order_test",
    consent: null,
    currency: "usd",
    expires_at: 1_786_585_465,
    line_items: { data: [] },
    metadata: null,
    mode: "payment",
    payment_status: "unpaid",
    status,
    url: null,
  } as unknown as Stripe.Checkout.Session;
}
