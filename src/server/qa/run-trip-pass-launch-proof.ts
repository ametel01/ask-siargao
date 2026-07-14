import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildTripPassLaunchProof,
  tripPassLaunchProofArtifactPath,
  validateTripPassLaunchProof,
} from "@/server/qa/trip-pass-launch-proof";

const writeArtifact = process.argv.includes("--write");
const proof = buildTripPassLaunchProof();
const validation = validateTripPassLaunchProof(proof);

if (!validation.valid) {
  throw new Error(`Trip Pass launch proof is invalid: ${validation.errors.join(", ")}`);
}

if (writeArtifact) {
  await mkdir(dirname(tripPassLaunchProofArtifactPath), { recursive: true });
  await writeFile(tripPassLaunchProofArtifactPath, `${JSON.stringify(proof, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      artifactPath: tripPassLaunchProofArtifactPath,
      deterministicChecks: proof.deterministicFlowChecks.length,
      launchReady: proof.launchReady,
      blockerCount: validation.blockerCount,
      wroteArtifact: writeArtifact,
    },
    null,
    2,
  ),
);
