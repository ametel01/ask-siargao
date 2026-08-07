import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { loadMigrationFiles } from "@/server/db/migration-files";
import {
  buildTripPassLaunchManifest,
  createFoundationBlockers,
  createFoundationGateResults,
  serializeTripPassLaunchManifest,
  validateTripPassLaunchManifest,
} from "@/server/qa/trip-pass-launch-manifest";

const writeArtifact = process.argv.includes("--write");
const foundationCiGatesPassed = process.argv.includes("--foundation-ci-gates-passed");
const checkedOutCommitSha = await readCheckedOutCommitSha();
const manifest = buildTripPassLaunchManifest({
  blockers: createFoundationBlockers(),
  checkedOutCommitSha,
  env: process.env,
  gateResults: createFoundationGateResults(foundationCiGatesPassed ? "pass" : "blocked"),
  generatedAt: process.env.GITHUB_RUN_STARTED_AT ?? "2026-08-07T00:00:00.000Z",
  migrations: await loadMigrationFiles(),
});
const validation = validateTripPassLaunchManifest(manifest);

if (!validation.valid) {
  throw new Error(`Trip Pass launch manifest is invalid: ${validation.errors.join(", ")}`);
}

if (writeArtifact) {
  await mkdir(dirname(manifest.artifact.path), { recursive: true });
  await writeFile(manifest.artifact.path, serializeTripPassLaunchManifest(manifest));
}

console.log(
  JSON.stringify(
    {
      artifactPath: manifest.artifact.path,
      checkedOutCommitSha: manifest.source.checkedOutCommitSha,
      engineeringReady: manifest.engineeringReadiness.engineeringReady,
      gateCount: manifest.engineeringReadiness.gateResults.length,
      humanLaunchAuthorized: manifest.humanLaunchAuthorization.launchAuthorized,
      unresolvedBlockerCount: manifest.blockers.length,
      wroteArtifact: writeArtifact,
    },
    null,
    2,
  ),
);

async function readCheckedOutCommitSha() {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Unable to read checked-out git commit SHA: ${stderr.trim()}`);
  }

  return stdout.trim();
}
