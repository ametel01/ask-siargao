import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildTripPassCostBaselineArtifact,
  tripPassCostBaselineArtifactPath,
} from "@/server/evaluations/trip-pass-cost-baseline";

const artifact = buildTripPassCostBaselineArtifact();

if (!artifact.exportReference.reconciles) {
  throw new Error(
    "Trip Pass cost baseline does not reconcile to the supplied DeepSeek CSV totals.",
  );
}

if (process.argv.includes("--write")) {
  const targetPath = join(process.cwd(), tripPassCostBaselineArtifactPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${tripPassCostBaselineArtifactPath}`);
} else {
  console.log(JSON.stringify(artifact, null, 2));
}
