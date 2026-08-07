export const accountClosureConfirmation = "CLOSE MY ACCOUNT";

export const accountClosureWarnings = [
  "Account Closure is terminal and cannot be undone.",
  "Public sharing stops as soon as local closure commits.",
  "Remaining Trip Pass time and answers are forfeited.",
  "There is no automatic proration; support can still review a separate refund request.",
] as const;

export type AccountClosureClientStatus =
  | "idle"
  | "submitting"
  | "request_failed"
  | "committed"
  | "committed_cleanup_failed";

export const accountClosureStatusMessages = {
  committed: "Account Closure committed permanently. Finishing local cleanup and sign-out now.",
  committed_cleanup_failed:
    "Your account is permanently closed. Local cleanup or sign-out did not finish; close this tab or return home.",
  request_failed:
    "Account Closure did not commit. Your account remains available; retry after checking your connection.",
} as const;

export function accountClosureFailureStatus(serverCommitted: boolean): AccountClosureClientStatus {
  return serverCommitted ? "committed_cleanup_failed" : "request_failed";
}
