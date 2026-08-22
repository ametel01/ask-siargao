import type { FieldPlanSnapshot } from "@/features/field-planning/field-planning-types";
import type {
  CaptureException,
  EvidenceAsset,
  FieldObservation,
  FieldVisit,
  AssignmentOutcome as ProtocolAssignmentOutcome,
  FieldDayClose as ProtocolFieldDayClose,
  FollowUpAssignment as ProtocolFollowUpAssignment,
  ObjectiveCoverage as ProtocolObjectiveCoverage,
  RouteRun,
  SchemaGap,
  SourceStatement,
  StatementTranslation,
} from "@/features/field-protocol/generated";

export const recorderSteps = [
  "briefing",
  "safety",
  "start_visit",
  "objectives",
  "gaps",
  "close_visit",
  "outcome",
] as const;

export type RecorderStepName = (typeof recorderSteps)[number];

export type RecorderStep = Readonly<{
  name: RecorderStepName;
  assignmentId: string;
  visitId?: string;
  objectiveId?: string;
  coverageRequirementId?: string;
}>;

export type RequirementCoverageStatus =
  | "unstarted"
  | "in_progress"
  | "satisfied"
  | "blocked"
  | "not_applicable"
  | "needs_resolution";

export type ObjectiveCoverageStatus =
  | "unstarted"
  | "in_progress"
  | "satisfied"
  | "blocked"
  | "needs_resolution";

export type RequirementCoverage = Readonly<{
  coverageRequirementId: string;
  objectiveId: string;
  status: RequirementCoverageStatus;
  capturedRecords: number;
  requiredRecords: number;
  distinctWindows: number;
  requiredDistinctWindows: number;
  supportingAssets: number;
  capturedRecordIds: readonly string[];
  distinctWindowIds: readonly string[];
  supportingAssetIds: readonly string[];
  reasonCodes: readonly string[];
}>;

export type ObjectiveCoverage = Readonly<{
  objectiveId: string;
  status: ObjectiveCoverageStatus;
  requirements: readonly RequirementCoverage[];
  sourceRecordIds: readonly string[];
}>;

export type AssignmentExecutionStatus =
  | "planned"
  | "in_progress"
  | "complete"
  | "closed_with_gaps"
  | "needs_attention"
  | "deferred";

export type AssignmentExecution = Readonly<{
  assignmentId: string;
  status: AssignmentExecutionStatus;
  visitIds: readonly string[];
  unresolvedRequirementIds: readonly string[];
  outcomeId?: string;
  closedAt?: string;
}>;

export type FollowUpAssignment = Readonly<ProtocolFollowUpAssignment>;
export type AssignmentOutcome = Readonly<ProtocolAssignmentOutcome>;
export type FieldDayClose = Readonly<ProtocolFieldDayClose>;

export type RecorderProtocolRecord =
  | FieldVisit
  | FieldObservation
  | RouteRun
  | SourceStatement
  | StatementTranslation
  | EvidenceAsset
  | CaptureException
  | SchemaGap;

export type RecorderRecordKind =
  | "fieldVisit"
  | "fieldObservation"
  | "routeRun"
  | "sourceStatement"
  | "statementTranslation"
  | "evidenceAsset"
  | "captureException"
  | "schemaGap";

export type RecorderRecord =
  | Readonly<{ kind: "fieldVisit"; value: FieldVisit }>
  | Readonly<{ kind: "fieldObservation"; value: FieldObservation }>
  | Readonly<{ kind: "routeRun"; value: RouteRun }>
  | Readonly<{ kind: "sourceStatement"; value: SourceStatement }>
  | Readonly<{ kind: "statementTranslation"; value: StatementTranslation }>
  | Readonly<{ kind: "evidenceAsset"; value: EvidenceAsset }>
  | Readonly<{ kind: "captureException"; value: CaptureException }>
  | Readonly<{ kind: "schemaGap"; value: SchemaGap }>;

export type RecorderWork = Readonly<{
  schemaVersion: "field-recorder-work.v1";
  id: string;
  revision: number;
  planSnapshot: FieldPlanSnapshot;
  planContentHash: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  researcherId: string;
  deviceId: string;
  selectedPartialCoverageSetIds: Readonly<Record<string, string>>;
  step: RecorderStep;
  assignments: readonly AssignmentExecution[];
  records: readonly RecorderRecord[];
  mediaReceipts: readonly Readonly<{
    assetId: string;
    opaqueMediaKey: string;
    byteSize: number;
    sha256: string;
    mediaType: "image/jpeg" | "image/png" | "application/pdf";
  }>[];
  objectiveCoverage: readonly ObjectiveCoverage[];
  objectiveCoverageRecords: readonly Readonly<ProtocolObjectiveCoverage>[];
  assignmentOutcomes: readonly AssignmentOutcome[];
  followUps: readonly FollowUpAssignment[];
  fieldDayClose?: FieldDayClose;
  createdAt: string;
  updatedAt: string;
}>;

export type RecorderSaveState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "saving"; revision: number }>
  | Readonly<{ status: "saved"; revision: number; savedAt: string }>
  | Readonly<{ status: "save_failed"; revision: number; reason: string }>;

export type RecorderRuntimeStatus = Readonly<{
  online: boolean;
  location: "not_requested" | "denied" | "coarse" | "precise_active_visit";
  vault: "locked" | "unlocked";
  grantExpiresAt?: string;
  waitingUpdate: boolean;
  writer: "none" | "active" | "conflict";
  storageAvailableBytes: number;
  save: RecorderSaveState;
}>;

export const captureExceptionReasons = [
  "access_denied",
  "unsafe_conditions",
  "permission_declined",
  "subject_unavailable",
  "equipment_failure",
  "eligibility_changed",
  "interrupted",
  "not_applicable",
] as const;

export type CaptureExceptionReason = (typeof captureExceptionReasons)[number];
