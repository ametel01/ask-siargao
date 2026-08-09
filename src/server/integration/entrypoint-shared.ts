const namespacePattern = /^[a-z][a-z0-9_]{0,62}$/;
const localTestHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const integrationSignals = ["SIGINT", "SIGTERM"] as const;

export const disposableIntegrationServiceMarkers = [
  "test",
  "integration",
  "issue",
  "local",
  "ci",
  "foundation",
] as const;

export type IntegrationSignal = (typeof integrationSignals)[number];

export type IntegrationProcess = {
  exit(code?: number): unknown;
  off(event: IntegrationSignal, listener: (signal: IntegrationSignal) => void): unknown;
  once(event: IntegrationSignal, listener: (signal: IntegrationSignal) => void): unknown;
};

export type IntegrationEntrypointOptions = {
  dryRun: boolean;
  namespace: string;
  timeoutMs: number;
};

export type IntegrationLifecycleOwner = {
  cleanup(signal?: IntegrationSignal): Promise<void>;
  deferCleanup(cleanup: (signal?: IntegrationSignal) => Promise<void>): void;
};

export function parseIntegrationEntrypointOptions(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): IntegrationEntrypointOptions {
  let dryRun = false;
  let namespace = env.INTEGRATION_TEST_NAMESPACE ?? "ask_siargao_issue150_local";
  let timeoutMs = 5_000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dry-run":
        dryRun = true;
        break;
      case "--namespace":
        index += 1;
        namespace = requireOptionValue(arg, argv[index]);
        break;
      case "--timeout-ms":
        index += 1;
        timeoutMs = parsePositiveIntegerOption(arg, requireOptionValue(arg, argv[index]));
        break;
      default:
        throw new Error(
          `Unsupported integration entry-point argument: ${arg}. Supported arguments: --dry-run, --namespace <name>, --timeout-ms <milliseconds>.`,
        );
    }
  }

  if (!namespacePattern.test(namespace)) {
    throw new Error(
      "INTEGRATION_TEST_NAMESPACE must start with a lowercase letter and contain only lowercase letters, digits, and underscores.",
    );
  }

  return {
    dryRun,
    namespace,
    timeoutMs,
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  failureMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(failureMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runWithIntegrationLifecycle<T>(
  work: (owner: IntegrationLifecycleOwner) => Promise<T>,
  input: { process?: IntegrationProcess } = {},
) {
  const owner = createIntegrationLifecycleOwner();
  const detachSignals = attachIntegrationSignalHandlers(owner, input.process);
  try {
    return await work(owner);
  } finally {
    await owner.cleanup();
    detachSignals();
  }
}

export function createIntegrationLifecycleOwner(): IntegrationLifecycleOwner {
  const cleanups: Array<(signal?: IntegrationSignal) => Promise<void>> = [];
  let cleanupPromise: Promise<void> | null = null;

  return {
    cleanup(signal) {
      cleanupPromise ??= (async () => {
        const errors: unknown[] = [];
        for (const cleanup of cleanups.splice(0).reverse()) {
          try {
            await cleanup(signal);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(errors, "Integration cleanup failed.");
        }
      })();
      return cleanupPromise;
    },
    deferCleanup(cleanup) {
      if (cleanupPromise) {
        throw new Error("Cannot register integration cleanup after cleanup has started.");
      }
      cleanups.push(cleanup);
    },
  };
}

export function attachIntegrationSignalHandlers(
  owner: IntegrationLifecycleOwner,
  processLike: IntegrationProcess = process,
) {
  return integrationSignalRegistryFor(processLike).register(owner);
}

export function requireServiceUrl(
  name: "DATABASE_URL" | "REDIS_URL",
  env: Record<string, string | undefined> = process.env,
) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for this integration entry point; no fallback is allowed.`,
    );
  }
  return value;
}

export function assertSafeIntegrationServiceUrl(input: {
  allowRemote?: boolean;
  name: "DATABASE_URL" | "REDIS_URL";
  requiredText: readonly string[];
  url: string;
}) {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error(`${input.name} must be a valid URL for the integration test service.`);
  }

  const protocolAllowed =
    input.name === "DATABASE_URL"
      ? parsed.protocol === "postgres:" || parsed.protocol === "postgresql:"
      : parsed.protocol === "redis:" || parsed.protocol === "rediss:";
  if (!protocolAllowed) {
    throw new Error(
      `${input.name} must use a ${input.name === "DATABASE_URL" ? "PostgreSQL" : "Redis"} URL.`,
    );
  }

  if (!input.allowRemote && !localTestHosts.has(parsed.hostname)) {
    throw new Error(
      `${input.name} must point at localhost unless INTEGRATION_TEST_ALLOW_REMOTE=1 is set.`,
    );
  }

  const requiresMarker = input.name === "DATABASE_URL" || !localTestHosts.has(parsed.hostname);
  const searchable = decodeURIComponent(
    [parsed.hostname, parsed.username, parsed.pathname, parsed.search].join(" "),
  ).toLowerCase();
  if (requiresMarker && !input.requiredText.some((marker) => searchable.includes(marker))) {
    throw new Error(
      `${input.name} must visibly target a disposable test service or namespace; refusing production-looking target.`,
    );
  }
}

export function redactUrl(input: string) {
  return input.replace(/:\/\/([^:@/]+):([^@/]+)@/g, "://$1:***@");
}

function requireOptionValue(option: string, value: string | undefined) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parsePositiveIntegerOption(option: string, value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${option} must be a positive integer.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer.`);
  }

  return parsed;
}

