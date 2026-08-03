import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildRealityCheckEvaluationArtifact,
  realityCheckEvaluationArtifactPath,
} from "@/server/evaluations/reality-check-matrix";

const artifact = buildRealityCheckEvaluationArtifact();

if (!artifact.productScenarios.allCasesPass) {
  throw new Error("One or more Reality Check product scenarios failed.");
}
if (!artifact.failClosedContracts.allCasesPass) {
  throw new Error("One or more Reality Check fail-closed contracts failed.");
}

if (process.argv.includes("--write")) {
  const targetPath = join(process.cwd(), realityCheckEvaluationArtifactPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${realityCheckEvaluationArtifactPath}`);
} else {
  console.log(JSON.stringify(artifact, null, 2));
}
