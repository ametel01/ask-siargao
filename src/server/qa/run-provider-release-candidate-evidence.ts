import type { ProviderReleaseCandidateLane } from "@/server/qa/provider-release-candidate";
import { createLiveProviderReleaseCandidateLifecycle } from "@/server/qa/provider-release-candidate-live-boundary";

const lane = readLane();
const lifecycle = await createLiveProviderReleaseCandidateLifecycle(lane);
const completed = await lifecycle.complete();

console.log(
  JSON.stringify({
    checkedOutCommitSha: completed.evidence.source.checkedOutCommitSha,
    evidencePath: completed.evidencePath,
    fingerprint: completed.evidence.codeAndMigrationFingerprint,
    lane: completed.evidence.lane,
    migrationCount: completed.evidence.migrations.length,
    scenarioCount: completed.evidence.scenarios.length,
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
