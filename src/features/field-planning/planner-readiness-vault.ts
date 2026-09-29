import { z } from "zod";
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

const instantSchema = z.iso.datetime({ offset: true });
const identifierSchema = z.string().min(1).max(256);
const nonNegativeNumberSchema = z.number().finite().nonnegative();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const gateStateSchema = z.enum(["allowed", "blocked", "unknown"]);

const assignmentGateEvidenceSchema = z.strictObject({
  id: identifierSchema,
  assignmentId: identifierSchema,
  safety: gateStateSchema,
  permission: gateStateSchema,
  access: gateStateSchema,
  sourceId: identifierSchema,
  retrievedAt: instantSchema,
  validUntil: instantSchema,
  fingerprint: identifierSchema,
});

const preflightEvidenceSchema = z.strictObject({
  id: identifierSchema,
  assignmentId: identifierSchema,
  kind: identifierSchema,
  value: z.string().min(1).max(1_024),
  state: gateStateSchema,
  sourceId: identifierSchema,
  retrievedAt: instantSchema,
  validUntil: instantSchema,
  fingerprint: identifierSchema,
});

const coverageRequirementStateSchema = z.strictObject({
  assignmentId: identifierSchema,
  coverageRequirementId: identifierSchema,
  capturedCount: nonNegativeIntegerSchema,
  distinctWindows: nonNegativeIntegerSchema,
  oldestAdmissibleEvidenceAt: instantSchema.optional(),
});

const coverageSnapshotSchema = z.strictObject({
  id: identifierSchema,
  version: identifierSchema,
  capturedAt: instantSchema,
  protocolPackageId: identifierSchema,
  protocolPackageVersion: identifierSchema,
  requirementStates: z.array(coverageRequirementStateSchema),
  resolvedAssignmentAreaIds: z.record(identifierSchema, identifierSchema),
});

const plannerInputsSchema = z.strictObject({
  planningAt: instantSchema,
  startingAreaId: identifierSchema,
  transportMode: identifierSchema,
  availableMinutes: nonNegativeNumberSchema,
  reserveMinutes: z.strictObject({
    safety: nonNegativeNumberSchema,
    documentation: nonNegativeNumberSchema,
    rest: nonNegativeNumberSchema,
    daylight: nonNegativeNumberSchema,
  }),
  preciseLocation: z
    .strictObject({ label: z.string().min(1).max(512), permission: z.literal("granted") })
    .optional(),
  assignmentGates: z.array(assignmentGateEvidenceSchema),
  eligibilityEvidence: z.array(preflightEvidenceSchema),
  partialCoverageSetIds: z.record(identifierSchema, identifierSchema).optional(),
});

const fieldPlannerReadinessHandoffSchema = z.strictObject({
  version: z.literal(1),
  handoffId: z.uuid(),
  handedOffAt: instantSchema,
  source: z.strictObject({
    kind: z.literal("approved_local_handoff"),
    id: z
      .string()
      .regex(/^field_readiness_[A-Za-z0-9_-]{16,}$/u)
      .max(256),
  }),
  protocolPackageId: identifierSchema,
  protocolPackageVersion: identifierSchema,
  coverageSnapshot: coverageSnapshotSchema,
  inputs: plannerInputsSchema,
});

/**
 * Read the machine-generated initial handoff supplied by the protected server
 * deployment. This is an internal deployment seam, not a user-facing JSON
 * authoring path. The caller must still validate it against the installed
 * protocol before using it.
 */
