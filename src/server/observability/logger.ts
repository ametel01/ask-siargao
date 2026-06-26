import pino, { type Logger } from "pino";

const defaultServiceName = "ask-siargao";
const defaultContainerImage = "ask-siargao-app:latest";

const redactPaths = [
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "customerEmail",
  "*.customerEmail",
  "DATABASE_URL",
  "databaseUrl",
  "*.databaseUrl",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "signature",
  "*.signature",
  "token",
  "*.token",
  "webhookSecret",
  "*.webhookSecret",
];

type LoggerBindingValue = boolean | number | string | null | undefined;

export type LoggerBindings = Record<string, LoggerBindingValue>;

function createServiceLogger(
  input: {
    bindings?: LoggerBindings;
    env?: Record<string, string | undefined>;
    level?: string;
  } = {},
): Logger {
  const env = input.env ?? process.env;
  const level = input.level ?? resolveLogLevel(env);

  return pino({
    base: compact({
      appEnv: env.APP_ENV,
      appRuntime: env.APP_RUNTIME,
      containerHostname: env.HOSTNAME,
      containerImage: env.CONTAINER_IMAGE ?? defaultContainerImage,
      nodeEnv: env.NODE_ENV,
      service: env.SERVICE_NAME ?? defaultServiceName,
      ...input.bindings,
    }),
    level,
    name: env.SERVICE_NAME ?? defaultServiceName,
    redact: {
      censor: "[redacted]",
      paths: redactPaths,
    },
    serializers: {
      error: pino.stdSerializers.err,
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

const logger = createServiceLogger();

export function createComponentLogger(component: string, bindings: LoggerBindings = {}) {
  return logger.child(compact({ component, ...bindings }));
}

function resolveLogLevel(env: Record<string, string | undefined> = process.env) {
  if (env.LOG_LEVEL) {
    return env.LOG_LEVEL;
  }

  if (env.NODE_ENV === "test") {
    return "silent";
  }

  return "info";
}

function compact(input: Record<string, LoggerBindingValue>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}
