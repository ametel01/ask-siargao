import { describe, expect, test } from "bun:test";

import { verifyProtectedLemonSqueezyCatalog } from "@/server/qa/lemon-squeezy-release-candidate";

const expected = { productId: "202", storeId: "101", variantId: "303" };

describe("protected Lemon Squeezy catalogue preflight", () => {
  test("accepts one published test-mode Product and Variant in the exact Store", async () => {
    const requests: string[] = [];

    const result = await verifyProtectedLemonSqueezyCatalog({
      expected,
      async request(path) {
        requests.push(path);
        return responseFor(path);
      },
    });

    expect(requests).toEqual(["/v1/stores/101", "/v1/products/202", "/v1/variants/303"]);
    expect(result).toEqual({
      productId: "202",
      storeId: "101",
      testMode: true,
      variantId: "303",
    });
  });

  test("rejects live or mixed resources during read-only preflight", async () => {
    const requests: string[] = [];

    await expect(
      verifyProtectedLemonSqueezyCatalog({
        expected,
        async request(path) {
          requests.push(path);
          if (path === "/v1/products/202") {
            return responseFor(path, { test_mode: false });
          }
          return responseFor(path);
        },
      }),
    ).rejects.toThrow("Protected Lemon Squeezy Product must be test-mode and published.");

    expect(requests).toEqual(["/v1/stores/101", "/v1/products/202", "/v1/variants/303"]);
  });

  test("rejects cross-Store, cross-Product, and license-key Variant drift", async () => {
    for (const [path, attributes, message] of [
      [
        "/v1/products/202",
        { store_id: 999 },
        "Protected Lemon Squeezy Product does not belong to the configured Store.",
      ],
      [
        "/v1/variants/303",
        { product_id: 999 },
        "Protected Lemon Squeezy Variant does not belong to the configured Product.",
      ],
      [
        "/v1/variants/303",
        { has_license_keys: true },
        "Protected Lemon Squeezy Variant must keep license keys disabled.",
      ],
    ] as const) {
      await expect(
        verifyProtectedLemonSqueezyCatalog({
          expected,
          request: async (requestPath) =>
            responseFor(requestPath, requestPath === path ? attributes : undefined),
        }),
      ).rejects.toThrow(message);
    }
  });
});

function responseFor(path: string, overrides: Record<string, unknown> = {}) {
  if (path === "/v1/stores/101") {
    return { data: { type: "stores", id: "101", attributes: { name: "Ask Siargao Test" } } };
  }
  if (path === "/v1/products/202") {
    return {
      data: {
        type: "products",
        id: "202",
        attributes: { status: "published", store_id: 101, test_mode: true, ...overrides },
      },
    };
  }
  return {
    data: {
      type: "variants",
      id: "303",
      attributes: {
        has_license_keys: false,
        product_id: 202,
        status: "published",
        test_mode: true,
        ...overrides,
      },
    },
  };
}
