import { describe, expect, test } from "bun:test";

import { siteConfig } from "./site";

describe("siteConfig", () => {
  test("captures the Step 1 product promise", () => {
    expect(siteConfig.name).toBe("Siargao Trip Risk Audit");
    expect(siteConfig.priceUsd).toBe(9.99);
    expect(siteConfig.promise).toContain("pay only when");
  });
});
