import { describe, expect, test } from "bun:test";

import nextConfig, { contentSecurityPolicyReportOnly } from "./next.config";

describe("security response headers", () => {
  test("ships a tested report-only CSP on every application path", async () => {
    expect(nextConfig.headers).toBeDefined();
    const headerRules = await nextConfig.headers?.();
    const globalRule = headerRules?.find((rule) => rule.source === "/:path*");
    const csp = globalRule?.headers.find(
      (header) => header.key.toLowerCase() === "content-security-policy-report-only",
    );

    expect(csp?.value).toBe(contentSecurityPolicyReportOnly);
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src",
      "connect-src",
      "frame-src",
    ]) {
      expect(csp?.value).toContain(directive);
    }
    const wildcardSources = (csp?.value.match(/https:\/\/[^\s;]+/g) ?? []).filter((source) =>
      source.includes("*"),
    );
    for (const source of wildcardSources) {
      expect(source).toMatch(/^https:\/\/\*\.[^*/]+$/);
    }
    expect(csp?.value).not.toContain("unsafe-eval");
  });
});
