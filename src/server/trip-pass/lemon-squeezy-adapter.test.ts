import { describe, expect, test } from "bun:test";

import {
  buildLemonSqueezyCheckoutRequest,
  createLemonSqueezyCheckoutClient,
  validateLemonSqueezyCheckout,
} from "@/server/trip-pass/lemon-squeezy-adapter";

const order = {
  id: "trip_pass_order_1",
  checkoutIdempotencyKey: "trip_pass_checkout:trip_pass_order_1",
  checkoutSessionExpiresAt: new Date("2026-08-19T00:30:00Z"),
  userId: "account_private_1",
  productFamily: "siargao_trip_pass",
  customerEmail: "traveler@example.com",
  storeId: "store_live",
  variantId: "999",
} as const;

describe("Lemon Squeezy Trip Pass adapter", () => {
  test("sends only the opaque Order ID across the checkout boundary", () => {
    const request = buildLemonSqueezyCheckoutRequest({
      order,
      appUrl: "https://www.asksiargao.com/",
    });
    const serialized = JSON.stringify(request);

    expect(request.data.relationships).toEqual({
      store: { data: { type: "stores", id: "store_live" } },
      variant: { data: { type: "variants", id: "999" } },
    });
    expect(request.data.attributes.checkout_data.custom).toEqual({ order_id: "trip_pass_order_1" });
    expect(request.data.attributes.checkout_data.variant_quantities).toEqual([
      { variant_id: 999, quantity: 1 },
    ]);
    expect(request.data.attributes.product_options.enabled_variants).toEqual([999]);
    expect(request.data.attributes).not.toHaveProperty("custom_price");
    expect(request.data.attributes.checkout_options).toEqual({ discount: false });
    expect(request.data.attributes.preview).toBe(true);
    expect(request.data.attributes.test_mode).toBe(false);
    expect(request.data.attributes.expires_at).toBe("2026-08-19T00:30:00.000Z");
    expect(serialized).not.toContain("account_private_1");
    expect(serialized).toContain("traveler@example.com");
  });

  test("rejects a checkout response that changes the immutable Variant", () => {
    expect(() =>
      validateLemonSqueezyCheckout({
        order,
        checkout: {
          id: "checkout_1",
          url: "https://lemonsqueezy.test/checkout_1",
          orderId: "trip_pass_order_1",
          storeId: "store_live",
          variantId: "variant_other",
          customPrice: 999,
          enabledVariants: ["variant_other"],
          quantity: 1,
          discountEnabled: false,
          previewSubtotal: 999,
          previewDiscountTotal: 0,
          previewTax: 0,
          previewTotal: 999,
          testMode: false,
          expiresAt: order.checkoutSessionExpiresAt,
        },
      }),
    ).toThrow("Variant does not match");
  });

  test("rejects a checkout response missing immutable provider identities", () => {
    expect(() =>
      validateLemonSqueezyCheckout({
        order,
        checkout: {
          id: "checkout_1",
          url: "https://lemonsqueezy.test/checkout_1",
          orderId: order.id,
          storeId: null,
          variantId: order.variantId,
          customPrice: 999,
          enabledVariants: [order.variantId],
          quantity: 1,
          discountEnabled: false,
          previewSubtotal: 999,
          previewDiscountTotal: 0,
          previewTax: 0,
          previewTotal: 999,
          testMode: false,
          expiresAt: order.checkoutSessionExpiresAt,
        },
      }),
    ).toThrow("Store is missing");
  });

  test("accepts tax-inclusive previews when the advertised total is unchanged", () => {
    expect(() =>
      validateLemonSqueezyCheckout({
        order,
        checkout: {
          id: "checkout_taxed",
          url: "https://lemonsqueezy.test/checkout_taxed",
          orderId: order.id,
          storeId: order.storeId,
          variantId: order.variantId,
          customPrice: null,
          enabledVariants: [order.variantId],
          quantity: 1,
          discountEnabled: false,
          previewSubtotal: 909,
          previewDiscountTotal: 0,
          previewTax: 90,
          previewTotal: 999,
          testMode: false,
          expiresAt: order.checkoutSessionExpiresAt,
        },
      }),
    ).not.toThrow();
  });

  test("normalizes numeric Store and Variant response attributes", async () => {
    const capturedRequests: unknown[] = [];
    const client = createLemonSqueezyCheckoutClient({
      request: async (request) => {
        capturedRequests.push(request);
        if (request.method === "GET") {
          return {
            data: {
              id: "999",
              attributes: { has_license_keys: false, test_mode: false },
            },
          };
        }
        return {
          data: {
            id: "checkout_numeric",
            attributes: {
              url: "https://lemonsqueezy.test/checkout_numeric",
              store_id: 7,
              variant_id: 999,
              checkout_data: { custom: { order_id: order.id } },
            },
          },
        };
      },
    });

    const checkout = await client.createCheckout(
      { order: { ...order, storeId: "7", variantId: "999" }, appUrl: "https://siargao.test" },
      { idempotencyKey: order.checkoutIdempotencyKey },
    );
    expect(checkout.storeId).toBe("7");
    expect(checkout.variantId).toBe("999");
    expect(capturedRequests[0]).toEqual({ method: "GET", path: "/v1/variants/999" });
    expect(capturedRequests[1]).toMatchObject({
      body: { data: { attributes: { product_options: { enabled_variants: [999] } } } },
    });
  });

  test("rejects a configured Variant that issues license keys before checkout creation", async () => {
    const requests: unknown[] = [];
    const client = createLemonSqueezyCheckoutClient({
      request: async (request) => {
        requests.push(request);
        return {
          data: {
            id: "999",
            attributes: { has_license_keys: true, test_mode: false },
          },
        };
      },
    });

    await expect(
      client.createCheckout(
        { order, appUrl: "https://siargao.test" },
        { idempotencyKey: order.checkoutIdempotencyKey },
      ),
    ).rejects.toThrow("did not complete");
    expect(requests).toHaveLength(1);
  });

  test("uses the official JSON:API order refund request for partial refunds", async () => {
    let capturedRequest: unknown;
    const client = createLemonSqueezyCheckoutClient({
      request: async (request) => {
        capturedRequest = request;
        return {
          data: {
            type: "orders",
            id: "123",
            attributes: {
              status: "partial_refund",
              total: 1199,
              refunded: false,
              refunded_amount: 100,
              currency: "USD",
              updated_at: "2026-08-19T00:00:00Z",
            },
          },
        };
      },
    });

    await client.refundOrder("123", { amountMinor: 100, idempotencyKey: "refund:123:100" });

    expect(capturedRequest).toEqual({
      method: "POST",
      path: "/v1/orders/123/refund",
      idempotencyKey: "refund:123:100",
      body: {
        data: {
          type: "orders",
          id: "123",
          attributes: { amount: 100 },
        },
      },
    });
  });
});
