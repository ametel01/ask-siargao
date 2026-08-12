export type DeploymentCommandResult = {
  exitCode: number;
  stdout: string;
};

export type DeploymentCommandRunner = (
  command: readonly string[],
) => Promise<DeploymentCommandResult>;

type StagingDeploymentDependencies = {
  log?: (message: string) => void;
  run?: DeploymentCommandRunner;
};

const project = "ask-siargao";
const scope = "ametel01s-projects";
const stagingAlias = "staging.asksiargao.com";
const stagingTarget = "staging";

export async function runStagingDeployment(input: StagingDeploymentDependencies = {}) {
  const run = input.run ?? runCommand;
  const log = input.log ?? console.log;

  const worktree = await runChecked(run, ["git", "status", "--porcelain"]);
  if (worktree.trim()) throw new Error("Staging deployment requires a clean worktree.");

  const branch = await runChecked(run, ["git", "branch", "--show-current"]);
  if (branch.trim() !== "main") throw new Error("Staging deployment requires the main branch.");

  await runChecked(run, ["git", "fetch", "upstream", "main"]);
  const headSha = await runChecked(run, ["git", "rev-parse", "HEAD"]);
  const trustedMainSha = await runChecked(run, ["git", "rev-parse", "upstream/main"]);
  if (headSha.trim() !== trustedMainSha.trim()) {
    throw new Error(
      "Staging deployment requires HEAD to match upstream/main. Push the candidate first.",
    );
  }

  log(`Deploying trusted main candidate ${headSha.trim().slice(0, 7)} to staging...`);
  const deployOutput = await runChecked(run, [
    "vercel",
    "deploy",
    "--target",
    stagingTarget,
    "--project",
    project,
    "--scope",
    scope,
    "--yes",
    "--no-wait",
  ]);
  const deploymentHost = readDeploymentHost(deployOutput);
  const inspectionOutput = await runChecked(run, [
    "vercel",
    "inspect",
    deploymentHost,
    "--wait",
    "--timeout",
    "10m",
    "--json",
    "--scope",
    scope,
  ]);
  const inspection = readInspection(inspectionOutput);
  if (
    inspection.readyState !== "READY" ||
    inspection.target !== stagingTarget ||
    inspection.url !== deploymentHost
  ) {
    throw new Error("Vercel did not return a READY staging deployment for the requested URL.");
  }

  await runChecked(run, ["vercel", "alias", "set", deploymentHost, stagingAlias, "--scope", scope]);

  const result = {
    deploymentUrl: `https://${deploymentHost}`,
    stagingUrl: `https://${stagingAlias}`,
  };
  log(`Staging deployed: ${result.stagingUrl}`);
  return result;
}

async function runChecked(run: DeploymentCommandRunner, command: readonly string[]) {
  const result = await run(command);
  if (result.exitCode !== 0) {
    throw new Error(`Staging deployment command failed: ${command[0]} ${command[1] ?? ""}`.trim());
  }
  return result.stdout;
}

function readDeploymentHost(output: string) {
  const candidates = output.split(/\s+/).flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && /^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
        ? [url.hostname]
        : [];
    } catch {
      return [];
    }
  });
  const deploymentHost = candidates.at(-1);
  if (!deploymentHost) throw new Error("Vercel did not return a deployment URL.");
  return deploymentHost;
}

function readInspection(output: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Vercel returned an invalid deployment inspection.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Vercel returned an invalid deployment inspection.");
  }
  const record = parsed as Record<string, unknown>;
  return {
    readyState: typeof record.readyState === "string" ? record.readyState : "",
    target: typeof record.target === "string" ? record.target : "",
    url: typeof record.url === "string" ? record.url : "",
  };
}

async function runCommand(command: readonly string[]): Promise<DeploymentCommandResult> {
  const subprocess = Bun.spawn([...command], {
    stderr: "inherit",
    stdin: "inherit",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);
  return { exitCode, stdout };
}

if (import.meta.main) {
  try {
    await runStagingDeployment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging deployment failed.");
    process.exit(1);
  }
}
