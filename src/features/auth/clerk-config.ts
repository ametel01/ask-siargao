export type ClerkAuthMode = "enabled" | "disabled";
type PublicClerkEnv = {
  NEXT_PUBLIC_CLERK_AUTH_MODE?: string | undefined;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string | undefined;
};

export function readPublicClerkAuthMode(env: PublicClerkEnv = process.env as PublicClerkEnv) {
  return env.NEXT_PUBLIC_CLERK_AUTH_MODE === "enabled" &&
    hasEnvValue(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    ? "enabled"
    : "disabled";
}

export const isClerkConfigured = readPublicClerkAuthMode() === "enabled";

function hasEnvValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
