import type { Logger } from "pino";

export type LoggedCommandResult = {
  durationMs: number;
  exitCode: number;
};

class LoggedCommandError extends Error {
  constructor(
    readonly step: string,
    readonly command: readonly string[],
    readonly exitCode: number,
  ) {
    super(`Command "${command.join(" ")}" failed in step "${step}" with exit code ${exitCode}.`);
    this.name = "LoggedCommandError";
  }
}

export async function runLoggedCommand(input: {
  command: readonly string[];
  cwd?: string;
  logger: Logger;
  step: string;
  throwOnFailure?: boolean;
}): Promise<LoggedCommandResult> {
  const startedAt = performance.now();
  const commandForLog = input.command.map(redactCommandPart);

  input.logger.info(
    {
      command: commandForLog,
      cwd: input.cwd ?? process.cwd(),
      step: input.step,
    },
    "Command started.",
  );

  const subprocess = Bun.spawn([...input.command], {
    cwd: input.cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  const cleanupSignalHandlers = installSignalForwarding(input.logger, input.step, subprocess);
  const exitCode = await subprocess.exited;
  cleanupSignalHandlers();

  const durationMs = Math.round(performance.now() - startedAt);
  const logPayload = {
    command: commandForLog,
    durationMs,
    exitCode,
    step: input.step,
  };

  if (exitCode === 0) {
    input.logger.info(logPayload, "Command completed.");
    return { durationMs, exitCode };
  }

  input.logger.error(logPayload, "Command failed.");

  if (input.throwOnFailure === false) {
    return { durationMs, exitCode };
  }

  throw new LoggedCommandError(input.step, input.command, exitCode);
}

function installSignalForwarding(
  logger: Logger,
  step: string,
  subprocess: Bun.Subprocess<"inherit", "inherit", "inherit">,
) {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const cleanup: Array<() => void> = [];

  for (const signal of signals) {
    const handler = () => {
      logger.warn({ signal, step }, "Forwarding signal to child process.");
      subprocess.kill(signal);
    };
    process.once(signal, handler);
    cleanup.push(() => process.off(signal, handler));
  }

  return () => {
    for (const removeHandler of cleanup) {
      removeHandler();
    }
  };
}

function redactCommandPart(part: string) {
  if (/password|secret|token|key/i.test(part)) {
    return "[redacted]";
  }

  return part;
}
