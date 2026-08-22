import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import { FieldSecurityError } from "@/features/field-security/errors";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import type { FieldCoverageSnapshot, PlannerInputs, PlannerProtocol } from "./field-planning-types";

export type FieldPlannerReadinessHandoff = Readonly<{
  version: 1;
  handoffId: string;
  handedOffAt: string;
  source: { kind: "approved_local_handoff"; id: string };
  protocolPackageId: string;
  protocolPackageVersion: string;
  coverageSnapshot: FieldCoverageSnapshot;
  inputs: PlannerInputs;
}>;

export async function loadPlannerReadiness(
  protocol: PlannerProtocol,
  key: Uint8Array,
  vault = new IndexedDbFieldVault(),
): Promise<FieldPlannerReadinessHandoff | undefined> {
  const pointer = await vault.getMetadata("planner-readiness");
  if (!pointer) return undefined;
  const envelope = await vault.getEnvelope(pointer.value.opaqueRecordKey);
  if (!envelope) throw new FieldSecurityError("field_artifact_invalid");
  const handoff = decryptFieldValue<FieldPlannerReadinessHandoff>(envelope, key);
  assertReadinessHandoff(handoff, protocol);
  if (handoff.handoffId !== pointer.value.handoffId) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  return handoff;
}

export async function savePlannerReadiness(
  handoff: FieldPlannerReadinessHandoff,
  protocol: PlannerProtocol,
  key: Uint8Array,
  vault = new IndexedDbFieldVault(),
): Promise<void> {
  assertReadinessHandoff(handoff, protocol);
  const envelope = encryptFieldValue({
    applicationVersion: "0.1.0",
    key,
    value: handoff,
  });
  await vault.putEnvelopeBatch([envelope]);
  await vault.putMetadata({
    key: "planner-readiness",
    value: {
      handoffId: handoff.handoffId,
      opaqueRecordKey: envelope.opaqueRecordKey,
      protocolPackageId: handoff.protocolPackageId,
      protocolPackageVersion: handoff.protocolPackageVersion,
      version: 1,
    },
  });
}

export function assertReadinessHandoff(
  handoff: FieldPlannerReadinessHandoff,
  protocol: PlannerProtocol,
): void {
  if (
    handoff.version !== 1 ||
    !/^[0-9a-f-]{36}$/iu.test(handoff.handoffId) ||
    !/^[a-zA-Z0-9._-]{1,200}$/u.test(handoff.source.id) ||
    handoff.source.kind !== "approved_local_handoff" ||
    handoff.protocolPackageId !== protocol.packageId ||
    handoff.protocolPackageVersion !== protocol.packageVersion ||
    handoff.coverageSnapshot.protocolPackageId !== protocol.packageId ||
    handoff.coverageSnapshot.protocolPackageVersion !== protocol.packageVersion ||
    !Number.isFinite(Date.parse(handoff.handedOffAt))
  ) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  for (const gate of handoff.inputs.assignmentGates) {
    if (!protocol.assignments.some((assignment) => assignment.id === gate.assignmentId)) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }
  for (const evidence of handoff.inputs.eligibilityEvidence) {
    if (!protocol.assignments.some((assignment) => assignment.id === evidence.assignmentId)) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }
}
