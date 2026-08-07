import { defineConfig, devices } from "@playwright/test";

const serverEnv =
  "CLERK_AUTH_MODE=disabled NEXT_PUBLIC_CLERK_AUTH_MODE=disabled CLERK_DEPLOYMENT_CONTEXT=local PLAYWRIGHT_PROTECTED_UI_HARNESS=1 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY=";
const isProductionPerformanceRun = process.env.PLAYWRIGHT_PRODUCTION_PERF === "1";
const serverCommand = isProductionPerformanceRun
  ? `${serverEnv} bun run start -- --hostname 127.0.0.1 --port 3100`
  : `${serverEnv} bun run dev -- --hostname 127.0.0.1 --port 3100`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  grep: isProductionPerformanceRun ? /@production-perf/ : undefined,
  grepInvert: process.env.CI && !isProductionPerformanceRun ? /@production-perf/ : undefined,
  outputDir: isProductionPerformanceRun ? "test-results/production-perf" : "test-results",
  reporter: "list",
  workers: isProductionPerformanceRun ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: serverCommand,
    url: "http://127.0.0.1:3100/robots.txt",
    reuseExistingServer: !process.env.CI && !isProductionPerformanceRun,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
