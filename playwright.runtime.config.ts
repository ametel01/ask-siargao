import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "runtime.e2e.ts",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "bun run tests/fixtures/deepseek-runtime-mock.ts",
      url: "http://127.0.0.1:3210/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "APP_ENV=production REDIS_URL=redis://127.0.0.1:6379/15 TRIP_PASS_ANON_HMAC_KEY=runtime-smoke-anonymous-key TRIP_PASS_IDEMPOTENCY_HMAC_KEY=runtime-smoke-idempotency-key DEEPSEEK_API_KEY=runtime-smoke-key DEEPSEEK_BASE_URL=http://127.0.0.1:3210 OPENAI_API_KEY= NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= bun run dev -- --hostname 127.0.0.1 --port 3200",
      url: "http://127.0.0.1:3200/chat",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "node-runtime",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
