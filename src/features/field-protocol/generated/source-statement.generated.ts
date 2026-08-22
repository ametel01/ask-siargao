// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface SourceStatement {
  schemaVersion: "source-statement.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitId: string;
  objectiveId: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
  supersedesId?: string;
  subjectId: string;
  sourceRole:
    | "owner"
    | "manager"
    | "staff"
    | "driver"
    | "resident"
    | "visitor"
    | "official"
    | "other_governed";
  basisOfKnowledge:
    | "direct_responsibility"
    | "direct_experience"
    | "posted_policy"
    | "second_hand"
    | "unknown";
  questionAsked: string;
  originalLanguage: string;
  statementForm: "exact_quotation" | "labelled_paraphrase";
  originalStatement: string;
  attribution: "named" | "role_only" | "anonymous" | "not_for_publication";
  captureContext: string;
  consents: {
    participation: boolean;
    llmUse: boolean;
    articleUse: boolean;
    quotationUse: boolean;
    publicUse: boolean;
  };
  consentMethod: "verbal" | "written" | "recorded_form";
  consentRecordedAt: string;
  validUntil?: string;
  recontactAfter?: string;
  withdrawalRoute: string;
  translationIds: string[];
  assetIds: string[];
}
