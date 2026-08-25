// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FollowUpAssignment {
  schemaVersion: "follow-up-assignment.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  originatingAssignmentId: string;
  /**
   * @minItems 1
   */
  originatingVisitIds: [string, ...string[]];
  /**
   * @minItems 1
   */
  coverageRequirementIds: [string, ...string[]];
  createdAt: string;
  reason: "closed_with_gaps" | "interrupted" | "needs_resolution";
}
