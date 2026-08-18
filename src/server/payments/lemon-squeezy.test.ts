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
});
