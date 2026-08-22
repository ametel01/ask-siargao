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
    },
    ...{
      packageId: string;
      version: string;
    }[],
  ];
  createdAt: string;
  /**
   * @minItems 1
   */
  recordIds: [string, ...string[]];
  /**
   * @minItems 1
   */
  reviewIds: [string, ...string[]];
  assetReferences: string[];
  referentialClosureSha256: string;
  payloadSha256: string;
  encryption: "none_no_protected_data" | "xchacha20-poly1305";
}
