import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createClient } from "redis";

import {
  assertSafeIntegrationServiceUrl,
  disposableIntegrationServiceMarkers,
  type IntegrationLifecycleOwner,
  type IntegrationProcess,
  type IntegrationSignal,
  runWithIntegrationLifecycle,
  withTimeout,
} from "@/server/integration/entrypoint-shared";

const postgresImage = "postgres:17.6-alpine3.22";
const redisImage = "redis:8.2.1-alpine3.22";
const dockerOwnerLabel = "com.ask-siargao.foundation-owner";
const explicitServiceReadyTimeoutMs = 5_000;
const serviceReadyTimeoutMs = 30_000;

type FoundationServiceKind = "postgres" | "redis";

export type FoundationRunIdentity = {
  readonly namespace: string;
  readonly postgres: {
    readonly containerName: string;
    readonly databaseName: string;
  };
  readonly redis: {
    readonly containerName: string;
    readonly keyPrefix: string;
  };
};

export type FoundationCommandInput = {
  readonly command: readonly string[];
  readonly env: Record<string, string | undefined>;
};

export type FoundationCommandRunner = {
  run(input: FoundationCommandInput): Promise<number>;
  stop(signal?: IntegrationSignal): Promise<void>;
};

export type FoundationServiceRuntime = {
  prepare(input: {
    containerName: string;
    env: Record<string, string | undefined>;
    explicitUrl: string | undefined;
    identity: FoundationRunIdentity;
    kind: FoundationServiceKind;
    owner: IntegrationLifecycleOwner;
  }): Promise<{ url: string }>;
};

type FoundationServicePreparationInput = Parameters<FoundationServiceRuntime["prepare"]>[0];

type FoundationServiceDefinition = {
  readonly buildUrl: (
    input: FoundationServicePreparationInput,
    password: string,
    port: string,
  ) => string;
  readonly containerPort: string;
  readonly displayName: string;
  readonly dockerArguments: (
    input: FoundationServicePreparationInput,
    password: string,
  ) => readonly string[];
  readonly environmentName: "DATABASE_URL" | "REDIS_URL";
  readonly image: string;
  readonly probe: (url: string) => Promise<void>;
};

const foundationServiceDefinitions = {
  postgres: {
    buildUrl(input, password, port) {
      return `postgres://foundation:${password}@127.0.0.1:${port}/${input.identity.postgres.databaseName}`;
    },
    containerPort: "5432/tcp",
    displayName: "PostgreSQL",
    dockerArguments(input, password) {
      return [
        "--env",
        "POSTGRES_USER=foundation",
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--env",
        `POSTGRES_DB=${input.identity.postgres.databaseName}`,
        "--publish",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
      ];
    },
    environmentName: "DATABASE_URL",
    image: postgresImage,
    probe: probePostgres,
  },
  redis: {
    buildUrl(_input, _password, port) {
      return `redis://127.0.0.1:${port}/0`;
    },
    containerPort: "6379/tcp",
    displayName: "Redis",
    dockerArguments() {
      return ["--publish", "127.0.0.1::6379"];
    },
    environmentName: "REDIS_URL",
    image: redisImage,
    probe: probeRedis,
  },
} satisfies Record<FoundationServiceKind, FoundationServiceDefinition>;

type FoundationLogger = {
  error(message: string): void;
  success(message: string): void;
};

type FoundationLifecycle = <T>(
  work: (owner: IntegrationLifecycleOwner) => Promise<T>,
) => Promise<T>;

type FoundationDependencies = {
  commandRunner?: FoundationCommandRunner;
  env?: Record<string, string | undefined>;
  lifecycle?: FoundationLifecycle;
  lifecycleProcess?: IntegrationProcess;
  log?: FoundationLogger;
  randomUUID?: () => string;
  serviceRuntime?: FoundationServiceRuntime;
};

export function createFoundationRunIdentity(createUuid: () => string = randomUUID) {
  const nonce = createUuid().replaceAll("-", "").toLowerCase().slice(0, 20);
  if (!/^[a-f0-9]{20}$/.test(nonce)) {
    throw new Error("Foundation Gate run identity must be a UUID.");
  }

  const namespace = `ask_siargao_foundation_${nonce}`;
  return {
    namespace,
    postgres: {
      containerName: `ask-siargao-foundation-postgres-${nonce}`,
      databaseName: namespace,
    },
    redis: {
      containerName: `ask-siargao-foundation-redis-${nonce}`,
      keyPrefix: `ask-siargao:foundation:${nonce}`,
    },
  } satisfies FoundationRunIdentity;
}

