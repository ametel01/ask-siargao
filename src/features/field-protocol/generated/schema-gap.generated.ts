// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface SchemaGap {
  schemaVersion: "schema-gap.v1";
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
  subject:
    | {
        kind: "governed";
        subjectId: string;
      }
    | {
        kind: "provisional";
        provisionalSubjectId: string;
      };
  attemptedAt: string;
  permittedLocation: "withheld" | "governed_area" | "route_corridor" | "approximate_100m";
  description: string;
  assetId?: string;
  resolutionState: "blocked_pending_protocol";
}
