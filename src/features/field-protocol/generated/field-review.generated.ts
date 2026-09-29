// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldReview {
  schemaVersion: "field-review.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  recordId: string;
  reviewerId: string;
  researcherId: string;
  reviewerMatchesResearcher: boolean;
  reviewedAt: string;
  decision: "include" | "exclude" | "needs_more_evidence" | "correct_by_supersession";
  reason?: string;
  supersedingRecordId?: string;
}
