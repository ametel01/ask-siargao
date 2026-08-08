import { localFoundationGates, runFoundationGatePlan } from "@/server/qa/foundation-gates";

type RunCommand = (command: readonly string[]) => Promise<number>;

export function runLocalFoundationGates(runCommand: RunCommand = runCommandInForeground) {
  return runFoundationGatePlan(localFoundationGates, (gate) => runCommand(gate.command));
}

async function runCommandInForeground(command: readonly string[]) {
  const subprocess = Bun.spawn([...command], {
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  return subprocess.exited;
}

if (import.meta.main) {
  process.exitCode = await runLocalFoundationGates();
}
