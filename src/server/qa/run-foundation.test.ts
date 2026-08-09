import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
  createIntegrationLifecycleOwner,
  type IntegrationLifecycleOwner,
} from "@/server/integration/entrypoint-shared";
import {
  type CapturedCommandRunner,
  createDockerFoundationServiceRuntime,
  createFoundationRunIdentity,
  type FoundationCommandInput,
  type FoundationCommandRunner,
  type FoundationServiceRuntime,
  runFoundationVerification,
} from "@/server/qa/run-foundation";

describe("complete Foundation Gate orchestration", () => {
  test("prepares both service boundaries before running all ten gates in order", async () => {
    const events: string[] = [];
    const commands: FoundationCommandInput[] = [];
    const runtime = createServiceRuntime(events);

    const exitCode = await runFoundationVerification({
      commandRunner: createCommandRunner(commands, events),
      env: {
        DATABASE_URL: safePostgresUrl,
        REDIS_URL: safeRedisUrl,
      },
      lifecycle: immediateLifecycle,
      log: createLogger(events),
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
      serviceRuntime: runtime,
    });

    expect(exitCode).toBe(0);
    expect(events).toEqual([
      "prepare:postgres:ask_siargao_foundation_11111111222243338444",
      "prepare:redis:ask_siargao_foundation_11111111222243338444",
      "run:bun run verify:foundation:local",
      "run:bun run test:integration:postgres",
      "run:bun run test:integration:redis",
      "cleanup:redis:ask-siargao-foundation-redis-11111111222243338444",
      "cleanup:postgres:ask-siargao-foundation-postgres-11111111222243338444",
      "success:Foundation Gate passed: all ten gates completed.",
    ]);
    expect(commands.map(({ command }) => command)).toEqual([
      ["bun", "run", "verify:foundation:local"],
      ["bun", "run", "test:integration:postgres"],
      ["bun", "run", "test:integration:redis"],
    ]);
    expect(commands[0]?.env).toMatchObject({ DATABASE_URL: "", REDIS_URL: "" });
    expect(commands[1]?.env).toMatchObject({
      DATABASE_URL:
        "postgres://foundation:password@127.0.0.1:45101/ask_siargao_foundation_11111111222243338444",
      INTEGRATION_TEST_NAMESPACE: "ask_siargao_foundation_11111111222243338444",
    });
    expect(commands[2]?.env).toMatchObject({
      INTEGRATION_TEST_NAMESPACE: "ask_siargao_foundation_11111111222243338444",
      REDIS_URL: "redis://127.0.0.1:45102/0",
    });
  });

  test("does not start a downstream lane or emit success while local verification is pending", async () => {
    const local = deferred<number>();
    const commands: string[] = [];
    const events: string[] = [];

    const result = runFoundationVerification({
      commandRunner: {
        async run({ command }) {
          const rendered = command.join(" ");
          commands.push(rendered);
          return rendered.endsWith("verify:foundation:local") ? local.promise : 0;
        },
        async stop() {},
      },
      env: {},
      lifecycle: immediateLifecycle,
      log: createLogger(events),
      randomUUID: () => "21111111-2222-4333-8444-555555555555",
      serviceRuntime: createServiceRuntime([]),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(commands).toEqual(["bun run verify:foundation:local"]);
    expect(events).not.toContain("success:Foundation Gate passed: all ten gates completed.");

    local.resolve(0);
    expect(await result).toBe(0);
    expect(commands).toEqual([
      "bun run verify:foundation:local",
      "bun run test:integration:postgres",
      "bun run test:integration:redis",
    ]);
  });

  test("returns each representative lane failure without starting later work or success", async () => {
    const plan = [
      "bun run verify:foundation:local",
      "bun run test:integration:postgres",
      "bun run test:integration:redis",
    ];

    for (const failedCommand of plan) {
      const commands: string[] = [];
      const events: string[] = [];
      const exitCode = await runFoundationVerification({
        commandRunner: {
          async run({ command }) {
            const rendered = command.join(" ");
            commands.push(rendered);
            return rendered === failedCommand ? 17 : 0;
          },
          async stop() {},
        },
        env: {},
        lifecycle: immediateLifecycle,
        log: createLogger(events),
        randomUUID: () => "31111111-2222-4333-8444-555555555555",
        serviceRuntime: createServiceRuntime([]),
      });

      expect(exitCode).toBe(17);
      expect(commands).toEqual(plan.slice(0, plan.indexOf(failedCommand) + 1));
      expect(events.some((event) => event.startsWith("success:"))).toBe(false);
    }
  });

  test("fails before expensive gates when a service cannot be prepared and redacts credentials", async () => {
    const commands: FoundationCommandInput[] = [];
    const errors: string[] = [];

    const exitCode = await runFoundationVerification({
      commandRunner: createCommandRunner(commands, []),
      env: {
        DATABASE_URL: "postgres://foundation:super-secret@127.0.0.1:5432/foundation_test",
      },
      lifecycle: immediateLifecycle,
      log: {
        error(message) {
          errors.push(message);
        },
        success() {},
      },
      randomUUID: () => "41111111-2222-4333-8444-555555555555",
      serviceRuntime: {
        async prepare(input) {
          throw new Error(`could not connect to ${input.explicitUrl}`);
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(commands).toEqual([]);
    expect(errors.join("\n")).not.toContain("super-secret");
    expect(errors.join("\n")).toContain("<redacted service URL>");
  });

  test("allocates distinct concurrent ownership identities", () => {
    const first = createFoundationRunIdentity(() => "aaaaaaaa-1111-4111-8111-111111111111");
    const second = createFoundationRunIdentity(() => "bbbbbbbb-2222-4222-8222-222222222222");

    expect(first.namespace).not.toBe(second.namespace);
    expect(first.postgres.containerName).not.toBe(second.postgres.containerName);
    expect(first.postgres.databaseName).not.toBe(second.postgres.databaseName);
    expect(first.redis.containerName).not.toBe(second.redis.containerName);
    expect(first.redis.keyPrefix).not.toBe(second.redis.keyPrefix);
  });

  test("concurrent runs use distinct service resources and clean up only their owner", async () => {
    const firstGate = deferred<number>();
    const secondGate = deferred<number>();
    const active = new Set<string>();
    const prepared: Array<{
      container: string;
      database: string;
      keyPrefix: string;
      namespace: string;
      port: number;
    }> = [];
    let nextPort = 46_000;
    const serviceRuntime: FoundationServiceRuntime = {
      async prepare(input) {
        const port = nextPort;
        nextPort += 1;
        active.add(input.containerName);
        prepared.push({
          container: input.containerName,
          database: input.identity.postgres.databaseName,
          keyPrefix: input.identity.redis.keyPrefix,
          namespace: input.identity.namespace,
          port,
        });
        input.owner.deferCleanup(async () => {
          active.delete(input.containerName);
        });
        return {
          url:
            input.kind === "postgres"
              ? `postgres://foundation:password@127.0.0.1:${port}/${input.identity.postgres.databaseName}`
              : `redis://127.0.0.1:${port}/0`,
        };
      },
    };
    const createRunner = (gate: ReturnType<typeof deferred<number>>): FoundationCommandRunner => ({
      async run({ command }) {
        return command.includes("verify:foundation:local") ? gate.promise : 0;
      },
      async stop() {},
    });

    const first = runFoundationVerification({
      commandRunner: createRunner(firstGate),
      env: {},
      lifecycle: immediateLifecycle,
      log: createLogger([]),
      randomUUID: () => "aaaaaaaa-1111-4111-8111-111111111111",
      serviceRuntime,
    });
    const second = runFoundationVerification({
      commandRunner: createRunner(secondGate),
      env: {},
      lifecycle: immediateLifecycle,
      log: createLogger([]),
      randomUUID: () => "bbbbbbbb-2222-4222-8222-222222222222",
      serviceRuntime,
    });

    await until(() => prepared.length === 4);
    expect(new Set(prepared.map(({ container }) => container)).size).toBe(4);
    expect(new Set(prepared.map(({ port }) => port)).size).toBe(4);
    expect(new Set(prepared.map(({ namespace }) => namespace)).size).toBe(2);
    expect(new Set(prepared.map(({ database }) => database)).size).toBe(2);
    expect(new Set(prepared.map(({ keyPrefix }) => keyPrefix)).size).toBe(2);

    firstGate.resolve(0);
    expect(await first).toBe(0);
    expect(active).toEqual(
      new Set([
        "ask-siargao-foundation-postgres-bbbbbbbb222242228222",
        "ask-siargao-foundation-redis-bbbbbbbb222242228222",
      ]),
    );

    secondGate.resolve(0);
    expect(await second).toBe(0);
    expect(active.size).toBe(0);
  });

  test("uses safe explicit services without Docker", async () => {
    const dockerCommands: string[][] = [];
    const probes: string[] = [];
    const identity = createFoundationRunIdentity(() => "61111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run(command) {
          dockerCommands.push([...command]);
          return { exitCode: 0, stderr: "", stdout: "unexpected" };
        },
      },
      async probeService(kind, url) {
        probes.push(`${kind}:${url}`);
      },
    });

    const result = await immediateLifecycle((owner) =>
      runtime.prepare({
        containerName: identity.postgres.containerName,
        env: {},
        explicitUrl: "postgres://foundation:password@127.0.0.1:5432/foundation_test",
        identity,
        kind: "postgres",
        owner,
      }),
    );

    expect(result.url).toContain("foundation_test");
    expect(probes).toEqual([
      "postgres:postgres://foundation:password@127.0.0.1:5432/foundation_test",
    ]);
    expect(dockerCommands).toEqual([]);
  });

  test("falls back to an owned container when a safe explicit service is unavailable", async () => {
    const commands: string[][] = [];
    const probes: string[] = [];
    const identity = createFoundationRunIdentity(() => "a1111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      createPassword: () => "disposable-password",
      docker: {
        async run(command) {
          const rendered = [...command];
          commands.push(rendered);
          if (rendered[1] === "version") {
            return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
          }
          if (rendered[1] === "port") {
            return { exitCode: 0, stderr: "", stdout: "127.0.0.1:47003\n" };
          }
          if (rendered[1] === "inspect") {
            return { exitCode: 0, stderr: "", stdout: `${identity.namespace}\n` };
          }
          return { exitCode: 0, stderr: "", stdout: "owned-container-id\n" };
        },
      },
      async probeService(_kind, url) {
        probes.push(url);
        if (url.includes(":5432/")) {
          throw new Error("configured service unavailable");
        }
      },
    });

    const result = await immediateLifecycle((owner) =>
      runtime.prepare({
        containerName: identity.postgres.containerName,
        env: {},
        explicitUrl: safePostgresUrl,
        identity,
        kind: "postgres",
        owner,
      }),
    );

    expect(result.url).toContain("127.0.0.1:47003");
    expect(probes).toHaveLength(2);
    expect(commands.some((command) => command[1] === "run")).toBe(true);
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.postgres.containerName]);
  });

  test("provisions pinned containers with dynamic ports and exact-name cleanup", async () => {
    const commands: string[][] = [];
    const probes: string[] = [];
    const docker: CapturedCommandRunner = {
      async run(command) {
        const rendered = [...command];
        commands.push(rendered);
        if (rendered[1] === "version") {
          return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
        }
        if (rendered[1] === "port") {
          const port = rendered[3] === "5432/tcp" ? 47_001 : 47_002;
          return { exitCode: 0, stderr: "", stdout: `127.0.0.1:${port}\n` };
        }
        if (rendered[1] === "inspect") {
          return { exitCode: 0, stderr: "", stdout: `${identity.namespace}\n` };
        }
        return { exitCode: 0, stderr: "", stdout: "owned-container-id\n" };
      },
    };
    const identity = createFoundationRunIdentity(() => "71111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      createPassword: () => "disposable-password",
      docker,
      async probeService(kind, url) {
        probes.push(`${kind}:${url}`);
      },
    });

    const urls = await immediateLifecycle(async (owner) => {
      const postgres = await runtime.prepare({
        containerName: identity.postgres.containerName,
        env: {},
        explicitUrl: undefined,
        identity,
        kind: "postgres",
        owner,
      });
      const redis = await runtime.prepare({
        containerName: identity.redis.containerName,
        env: {},
        explicitUrl: undefined,
        identity,
        kind: "redis",
        owner,
      });
      return { postgres: postgres.url, redis: redis.url };
    });

    expect(urls).toEqual({
      postgres:
        "postgres://foundation:disposable-password@127.0.0.1:47001/ask_siargao_foundation_71111111222243338444",
      redis: "redis://127.0.0.1:47002/0",
    });
    expect(probes).toEqual([`postgres:${urls.postgres}`, `redis:${urls.redis}`]);
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.postgres.containerName]);
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.redis.containerName]);
    const postgresRun = commands.find(
      (command) => command[1] === "run" && command.includes(postgresImageForTest),
    );
    const redisRun = commands.find(
      (command) => command[1] === "run" && command.includes(redisImageForTest),
    );
    expect(postgresRun).toContain("127.0.0.1::5432");
    expect(redisRun).toContain("127.0.0.1::6379");
    expect(postgresRun).toContain(`com.ask-siargao.foundation-owner=${identity.namespace}`);
    expect(redisRun).toContain(`com.ask-siargao.foundation-owner=${identity.namespace}`);
  });

  test("cleanup waits for in-flight container creation and removes the owned container", async () => {
    const containerStart = deferred<{
      exitCode: number;
      stderr: string;
      stdout: string;
    }>();
    const commands: string[][] = [];
    const identity = createFoundationRunIdentity(() => "b1111111-2222-4333-8444-555555555555");
    const owner = createIntegrationLifecycleOwner();
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run(command) {
          const rendered = [...command];
          commands.push(rendered);
          if (rendered[1] === "version") {
            return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
          }
          if (rendered[1] === "run") {
            return containerStart.promise;
          }
          if (rendered[1] === "port") {
            return { exitCode: 0, stderr: "", stdout: "127.0.0.1:47004\n" };
          }
          if (rendered[1] === "inspect") {
            return { exitCode: 0, stderr: "", stdout: `${identity.namespace}\n` };
          }
          return { exitCode: 0, stderr: "", stdout: "" };
        },
      },
      async probeService() {},
    });

    const preparation = runtime.prepare({
      containerName: identity.redis.containerName,
      env: {},
      explicitUrl: undefined,
      identity,
      kind: "redis",
      owner,
    });
    await until(() => commands.some((command) => command[1] === "run"));

    const cleanup = owner.cleanup("SIGTERM");
    await Promise.resolve();
    expect(commands.some((command) => command[1] === "rm")).toBe(false);

    containerStart.resolve({ exitCode: 0, stderr: "", stdout: "owned-container-id\n" });
    await cleanup;
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.redis.containerName]);
    await preparation;
  });

  test("signal cleanup stops a stuck Docker client before awaiting container creation", async () => {
    const containerStart = deferred<{
      exitCode: number;
      stderr: string;
      stdout: string;
    }>();
    const stops: Array<string | undefined> = [];
    const commands: string[][] = [];
    let startSeen = false;
    const identity = createFoundationRunIdentity(() => "c1111111-2222-4333-8444-555555555555");
    const owner = createIntegrationLifecycleOwner();
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run(command) {
          const rendered = [...command];
          commands.push(rendered);
          if (rendered[1] === "version") {
            return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
          }
          if (rendered[1] === "inspect") {
            return { exitCode: 0, stderr: "", stdout: `${identity.namespace}\n` };
          }
          if (rendered[1] === "rm") {
            return { exitCode: 0, stderr: "", stdout: "" };
          }
          startSeen = true;
          return containerStart.promise;
        },
        async stop(signal) {
          stops.push(signal);
          containerStart.resolve({ exitCode: 143, stderr: "terminated", stdout: "" });
        },
      },
      async probeService() {},
    });

    const preparation = runtime.prepare({
      containerName: identity.redis.containerName,
      env: {},
      explicitUrl: undefined,
      identity,
      kind: "redis",
      owner,
    });
    await until(() => startSeen);

    await owner.cleanup("SIGTERM");
    expect(stops).toEqual(["SIGTERM"]);
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.redis.containerName]);
    await expect(preparation).rejects.toThrow("Docker could not start the pinned Redis service");
  });

  test("failed container startup still removes a container labeled for the current run", async () => {
    const commands: string[][] = [];
    const identity = createFoundationRunIdentity(() => "d1111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run(command) {
          const rendered = [...command];
          commands.push(rendered);
          if (rendered[1] === "version") {
            return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
          }
          if (rendered[1] === "inspect") {
            return { exitCode: 0, stderr: "", stdout: `${identity.namespace}\n` };
          }
          if (rendered[1] === "rm") {
            return { exitCode: 0, stderr: "", stdout: "" };
          }
          return { exitCode: 1, stderr: "start failed", stdout: "" };
        },
      },
      async probeService() {},
    });

    await expect(
      immediateLifecycle((owner) =>
        runtime.prepare({
          containerName: identity.postgres.containerName,
          env: {},
          explicitUrl: undefined,
          identity,
          kind: "postgres",
          owner,
        }),
      ),
    ).rejects.toThrow("Docker could not start the pinned PostgreSQL service");
    expect(commands).toContainEqual(["docker", "rm", "--force", identity.postgres.containerName]);
  });

  test("never removes a same-name container with a different ownership label", async () => {
    const commands: string[][] = [];
    const identity = createFoundationRunIdentity(() => "e1111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run(command) {
          const rendered = [...command];
          commands.push(rendered);
          if (rendered[1] === "version") {
            return { exitCode: 0, stderr: "", stdout: "29.3.1\n" };
          }
          if (rendered[1] === "inspect") {
            return { exitCode: 0, stderr: "", stdout: "different-foundation-run\n" };
          }
          return { exitCode: 1, stderr: "name conflict", stdout: "" };
        },
      },
      async probeService() {},
    });

    await expect(
      immediateLifecycle((owner) =>
        runtime.prepare({
          containerName: identity.redis.containerName,
          env: {},
          explicitUrl: undefined,
          identity,
          kind: "redis",
          owner,
        }),
      ),
    ).rejects.toThrow("without the run ownership label");
    expect(commands.some((command) => command[1] === "rm")).toBe(false);
  });

  test("fails actionably when Docker cannot provision a missing service", async () => {
    const identity = createFoundationRunIdentity(() => "91111111-2222-4333-8444-555555555555");
    const runtime = createDockerFoundationServiceRuntime({
      docker: {
        async run() {
          return { exitCode: 1, stderr: "daemon unavailable", stdout: "" };
        },
      },
    });

    await expect(
      immediateLifecycle((owner) =>
        runtime.prepare({
          containerName: identity.redis.containerName,
          env: {},
          explicitUrl: undefined,
          identity,
          kind: "redis",
          owner,
        }),
      ),
    ).rejects.toThrow("Start the Docker daemon or configure safe DATABASE_URL and REDIS_URL");
  });

  test("does not emit success when owned cleanup fails", async () => {
    const events: string[] = [];
    const exitCode = await runFoundationVerification({
      commandRunner: createCommandRunner([], events),
      env: {},
      lifecycle: immediateLifecycle,
      log: createLogger(events),
      randomUUID: () => "81111111-2222-4333-8444-555555555555",
      serviceRuntime: {
        async prepare(input) {
          input.owner.deferCleanup(async () => {
            throw new Error("owned cleanup failed");
          });
          return { url: input.kind === "postgres" ? safePostgresUrl : safeRedisUrl };
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(events).toContain("error:Foundation Gate failed: owned cleanup failed");
    expect(events.some((event) => event.startsWith("success:"))).toBe(false);
  });

  test("forwards termination to the active command and cleans only owned services", async () => {
    const processLike = new EventEmitter() as EventEmitter & {
      exit(code?: number): void;
    };
    const local = deferred<number>();
    const events: string[] = [];
    const exited = deferred<number | undefined>();
    processLike.exit = (code?: number) => {
      events.push(`exit:${code}`);
      exited.resolve(code);
    };

    const verification = runFoundationVerification({
      commandRunner: {
        async run() {
          events.push("run:local");
          return local.promise;
        },
        async stop(signal) {
          events.push(`stop:${signal}`);
          local.resolve(signal === "SIGINT" ? 130 : 143);
        },
      },
      env: {},
      lifecycleProcess: processLike,
      log: createLogger(events),
      randomUUID: () => "51111111-2222-4333-8444-555555555555",
      serviceRuntime: createServiceRuntime(events),
    });

    await until(() => events.includes("run:local"));
    processLike.emit("SIGINT");

    expect(await exited.promise).toBe(130);
    expect(await verification).toBe(130);
    expect(events).toContain("stop:SIGINT");
    expect(events).toContain(
      "cleanup:postgres:ask-siargao-foundation-postgres-51111111222243338444",
    );
    expect(events).toContain("cleanup:redis:ask-siargao-foundation-redis-51111111222243338444");
    expect(events.some((event) => event.startsWith("success:"))).toBe(false);
  });
});

function createServiceRuntime(events: string[]): FoundationServiceRuntime {
  return {
    async prepare(input) {
      events.push(`prepare:${input.kind}:${input.identity.namespace}`);
      input.owner.deferCleanup(async () => {
        events.push(`cleanup:${input.kind}:${input.containerName}`);
      });
      return {
        url:
          input.kind === "postgres"
            ? `postgres://foundation:password@127.0.0.1:45101/${input.identity.postgres.databaseName}`
            : "redis://127.0.0.1:45102/0",
      };
    },
  };
}

function createCommandRunner(
  commands: FoundationCommandInput[],
  events: string[],
): FoundationCommandRunner {
  return {
    async run(input) {
      commands.push(input);
      events.push(`run:${input.command.join(" ")}`);
      return 0;
    },
    async stop() {},
  };
}

function createLogger(events: string[]) {
  return {
    error(message: string) {
      events.push(`error:${message}`);
    },
    success(message: string) {
      events.push(`success:${message}`);
    },
  };
}

async function immediateLifecycle<T>(work: (owner: IntegrationLifecycleOwner) => Promise<T>) {
  const cleanups: Parameters<IntegrationLifecycleOwner["deferCleanup"]>[0][] = [];
  const owner = {
    async cleanup() {
      for (const cleanup of cleanups.reverse()) await cleanup();
    },
    deferCleanup(cleanup: Parameters<IntegrationLifecycleOwner["deferCleanup"]>[0]) {
      cleanups.push(cleanup);
    },
  };
  try {
    return await work(owner);
  } finally {
    await owner.cleanup();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for test condition.");
}

const postgresImageForTest = "postgres:17.6-alpine3.22";
const redisImageForTest = "redis:8.2.1-alpine3.22";
const safePostgresUrl = "postgres://foundation:password@127.0.0.1:5432/foundation_test";
const safeRedisUrl = "redis://127.0.0.1:6379/0";
