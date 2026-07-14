import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildTripPassCostBaselineArtifact,
  buildTripPassCostCandidateComparisonArtifact,
  tripPassCostBaselineArtifactPath,
  tripPassCostCandidateArtifactPath,
} from "@/server/evaluations/trip-pass-cost-baseline";

const candidateMode = process.argv.includes("--candidate");

const artifact = candidateMode ? candidateArtifact() : baselineArtifact();
const artifactPath = candidateMode
  ? tripPassCostCandidateArtifactPath
  : tripPassCostBaselineArtifactPath;

if (process.argv.includes("--write")) {
  const targetPath = join(process.cwd(), artifactPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${artifactPath}`);
} else {
  console.log(JSON.stringify(artifact, null, 2));
}

function baselineArtifact() {
  const baseline = buildTripPassCostBaselineArtifact();
  if (!baseline.exportReference.reconciles) {
    throw new Error(
      "Trip Pass cost baseline does not reconcile to the supplied DeepSeek CSV totals.",
    );
  }
  return baseline;
}

function candidateArtifact() {
  const candidate = buildTripPassCostCandidateComparisonArtifact();
  if (!candidate.comparison.passesTwentyPercentTarget) {
    throw new Error("Trip Pass cost candidate does not pass the 20% savings target.");
  }
  return candidate;
}
