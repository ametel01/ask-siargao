export type GateState = "allowed" | "blocked" | "unknown";

export type PlanningReasonCode =
  | "included"
  | "hard_gate_blocked"
  | "missing_gate_evidence"
  | "eligibility_not_current"
  | "eligibility_value_mismatch"
  | "transport_incompatible"
  | "transfer_boundary"
  | "unresolved_geography"
  | "insufficient_capacity"
  | "coverage_complete"
  | "partial_coverage_selected"
  | "not_selected_after_ranking";

export type PlanningReason = Readonly<{
  code: PlanningReasonCode;
  assignmentId: string;
  facts: Readonly<Record<string, string | number | boolean>>;
}>;

export type EligibilityWindowRule = Readonly<{
  kind: string;
  rarityRank: number;
  maximumAgeMinutes: number;
  hardGate: true;
}>;

export type PlannerCoverageRequirement = Readonly<{
  id: string;
  objectiveId: string;
  required: boolean;
  minimumRecords: number;
  minimumDistinctWindows: number;
}>;

export type PlannerPartialCoverageSet = Readonly<{
  id: string;
  objectiveIds: readonly string[];
}>;

export type PlannerAssignment = Readonly<{
  id: string;
  title: string;
  estimatedMinutes: number;
  editorialPriority: number;
  evidenceFreshnessReviewMinutes: number;
  anchorAreaId?: string;
  anchorResolution?: "coverage_snapshot_required";
  eligibilityWindows: readonly Readonly<{ kind: string; values: readonly string[] }>[];
  coverageRequirements: readonly PlannerCoverageRequirement[];
  partialCoverageSets: readonly PlannerPartialCoverageSet[];
  safeFallbackAssignmentId?: string;
}>;

export type TravelEdge = Readonly<{
  from: string;
  to: string;
  modes: readonly string[];
  durationBandMinutes: readonly [number, number];
  direction: "directed" | "bidirectional";
  transferBoundary: boolean;
}>;

export type PlannerProtocol = Readonly<{
  packageId: string;
  packageVersion: string;
  campaignId: string;
  campaignVersion: string;
  geographyVersion: string;
  areas: readonly string[];
  transportModes: readonly string[];
  eligibilityRules: readonly EligibilityWindowRule[];
  assignments: readonly PlannerAssignment[];
  travelEdges: readonly TravelEdge[];
}>;

export type PreflightEvidence = Readonly<{
  id: string;
  assignmentId: string;
  kind: string;
  value: string;
  state: GateState;
  sourceId: string;
  retrievedAt: string;
  validUntil: string;
  fingerprint: string;
}>;

export type AssignmentGateEvidence = Readonly<{
  id: string;
  assignmentId: string;
  safety: GateState;
  permission: GateState;
  access: GateState;
  sourceId: string;
  retrievedAt: string;
  validUntil: string;
  fingerprint: string;
}>;

export type CoverageRequirementState = Readonly<{
  assignmentId: string;
  coverageRequirementId: string;
  capturedCount: number;
  distinctWindows: number;
  oldestAdmissibleEvidenceAt?: string;
}>;

export type FieldCoverageSnapshot = Readonly<{
  id: string;
  version: string;
  capturedAt: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  requirementStates: readonly CoverageRequirementState[];
  resolvedAssignmentAreaIds: Readonly<Record<string, string>>;
}>;

export type PlannerInputs = Readonly<{
  planningAt: string;
  startingAreaId: string;
  transportMode: string;
  availableMinutes: number;
  reserveMinutes: Readonly<{
    safety: number;
    documentation: number;
    rest: number;
    daylight: number;
  }>;
  preciseLocation?: Readonly<{ label: string; permission: "granted" }>;
  assignmentGates: readonly AssignmentGateEvidence[];
  eligibilityEvidence: readonly PreflightEvidence[];
  partialCoverageSetIds?: Readonly<Record<string, string>>;
}>;

export type CoverageConsequence = Readonly<{
  coverageRequirementId: string;
  remainingRecords: number;
  remainingDistinctWindows: number;
}>;

export type PlannedAssignment = Readonly<{
  assignmentId: string;
  title: string;
  areaId: string;
  partialCoverageSetId?: string;
  travelFromPreviousMinutes: number;
  returnToStartMinutes: number;
  workMinutes: number;
  outstandingRequiredCoverage: number;
  consequences: readonly CoverageConsequence[];
  reasons: readonly PlanningReason[];
}>;

export type FieldPlanProposal = Readonly<{
  protocolPackageId: string;
  protocolPackageVersion: string;
  coverageSnapshotId: string;
  selected: readonly PlannedAssignment[];
  exclusions: readonly PlanningReason[];
  availableMinutes: number;
  reserveMinutes: number;
  usableMinutes: number;
  consumedMinutes: number;
  plannedReturnMinutes: number;
  remainingMinutes: number;
}>;

export type FieldPlanAdjustment =
  | Readonly<{ kind: "remove"; assignmentId: string }>
  | Readonly<{ kind: "move"; assignmentId: string; direction: "earlier" | "later" }>
  | Readonly<{ kind: "add"; assignmentId: string; partialCoverageSetId?: string }>;

export type FieldPlanAdjustmentResult = Readonly<{
  proposal: FieldPlanProposal;
  adjustment: FieldPlanAdjustment;
  coverageImpact: readonly CoverageConsequence[];
}>;

export type FieldPlanRevisionMetadata = Readonly<{
  snapshotId: string;
  confirmedAt: string;
  researcherId: string;
  deviceId: string;
  revisionReason: string;
}>;

export type FieldPlanSnapshot = Readonly<{
  schemaVersion: "field-plan-snapshot.v1";
  snapshotId: string;
  revision: number;
  priorSnapshotId?: string;
  revisionReason: string;
  confirmedAt: string;
  researcherId: string;
  deviceId: string;
  protocol: Readonly<{
    packageId: string;
    packageVersion: string;
    campaignId: string;
    campaignVersion: string;
    geographyVersion: string;
  }>;
  coverageSnapshot: FieldCoverageSnapshot;
  inputs: PlannerInputs;
  proposal: FieldPlanProposal;
  adjustments: readonly FieldPlanAdjustment[];
  invalidatedEvidenceIds: readonly string[];
  priorContentHash?: string;
  contentHash: string;
}>;
