// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldRecoveryExport {
  schemaVersion: "field-recovery-export.v1";
  filename: string;
  createdAt: string;
  encryption: "xchacha20-poly1305";
  ciphertextBytes: number;
  ciphertextSha256: string;
  keyId: string;
  restoreInstructionsVersion: "1.0.0";
}
