import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildTripPassQualityBypassArtifact,
  tripPassQualityBypassArtifactPath,
} from "@/server/evaluations/trip-pass-quality-bypass";

const artifact = buildTripPassQualityBypassArtifact();

if (!artifact.decisionQuality.allCasesPass) {
  throw new Error("Trip Pass decision-quality corpus has failing cases.");
}
if (!artifact.costComparison.passesTwentyPercentTarget) {
  throw new Error("Trip Pass candidate cost comparison misses the 20% target.");
}
if (artifact.costComparison.maxNormalModelCalls > 4) {
  throw new Error("Trip Pass normal candidate turns exceed the four-call target.");
}
if (!artifact.bypassMatrix.allCasesPass) {
  throw new Error("Trip Pass bypass matrix has failing cases.");
}

if (process.argv.includes("--write")) {
  const targetPath = join(process.cwd(), tripPassQualityBypassArtifactPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${tripPassQualityBypassArtifactPath}`);
} else {
  console.log(JSON.stringify(artifact, null, 2));
}
