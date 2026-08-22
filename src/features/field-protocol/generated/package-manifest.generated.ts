// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldProtocolPackageManifest {
  schemaVersion: "field-protocol-package-manifest.v1";
  packageId: string;
  packageVersion: string;
  createdAt: string;
  signerKeyId: string;
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
  compatibility: {
    minimumApplicationVersion: string;
    maximumApplicationVersionExclusive: string;
  };
  migrationDeclaration: {
    strategy: "initial_install" | "explicit_preview_required";
    supportedFromVersions: string[];
    migrationIds: string[];
  };
  /**
   * @minItems 1
   */
  files: [
    {
      path: string;
      sha256: string;
    },
    ...{
      path: string;
      sha256: string;
    }[],
  ];
  signature: {
    algorithm: "Ed25519";
    value: string;
  };
}
