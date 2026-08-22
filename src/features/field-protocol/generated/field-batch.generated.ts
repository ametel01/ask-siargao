// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldBatch {
  schemaVersion: "field-batch.v2";
  filename: string;
  batchId: string;
  /**
   * @minItems 1
   */
  protocolPackages: [
    {
      packageId: string;
      version: string;
      componentVersions: {
        schemas: string;
        distributionSchemas: string;
        observationKinds: string;
        methodProfiles: string;
        subjects: string;
        geography: string;
        campaign: string;
        help: string;
        migration: string;
        examples: string;
      };
    },
    ...{
      packageId: string;
      version: string;
      componentVersions: {
        schemas: string;
        distributionSchemas: string;
        observationKinds: string;
        methodProfiles: string;
        subjects: string;
        geography: string;
        campaign: string;
        help: string;
        migration: string;
        examples: string;
      };
    }[],
  ];
  createdAt: string;
  recordCounts: {
    fieldVisit: number;
    fieldObservation: number;
    routeRun: number;
    sourceStatement: number;
    statementTranslation: number;
    evidenceAsset: number;
    fieldReview: number;
  };
  /**
   * @minItems 1
   */
  files: [
    {
      recordType:
        | "fieldVisit"
        | "fieldObservation"
        | "routeRun"
        | "sourceStatement"
        | "statementTranslation"
        | "evidenceAsset"
        | "fieldReview";
      filename: string;
      byteSize: number;
      sha256: string;
      recordCount: number;
    },
    ...{
      recordType:
        | "fieldVisit"
        | "fieldObservation"
        | "routeRun"
        | "sourceStatement"
        | "statementTranslation"
        | "evidenceAsset"
        | "fieldReview";
      filename: string;
      byteSize: number;
      sha256: string;
      recordCount: number;
    }[],
  ];
  reviewerSummary: {
    /**
     * @minItems 1
     */
    reviewerIds: [string, ...string[]];
    includesSelfReview: boolean;
    independentReviewCount: number;
  };
  lineage: {
    /**
     * @minItems 1
     */
    campaignIds: [string, ...string[]];
    /**
     * @minItems 1
     */
    assignmentIds: [string, ...string[]];
    /**
     * @minItems 1
     */
    visitIds: [string, ...string[]];
    /**
     * @minItems 1
     */
    researcherIds: [string, ...string[]];
    supersessionRecordIds: string[];
    conflictRecordIds: string[];
    /**
     * @minItems 1
     */
    reviewIds: [string, ...string[]];
  };
  assetReferences: string[];
  referentialClosureSha256: string;
  payloadSha256: string;
  encryption: "none_no_protected_data" | "xchacha20-poly1305";
}
