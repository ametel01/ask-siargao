import type { ClerkAuthMode } from "@/features/auth/clerk-config";

export type ClerkDeploymentContext =
  | "build"
  | "local"
  | "preview"
  | "production"
  | "protected-staging"
  | "test";

export type ClerkDeploymentEnv = Partial<
  Record<
    | "CLERK_AUTH_MODE"
    | "CLERK_AUTHORIZED_PARTIES"
    | "CLERK_DEPLOYMENT_CONTEXT"
    | "CLERK_PRODUCTION_ORIGIN"
    | "CLERK_PRODUCTION_VERCEL_URL"
    | "CLERK_PROTECTED_STAGING_ORIGIN"
    | "CLERK_PROTECTED_STAGING_VERCEL_URL"
    | "CLERK_SECRET_KEY"
    | "CLERK_WEBHOOK_SIGNING_SECRET"
    | "NEXT_PUBLIC_APP_URL"
    | "NEXT_PUBLIC_CLERK_AUTH_MODE"
    | "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
    | "NODE_ENV"
    | "VERCEL_ENV"
    | "VERCEL_URL",
    string | undefined
  >
>;

export type ClerkConfigError = {
  code: string;
  field: string;
  message: string;
};

export type EnabledClerkDeploymentConfig = {
  authorizedParties: string[];
  canonicalOrigin: string;
  context: ClerkDeploymentContext;
  mode: "enabled";
  productionOrigin?: string;
  productionVercelUrl?: string;
  protectedStagingOrigin?: string;
  protectedStagingVercelUrl?: string;
};

export type DisabledClerkDeploymentConfig = {
  context: ClerkDeploymentContext;
  mode: "disabled";
};

export type ClerkDeploymentConfig = DisabledClerkDeploymentConfig | EnabledClerkDeploymentConfig;

export type ClerkDeploymentConfigResult =
  | { config: ClerkDeploymentConfig; ok: true }
  | { errors: ClerkConfigError[]; ok: false };

const clerkKeyFields = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
] as const;

const enabledRequiredFields = [
  ...clerkKeyFields,
  "NEXT_PUBLIC_CLERK_AUTH_MODE",
  "NEXT_PUBLIC_APP_URL",
  "CLERK_AUTHORIZED_PARTIES",
] as const;

const deploymentContexts = new Set<ClerkDeploymentContext>([
  "build",
  "local",
  "preview",
  "production",
  "protected-staging",
  "test",
]);

export function readClerkDeploymentConfig(
  env: ClerkDeploymentEnv = process.env,
): ClerkDeploymentConfigResult {
  const errors: ClerkConfigError[] = [];
  const context = resolveClerkDeploymentContext(env);
  validateExplicitDeploymentContext(env, errors);
  validatePlatformContext(env, context, errors);
  const mode = readClerkMode(env, context, errors);

  if (!mode) {
    return { ok: false, errors };
  }

  validatePublicClerkMode(env, mode, errors);

  if (mode === "disabled") {
    validateDisabledMode(env, context, errors);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, config: { context, mode } };
  }

  const canonicalOrigin = readRequiredOrigin(env, "NEXT_PUBLIC_APP_URL", context, errors);
  const authorizedParties = readAuthorizedParties(env, context, errors);
  const productionOrigin = readOptionalOrigin(env, "CLERK_PRODUCTION_ORIGIN", context, errors);
  const productionVercelUrl = readOptionalVercelUrl(env, "CLERK_PRODUCTION_VERCEL_URL", errors);
  const protectedStagingOrigin = readOptionalOrigin(
    env,
    "CLERK_PROTECTED_STAGING_ORIGIN",
    context,
    errors,
  );
  const protectedStagingVercelUrl = readOptionalVercelUrl(
    env,
    "CLERK_PROTECTED_STAGING_VERCEL_URL",
    errors,
  );

  for (const field of enabledRequiredFields) {
    if (!hasEnvValue(env[field])) {
      errors.push({
        code: "missing_required_clerk_field",
        field,
        message: `${field} is required when CLERK_AUTH_MODE=enabled.`,
      });
    }
  }

  if (context === "preview") {
    errors.push({
      code: "preview_clerk_enabled",
      field: "CLERK_AUTH_MODE",
      message: "Untrusted preview deployments must use CLERK_AUTH_MODE=disabled.",
    });
  }

  if (isProtectedDeploymentContext(context)) {
    validateProtectedDeploymentOrigins({
      authorizedParties,
      canonicalOrigin,
      context,
      errors,
      productionOrigin,
      productionVercelUrl,
      protectedStagingOrigin,
      protectedStagingVercelUrl,
      vercelUrl: env.VERCEL_URL,
    });
  }

  if (errors.length > 0 || !canonicalOrigin) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      authorizedParties,
      canonicalOrigin,
      context,
      mode,
      productionOrigin,
      productionVercelUrl,
      protectedStagingOrigin,
      protectedStagingVercelUrl,
    },
  };
}

