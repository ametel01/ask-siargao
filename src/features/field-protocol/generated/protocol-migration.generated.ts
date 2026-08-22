// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface ProtocolMigration {
  schemaVersion: "protocol-migration.v1";
  componentVersion: string;
  migrationId: string;
  fromPackageVersion: string;
  toPackageVersion: string;
  kindMappings: {
    from: string;
    to: string;
  }[];
  subjectMappings: {
    from: string;
    to: string;
  }[];
  ambiguousKinds: {
    kind: string;
    reason: string;
  }[];
  unsupportedKinds: string[];
}
