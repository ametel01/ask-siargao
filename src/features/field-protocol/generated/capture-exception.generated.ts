// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface CaptureException {
  schemaVersion: "capture-exception.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  objectiveId: string;
  coverageRequirementId: string;
  visitId?: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
  supersedesId?: string;
  reason:
    | "access_denied"
    | "unsafe_conditions"
    | "permission_declined"
    | "subject_unavailable"
    | "equipment_failure"
    | "eligibility_changed"
    | "interrupted"
    | "not_applicable";
  reasonDetails: string;
  context: "planning" | "visit";
}
