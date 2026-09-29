import {
  hasVercelDeploymentSignals,
  readClerkDeploymentConfig,
} from "@/server/auth/clerk-deployment-config";

type HeaderReader = { get(name: string): string | null };

export function isProtectedUiHarnessRequest(input: { headers: HeaderReader }): boolean {
  const token = process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN?.trim();

  if (
    process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS !== "1" ||
    process.env.NODE_ENV === "production" ||
    hasVercelDeploymentSignals() ||
    !token ||
    token.length < 32 ||
    input.headers.get("x-ask-siargao-protected-ui-harness") !== "1" ||
    input.headers.get("x-ask-siargao-protected-ui-harness-token") !== token
  ) {
    return false;
  }

  const result = readClerkDeploymentConfig();
  return (
    result.ok &&
    result.config.mode === "disabled" &&
    (result.config.context === "local" || result.config.context === "test")
  );
}
