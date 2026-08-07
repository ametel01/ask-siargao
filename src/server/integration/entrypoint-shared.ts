const namespacePattern = /^[a-z][a-z0-9_]{0,62}$/;

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
  let namespace = env.INTEGRATION_TEST_NAMESPACE ?? "ask_siargao_issue145_local";
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

  if (!dryRun) {
    throw new Error(
      "This integration entry point currently supports --dry-run only; production-semantic fixtures are owned by issue #150.",
    );
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
