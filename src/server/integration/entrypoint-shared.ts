const namespacePattern = /^[a-z][a-z0-9_]{0,62}$/;
const localTestHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export type IntegrationEntrypointOptions = {
  dryRun: boolean;
  namespace: string;
  timeoutMs: number;
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

  const searchable = decodeURIComponent(
    [parsed.hostname, parsed.username, parsed.pathname, parsed.search].join(" "),
  ).toLowerCase();
  if (!input.requiredText.some((marker) => searchable.includes(marker))) {
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
