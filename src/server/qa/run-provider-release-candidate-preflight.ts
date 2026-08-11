import type { ProviderReleaseCandidateLane } from "@/server/qa/provider-release-candidate";
import { createLiveProviderReleaseCandidateLifecycle } from "@/server/qa/provider-release-candidate-live-boundary";

const lane = readLane();
const lifecycle = await createLiveProviderReleaseCandidateLifecycle(lane);
const receipt = await lifecycle.begin();
console.log(JSON.stringify(receipt));

function readLane(): ProviderReleaseCandidateLane {
  const index = process.argv.indexOf("--lane");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== "clerk" && value !== "stripe") throw new Error("Use --lane clerk or stripe.");
  return value;
}
