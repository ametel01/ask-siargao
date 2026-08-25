// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface StatementTranslation {
  schemaVersion: "statement-translation.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitId: string;
  objectiveId: string;
  coverageRequirementId: string;
  researcherId: string;
  deviceId: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
  sourceStatementId: string;
  originalLanguage: string;
  targetLanguage: string;
  translatedText: string;
  translator: {
    kind: "human" | "machine";
    identityOrMethod: string;
  };
  recordedAt: string;
  supersedesId?: string;
}
