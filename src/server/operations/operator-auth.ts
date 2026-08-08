export const operatorMutationVerificationConfig = {
  level: "second_factor",
  // Clerk reports an integer factor-verification age and checks `afterMinutes > age`.
  // Six includes minute ages 0 through 5 and rejects age 6.
  afterMinutes: 6,
} as const;

export type OperatorAuthSnapshot = {
  accountId: string | null;
  mfaFresh: boolean;
};

export type OperatorAuthorization =
  | { allowed: true; accountId: string }
  | {
      allowed: false;
      reason: "unauthenticated" | "operator_not_allowlisted" | "fresh_mfa_required";
    };

export function readOperatorAccountAllowlist(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const configured = env.OPERATOR_ACCOUNT_IDS?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set(configured ?? []);
}

export function authorizeOperator(input: {
  allowlist: ReadonlySet<string>;
  auth: OperatorAuthSnapshot;
  mutation: boolean;
}): OperatorAuthorization {
  if (!input.auth.accountId) return { allowed: false, reason: "unauthenticated" };
  if (!input.allowlist.has(input.auth.accountId)) {
    return { allowed: false, reason: "operator_not_allowlisted" };
  }
  if (input.mutation && !input.auth.mfaFresh) {
    return { allowed: false, reason: "fresh_mfa_required" };
  }
  return { allowed: true, accountId: input.auth.accountId };
}
