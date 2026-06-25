import { runLoggedCommand } from "@/server/container/commands";
import { createComponentLogger } from "@/server/observability/logger";

const args = new Set(process.argv.slice(2));
const serveOnly = args.has("--serve-only");
const startupLogger = createComponentLogger("container.startup", {
  composeService: "app",
});

process.on("uncaughtException", (error) => {
  startupLogger.fatal({ err: error }, "Uncaught exception in container startup.");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  startupLogger.fatal({ reason: String(reason) }, "Unhandled rejection in container startup.");
  process.exit(1);
});

startupLogger.info(
  {
    bunVersion: Bun.version,
    databaseTarget: databaseTargetForLog(process.env.DATABASE_URL),
    logLevel: process.env.LOG_LEVEL ?? "info",
    nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    nodeEnv: process.env.NODE_ENV,
    serveOnly,
    trustProxyHeaders: process.env.TRUST_PROXY_HEADERS,
    workingDirectory: process.cwd(),
  },
  "Container app startup initialized.",
);

if (!serveOnly) {
  await runLoggedCommand({
    command: ["bun", "install", "--frozen-lockfile"],
    logger: startupLogger,
    step: "dependencies.install",
  });

  await runLoggedCommand({
    command: ["bun", "run", "db:migrate"],
    logger: startupLogger,
    step: "database.migrate",
  });

  await runLoggedCommand({
    command: ["bun", "run", "db:seed"],
    logger: startupLogger,
    step: "database.seed",
  });
}

const nextResult = await runLoggedCommand({
  command: ["node", "./node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0", "--webpack"],
  logger: startupLogger,
  step: "next.dev",
  throwOnFailure: false,
});

startupLogger.info(
  {
    durationMs: nextResult.durationMs,
    exitCode: nextResult.exitCode,
  },
  "Container app process exited.",
);

process.exit(nextResult.exitCode);

function databaseTargetForLog(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return "unset";
  }

  try {
    const parsed = new URL(databaseUrl);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return "[unparseable]";
  }
}
