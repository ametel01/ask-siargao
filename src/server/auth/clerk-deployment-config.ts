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
    | "CLERK_PROTECTED_STAGING_GIT_COMMIT_REF"
    | "CLERK_PROTECTED_STAGING_ORIGIN"
    | "CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV"
    | "CLERK_SECRET_KEY"
    | "CLERK_VERCEL_PROJECT_ID"
    | "CLERK_WEBHOOK_SIGNING_SECRET"
    | "NEXT_PUBLIC_APP_URL"
    | "NEXT_PUBLIC_CLERK_AUTH_MODE"
    | "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
    | "NODE_ENV"
    | "PLAYWRIGHT_PROTECTED_UI_HARNESS"
    | "PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN"
    | "VERCEL"
    | "VERCEL_BRANCH_URL"
    | "VERCEL_ENV"
    | "VERCEL_GIT_COMMIT_REF"
    | "VERCEL_PROJECT_ID"
    | "VERCEL_PROJECT_PRODUCTION_URL"
    | "VERCEL_TARGET_ENV"
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
  protectedStagingGitCommitRef?: string;
  protectedStagingOrigin?: string;
  protectedStagingTargetEnv?: string;
  vercelProjectId?: string;
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

const vercelDeploymentSignalFields = [
  "VERCEL",
  "VERCEL_BRANCH_URL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_PROJECT_ID",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
] as const;

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
  validateProtectedUiHarnessConfig(env, context, errors);

  if (mode === "disabled") {
    validateDisabledMode(env, context, errors);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, config: { context, mode } };
  }

  const canonicalOrigin = readRequiredOrigin(env, "NEXT_PUBLIC_APP_URL", context, errors);
  const authorizedParties = readAuthorizedParties(env, context, errors);
  const productionOrigin = readOptionalOrigin(env, "CLERK_PRODUCTION_ORIGIN", context, errors);
  const protectedStagingOrigin = readOptionalOrigin(
    env,
    "CLERK_PROTECTED_STAGING_ORIGIN",
    context,
    errors,
  );
  const protectedStagingGitCommitRef = readOptionalExactIdentifier(
    env,
    "CLERK_PROTECTED_STAGING_GIT_COMMIT_REF",
    errors,
  );
  const protectedStagingTargetEnv = readOptionalExactIdentifier(
    env,
    "CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV",
    errors,
  );
  const vercelProjectId = readOptionalExactIdentifier(env, "CLERK_VERCEL_PROJECT_ID", errors);

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
      protectedStagingGitCommitRef,
      protectedStagingOrigin,
      protectedStagingTargetEnv,
      vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
      vercelProjectId,
      vercelProjectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
      vercelRuntimeProjectId: env.VERCEL_PROJECT_ID,
      vercelTargetEnv: env.VERCEL_TARGET_ENV,
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
      protectedStagingGitCommitRef,
      protectedStagingOrigin,
      protectedStagingTargetEnv,
      vercelProjectId,
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
  const protectedStagingCustomEnvironment =
    context === "protected-staging" &&
    hasEnvValue(env.CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV) &&
    env.VERCEL_TARGET_ENV === env.CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV;

  if (
    env.VERCEL_ENV === "production" &&
    context !== "production" &&
    !protectedStagingCustomEnvironment
  ) {
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

  if (context === "production" && env.VERCEL_ENV !== "production") {
    errors.push({
      code: "production_platform_context_mismatch",
      field: "VERCEL_ENV",
      message: "Production Clerk deployments require VERCEL_ENV=production.",
    });
  }

  if (
    context === "production" &&
    hasEnvValue(env.VERCEL_TARGET_ENV) &&
    env.VERCEL_TARGET_ENV !== "production"
  ) {
    errors.push({
      code: "production_vercel_target_env_mismatch",
      field: "VERCEL_TARGET_ENV",
      message: "Production Clerk deployments cannot run on a non-production Vercel target.",
    });
  }

  if (
    context === "protected-staging" &&
    env.VERCEL_ENV !== "preview" &&
    !protectedStagingCustomEnvironment
  ) {
    errors.push({
      code: "protected_staging_platform_context_mismatch",
      field: "VERCEL_ENV",
      message:
        "Protected staging Clerk deployments require VERCEL_ENV=preview or the exact configured Vercel custom target.",
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

function validateProtectedUiHarnessConfig(
  env: ClerkDeploymentEnv,
  context: ClerkDeploymentContext,
  errors: ClerkConfigError[],
) {
  if (env.PLAYWRIGHT_PROTECTED_UI_HARNESS !== "1") {
    return;
  }

  if (env.CLERK_DEPLOYMENT_CONTEXT !== "local" && env.CLERK_DEPLOYMENT_CONTEXT !== "test") {
    errors.push({
      code: "protected_ui_harness_context_mismatch",
      field: "CLERK_DEPLOYMENT_CONTEXT",
      message: "PLAYWRIGHT_PROTECTED_UI_HARNESS requires explicit local or test context.",
    });
  }

  if (context !== "local" && context !== "test") {
    errors.push({
      code: "protected_ui_harness_context_mismatch",
      field: "PLAYWRIGHT_PROTECTED_UI_HARNESS",
      message: "PLAYWRIGHT_PROTECTED_UI_HARNESS is only allowed in local or test context.",
    });
  }

  if (env.NODE_ENV === "production") {
    errors.push({
      code: "protected_ui_harness_production_runtime",
      field: "NODE_ENV",
      message: "PLAYWRIGHT_PROTECTED_UI_HARNESS is not allowed when NODE_ENV=production.",
    });
  }

  const firstVercelSignal = firstVercelDeploymentSignal(env);
  if (firstVercelSignal) {
    errors.push({
      code: "protected_ui_harness_platform_signal",
      field: firstVercelSignal,
      message: "PLAYWRIGHT_PROTECTED_UI_HARNESS is not allowed with Vercel deployment signals.",
    });
  }

  const token = env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN?.trim();
  if (!token || token.length < 32) {
    errors.push({
      code: "protected_ui_harness_token_required",
      field: "PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN",
      message:
        "PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN must be a test-only token of at least 32 characters.",
    });
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

function readOptionalExactIdentifier(
  env: ClerkDeploymentEnv,
  field:
    | "CLERK_PROTECTED_STAGING_GIT_COMMIT_REF"
    | "CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV"
    | "CLERK_VERCEL_PROJECT_ID",
  errors: ClerkConfigError[],
) {
  if (!hasEnvValue(env[field])) {
    return undefined;
  }

  return parseExactIdentifier(env[field], field, errors) ?? undefined;
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

function parseExactIdentifier(
  value: string | undefined,
  field: string,
  errors: ClerkConfigError[],
) {
  const rawValue = value?.trim() ?? "";
  if (!rawValue) {
    return null;
  }

  if (rawValue.includes("*") || rawValue.includes(",") || /\s/.test(rawValue)) {
    errors.push({
      code: "non_exact_identifier_rejected",
      field,
      message: `${field} must be one exact identifier without wildcards, commas, or whitespace.`,
    });
    return null;
  }

  return rawValue;
}

function validateProtectedDeploymentOrigins(input: {
  authorizedParties: string[];
  canonicalOrigin: string | null;
  context: ClerkDeploymentContext;
  errors: ClerkConfigError[];
  productionOrigin: string | undefined;
  protectedStagingGitCommitRef: string | undefined;
  protectedStagingOrigin: string | undefined;
  protectedStagingTargetEnv: string | undefined;
  vercelGitCommitRef: string | undefined;
  vercelProjectId: string | undefined;
  vercelProjectProductionUrl: string | undefined;
  vercelRuntimeProjectId: string | undefined;
  vercelTargetEnv: string | undefined;
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

  if (!input.vercelProjectId) {
    input.errors.push({
      code: "missing_clerk_vercel_project_id",
      field: "CLERK_VERCEL_PROJECT_ID",
      message: "CLERK_VERCEL_PROJECT_ID is required for protected Clerk deployments.",
    });
  }

  if (
    input.context === "protected-staging" &&
    !input.protectedStagingTargetEnv &&
    !input.protectedStagingGitCommitRef
  ) {
    input.errors.push({
      code: "missing_protected_staging_identity",
      field: "CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV",
      message:
        "Protected staging requires CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV or CLERK_PROTECTED_STAGING_GIT_COMMIT_REF.",
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

  validateVercelStableDeploymentIdentity(input);
}

function validateVercelStableDeploymentIdentity(input: {
  context: ClerkDeploymentContext;
  errors: ClerkConfigError[];
  productionOrigin: string | undefined;
  protectedStagingGitCommitRef: string | undefined;
  protectedStagingTargetEnv: string | undefined;
  vercelGitCommitRef: string | undefined;
  vercelProjectId: string | undefined;
  vercelProjectProductionUrl: string | undefined;
  vercelRuntimeProjectId: string | undefined;
  vercelTargetEnv: string | undefined;
}) {
  if (!hasEnvValue(input.vercelRuntimeProjectId)) {
    input.errors.push({
      code: "missing_vercel_project_id",
      field: "VERCEL_PROJECT_ID",
      message: `${input.context} deployments require the platform-provided VERCEL_PROJECT_ID.`,
    });
  } else if (input.vercelProjectId && input.vercelRuntimeProjectId !== input.vercelProjectId) {
    input.errors.push({
      code: "vercel_project_id_mismatch",
      field: "VERCEL_PROJECT_ID",
      message: "VERCEL_PROJECT_ID must match CLERK_VERCEL_PROJECT_ID.",
    });
  }

  if (input.context === "production") {
    validateProductionProjectUrl(input);
    return;
  }

  validateProtectedStagingTargetIdentity(input);
}

function validateProductionProjectUrl(input: {
  errors: ClerkConfigError[];
  vercelProjectProductionUrl: string | undefined;
}) {
  const projectProductionHost = parseExactVercelUrl(
    input.vercelProjectProductionUrl,
    "VERCEL_PROJECT_PRODUCTION_URL",
    input.errors,
  );

  if (!projectProductionHost) {
    if (!hasEnvValue(input.vercelProjectProductionUrl)) {
      input.errors.push({
        code: "missing_vercel_project_production_url",
        field: "VERCEL_PROJECT_PRODUCTION_URL",
        message: "Production deployments require VERCEL_PROJECT_PRODUCTION_URL.",
      });
    }
  }
}

function validateProtectedStagingTargetIdentity(input: {
  errors: ClerkConfigError[];
  protectedStagingGitCommitRef: string | undefined;
  protectedStagingTargetEnv: string | undefined;
  vercelGitCommitRef: string | undefined;
  vercelTargetEnv: string | undefined;
}) {
  if (input.protectedStagingTargetEnv) {
    if (!hasEnvValue(input.vercelTargetEnv)) {
      input.errors.push({
        code: "missing_vercel_target_env",
        field: "VERCEL_TARGET_ENV",
        message: "Protected staging requires the platform-provided VERCEL_TARGET_ENV.",
      });
    } else if (input.vercelTargetEnv !== input.protectedStagingTargetEnv) {
      input.errors.push({
        code: "vercel_target_env_mismatch",
        field: "VERCEL_TARGET_ENV",
        message: "VERCEL_TARGET_ENV must match CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV.",
      });
    }
  }

  if (input.protectedStagingGitCommitRef) {
    if (!hasEnvValue(input.vercelGitCommitRef)) {
      input.errors.push({
        code: "missing_vercel_git_commit_ref",
        field: "VERCEL_GIT_COMMIT_REF",
        message: "Protected staging requires the platform-provided VERCEL_GIT_COMMIT_REF.",
      });
    } else if (input.vercelGitCommitRef !== input.protectedStagingGitCommitRef) {
      input.errors.push({
        code: "vercel_git_commit_ref_mismatch",
        field: "VERCEL_GIT_COMMIT_REF",
        message: "VERCEL_GIT_COMMIT_REF must match CLERK_PROTECTED_STAGING_GIT_COMMIT_REF.",
      });
    }
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

export function hasVercelDeploymentSignals(
  env: Partial<Record<string, string | undefined>> = process.env,
) {
  return Boolean(firstVercelDeploymentSignal(env));
}

function firstVercelDeploymentSignal(env: Partial<Record<string, string | undefined>>) {
  return vercelDeploymentSignalFields.find((field) => hasEnvValue(env[field]));
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
