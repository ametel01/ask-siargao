import {
  type IntegrationLifecycleOwner,
  type IntegrationProcess,
  type IntegrationSignal,
  runWithIntegrationLifecycle,
} from "@/server/integration/entrypoint-shared";
import { localFoundationGates, runFoundationGatePlan } from "@/server/qa/foundation-gates";

type RunCommand = (command: readonly string[]) => Promise<number>;

export type LocalFoundationCommandRunner = {
  run(command: readonly string[]): Promise<number>;
  stop(signal?: IntegrationSignal): Promise<void>;
};

type LocalFoundationLifecycle = <T>(
  work: (owner: IntegrationLifecycleOwner) => Promise<T>,
) => Promise<T>;

type LocalFoundationDependencies = {
  commandRunner?: LocalFoundationCommandRunner;
  lifecycle?: LocalFoundationLifecycle;
  lifecycleProcess?: IntegrationProcess;
};

export function runLocalFoundationGates(runCommand: RunCommand) {
  return runFoundationGatePlan(localFoundationGates, (gate) => runCommand(gate.command));
}

export function runLocalFoundationVerification(input: LocalFoundationDependencies = {}) {
  const commandRunner = input.commandRunner ?? createLocalFoundationCommandRunner();
  const lifecycle =
    input.lifecycle ??
    (<T>(work: (owner: IntegrationLifecycleOwner) => Promise<T>) =>
      runWithIntegrationLifecycle(work, { process: input.lifecycleProcess }));

  return lifecycle(async (owner) => {
    owner.deferCleanup((signal) => commandRunner.stop(signal));
    return runLocalFoundationGates((command) => commandRunner.run(command));
  });
}

function createLocalFoundationCommandRunner(): LocalFoundationCommandRunner {
  let active: ReturnType<typeof Bun.spawn> | undefined;

  return {
    async run(command) {
      if (active) {
        throw new Error("A local Foundation Gate subprocess is already active.");
      }
      const subprocess = Bun.spawn([...command], {
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

if (import.meta.main) {
  process.exitCode = await runLocalFoundationVerification();
}
