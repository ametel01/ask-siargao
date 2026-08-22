import { canonicalStringify } from "@/features/field-protocol/canonical-json";

import { proposeFieldDayPlan } from "./field-planner";
import type {
  FieldCoverageSnapshot,
  FieldPlanAdjustment,
  FieldPlanProposal,
  FieldPlanRevisionMetadata,
  FieldPlanSnapshot,
  PlannerInputs,
  PlannerProtocol,
} from "./field-planning-types";

export async function confirmFieldPlanSnapshot(input: {
  protocol: PlannerProtocol;
  coverageSnapshot: FieldCoverageSnapshot;
  plannerInputs: PlannerInputs;
  proposal: FieldPlanProposal;
  metadata: FieldPlanRevisionMetadata;
  adjustments?: readonly FieldPlanAdjustment[];
  priorSnapshot?: FieldPlanSnapshot;
}): Promise<FieldPlanSnapshot> {
  if (!Number.isFinite(Date.parse(input.metadata.confirmedAt))) {
    throw new Error("Snapshot confirmation requires an explicit timestamp.");
  }
  if (input.priorSnapshot && input.priorSnapshot.snapshotId === input.metadata.snapshotId) {
    throw new Error("A revision requires a new immutable snapshot ID.");
  }
  const regeneratedProposal = proposeFieldDayPlan(
    input.protocol,
    input.coverageSnapshot,
    input.plannerInputs,
  );
  if (canonicalStringify(regeneratedProposal) !== canonicalStringify(input.proposal)) {
    throw new Error("Snapshot proposal does not match current hard-gated planning inputs.");
  }
  const invalidatedEvidenceIds = input.priorSnapshot
    ? changedEvidenceIds(input.priorSnapshot.inputs, input.plannerInputs)
    : [];
  const payload = {
    schemaVersion: "field-plan-snapshot.v1" as const,
    snapshotId: input.metadata.snapshotId,
    revision: (input.priorSnapshot?.revision ?? 0) + 1,
    priorSnapshotId: input.priorSnapshot?.snapshotId,
    revisionReason: input.metadata.revisionReason,
    confirmedAt: input.metadata.confirmedAt,
    researcherId: input.metadata.researcherId,
    deviceId: input.metadata.deviceId,
    protocol: {
      packageId: input.protocol.packageId,
      packageVersion: input.protocol.packageVersion,
      campaignId: input.protocol.campaignId,
      campaignVersion: input.protocol.campaignVersion,
      geographyVersion: input.protocol.geographyVersion,
    },
    coverageSnapshot: input.coverageSnapshot,
    inputs: input.plannerInputs,
    proposal: input.proposal,
    adjustments: [...(input.adjustments ?? [])],
    invalidatedEvidenceIds,
    priorContentHash: input.priorSnapshot?.contentHash,
  };
  const contentHash = await sha256(canonicalStringify(payload));
  return deepFreeze(structuredClone({ ...payload, contentHash }));
}

function changedEvidenceIds(previous: PlannerInputs, current: PlannerInputs): string[] {
  const previousFingerprints = new Map(
    [...previous.assignmentGates, ...previous.eligibilityEvidence].map((entry) => [
      entry.id ?? `gate:${entry.assignmentId}`,
      entry.fingerprint,
    ]),
  );
  const currentFingerprints = new Map(
    [...current.assignmentGates, ...current.eligibilityEvidence].map((entry) => [
      entry.id,
      entry.fingerprint,
    ]),
  );
  return [...new Set([...previousFingerprints.keys(), ...currentFingerprints.keys()])]
    .filter((id) => previousFingerprints.get(id) !== currentFingerprints.get(id))
    .sort();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
