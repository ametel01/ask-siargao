import { mkdir, writeFile } from "node:fs/promises";

import { loadMigrationFiles } from "@/server/db/migration-files";
import {
  assertProviderReleaseCandidateContext,
  buildProviderReleaseCandidateEvidence,
  type ProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";

const lane = readLane();
const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane });

const evidence = buildProviderReleaseCandidateEvidence({
  checkedOutCommitSha,
  lane,
  migrations: await loadMigrationFiles(),
});
const directory = ".tmp/provider-release-candidate";
const path = `${directory}/${lane}-${checkedOutCommitSha}.json`;
await mkdir(directory, { recursive: true });
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });

console.log(
  JSON.stringify({
    checkedOutCommitSha,
    evidencePath: path,
    fingerprint: evidence.codeAndMigrationFingerprint,
    lane,
    migrationCount: evidence.migrations.length,
    scenarioCount: evidence.scenarios.length,
  }),
);

function readLane(): ProviderReleaseCandidateLane {
  const index = process.argv.indexOf("--lane");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== "clerk" && value !== "stripe") {
    throw new Error("Use --lane clerk or --lane stripe.");
  }
  return value;
}

async function readHeadSha() {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}
