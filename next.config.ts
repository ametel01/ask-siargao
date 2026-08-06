import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED: process.env.NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED ?? "1",
  },
  experimental: {
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
    ];
  },
};

export default nextConfig;