export function requireClerkDeploymentConfig(env: ClerkDeploymentEnv = process.env) {
  const result = readClerkDeploymentConfig(env);
  if (!result.ok) {
    throw new Error(formatClerkConfigErrors(result.errors));
  }

  return result.config;
}

export const isClerkServerConfigured = isClerkServerAuthEnabled();

export function isClerkServerAuthEnabled(env: ClerkDeploymentEnv = process.env) {
  const result = readClerkDeploymentConfig(env);
  return result.ok && result.config.mode === "enabled";
}

export function formatClerkConfigErrors(errors: ClerkConfigError[]) {
  return errors.map((error) => `${error.field}: ${error.message} [${error.code}]`).join("\n");
}

export function resolveClerkDeploymentContext(
  env: ClerkDeploymentEnv = process.env,
): ClerkDeploymentContext {
  const explicitContext = env.CLERK_DEPLOYMENT_CONTEXT;
  if (explicitContext) {
    return deploymentContexts.has(explicitContext as ClerkDeploymentContext)
      ? (explicitContext as ClerkDeploymentContext)
      : "production";
  }

  if (env.NODE_ENV === "test") {
    return "test";
  }

  if (env.VERCEL_ENV === "preview") {
    return "preview";
  }

  if (env.VERCEL_ENV === "production") {
    return "production";
  }

  if (env.NODE_ENV === "production") {
    return "build";
  }

  return "local";
}

function validateExplicitDeploymentContext(env: ClerkDeploymentEnv, errors: ClerkConfigError[]) {
  if (
    hasEnvValue(env.CLERK_DEPLOYMENT_CONTEXT) &&
    !deploymentContexts.has(env.CLERK_DEPLOYMENT_CONTEXT as ClerkDeploymentContext)
  ) {
    errors.push({
      code: "invalid_clerk_deployment_context",
      field: "CLERK_DEPLOYMENT_CONTEXT",
      message:
        "CLERK_DEPLOYMENT_CONTEXT must be local, test, build, preview, production, or protected-staging.",
    });
  }
}

function validatePlatformContext(
  env: ClerkDeploymentEnv,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  if (env.VERCEL_ENV === "production" && context !== "production") {
    errors.push({
      code: "vercel_production_context_mismatch",
      field: "CLERK_DEPLOYMENT_CONTEXT",
      message: "Vercel production deployments must use CLERK_DEPLOYMENT_CONTEXT=production.",
    });
  }

  if (env.VERCEL_ENV === "preview" && context !== "preview" && context !== "protected-staging") {
    errors.push({
      code: "vercel_preview_context_mismatch",
      field: "CLERK_DEPLOYMENT_CONTEXT",
      message:
        "Vercel preview deployments may only use CLERK_DEPLOYMENT_CONTEXT=preview or protected-staging.",
    });
  }

  if (context === "production" && hasEnvValue(env.VERCEL_ENV) && env.VERCEL_ENV !== "production") {
    errors.push({
      code: "production_platform_context_mismatch",
      field: "VERCEL_ENV",
      message: "Production Clerk deployments require VERCEL_ENV=production.",
    });
  }

  if (context === "protected-staging" && env.VERCEL_ENV !== "preview") {
    errors.push({
      code: "protected_staging_platform_context_mismatch",
      field: "VERCEL_ENV",
      message: "Protected staging Clerk deployments require VERCEL_ENV=preview.",
    });
  }
}

function validatePublicClerkMode(
  env: ClerkDeploymentEnv,
  mode: ClerkAuthMode,
  errors: ClerkConfigError[],
) {
  if (
    hasEnvValue(env.NEXT_PUBLIC_CLERK_AUTH_MODE) &&
    env.NEXT_PUBLIC_CLERK_AUTH_MODE !== "enabled" &&
    env.NEXT_PUBLIC_CLERK_AUTH_MODE !== "disabled"
  ) {
    errors.push({
      code: "invalid_public_clerk_auth_mode",
      field: "NEXT_PUBLIC_CLERK_AUTH_MODE",
      message: "NEXT_PUBLIC_CLERK_AUTH_MODE must be enabled or disabled.",
    });
    return;
  }

  if (hasEnvValue(env.NEXT_PUBLIC_CLERK_AUTH_MODE) && env.NEXT_PUBLIC_CLERK_AUTH_MODE !== mode) {
    errors.push({
      code: "clerk_auth_mode_mismatch",
      field: "NEXT_PUBLIC_CLERK_AUTH_MODE",
      message: "NEXT_PUBLIC_CLERK_AUTH_MODE must match CLERK_AUTH_MODE.",
    });
  }
}

