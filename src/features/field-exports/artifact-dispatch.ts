import { FieldSecurityError } from "@/features/field-security/errors";
import type { ArtifactKind } from "./artifact-schemas";

export function artifactKindForAction(input: {
  action: "restore_recovery" | "verify_batch";
  filename: string;
}): ArtifactKind {
  const expected = input.action === "restore_recovery" ? ".asfrecovery" : ".asfbatch";
  if (!input.filename.endsWith(expected)) throw new FieldSecurityError("field_artifact_invalid");
  if (input.filename.includes("/") || input.filename.includes("\\")) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  return input.action === "restore_recovery" ? "field_recovery" : "field_batch";
}