export async function runFoundationVerification(input: FoundationDependencies = {}) {
  const log = input.log ?? consoleFoundationLogger;

  try {
    const env = { ...(input.env ?? process.env) };
    const identity = createFoundationRunIdentity(input.randomUUID);
    const commandRunner = input.commandRunner ?? createForegroundCommandRunner();
    const serviceRuntime = input.serviceRuntime ?? createDockerFoundationServiceRuntime();
    const lifecycle =
      input.lifecycle ??
      (<T>(work: (owner: IntegrationLifecycleOwner) => Promise<T>) =>
        runWithIntegrationLifecycle(work, { process: input.lifecycleProcess }));
    const exitCode = await lifecycle(async (owner) => {
      const [postgresService, redisService] = await Promise.all([
        serviceRuntime.prepare({
          containerName: identity.postgres.containerName,
          env,
          explicitUrl: env.DATABASE_URL,
          identity,
          kind: "postgres",
          owner,
        }),
        serviceRuntime.prepare({
          containerName: identity.redis.containerName,
          env,
          explicitUrl: env.REDIS_URL,
          identity,
          kind: "redis",
          owner,
        }),
      ]);

      owner.deferCleanup((signal) => commandRunner.stop(signal));

      const commands: readonly FoundationCommandInput[] = [
        {
          command: ["bun", "run", "verify:foundation:local"],
          env: {
            ...env,
            DATABASE_URL: "",
            REDIS_URL: "",
          },
        },
        {
          command: ["bun", "run", "test:integration:postgres"],
          env: {
            ...env,
            DATABASE_URL: postgresService.url,
            INTEGRATION_TEST_NAMESPACE: identity.namespace,
          },
        },
        {
          command: ["bun", "run", "test:integration:redis"],
          env: {
            ...env,
            INTEGRATION_TEST_NAMESPACE: identity.namespace,
            REDIS_URL: redisService.url,
          },
        },
      ];

      for (const command of commands) {
        const commandExitCode = await commandRunner.run(command);
        if (commandExitCode !== 0) {
          return commandExitCode;
        }
      }

      return 0;
    });

    if (exitCode === 0) {
      log.success("Foundation Gate passed: all ten gates completed.");
    }
    return exitCode;
  } catch (error) {
    log.error(`Foundation Gate failed: ${redactFoundationError(error)}`);
    return 1;
  }
}

function createForegroundCommandRunner(): FoundationCommandRunner {
  let active:
    | {
        exited: Promise<number>;
        kill(signal?: number | NodeJS.Signals): void;
      }
    | undefined;

  return {
    async run(input) {
      if (active) {
        throw new Error("A Foundation Gate subprocess is already active.");
      }
      const subprocess = Bun.spawn([...input.command], {
        env: compactEnvironment(input.env),
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      });
      active = subprocess;
      try {
        return await subprocess.exited;
      } finally {
        if (active === subprocess) {
          active = undefined;
        }
      }
    },
    async stop(signal = "SIGTERM") {
      const subprocess = active;
      if (!subprocess) {
        return;
      }
      subprocess.kill(signal);
      await subprocess.exited;
    },
  };
}

export type CapturedCommandRunner = {
  run(command: readonly string[]): Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>;
  stop?(signal?: IntegrationSignal): Promise<void>;
};

export function createDockerFoundationServiceRuntime(
  input: {
    createPassword?: () => string;
    docker?: CapturedCommandRunner;
    probeService?: (kind: FoundationServiceKind, url: string, timeoutMs: number) => Promise<void>;
  } = {},
): FoundationServiceRuntime {
  const docker = input.docker ?? createCapturedCommandRunner();
  const createPassword = input.createPassword ?? (() => randomUUID().replaceAll("-", ""));
  const probeService = input.probeService ?? waitForService;
  let dockerPreflight: Promise<void> | undefined;

  return {
    async prepare(input) {
      const definition = foundationServiceDefinitions[input.kind];
      if (input.explicitUrl?.trim()) {
        const url = input.explicitUrl.trim();
        assertSafeIntegrationServiceUrl({
          allowRemote: input.env.INTEGRATION_TEST_ALLOW_REMOTE === "1",
          name: definition.environmentName,
          requiredText: disposableIntegrationServiceMarkers,
          url,
        });
        try {
          await probeService(input.kind, url, explicitServiceReadyTimeoutMs);
          return { url };
        } catch {
          // A safe but unavailable configured endpoint falls back to a run-owned container.
        }
      }

      dockerPreflight ??= preflightDocker(docker);
      await dockerPreflight;
      return provisionDockerService(docker, input, createPassword, probeService);
    },
  };
}

async function preflightDocker(docker: CapturedCommandRunner) {
  const result = await docker
    .run(["docker", "version", "--format", "{{.Server.Version}}"])
    .catch(() => undefined);
  const dockerReady = result ? result.exitCode === 0 && Boolean(result.stdout.trim()) : false;
  if (!dockerReady) {
    throw new Error(
      "Docker is unavailable. Start the Docker daemon or configure safe DATABASE_URL and REDIS_URL test services.",
    );
  }
}

