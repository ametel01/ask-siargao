import { describe, expect, test } from "bun:test";

import {
  buildLemonSqueezyCheckoutRequest,
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
  variantId: "variant_live_999",
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
      variant: { data: { type: "variants", id: "variant_live_999" } },
    });
    expect(request.data.attributes.checkout_data.custom).toEqual({ order_id: "trip_pass_order_1" });
    expect(request.data.attributes.product_options.enabled_variants).toEqual(["variant_live_999"]);
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
        },
      }),
    ).toThrow("Variant does not match");
  });
});
