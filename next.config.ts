import type { NextConfig } from "next";

export const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://clerk.asksiargao.com https://challenges.cloudflare.com https://static.cloudflareinsights.com https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk.asksiargao.com https://api.deepseek.com https://api.openai.com https://*.posthog.com https://us.i.posthog.com https://*.ingest.sentry.io",
  "frame-src https://*.clerk.accounts.dev https://clerk.asksiargao.com https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
].join("; ");

export function createFieldWorkspaceContentSecurityPolicy(nodeEnv = process.env.NODE_ENV) {
  const developmentScriptSource = nodeEnv === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${developmentScriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
  ].join("; ");
}

export const fieldWorkspaceContentSecurityPolicy = createFieldWorkspaceContentSecurityPolicy();

const nextConfig: NextConfig = {
  devIndicators: false,
  env: {
    NEXT_PUBLIC_FIELD_CACHE_GENERATION:
      process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      "local",
    NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED: process.env.NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED ?? "1",
  },
  experimental: {
    inlineCss: true,
    useTypeScriptCli: true,
  },
  // The chat runtime reads governed Markdown through fs at request time. The
  // dynamic manifest iteration is not discoverable by Next.js output tracing,
  // so include only that route's required memory directory explicitly.
  outputFileTracingIncludes: {
    "/api/chat": ["./docs/agent-memory/*.md"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "content-security-policy-report-only",
            value: contentSecurityPolicyReportOnly,
          },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "DENY" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          {
            key: "permissions-policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=()",
          },
        ],
      },
      {
        source: "/audits/:path*",
        headers: [{ key: "x-robots-tag", value: "noindex, nofollow" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "x-robots-tag", value: "noindex, nofollow" }],
      },
      {
        source: "/operator/field/:path*",
        headers: [
          { key: "cache-control", value: "private, no-store" },
          { key: "content-security-policy", value: fieldWorkspaceContentSecurityPolicy },
          {
            key: "permissions-policy",
            value: "camera=(self), microphone=(self), geolocation=(self), payment=()",
          },
          { key: "referrer-policy", value: "no-referrer" },
          { key: "x-robots-tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/operator/field/:path*",
        headers: [
          { key: "cache-control", value: "private, no-store" },
          { key: "content-security-policy", value: fieldWorkspaceContentSecurityPolicy },
          { key: "x-robots-tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/field-service-worker",
        headers: [
          { key: "cache-control", value: "no-cache, no-store, must-revalidate" },
          { key: "service-worker-allowed", value: "/" },
          { key: "x-robots-tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
