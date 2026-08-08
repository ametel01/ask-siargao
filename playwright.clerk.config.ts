import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PROVIDER_RC_APP_ORIGIN;
if (!baseURL) throw new Error("PROVIDER_RC_APP_ORIGIN is required for the protected Clerk lane.");

export default defineConfig({
  testDir: "./tests/provider",
  testMatch: "**/*.clerk.e2e.ts",
  fullyParallel: false,
  forbidOnly: true,
  outputDir: "test-results/provider-clerk",
  reporter: "list",
  retries: 1,
  workers: 1,
  use: {
    baseURL,
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
