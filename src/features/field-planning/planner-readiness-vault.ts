import { FieldDeskRepository } from "@/features/field-desk/field-desk-repository";
import { FieldRecorderRepository } from "@/features/field-recorder/field-recorder-repository";
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

export async function producePlannerReadinessFromCustody(
  protocol: PlannerProtocol,
  key: Uint8Array,
  vault = new IndexedDbFieldVault(),
): Promise<FieldPlannerReadinessHandoff> {
  const recorder = await new FieldRecorderRepository({ applicationVersion: "0.1.0", vault }).load(
    key,
  );
  const deskWorks = await new FieldDeskRepository("0.1.0", vault).list(key);
  const snapshot = recorder?.planSnapshot ?? deskWorks.at(-1)?.recorderWork.planSnapshot;
  if (!snapshot) throw new FieldSecurityError("field_key_unavailable");
  const handoff: FieldPlannerReadinessHandoff = {
    version: 1,
    handoffId: crypto.randomUUID(),
    handedOffAt: new Date().toISOString(),
    source: {
      kind: "approved_local_handoff",
      id: `field_readiness_vault_${crypto.randomUUID().replaceAll("-", "")}`,
    },
    protocolPackageId: snapshot.protocol.packageId,
    protocolPackageVersion: snapshot.protocol.packageVersion,
    coverageSnapshot: snapshot.coverageSnapshot,
    inputs: snapshot.inputs,
  };
  await savePlannerReadiness(handoff, protocol, key, vault);
  return handoff;
}

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
  const [authorization, fieldReadiness] = await Promise.all([
    vault.getMetadata("authorization-envelope"),
    vault.getMetadata("field-readiness"),
  ]);
  if (
    !authorization ||
    !fieldReadiness?.value.persisted ||
    !fieldReadiness.value.offlineShellPrepared
  ) {
    throw new FieldSecurityError("field_key_unavailable");
  }
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
    !/^field_readiness_[A-Za-z0-9_-]{16,}$/u.test(handoff.source.id) ||
    handoff.source.kind !== "approved_local_handoff" ||
    handoff.protocolPackageId !== protocol.packageId ||
    handoff.protocolPackageVersion !== protocol.packageVersion ||
    handoff.coverageSnapshot.protocolPackageId !== protocol.packageId ||
    handoff.coverageSnapshot.protocolPackageVersion !== protocol.packageVersion ||
    !Number.isFinite(Date.parse(handoff.handedOffAt)) ||
    Date.parse(handoff.handedOffAt) > Date.now() + 2 * 60_000 ||
    Date.now() - Date.parse(handoff.handedOffAt) > 24 * 60 * 60_000
  ) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  for (const gate of handoff.inputs.assignmentGates) {
    if (
      !protocol.assignments.some((assignment) => assignment.id === gate.assignmentId) ||
      /^fixture|^test|^preflight$/iu.test(gate.sourceId) ||
      /^gate-fingerprint-|^fixture|^test/iu.test(gate.fingerprint)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }
  for (const evidence of handoff.inputs.eligibilityEvidence) {
    if (
      !protocol.assignments.some((assignment) => assignment.id === evidence.assignmentId) ||
      /^fixture|^test|^preflight$/iu.test(evidence.sourceId) ||
      /^preflight-|^fixture|^test/iu.test(evidence.fingerprint)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }
}
