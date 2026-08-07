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
    expect(workflow).toContain('--health-cmd "pg_isready');
    expect(workflow).toContain('--health-cmd "redis-cli ping"');
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("INTEGRATION_TEST_NAMESPACE:");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("PGLITE");
    expect(workflow).not.toContain("pglite");
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
