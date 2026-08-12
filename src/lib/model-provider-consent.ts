export const modelProviderConsentVersion = "deepseek-cn-2026-08-13";
export const modelProviderConsentCookieName = "ask_siargao_model_provider_consent";
export const modelProviderConsentMaxAgeSeconds = 60 * 60 * 24 * 180;

type ModelProviderConsentEnvironment = Record<string, string | undefined>;

export function requiresModelProviderConsent(env: ModelProviderConsentEnvironment = process.env) {
  return isProductionEnvironment(env) && resolveProvider(env) === "deepseek";
}

export function requiresBrowserModelProviderConsent(
  env: ModelProviderConsentEnvironment = {
    NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED:
      process.env.NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED,
  },
) {
  return env.NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED?.trim().toLowerCase() === "true";
}

export function hasModelProviderConsent(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) {
      return false;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return name === modelProviderConsentCookieName && value === modelProviderConsentVersion;
  });
}

export function modelProviderConsentCookie({ secure }: { secure: boolean }) {
  const attributes = [
    `${modelProviderConsentCookieName}=${modelProviderConsentVersion}`,
    "Path=/",
    `Max-Age=${modelProviderConsentMaxAgeSeconds}`,
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function isProductionEnvironment(env: ModelProviderConsentEnvironment) {
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "production";
  }
  if (env.APP_ENV) {
    return env.APP_ENV === "production";
  }
  return env.NODE_ENV === "production";
}

function resolveProvider(env: ModelProviderConsentEnvironment) {
  return env.CHAT_MODEL_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "deepseek";
}
