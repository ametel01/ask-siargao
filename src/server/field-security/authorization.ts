import {
  operatorMutationVerificationConfig,
  readOperatorAccountAllowlist,
} from "@/server/operations/operator-auth";

export const fieldResearcherVerificationConfig = operatorMutationVerificationConfig;

export type FieldResearcherAuthSnapshot = {
  accountId: string | null;
  mfaFresh: boolean;
};

export function readFieldResearcherAccountAllowlist(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const fieldResearchers = env.FIELD_RESEARCHER_ACCOUNT_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...(fieldResearchers ?? []), ...readOperatorAccountAllowlist(env)]);
}

export function authorizeFieldResearcher(input: {
  allowlist: ReadonlySet<string>;
  auth: FieldResearcherAuthSnapshot;
  mutation: boolean;
}):
  | { allowed: true; accountId: string }
  | {
      allowed: false;
      reason: "field_researcher_not_authorized" | "fresh_mfa_required" | "unauthenticated";
    } {
  if (!input.auth.accountId) return { allowed: false, reason: "unauthenticated" };
  if (!input.allowlist.has(input.auth.accountId)) {
    return { allowed: false, reason: "field_researcher_not_authorized" };
  }
  if (input.mutation && !input.auth.mfaFresh) {
    return { allowed: false, reason: "fresh_mfa_required" };
  }
  return { allowed: true, accountId: input.auth.accountId };
}
