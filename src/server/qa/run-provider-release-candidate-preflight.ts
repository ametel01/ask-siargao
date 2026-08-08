import {
  assertProviderReleaseCandidateContext,
  type ProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";
import { verifyLiveProviderDatabase } from "@/server/qa/provider-release-candidate-live-boundary";
import { writeProviderDatabaseReceipt } from "@/server/qa/provider-release-candidate-receipts";

const lane = readLane();
const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane });

const { deployedMigrationLedgerFingerprint, migrationCount } = await verifyLiveProviderDatabase({
  checkedOutCommitSha,
  compareInitialReceipt: false,
  lane,
});
await writeProviderDatabaseReceipt({
  checkedOutCommitSha,
  deployedMigrationLedgerFingerprint,
  lane,
  migrationCount,
  protectedDatabaseEnvironment: "protected-test",
});
console.log(
  JSON.stringify({
    checkedOutCommitSha,
    deployedMigrationLedgerFingerprint,
    lane,
    migrationCount,
    protectedDatabaseEnvironment: "protected-test",
  }),
);

function readLane(): ProviderReleaseCandidateLane {
  const index = process.argv.indexOf("--lane");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== "clerk" && value !== "stripe") throw new Error("Use --lane clerk or stripe.");
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
