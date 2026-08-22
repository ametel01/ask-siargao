import {
  hasVercelDeploymentSignals,
  readClerkDeploymentConfig,
} from "@/server/auth/clerk-deployment-config";

type HeaderReader = { get(name: string): string | null };

export const FIELD_SECURITY_HARNESS_COOKIE = "ask_siargao_field_security_harness";

function hasHarnessCookie(cookieHeader: string | null, token: string): boolean {
  return (cookieHeader ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .some((entry) => entry === `${FIELD_SECURITY_HARNESS_COOKIE}=${token}`);
}

export function isFieldSecurityProductionHarnessRequest(input: {
  headers: HeaderReader;
  pathname: string;
}): boolean {
  const token = process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN?.trim();
  const hasHarnessHeaders =
    input.headers.get("x-ask-siargao-field-security-harness") === "1" &&
    input.headers.get("x-ask-siargao-field-security-harness-token") === token;
  const hasHarnessCredential =
    hasHarnessHeaders || hasHarnessCookie(input.headers.get("cookie"), token ?? "");
  if (
    process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS !== "1" ||
    hasVercelDeploymentSignals() ||
    (!input.pathname.startsWith("/operator/field") && input.pathname !== "/field-service-worker") ||
    !token ||
    token.length < 32 ||
    !hasHarnessCredential
  ) {
    return false;
  }
  const config = readClerkDeploymentConfig();
  return config.ok && config.config.mode === "disabled" && config.config.context === "local";
}
