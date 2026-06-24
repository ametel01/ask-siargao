import { describe, expect, test } from "bun:test";

import { siteConfig } from "./site";

describe("siteConfig", () => {
  test("captures the Ask Siargao product promise", () => {
    expect(siteConfig.name).toBe("Ask Siargao");
    expect(siteConfig.priceUsd).toBe(14.99);
    expect(siteConfig.promise).toContain("freshness and confidence");
  });
});
