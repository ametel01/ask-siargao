// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface AssignmentOutcome {
  schemaVersion: "assignment-outcome.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitIds: string[];
  status: "complete" | "closed_with_gaps" | "deferred";
  unresolvedRequirementIds: string[];
  followUpAssignmentIds: string[];
  closedAt: string;
}