function exitCodeForSignal(signal: IntegrationSignal) {
  return signal === "SIGINT" ? 130 : 143;
}

type IntegrationSignalRegistry = {
  register(owner: IntegrationLifecycleOwner): () => void;
};

const signalRegistries = new WeakMap<IntegrationProcess, IntegrationSignalRegistry>();

function integrationSignalRegistryFor(processLike: IntegrationProcess): IntegrationSignalRegistry {
  let registry = signalRegistries.get(processLike);
  if (!registry) {
    registry = createIntegrationSignalRegistry(processLike);
    signalRegistries.set(processLike, registry);
  }
  return registry;
}

function createIntegrationSignalRegistry(
  processLike: IntegrationProcess,
): IntegrationSignalRegistry {
  const owners = new Set<IntegrationLifecycleOwner>();
  const handlers = new Map<IntegrationSignal, (signal: IntegrationSignal) => void>();
  let signalCleanupPromise: Promise<void> | null = null;

  const detachHandlers = () => {
    for (const [signal, handler] of handlers) {
      processLike.off(signal, handler);
    }
    handlers.clear();
  };

  const attachHandlers = () => {
    if (handlers.size > 0) {
      return;
    }
    for (const signal of integrationSignals) {
      const handler = () => {
        const receivedSignal = signal;
        signalCleanupPromise ??= cleanupAllActiveOwners(owners, receivedSignal)
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            detachHandlers();
            owners.clear();
            signalCleanupPromise = null;
            processLike.exit(exitCodeForSignal(receivedSignal));
          });
      };
      handlers.set(signal, handler);
      processLike.once(signal, handler);
    }
  };

  return {
    register(owner) {
      owners.add(owner);
      attachHandlers();

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        owners.delete(owner);
        if (owners.size === 0 && !signalCleanupPromise) {
          detachHandlers();
        }
      };
    },
  };
}

async function cleanupAllActiveOwners(
  owners: Set<IntegrationLifecycleOwner>,
  signal: IntegrationSignal,
) {
  const errors: unknown[] = [];
  await Promise.all(
    [...owners].map(async (owner) => {
      try {
        await owner.cleanup(signal);
      } catch (error) {
        errors.push(error);
      }
    }),
  );

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Integration cleanup failed.");
  }
}
