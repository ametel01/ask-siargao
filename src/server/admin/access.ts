export type AdminAccessInput = {
  configuredToken?: string;
  suppliedToken?: string | null;
  nodeEnv?: string;
  operatorAccountId?: string | null;
  operatorAllowlist?: ReadonlySet<string>;
};

export type AdminAccessResult =
  | { allowed: true; mode: "operator" | "token" | "local" }
  | { allowed: false; reason: "missing_token" | "invalid_token" | "production_token_required" };

export function evaluateAdminAccess(input: AdminAccessInput): AdminAccessResult {
  const configuredToken = input.configuredToken?.trim();
  const suppliedToken = input.suppliedToken?.trim();
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV;

  if (input.operatorAccountId && input.operatorAllowlist?.has(input.operatorAccountId)) {
    return { allowed: true, mode: "operator" };
  }

  if (configuredToken && nodeEnv !== "production") {
    return suppliedToken === configuredToken
      ? { allowed: true, mode: "token" }
      : { allowed: false, reason: suppliedToken ? "invalid_token" : "missing_token" };
  }

  if (nodeEnv === "production") {
    return { allowed: false, reason: "production_token_required" };
  }

  return { allowed: true, mode: "local" };
}
