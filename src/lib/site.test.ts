import { describe, expect, test } from "bun:test";

import { siteConfig } from "./site";

describe("siteConfig", () => {
  test("captures the Ask Siargao product promise", () => {
    expect(siteConfig.name).toBe("Ask Siargao");
    expect(siteConfig.contact).toEqual({
      primaryEmail: "hello@asksiargao.com",
      supportEmail: "support@asksiargao.com",
      supportMailto: "mailto:support@asksiargao.com",
    });
    expect(siteConfig.tripPass).toEqual({
      label: "Siargao Trip Pass",
      priceAuthority: "stripe_price",
    });
    expect(siteConfig.promise).toContain("Reality-check Siargao plans on demand");
    expect(siteConfig.promise).toContain("clear evidence limits");
  });
});