async function provisionDockerService(
  docker: CapturedCommandRunner,
  input: Parameters<FoundationServiceRuntime["prepare"]>[0],
  createPassword: () => string,
  probeService: (kind: FoundationServiceKind, url: string, timeoutMs: number) => Promise<void>,
) {
  const definition = foundationServiceDefinitions[input.kind];
  const password = createPassword();
  const command = [
    "docker",
    "run",
    "--detach",
    "--name",
    input.containerName,
    "--label",
    `${dockerOwnerLabel}=${input.identity.namespace}`,
    ...definition.dockerArguments(input, password),
    definition.image,
  ];
  const startPromise = docker.run(command);
  input.owner.deferCleanup(async (signal) => {
    if (signal) {
      await docker.stop?.(signal);
    }
    await startPromise.catch(() => undefined);
    await removeOwnedContainer(docker, input.containerName, input.identity.namespace);
  });

  const started = await startPromise;
  if (started.exitCode !== 0 || !started.stdout.trim()) {
    throw new Error(
      `Docker could not start the pinned ${definition.displayName} service. Verify image access and Docker capacity.`,
    );
  }

  const published = await docker.run([
    "docker",
    "port",
    input.containerName,
    definition.containerPort,
  ]);
  if (published.exitCode !== 0) {
    throw new Error(`Docker did not publish a loopback port for the owned ${input.kind} service.`);
  }
  const port = parsePublishedPort(published.stdout);
  const url = definition.buildUrl(input, password, port);
  await probeService(input.kind, url, serviceReadyTimeoutMs);
  return { url };
}

async function removeOwnedContainer(
  docker: CapturedCommandRunner,
  containerName: string,
  owner: string,
) {
  const inspected = await docker.run([
    "docker",
    "inspect",
    "--format",
    `{{ index .Config.Labels "${dockerOwnerLabel}" }}`,
    containerName,
  ]);
  if (inspected.exitCode !== 0) {
    if (/no such (?:object|container)/i.test(inspected.stderr)) {
      return;
    }
    throw new Error(`Docker could not inspect owned container ${containerName}.`);
  }
  if (inspected.stdout.trim() !== owner) {
    throw new Error(
      `Refusing to remove container ${containerName} without the run ownership label.`,
    );
  }

  const result = await docker.run(["docker", "rm", "--force", containerName]);
  if (result.exitCode !== 0 && !result.stderr.includes("No such container")) {
    throw new Error(`Docker could not remove owned container ${containerName}.`);
  }
}

function parsePublishedPort(output: string) {
  const match = /127\.0\.0\.1:(\d+)/.exec(output);
  const port = match?.[1];
  if (!port) {
    throw new Error("Docker returned an invalid dynamic loopback port.");
  }
  return port;
}

async function waitForService(kind: FoundationServiceKind, url: string, timeoutMs: number) {
  const definition = foundationServiceDefinitions[kind];
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      await definition.probe(url);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  } while (Date.now() < deadline);

  throw new Error(
    `${definition.displayName} test service did not become ready within ${Math.ceil(timeoutMs / 1_000)} seconds. Check the disposable service and retry.`,
    { cause: lastError },
  );
}

async function probePostgres(url: string) {
  const sql = postgres(url, { connect_timeout: 1, max: 1 });
  try {
    await withTimeout(sql`select 1`, 2_000, "PostgreSQL service probe timed out.");
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function probeRedis(url: string) {
  const client = createClient({
    url,
    socket: { connectTimeout: 1_000, reconnectStrategy: false },
  });
  client.on("error", () => undefined);
  try {
    await withTimeout(client.connect(), 2_000, "Redis service probe timed out.");
    await withTimeout(client.ping(), 2_000, "Redis service probe timed out.");
  } finally {
    if (client.isOpen) {
      await client.close().catch(() => undefined);
    }
  }
}

function createCapturedCommandRunner(): CapturedCommandRunner {
  const active = new Set<ReturnType<typeof Bun.spawn>>();

  return {
    async run(command) {
      const subprocess = Bun.spawn([...command], {
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      });
      active.add(subprocess);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          subprocess.exited,
          new Response(subprocess.stdout).text(),
          new Response(subprocess.stderr).text(),
        ]);
        return { exitCode, stderr, stdout };
      } finally {
        active.delete(subprocess);
      }
    },
    async stop(signal = "SIGTERM") {
      const subprocesses = [...active];
      for (const subprocess of subprocesses) {
        subprocess.kill(signal);
      }
      await Promise.all(subprocesses.map((subprocess) => subprocess.exited));
    },
  };
}

function compactEnvironment(env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function redactFoundationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(?:postgres(?:ql)?|rediss?):\/\/[^\s"'`]+/gi, "<redacted service URL>");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const consoleFoundationLogger: FoundationLogger = {
  error(message) {
    console.error(message);
  },
  success(message) {
    console.log(message);
  },
};

if (import.meta.main) {
  process.exitCode = await runFoundationVerification();
}
