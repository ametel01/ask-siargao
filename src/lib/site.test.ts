import { describe, expect, test } from "bun:test";

import { siteConfig } from "./site";

describe("siteConfig", () => {
  test("captures the Ask Siargao product promise", () => {
    expect(siteConfig.name).toBe("Ask Siargao");
    expect(siteConfig.tripPass).toEqual({
      label: "Siargao Trip Pass",
      priceAuthority: "stripe_price",
    });
    expect(siteConfig.promise).toContain("freshness and confidence");
  });
});
