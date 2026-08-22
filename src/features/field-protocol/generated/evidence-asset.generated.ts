// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface EvidenceAsset {
  schemaVersion: "evidence-asset.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitId: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
  supersedesId?: string;
  assetKind: "photo" | "receipt_scan" | "document_scan";
  byteSize: number;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
  contentSha256: string;
  capturedAt: string;
  purpose:
    | "orientation"
    | "measurement_context"
    | "posted_information"
    | "transaction_receipt"
    | "consent_record";
  /**
   * @minItems 1
   */
  objectiveIds: [string, ...string[]];
  recordIds: string[];
  permittedLocation: "withheld" | "governed_area" | "route_corridor" | "approximate_100m";
  peoplePresent: "none" | "researcher_only" | "consenting_people" | "bystanders_present";
  rights: "research_internal" | "licensed_internal" | "public_use_granted";
  consentState: "not_required" | "denied" | "granted" | "withdrawn";
  redactionState: "not_required" | "pending" | "complete" | "blocked";
  retentionState: "active" | "pending_deletion" | "deleted";
  redactedDerivativeId?: string;
  sourceAssetId?: string;
}
