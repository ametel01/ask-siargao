import { type AuditJobState, auditJobStates } from "@/server/audit/enums";

export function parseAuditStatusState(value: string | undefined): AuditJobState {
  return auditJobStates.includes(value as AuditJobState)
    ? (value as AuditJobState)
    : "awaiting_payment";
}
