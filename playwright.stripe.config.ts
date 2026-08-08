import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PROVIDER_RC_APP_ORIGIN;
if (!baseURL) throw new Error("PROVIDER_RC_APP_ORIGIN is required for the protected Stripe lane.");

export default defineConfig({
  testDir: "./tests/provider",
  testMatch: "**/*.stripe.e2e.ts",
  fullyParallel: false,
  forbidOnly: true,
  outputDir: "test-results/provider-stripe",
  reporter: "list",
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    { name: "stripe setup", testMatch: "**/stripe.global.setup.ts" },
    {
      name: "stripe protected chromium",
      dependencies: ["stripe setup"],
      testIgnore: "**/stripe.global.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
