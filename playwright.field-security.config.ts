import { defineConfig, devices } from "@playwright/test";

import { FIELD_SECURITY_HARNESS_COOKIE } from "./src/server/field-security/test-harness";

const harnessToken = "ask-siargao-field-security-production-harness-2026";
const serverEnv = [
  "APP_ENV=local",
  "CLERK_AUTH_MODE=disabled",
  "NEXT_PUBLIC_CLERK_AUTH_MODE=disabled",
  "CLERK_DEPLOYMENT_CONTEXT=local",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=",
  "CLERK_SECRET_KEY=",
  "DATABASE_URL=",
  "REDIS_URL=",
  "PLAYWRIGHT_FIELD_SECURITY_HARNESS=1",
  `PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN=${harnessToken}`,
].join(" ");

export default defineConfig({
  testDir: "./tests/field-security",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  outputDir: "test-results/field-security",
  reporter: "list",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    extraHTTPHeaders: {
      "x-ask-siargao-field-security-harness": "1",
      "x-ask-siargao-field-security-harness-token": harnessToken,
    },
    storageState: {
      cookies: [
        {
          name: FIELD_SECURITY_HARNESS_COOKIE,
          value: harnessToken,
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ],
      origins: [],
    },
    trace: "on-first-retry",
  },
  webServer: {
    command: `${serverEnv} bun run start -- --hostname 127.0.0.1 --port 3100`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3100/",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
