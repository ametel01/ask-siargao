import { mkdir, writeFile } from "node:fs/promises";

import { loadMigrationFiles } from "@/server/db/migration-files";
import {
  assertProviderReleaseCandidateContext,
  buildProviderReleaseCandidateEvidence,
  type ProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";
import {
  readExecutedProviderScenarios,
  readProviderDatabaseReceipt,
} from "@/server/qa/provider-release-candidate-receipts";

const lane = readLane();
const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane });
const migrations = await loadMigrationFiles();
const databaseReceipt = await readProviderDatabaseReceipt(lane, checkedOutCommitSha);
if (
  databaseReceipt.checkedOutCommitSha !== checkedOutCommitSha ||
  databaseReceipt.lane !== lane ||
  databaseReceipt.protectedDatabaseEnvironment !== "protected-test" ||
  databaseReceipt.migrationCount !== migrations.length ||
  !/^[0-9a-f]{64}$/.test(databaseReceipt.deployedMigrationLedgerFingerprint)
) {
  throw new Error("Protected database receipt does not match this exact lane and SHA.");
}

const evidence = buildProviderReleaseCandidateEvidence({
  checkedOutCommitSha,
  deployedMigrationLedgerFingerprint: databaseReceipt.deployedMigrationLedgerFingerprint,
  lane,
  migrations,
  scenarios: await readExecutedProviderScenarios(lane, checkedOutCommitSha),
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