export function parsePreseededPlannerReadiness(
  raw: string | undefined,
  protocol: PlannerProtocol,
  nowMs = Date.now(),
): FieldPlannerReadinessHandoff | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    assertReadinessHandoff(parsed, protocol, nowMs);
    return parsed;
  } catch {
    throw new FieldSecurityError("field_artifact_invalid");
  }
}

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
  nowMs = Date.now(),
): Promise<FieldPlannerReadinessHandoff | undefined> {
  const pointer = await vault.getMetadata("planner-readiness");
  if (!pointer) return undefined;
  const envelope = await vault.getEnvelope(pointer.value.opaqueRecordKey);
  if (!envelope) throw new FieldSecurityError("field_artifact_invalid");
  const handoff = decryptFieldValue<FieldPlannerReadinessHandoff>(envelope, key);
  assertReadinessHandoff(handoff, protocol, nowMs);
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
  nowMs = Date.now(),
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
  assertReadinessHandoff(handoff, protocol, nowMs);
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

/**
 * Adopt an authenticated deployment handoff into encrypted local custody.
 * The handoff is not usable until the durable vault write has completed.
 */
export async function persistPreseededPlannerReadiness(
  handoff: unknown,
  protocol: PlannerProtocol,
  key: Uint8Array,
  vault = new IndexedDbFieldVault(),
  nowMs = Date.now(),
): Promise<FieldPlannerReadinessHandoff> {
  assertReadinessHandoff(handoff, protocol, nowMs);
  await savePlannerReadiness(handoff, protocol, key, vault, nowMs);
  return handoff;
}

export function assertReadinessHandoff(
  handoff: unknown,
  protocol: PlannerProtocol,
  nowMs = Date.now(),
): asserts handoff is FieldPlannerReadinessHandoff {
  const parsed = fieldPlannerReadinessHandoffSchema.safeParse(handoff);
  if (!parsed.success) throw new FieldSecurityError("field_artifact_invalid");
  const value = parsed.data;
  const handedOffAtMs = Date.parse(value.handedOffAt);
  if (
    value.protocolPackageId !== protocol.packageId ||
    value.protocolPackageVersion !== protocol.packageVersion ||
    value.coverageSnapshot.protocolPackageId !== protocol.packageId ||
    value.coverageSnapshot.protocolPackageVersion !== protocol.packageVersion ||
    handedOffAtMs > nowMs + 2 * 60_000 ||
    nowMs - handedOffAtMs > 24 * 60 * 60_000 ||
    !protocol.areas.includes(value.inputs.startingAreaId) ||
    !protocol.transportModes.includes(value.inputs.transportMode) ||
    Date.parse(value.coverageSnapshot.capturedAt) > handedOffAtMs + 2 * 60_000
  ) {
    throw new FieldSecurityError("field_artifact_invalid");
  }

  const assignments = new Map(
    protocol.assignments.map((assignment) => [assignment.id, assignment]),
  );
  const areaIds = new Set(protocol.areas);
  const assignmentGateIds = new Set<string>();
  for (const gate of value.inputs.assignmentGates) {
    if (
      !assignments.has(gate.assignmentId) ||
      assignmentGateIds.has(gate.assignmentId) ||
      /^fixture|^test|^preflight$/iu.test(gate.sourceId) ||
      /^gate-fingerprint-|^fixture|^test/iu.test(gate.fingerprint) ||
      Date.parse(gate.retrievedAt) > Date.parse(gate.validUntil)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    assignmentGateIds.add(gate.assignmentId);
  }

  const eligibilityEvidenceIds = new Set<string>();
  for (const evidence of value.inputs.eligibilityEvidence) {
    const assignment = assignments.get(evidence.assignmentId);
    const evidenceId = `${evidence.assignmentId}\u0000${evidence.kind}`;
    if (
      !assignment?.eligibilityWindows.some((window) => window.kind === evidence.kind) ||
      eligibilityEvidenceIds.has(evidenceId) ||
      /^fixture|^test|^preflight$/iu.test(evidence.sourceId) ||
      /^preflight-|^fixture|^test/iu.test(evidence.fingerprint) ||
      Date.parse(evidence.retrievedAt) > Date.parse(evidence.validUntil)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    eligibilityEvidenceIds.add(evidenceId);
  }

  const coverageRequirementIds = new Set<string>();
  for (const state of value.coverageSnapshot.requirementStates) {
    const assignment = assignments.get(state.assignmentId);
    const stateId = `${state.assignmentId}\u0000${state.coverageRequirementId}`;
    if (
      !assignment?.coverageRequirements.some(
        (requirement) => requirement.id === state.coverageRequirementId,
      ) ||
      coverageRequirementIds.has(stateId)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
    coverageRequirementIds.add(stateId);
  }

  for (const [assignmentId, areaId] of Object.entries(
    value.coverageSnapshot.resolvedAssignmentAreaIds,
  )) {
    if (!assignments.has(assignmentId) || !areaIds.has(areaId)) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }

  for (const [assignmentId, partialCoverageSetId] of Object.entries(
    value.inputs.partialCoverageSetIds ?? {},
  )) {
    if (
      !assignments
        .get(assignmentId)
        ?.partialCoverageSets.some((coverageSet) => coverageSet.id === partialCoverageSetId)
    ) {
      throw new FieldSecurityError("field_artifact_invalid");
    }
  }
}
