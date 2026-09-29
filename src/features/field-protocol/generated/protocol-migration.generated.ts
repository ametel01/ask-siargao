// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface ProtocolMigration {
  schemaVersion: "protocol-migration.v1";
  componentVersion: string;
  migrationId: string;
  fromPackageVersion: string;
  toPackageVersion: string;
  /**
   * @minItems 1
   */
  sourceSchemaVersions: [string, ...string[]];
  targetProtocolPackageId: string;
  targetCampaignId: string;
  kindMappings: {
    from: string;
    to: string;
  }[];
  subjectMappings: {
    from: string;
    to: string;
  }[];
  /**
   * @minItems 1
   */
  legacyObservationRoutes: [
    {
      subjectId: string;
      observationKind: string;
      assignmentId: string;
      objectiveId: string;
      coverageRequirementId: string;
    },
    ...{
      subjectId: string;
      observationKind: string;
      assignmentId: string;
      objectiveId: string;
      coverageRequirementId: string;
    }[],
  ];
  methodMappings: {
    from: string;
    to: string;
  }[];
  ambiguousKinds: {
    kind: string;
    reason: string;
  }[];
  unsupportedKinds: string[];
}
