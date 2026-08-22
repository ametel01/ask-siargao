import { describe, expect, test } from "bun:test";

import nextConfig, {
  contentSecurityPolicyReportOnly,
  createFieldWorkspaceContentSecurityPolicy,
  fieldWorkspaceContentSecurityPolicy,
} from "./next.config";

describe("mobile rendering performance", () => {
  test("inlines the small Tailwind bundle to remove first-load CSS round trips", () => {
    expect(nextConfig.experimental?.inlineCss).toBe(true);
  });
});

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

  test("enforces an isolated no-store policy on the Field Workspace", async () => {
    const headerRules = await nextConfig.headers?.();
    const fieldRule = headerRules?.find((rule) => rule.source === "/operator/field/:path*");
    const values = Object.fromEntries(
      fieldRule?.headers.map((header) => [header.key.toLowerCase(), header.value]) ?? [],
    );

    expect(values["cache-control"]).toBe("private, no-store");
    expect(values["content-security-policy"]).toBe(fieldWorkspaceContentSecurityPolicy);
    expect(values["permissions-policy"]).toContain("camera=(self)");
    expect(fieldWorkspaceContentSecurityPolicy).toContain("connect-src 'self'");
    expect(fieldWorkspaceContentSecurityPolicy).not.toContain("posthog");
    expect(fieldWorkspaceContentSecurityPolicy).not.toContain("sentry");
    expect(fieldWorkspaceContentSecurityPolicy).not.toContain("api.openai.com");
    expect(createFieldWorkspaceContentSecurityPolicy("development")).toContain("'unsafe-eval'");
    expect(createFieldWorkspaceContentSecurityPolicy("production")).not.toContain("'unsafe-eval'");
  });
});

describe("server output tracing", () => {
  test("ships governed agent memory with the chat route", () => {
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/api/chat": ["./docs/agent-memory/*.md"],
    });
  });
});
