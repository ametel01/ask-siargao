import { defineConfig, devices } from "@playwright/test";

import {
  modelProviderConsentCookieName,
  modelProviderConsentVersion,
} from "./src/lib/model-provider-consent";

const baseServerEnv =
  "CLERK_AUTH_MODE=disabled NEXT_PUBLIC_CLERK_AUTH_MODE=disabled CLERK_DEPLOYMENT_CONTEXT=local NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= DATABASE_URL= REDIS_URL= NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED=true";
const protectedUiHarnessEnv =
  "PLAYWRIGHT_PROTECTED_UI_HARNESS=1 PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN=ask-siargao-playwright-protected-ui-harness-token-2026";
const isProductionPerformanceRun = process.env.PLAYWRIGHT_PRODUCTION_PERF === "1";
const serverEnv = isProductionPerformanceRun
  ? `APP_ENV=local ${baseServerEnv}`
  : `${baseServerEnv} ${protectedUiHarnessEnv}`;
const serverCommand = isProductionPerformanceRun
  ? `${serverEnv} bun run start -- --hostname 127.0.0.1 --port 3100`
  : `${serverEnv} bun run dev -- --webpack --hostname 127.0.0.1 --port 3100`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  grep: isProductionPerformanceRun ? /@production-perf/ : undefined,
  grepInvert: !isProductionPerformanceRun ? /@production-perf/ : undefined,
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: isProductionPerformanceRun ? "test-results/production-perf" : "test-results",
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    storageState: {
      cookies: [
        {
          domain: "localhost",
          expires: -1,
          httpOnly: false,
          name: modelProviderConsentCookieName,
          path: "/",
          sameSite: "Lax",
          secure: false,
          value: modelProviderConsentVersion,
        },
      ],
      origins: [],
    },
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