function readClerkMode(
  env: ClerkDeploymentEnv,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
): ClerkAuthMode | null {
  if (env.CLERK_AUTH_MODE === "enabled" || env.CLERK_AUTH_MODE === "disabled") {
    return env.CLERK_AUTH_MODE;
  }

  if (!hasEnvValue(env.CLERK_AUTH_MODE)) {
    if (!isProtectedDeploymentContext(context)) {
      return "disabled";
    }

    errors.push({
      code: "missing_clerk_auth_mode",
      field: "CLERK_AUTH_MODE",
      message: "CLERK_AUTH_MODE must be explicitly set to enabled or disabled.",
    });
    return null;
  }

  errors.push({
    code: "invalid_clerk_auth_mode",
    field: "CLERK_AUTH_MODE",
    message: "CLERK_AUTH_MODE must be enabled or disabled.",
  });
  return null;
}

function validateDisabledMode(
  env: ClerkDeploymentEnv,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  if (isProtectedDeploymentContext(context)) {
    errors.push({
      code: "disabled_protected_deployment",
      field: "CLERK_AUTH_MODE",
      message: `${context} deployments require CLERK_AUTH_MODE=enabled.`,
    });
  }

  if (context === "preview" || isProtectedDeploymentContext(context)) {
    for (const field of clerkKeyFields) {
      if (hasEnvValue(env[field])) {
        errors.push({
          code: "disabled_mode_clerk_key_present",
          field,
          message: `${field} must be absent when CLERK_AUTH_MODE=disabled for ${context}.`,
        });
      }
    }
  }
}

function readAuthorizedParties(
  env: ClerkDeploymentEnv,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES;
  if (!hasEnvValue(authorizedParties)) {
    return [];
  }

  const origins = authorizedParties
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const origin of origins) {
    const parsed = parseExactOrigin(origin, "CLERK_AUTHORIZED_PARTIES", context, errors);
    if (parsed && !seen.has(parsed)) {
      seen.add(parsed);
      normalized.push(parsed);
    }
  }

  return normalized;
}

function readRequiredOrigin(
  env: ClerkDeploymentEnv,
  field: "NEXT_PUBLIC_APP_URL",
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  if (!hasEnvValue(env[field])) {
    return null;
  }

  return parseExactOrigin(env[field], field, context, errors);
}

function readOptionalOrigin(
  env: ClerkDeploymentEnv,
  field: "CLERK_PRODUCTION_ORIGIN" | "CLERK_PROTECTED_STAGING_ORIGIN",
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  if (!hasEnvValue(env[field])) {
    return undefined;
  }

  return parseExactOrigin(env[field], field, context, errors) ?? undefined;
}

function readOptionalVercelUrl(
  env: ClerkDeploymentEnv,
  field: "CLERK_PRODUCTION_VERCEL_URL" | "CLERK_PROTECTED_STAGING_VERCEL_URL",
  errors: ClerkConfigError[],
) {
  if (!hasEnvValue(env[field])) {
    return undefined;
  }

  return parseExactVercelUrl(env[field], field, errors) ?? undefined;
}

function parseExactOrigin(
  value: string | undefined,
  field: string,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  const rawValue = value?.trim() ?? "";
  if (rawValue.includes("*")) {
    errors.push({
      code: "wildcard_origin_rejected",
      field,
      message: `${field} must use exact origins; wildcards are not allowed.`,
    });
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    errors.push({
      code: "invalid_origin",
      field,
      message: `${field} must be an exact URL origin.`,
    });
    return null;
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    rawValue.endsWith("/")
  ) {
    errors.push({
      code: "non_origin_url_rejected",
      field,
      message: `${field} must not include credentials, paths, query strings, fragments, or a trailing slash.`,
    });
    return null;
  }

  if (url.protocol !== "https:" && !isAllowedLocalhostOrigin(url, context)) {
    errors.push({
      code: "insecure_deployed_origin",
      field,
      message: `${field} must be an https origin outside local, test, and build contexts.`,
    });
    return null;
  }

  return url.origin;
}

function parseExactVercelUrl(value: string | undefined, field: string, errors: ClerkConfigError[]) {
  const rawValue = value?.trim() ?? "";
  if (!rawValue) {
    return null;
  }

  if (rawValue.includes("*")) {
    errors.push({
      code: "wildcard_vercel_url_rejected",
      field,
      message: `${field} must be an exact Vercel deployment host; wildcards are not allowed.`,
    });
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawValue.includes("://") ? rawValue : `https://${rawValue}`);
  } catch {
    errors.push({
      code: "invalid_vercel_url",
      field,
      message: `${field} must be an exact Vercel deployment host.`,
    });
    return null;
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    rawValue.endsWith("/")
  ) {
    errors.push({
      code: "non_host_vercel_url_rejected",
      field,
      message: `${field} must not include credentials, paths, query strings, fragments, or a trailing slash.`,
    });
    return null;
  }

  return url.host;
}

