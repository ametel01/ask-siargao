// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldDayClose {
  schemaVersion: "field-day-close.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  planSnapshotId: string;
  assignmentOutcomeIds: string[];
  followUpAssignmentIds: string[];
  unresolvedRecordIds: string[];
  permissionIssueRecordIds: string[];
  assetIssueRecordIds: string[];
  recoveryStatus: "recovery_required" | "verified";
  closedAt: string;
}
