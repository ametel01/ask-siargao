import type postgres from "postgres";

export type PostgresClientProfile = "app" | "cli";

export type PostgresConnectionEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "APP_ENV"
    | "DATABASE_CLI_POOL_SIZE"
    | "DATABASE_CONNECT_TIMEOUT_SECONDS"
    | "DATABASE_IDLE_TIMEOUT_SECONDS"
    | "DATABASE_MAX_LIFETIME_SECONDS"
    | "DATABASE_POOL_SIZE"
    | "DATABASE_SSL_MODE"
    | "DATABASE_STATEMENT_TIMEOUT_MS"
    | "NODE_ENV"
  >
>;

export type PostgresConnectionOptions = postgres.Options<Record<string, postgres.PostgresType>>;

const defaultAppPoolSize = 10;
const defaultProductionAppPoolSize = 2;
const defaultCliPoolSize = 1;
const defaultConnectTimeoutSeconds = 10;
const defaultIdleTimeoutSeconds = 30;
const defaultMaxLifetimeSeconds = 1_800;
const defaultProductionAppStatementTimeoutMs = 30_000;
const defaultProductionCliStatementTimeoutMs = 120_000;

export function createPostgresConnectionOptions(
  profile: PostgresClientProfile,
  env: PostgresConnectionEnv = process.env,
): PostgresConnectionOptions {
  const isProduction = env.NODE_ENV === "production" || env.APP_ENV === "production";
  const statementTimeoutDefault =
    profile === "cli"
      ? defaultProductionCliStatementTimeoutMs
      : defaultProductionAppStatementTimeoutMs;

  return {
    connect_timeout: parseIntegerEnv(
      "DATABASE_CONNECT_TIMEOUT_SECONDS",
      env.DATABASE_CONNECT_TIMEOUT_SECONDS,
      defaultConnectTimeoutSeconds,
      { minimum: 1 },
    ),
    connection: {
      statement_timeout: parseIntegerEnv(
        "DATABASE_STATEMENT_TIMEOUT_MS",
        env.DATABASE_STATEMENT_TIMEOUT_MS,
        isProduction ? statementTimeoutDefault : 0,
        { minimum: 0 },
      ),
    },
    idle_timeout: parseIntegerEnv(
      "DATABASE_IDLE_TIMEOUT_SECONDS",
      env.DATABASE_IDLE_TIMEOUT_SECONDS,
      defaultIdleTimeoutSeconds,
      { minimum: 0 },
    ),
    max:
      profile === "cli"
        ? parseIntegerEnv(
            "DATABASE_CLI_POOL_SIZE",
            env.DATABASE_CLI_POOL_SIZE,
            defaultCliPoolSize,
            { minimum: 1 },
          )
        : parseIntegerEnv(
            "DATABASE_POOL_SIZE",
            env.DATABASE_POOL_SIZE,
            isProduction ? defaultProductionAppPoolSize : defaultAppPoolSize,
            { minimum: 1 },
          ),
    max_lifetime: parseIntegerEnv(
      "DATABASE_MAX_LIFETIME_SECONDS",
      env.DATABASE_MAX_LIFETIME_SECONDS,
      defaultMaxLifetimeSeconds,
      { minimum: 0 },
    ),
    prepare: false,
    ssl: parseSslMode(env.DATABASE_SSL_MODE, isProduction),
  };
}

function parseIntegerEnv(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
  { minimum }: { minimum: number },
) {
  const value = rawValue?.trim();
  if (!value) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

function parseSslMode(rawValue: string | undefined, isProduction: boolean) {
  const value = rawValue?.trim().toLowerCase();
  if (isProduction) {
    if (value !== "verify-full") {
      throw new Error("DATABASE_SSL_MODE must be verify-full in production.");
    }
    return "verify-full";
  }
  if (!value) {
    return false;
  }

  switch (value) {
    case "allow":
    case "prefer":
    case "require":
    case "verify-full":
      return value;
    case "disable":
      return false;
    default:
      throw new Error(
        "DATABASE_SSL_MODE must be one of: disable, allow, prefer, require, verify-full.",
      );
  }
}