function validateProtectedDeploymentOrigins(input: {
  authorizedParties: string[];
  canonicalOrigin: string | null;
  context: ClerkDeploymentContext;
  errors: ClerkConfigError[];
  productionOrigin: string | undefined;
  productionVercelUrl: string | undefined;
  protectedStagingOrigin: string | undefined;
  protectedStagingVercelUrl: string | undefined;
  vercelUrl: string | undefined;
}) {
  if (!input.productionOrigin) {
    input.errors.push({
      code: "missing_production_origin",
      field: "CLERK_PRODUCTION_ORIGIN",
      message: "CLERK_PRODUCTION_ORIGIN is required for production and protected staging.",
    });
  }

  if (!input.protectedStagingOrigin) {
    input.errors.push({
      code: "missing_protected_staging_origin",
      field: "CLERK_PROTECTED_STAGING_ORIGIN",
      message: "CLERK_PROTECTED_STAGING_ORIGIN is required for production and protected staging.",
    });
  }

  if (input.context === "production" && !input.productionVercelUrl) {
    input.errors.push({
      code: "missing_production_vercel_url",
      field: "CLERK_PRODUCTION_VERCEL_URL",
      message: "CLERK_PRODUCTION_VERCEL_URL is required for production deployments.",
    });
  }

  if (input.context === "protected-staging" && !input.protectedStagingVercelUrl) {
    input.errors.push({
      code: "missing_protected_staging_vercel_url",
      field: "CLERK_PROTECTED_STAGING_VERCEL_URL",
      message: "CLERK_PROTECTED_STAGING_VERCEL_URL is required for protected staging deployments.",
    });
  }

  if (input.context === "production" && input.canonicalOrigin !== input.productionOrigin) {
    input.errors.push({
      code: "canonical_origin_mismatch",
      field: "NEXT_PUBLIC_APP_URL",
      message: "Production NEXT_PUBLIC_APP_URL must equal CLERK_PRODUCTION_ORIGIN.",
    });
  }

  if (
    input.context === "protected-staging" &&
    input.canonicalOrigin !== input.protectedStagingOrigin
  ) {
    input.errors.push({
      code: "canonical_origin_mismatch",
      field: "NEXT_PUBLIC_APP_URL",
      message: "Protected staging NEXT_PUBLIC_APP_URL must equal CLERK_PROTECTED_STAGING_ORIGIN.",
    });
  }

  const requiredAuthorizedParties = [input.productionOrigin, input.protectedStagingOrigin].filter(
    (origin): origin is string => Boolean(origin),
  );

  if (!sameStringSet(input.authorizedParties, requiredAuthorizedParties)) {
    input.errors.push({
      code: "authorized_parties_mismatch",
      field: "CLERK_AUTHORIZED_PARTIES",
      message:
        "CLERK_AUTHORIZED_PARTIES must exactly match CLERK_PRODUCTION_ORIGIN and CLERK_PROTECTED_STAGING_ORIGIN.",
    });
  }

  validateVercelDeploymentUrl(input);
}

function validateVercelDeploymentUrl(input: {
  context: ClerkDeploymentContext;
  errors: ClerkConfigError[];
  productionVercelUrl: string | undefined;
  protectedStagingVercelUrl: string | undefined;
  vercelUrl: string | undefined;
}) {
  const vercelUrl = parseExactVercelUrl(input.vercelUrl, "VERCEL_URL", input.errors);
  if (!vercelUrl) {
    if (!hasEnvValue(input.vercelUrl)) {
      input.errors.push({
        code: "missing_vercel_deployment_url",
        field: "VERCEL_URL",
        message: `${input.context} deployments require the platform-provided VERCEL_URL.`,
      });
    }
    return;
  }

  const expected =
    input.context === "production" ? input.productionVercelUrl : input.protectedStagingVercelUrl;

  if (expected && vercelUrl !== expected) {
    input.errors.push({
      code: "vercel_deployment_url_mismatch",
      field: "VERCEL_URL",
      message: "VERCEL_URL must match the exact configured protected deployment host.",
    });
  }
}

function isAllowedLocalhostOrigin(url: URL, context: ClerkDeploymentContext) {
  return (
    (context === "local" || context === "test" || context === "build") &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
  );
}

function isProtectedDeploymentContext(context: ClerkDeploymentContext) {
  return context === "production" || context === "protected-staging";
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function hasEnvValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
