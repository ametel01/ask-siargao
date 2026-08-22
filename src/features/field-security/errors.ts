export const fieldSecurityErrorCodes = [
  "field_authorization_required",
  "field_artifact_incomplete",
  "field_artifact_invalid",
  "field_artifact_recipient_invalid",
  "field_artifact_replay",
  "field_ciphertext_tampered",
  "field_clock_rollback_detected",
  "field_device_not_authorized",
  "field_device_revoked",
  "field_grant_expired",
  "field_grant_invalid",
  "field_grant_version_incompatible",
  "field_key_unavailable",
  "field_media_integrity_failed",
  "field_media_too_large",
  "field_offline_shell_unavailable",
  "field_protocol_incompatible",
  "field_purge_not_authorized",
  "field_recorder_resume_invalid",
  "field_recorder_revision_conflict",
  "field_recovery_not_verified",
  "field_storage_unavailable",
  "field_transfer_receipt_invalid",
  "field_unlock_credential_ineligible",
  "field_unlock_failed",
  "field_writer_conflict",
  "field_writer_takeover_required",
] as const;

export type FieldSecurityErrorCode = (typeof fieldSecurityErrorCodes)[number];

export class FieldSecurityError extends Error {
  readonly code: FieldSecurityErrorCode;

  constructor(code: FieldSecurityErrorCode) {
    super(code);
    this.name = "FieldSecurityError";
    this.code = code;
  }
}

export function fieldSecurityErrorCode(error: unknown): FieldSecurityErrorCode {
  return error instanceof FieldSecurityError ? error.code : "field_unlock_failed";
}
