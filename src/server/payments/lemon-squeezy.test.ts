import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  parseLemonSqueezyOrderFact,
  paymentFactFingerprint,
  verifyLemonSqueezyWebhookSignature,
} from "@/server/payments/lemon-squeezy";

describe("Lemon Squeezy payment authority boundary", () => {
  test("verifies the unmodified body with a timing-safe HMAC signature", () => {
    const payload = JSON.stringify({ data: { id: "order_1" } });
    const secret = "test-secret";
    const signature = createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyLemonSqueezyWebhookSignature({ payload, signature, webhookSecret: secret })).toBe(
      true,
    );
    expect(() =>
      verifyLemonSqueezyWebhookSignature({
        payload,
        signature: `${signature.slice(0, -1)}0`,
        webhookSecret: secret,
      }),
    ).toThrow("Invalid Lemon Squeezy webhook signature");
  });

  test("normalizes custom order correlation without retaining raw payload", () => {
    const fact = parseLemonSqueezyOrderFact({
      eventName: "order_created",
      payload: {
        meta: { event_name: "order_created", custom_data: { order_id: "trip_pass_order_1" } },
        data: {
          id: "123",
          attributes: {
            status: "paid",
            total: 999,
            refunded: 0,
            currency: "USD",
            updated_at: "2026-08-19T00:00:00Z",
          },
        },
      },
    });

    expect(fact).toMatchObject({
      provider: "lemon_squeezy",
      orderId: "trip_pass_order_1",
      providerOrderId: "123",
      status: "paid",
      amountTotalMinor: 999,
      currency: "USD",
    });
    expect(JSON.stringify(fact)).not.toContain("custom_data");
  });

  test("normalizes Store and Variant IDs from the official order webhook shape", () => {
    const fact = parseLemonSqueezyOrderFact({
      eventName: "order_created",
      payload: {
        meta: {
          event_name: "order_created",
          custom_data: { order_id: "trip_pass_order_1" },
        },
        data: {
          type: "orders",
          id: "123",
          attributes: {
            store_id: 1,
            status: "paid",
            total: 999,
            currency: "USD",
            first_order_item: {
              order_id: 123,
              product_id: 456,
              variant_id: 789,
              price: 999,
              quantity: 1,
              test_mode: false,
            },
            updated_at: "2026-08-19T00:00:00Z",
          },
        },
      },
    });

    expect(fact).toMatchObject({
      orderId: "trip_pass_order_1",
      storeId: "1",
      variantId: "789",
      quantity: 1,
      testMode: false,
    });
  });

  test("distinguishes lifecycle updates in the deterministic receipt fingerprint", () => {
    const base = parseLemonSqueezyOrderFact({
      eventName: "order_created",
      payload: {
        data: {
          id: "123",
          attributes: {
            status: "paid",
            total: 999,
            refunded: 0,
            updated_at: "2026-08-19T00:00:00Z",
          },
        },
      },
    });
    const refunded = {
      ...base,
      eventName: "order_refunded",
      status: "refunded" as const,
      refundedAmountMinor: 999,
    };
    expect(paymentFactFingerprint(base)).not.toBe(paymentFactFingerprint(refunded));
    expect(paymentFactFingerprint(base)).toHaveLength(64);
  });

  test("preserves the refunded amount and partial-refund status from an order payload", () => {
    const partial = parseLemonSqueezyOrderFact({
      eventName: "order_refunded",
      payload: {
        data: {
          id: "123",
          attributes: {
            status: "partial_refund",
            total: 1199,
            refunded: false,
            refunded_amount: 100,
          },
        },
      },
    });
    const full = parseLemonSqueezyOrderFact({
      eventName: "order_refunded",
      payload: {
        data: {
          id: "123",
          attributes: {
            status: "refunded",
            total: 1199,
            refunded: true,
            refunded_amount: 1199,
          },
        },
      },
    });

    expect(partial).toMatchObject({ status: "partial_refund", refundedAmountMinor: 100 });
    expect(full).toMatchObject({ status: "refunded", refundedAmountMinor: 1199 });
  });
});
