import { runLoggedCommand } from "@/server/container/commands";
import { createComponentLogger } from "@/server/observability/logger";

const stackLogger = createComponentLogger("container.stack", {
  composeProject: "ask-siargao",
});

const actions = {
  down: {
    command: ["docker", "compose", "down"],
    step: "compose.down",
  },
  "down-volumes": {
    command: ["docker", "compose", "down", "--volumes"],
    step: "compose.down.volumes",
  },
  logs: {
    command: ["docker", "compose", "logs", "-f"],
    step: "compose.logs.follow",
  },
  ps: {
    command: ["docker", "compose", "ps", "-a"],
    step: "compose.ps",
  },
  "up-app": {
    command: ["docker", "compose", "--profile", "app", "up", "-d", "--build"],
    postCommands: [
      {
        command: ["docker", "compose", "ps", "-a", "app"],
        step: "compose.ps.app",
      },
    ],
    step: "compose.up.app",
  },
  "up-db": {
    command: ["docker", "compose", "up", "-d", "db"],
    step: "compose.up.db",
  },
} as const;

type StackAction = keyof typeof actions;

const action = process.argv[2] as StackAction | undefined;

if (!action || !(action in actions)) {
  stackLogger.error(
    {
      requestedAction: action,
      supportedActions: Object.keys(actions),
    },
    "Unsupported container stack action.",
  );
  process.exit(1);
}

const dockerAvailable = await hasDockerDaemon();

if (!dockerAvailable) {
  if (action === "down") {
    stackLogger.warn("Docker daemon is not running; nothing to stop.");
    process.exit(0);
  }

  stackLogger.error("Docker daemon is not available.");
  process.exit(1);
}

const actionConfig = actions[action];
stackLogger.info(
  {
    action,
    command: actionConfig.command,
  },
  "Container stack action started.",
);

await runLoggedCommand({
  command: actionConfig.command,
  logger: stackLogger,
  step: actionConfig.step,
});

if ("postCommands" in actionConfig) {
  for (const postCommand of actionConfig.postCommands) {
    await runLoggedCommand({
      command: postCommand.command,
      logger: stackLogger,
      step: postCommand.step,
    });
  }
}

stackLogger.info({ action }, "Container stack action completed.");

async function hasDockerDaemon() {
  const subprocess = Bun.spawn(["docker", "info"], {
    stderr: "ignore",
    stdout: "ignore",
  });

  return (await subprocess.exited) === 0;
}
