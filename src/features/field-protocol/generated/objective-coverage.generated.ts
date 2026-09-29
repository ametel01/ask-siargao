// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface ObjectiveCoverage {
  schemaVersion: "objective-coverage.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  objectiveId: string;
  status: "unstarted" | "in_progress" | "satisfied" | "blocked" | "needs_resolution";
  /**
   * @minItems 1
   */
  requirements: [
    {
      coverageRequirementId: string;
      status:
        | "unstarted"
        | "in_progress"
        | "satisfied"
        | "blocked"
        | "not_applicable"
        | "needs_resolution";
      capturedRecordIds: string[];
      requiredRecords: number;
      distinctWindowIds: string[];
      requiredDistinctWindows: number;
      supportingAssetIds: string[];
      reasonCodes: (
        | "outside_partial_coverage_set"
        | "schema_gap"
        | "provisional_subject"
        | "unknown_or_not_tested"
        | "unresolved_contradiction"
        | "record_threshold"
        | "distinct_window_threshold"
        | "supporting_asset_required"
        | "invalid_capture_window_link"
        | "invalid_permission_link"
        | "invalid_asset_link"
        | "capture_exception"
        | "not_applicable"
      )[];
    },
    ...{
      coverageRequirementId: string;
      status:
        | "unstarted"
        | "in_progress"
        | "satisfied"
        | "blocked"
        | "not_applicable"
        | "needs_resolution";
      capturedRecordIds: string[];
      requiredRecords: number;
      distinctWindowIds: string[];
      requiredDistinctWindows: number;
      supportingAssetIds: string[];
      reasonCodes: (
        | "outside_partial_coverage_set"
        | "schema_gap"
        | "provisional_subject"
        | "unknown_or_not_tested"
        | "unresolved_contradiction"
        | "record_threshold"
        | "distinct_window_threshold"
        | "supporting_asset_required"
        | "invalid_capture_window_link"
        | "invalid_permission_link"
        | "invalid_asset_link"
        | "capture_exception"
        | "not_applicable"
      )[];
    }[],
  ];
  sourceRecordIds: string[];
  derivedAt: string;
}
