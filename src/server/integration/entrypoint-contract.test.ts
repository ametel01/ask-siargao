import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { parseIntegrationEntrypointOptions } from "@/server/integration/entrypoint-shared";

describe("integration entry-point contracts", () => {
  test("package scripts expose dry-run PostgreSQL and Redis lanes", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:integration:postgres"]).toBe(
      "bun run src/server/integration/postgres-entrypoint.ts --dry-run",
    );
    expect(packageJson.scripts["test:integration:redis"]).toBe(
      "bun run src/server/integration/redis-entrypoint.ts --dry-run",
    );
  });

  test("package scripts preserve functional and production-performance E2E lanes", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:e2e"]).toBe("playwright test");
    expect(packageJson.scripts["test:e2e:production-perf"]).toBe(
      "PLAYWRIGHT_PRODUCTION_PERF=1 playwright test",
    );
    expect(packageJson.scripts["verify:ci"]).toContain(
      "bun run build && bun run test:e2e && bun run test:e2e:production-perf",
    );
  });

  test("entry-point argument parsing fails closed instead of silently skipping", () => {
    expect(() => parseIntegrationEntrypointOptions([])).toThrow("--dry-run only");
    expect(() =>
      parseIntegrationEntrypointOptions(["--dry-run"], {
        INTEGRATION_TEST_NAMESPACE: "Bad-Namespace",
      }),
    ).toThrow("INTEGRATION_TEST_NAMESPACE");
    expect(
      parseIntegrationEntrypointOptions([
        "--dry-run",
        "--namespace",
        "issue145",
        "--timeout-ms",
        "1000",
      ]),
    ).toEqual({
      dryRun: true,
      namespace: "issue145",
      timeoutMs: 1_000,
    });
  });

  test("CI defines separate secret-free pinned service job boundaries", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("integration-postgres:");
    expect(workflow).toContain("integration-redis:");
    expect(workflow).toContain("image: postgres:17.6-alpine3.22");
    expect(workflow).toContain("image: redis:8.2.1-alpine3.22");
    expect(workflow).toContain("POSTGRES_PASSWORD: ask_siargao_issue145_password");
    expect(workflow).toContain("- 5432:5432");
    expect(workflow).toContain("- 6379:6379");
    expect(workflow).toContain(
      "DATABASE_URL: postgres://ask_siargao_issue145:ask_siargao_issue145_password@127.0.0.1:5432/ask_siargao_issue145",
    );
    expect(workflow).toContain("REDIS_URL: redis://127.0.0.1:6379/0");
    expect(workflow).toContain('--health-cmd "pg_isready');
    expect(workflow).toContain('--health-cmd "redis-cli ping"');
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("INTEGRATION_TEST_NAMESPACE:");
    expect(workflow).not.toContain("job.services.");
    expect(workflow).not.toContain("5432/tcp");
    expect(workflow).not.toContain("6379/tcp");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("PGLITE");
    expect(workflow).not.toContain("pglite");
  });

  test("CI preserves production performance before isolated artifact uploads", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    const e2eIndex = workflow.indexOf("run: bun run test:e2e");
    const productionPerfIndex = workflow.indexOf("run: bun run test:e2e:production-perf");
    const manifestIndex = workflow.indexOf("run: bun run qa:trip-pass-launch");
    const screenshotUploadIndex = workflow.indexOf("Upload mobile trip context screenshots");

    expect(e2eIndex).toBeGreaterThan(0);
    expect(productionPerfIndex).toBeGreaterThan(e2eIndex);
    expect(manifestIndex).toBeGreaterThan(productionPerfIndex);
    expect(screenshotUploadIndex).toBeGreaterThan(manifestIndex);
  });

  test("Playwright routes only issue #124 production performance by tag and output directory", async () => {
    const [playwrightConfig, chatE2E] = await Promise.all([
      readFile("playwright.config.ts", "utf8"),
      readFile("tests/e2e/chat.e2e.ts", "utf8"),
    ]);

    expect(playwrightConfig).toContain("PLAYWRIGHT_PRODUCTION_PERF === \"1\"");
    expect(playwrightConfig).toContain("grep: isProductionPerformanceRun ? /@production-perf/");
    expect(playwrightConfig).toContain(
      "grepInvert: process.env.CI && !isProductionPerformanceRun ? /@production-perf/",
    );
    expect(playwrightConfig).toContain(
      'outputDir: isProductionPerformanceRun ? "test-results/production-perf" : "test-results"',
    );
    expect(playwrightConfig).toContain("next start --hostname 127.0.0.1 --port 3100");
    expect(playwrightConfig).toContain("bun run dev -- --hostname 127.0.0.1 --port 3100");
    expect(chatE2E.match(/@production-perf/g)?.length).toBe(1);
  });

  test("CI uploads the generated manifest for the checked-out SHA", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain(
      "bun run qa:trip-pass-launch -- --write --foundation-ci-gates-passed",
    );
    expect(workflow).toContain("name: trip-pass-launch-manifest-$" + "{{ github.sha }}");
    expect(workflow).toContain(
      "path: .tmp/trip-pass-launch/trip-pass-launch-manifest-$" + "{{ github.sha }}.json",
    );
    expect(workflow).not.toContain(
      "trip-pass-launch-manifest-${{ github.event.pull_request.head.sha",
    );
  });
});
