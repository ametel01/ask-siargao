import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PROVIDER_RC_APP_ORIGIN;
if (!baseURL) throw new Error("PROVIDER_RC_APP_ORIGIN is required for the protected Clerk lane.");
const protectionBypass = process.env.PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET;
if (!protectionBypass) {
  throw new Error(
    "PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET is required for the protected Clerk lane.",
  );
}

export default defineConfig({
  testDir: "./tests/provider",
  testMatch: "**/*.clerk.e2e.ts",
  fullyParallel: false,
  forbidOnly: true,
  outputDir: "test-results/provider-clerk",
  reporter: "list",
  retries: 1,
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true",
    },
    // Protected sessions and testing tokens must never be persisted in CI artifacts.
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "clerk setup",
      testMatch: "**/clerk.global.setup.ts",
    },
    {
      name: "clerk protected chromium",
      dependencies: ["clerk setup"],
      testIgnore: "**/clerk.global.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
