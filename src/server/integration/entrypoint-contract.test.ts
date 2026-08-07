import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import {
  assertSafeIntegrationServiceUrl,
  attachIntegrationSignalHandlers,
  createIntegrationLifecycleOwner,
  parseIntegrationEntrypointOptions,
  runWithIntegrationLifecycle,
} from "@/server/integration/entrypoint-shared";
import { parsePostgresHarnessOptions } from "@/server/integration/postgres-harness";
import { parseRedisHarnessOptions } from "@/server/integration/redis-harness";

describe("integration entry-point contracts", () => {
  test("package scripts expose semantic PostgreSQL and Redis lanes", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:integration:postgres"]).toBe(
      "bun run src/server/integration/postgres-entrypoint.ts",
    );
    expect(packageJson.scripts["test:integration:redis"]).toBe(
      "bun run src/server/integration/redis-entrypoint.ts",
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

  test("entry-point argument parsing fails closed on unsafe options", () => {
    expect(parseIntegrationEntrypointOptions([])).toEqual({
      dryRun: false,
      namespace: "ask_siargao_issue150_local",
      timeoutMs: 5_000,
    });
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

  test("real service harnesses refuse production-looking targets", () => {
    expect(() =>
      assertSafeIntegrationServiceUrl({
        name: "DATABASE_URL",
        requiredText: ["test", "integration", "issue", "local", "ci"],
        url: "postgres://app:secret@db.internal.example.com/production",
      }),
    ).toThrow("localhost");
    expect(() =>
      assertSafeIntegrationServiceUrl({
        allowRemote: true,
        name: "REDIS_URL",
        requiredText: ["test", "integration", "issue", "local", "ci"],
        url: "rediss://redis.internal.example.com/0",
      }),
    ).toThrow("production-looking");

    expect(() =>
      parsePostgresHarnessOptions([], {
        DATABASE_URL: "postgres://issue150:pw@127.0.0.1:5432/issue150_test",
        INTEGRATION_TEST_NAMESPACE: "issue150",
      }),
    ).not.toThrow();
    expect(() =>
      parseRedisHarnessOptions([], {
        INTEGRATION_TEST_NAMESPACE: "issue150",
        REDIS_URL: "redis://127.0.0.1:6379/0",
      }),
    ).not.toThrow();
    expect(() =>
      parseRedisHarnessOptions([], {
        INTEGRATION_TEST_ALLOW_REMOTE: "1",
        INTEGRATION_TEST_NAMESPACE: "issue150",
        REDIS_URL: "redis://production.example/0",
      }),
    ).toThrow("production-looking");
    expect(() =>
      parseRedisHarnessOptions([], {
        INTEGRATION_TEST_ALLOW_REMOTE: "1",
        INTEGRATION_TEST_NAMESPACE: "issue150",
        REDIS_URL: "redis://redis.integration.example/0",
      }),
    ).not.toThrow();
  });

  test("real service suites expose reusable helpers and scoped cleanup", async () => {
    const [postgresHarness, redisHarness, postgresEntrypoint, redisEntrypoint] = await Promise.all([
      readFile("src/server/integration/postgres-harness.ts", "utf8"),
      readFile("src/server/integration/redis-harness.ts", "utf8"),
      readFile("src/server/integration/postgres-entrypoint.ts", "utf8"),
      readFile("src/server/integration/redis-entrypoint.ts", "utf8"),
    ]);

    expect(postgresHarness).toContain("export async function withRealPostgresHarness");
    expect(postgresHarness).toContain("create database");
    expect(postgresHarness).toContain("drop database if exists");
    expect(postgresHarness).toContain("runLedgerBackedMigrations");
    expect(postgresHarness).toContain("pg_terminate_backend");
    expect(postgresEntrypoint).toContain("pg_advisory_xact_lock");
    expect(postgresEntrypoint).toContain("pg_stat_activity");

    expect(redisHarness).toContain("export async function withRealRedisHarness");
    expect(redisHarness).toContain('"SCAN"');
    expect(redisHarness).toContain('"DEL"');
    expect(redisHarness).toContain('"MATCH"');
    expect(redisHarness).toContain("keyPrefix");
    expect(redisHarness).not.toContain("FLUSHALL");
    expect(redisHarness).not.toContain("flushAll");
    expect(redisEntrypoint).toContain("openChatUsageSession");
    expect(redisEntrypoint).toContain("stripeWebhookResponse");
    expect(redisEntrypoint).toContain('import { POST } from "@/app/api/stripe/webhook/route"');
    expect(redisEntrypoint).toContain("withStripeWebhookRouteDependenciesForTest");
    expect(redisEntrypoint).toContain("checkout.session.completed");
  });

  test("integration lifecycle owner tears down scoped resources before signal exit", async () => {
    const owner = createIntegrationLifecycleOwner();
    const processLike = new EventEmitter() as EventEmitter & {
      exitCode?: number;
      exit(code?: number): void;
    };
    const events: string[] = [];
    const exited = new Promise<void>((resolve) => {
      processLike.exit = (code?: number) => {
        processLike.exitCode = code;
        events.push(`exit:${code}`);
        resolve();
      };
    });
    owner.deferCleanup(async () => {
      events.push("cleanup");
    });

    const detach = attachIntegrationSignalHandlers(owner, processLike);
    processLike.emit("SIGTERM", "SIGTERM");
    await exited;
    detach();

    expect(events).toEqual(["cleanup", "exit:143"]);
    await owner.cleanup();
    expect(events).toEqual(["cleanup", "exit:143"]);
  });

  test("integration lifecycle signal handler waits for every concurrent owner before exit", async () => {
    const firstOwner = createIntegrationLifecycleOwner();
    const secondOwner = createIntegrationLifecycleOwner();
    const firstCleanup = deferred<void>();
    const secondCleanup = deferred<void>();
    const processLike = new EventEmitter() as EventEmitter & {
      exitCode?: number;
      exit(code?: number): void;
    };
    const events: string[] = [];
    const exited = new Promise<void>((resolve) => {
      processLike.exit = (code?: number) => {
        processLike.exitCode = code;
        events.push(`exit:${code}`);
        resolve();
      };
    });

    firstOwner.deferCleanup(async () => {
      events.push("first:start");
      await firstCleanup.promise;
      events.push("first:end");
    });
    secondOwner.deferCleanup(async () => {
      events.push("second:start");
      await secondCleanup.promise;
      events.push("second:end");
    });

    const detachFirst = attachIntegrationSignalHandlers(firstOwner, processLike);
    const detachSecond = attachIntegrationSignalHandlers(secondOwner, processLike);
    expect(processLike.listenerCount("SIGTERM")).toBe(1);

    processLike.emit("SIGTERM", "SIGTERM");
    await Promise.resolve();
    expect(events).toEqual(["first:start", "second:start"]);

    firstCleanup.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start", "second:start", "first:end"]);

    secondCleanup.resolve();
    await exited;
    detachFirst();
    detachSecond();

    expect(events).toEqual(["first:start", "second:start", "first:end", "second:end", "exit:143"]);
    expect(processLike.listenerCount("SIGTERM")).toBe(0);
    await firstOwner.cleanup();
    await secondOwner.cleanup();
  });

  test("integration lifecycle normal cleanup detaches signal handlers after async cleanup", async () => {
    const cleanup = deferred<void>();
    const cleanupStarted = deferred<void>();
    const processLike = new EventEmitter() as EventEmitter & {
      exit(code?: number): void;
    };
    const events: string[] = [];
    processLike.exit = (code?: number) => {
      events.push(`exit:${code}`);
    };

    const lifecycle = runWithIntegrationLifecycle(
      async (owner) => {
        owner.deferCleanup(async () => {
          events.push("cleanup:start");
          cleanupStarted.resolve();
          await cleanup.promise;
          events.push("cleanup:end");
        });
      },
      { process: processLike },
    );

    await cleanupStarted.promise;
    expect(processLike.listenerCount("SIGTERM")).toBe(1);
    expect(events).toEqual(["cleanup:start"]);

    cleanup.resolve();
    await lifecycle;

    expect(events).toEqual(["cleanup:start", "cleanup:end"]);
    expect(processLike.listenerCount("SIGTERM")).toBe(0);
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
    expect(workflow).toContain("timeout-minutes: 15");
    expect(workflow).toContain("INTEGRATION_TEST_NAMESPACE:");
    expect(workflow).not.toContain("job.services.");
    expect(workflow).not.toContain("5432/tcp");
    expect(workflow).not.toContain("6379/tcp");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("PGLITE");
    expect(workflow).not.toContain("pglite");
    expect(workflow).toContain("Real PostgreSQL semantic integration suite");
    expect(workflow).toContain("Real Redis semantic integration suite");
  });

  test("CI preserves production performance before isolated release artifacts", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const releaseGateJob = extractWorkflowJob(workflow, "release-gate");

    const e2eIndex = releaseGateJob.indexOf("run: bun run test:e2e");
    const productionPerfIndex = releaseGateJob.indexOf("run: bun run test:e2e:production-perf");
    const screenshotUploadIndex = releaseGateJob.indexOf("Upload mobile trip context screenshots");

    expect(e2eIndex).toBeGreaterThan(0);
    expect(productionPerfIndex).toBeGreaterThan(e2eIndex);
    expect(screenshotUploadIndex).toBeGreaterThan(productionPerfIndex);
    expect(releaseGateJob).not.toContain("run: bun run qa:trip-pass-launch");
  });

  test("CI starts launch manifest evidence only after release and integration jobs pass", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const manifestJob = extractWorkflowJob(workflow, "trip-pass-launch-manifest");

    const needsIndex = manifestJob.indexOf("needs:");
    const releaseGateNeedIndex = manifestJob.indexOf("- release-gate");
    const postgresNeedIndex = manifestJob.indexOf("- integration-postgres");
    const redisNeedIndex = manifestJob.indexOf("- integration-redis");
    const manifestGenerateIndex = manifestJob.indexOf("run: bun run qa:trip-pass-launch");

    expect(needsIndex).toBeGreaterThan(0);
    expect(releaseGateNeedIndex).toBeGreaterThan(needsIndex);
    expect(postgresNeedIndex).toBeGreaterThan(needsIndex);
    expect(redisNeedIndex).toBeGreaterThan(needsIndex);
    expect(manifestGenerateIndex).toBeGreaterThan(redisNeedIndex);
  });

  test("Playwright routes only issue #124 production performance by tag and output directory", async () => {
    const [playwrightConfig, chatE2E] = await Promise.all([
      readFile("playwright.config.ts", "utf8"),
      readFile("tests/e2e/chat.e2e.ts", "utf8"),
    ]);

    expect(playwrightConfig).toContain('PLAYWRIGHT_PRODUCTION_PERF === "1"');
    expect(playwrightConfig).toContain("grep: isProductionPerformanceRun ? /@production-perf/");
    expect(playwrightConfig).toContain(
      "grepInvert: process.env.CI && !isProductionPerformanceRun ? /@production-perf/",
    );
    expect(playwrightConfig).toContain(
      'outputDir: isProductionPerformanceRun ? "test-results/production-perf" : "test-results"',
    );
    expect(playwrightConfig).toContain("bun run start -- --hostname 127.0.0.1 --port 3100");
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

function extractWorkflowJob(workflow: string, jobName: string) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThan(0);

  const rest = workflow.slice(start + marker.length);
  const nextJobMatch = /\n {2}[a-z0-9-]+:\n/.exec(rest);
  return workflow.slice(
    start,
    nextJobMatch ? start + marker.length + nextJobMatch.index : undefined,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
