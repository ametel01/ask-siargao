import { describe, expect, test } from "bun:test";

import {
  formatClerkConfigErrors,
  readClerkDeploymentConfig,
} from "@/server/auth/clerk-deployment-config";

const productionOrigin = "https://asksiargao.com";
const stagingOrigin = "https://staging.asksiargao.com";
const productionProjectUrl = "asksiargao.com";
const productionVercelUrl = "ask-siargao-production-a1b2c3.vercel.app";
const stagingBranch = "protected-staging";
const stagingTargetEnv = "staging";
const stagingVercelUrl = "ask-siargao-staging-a1b2c3.vercel.app";
const vercelProjectId = "prj_askSiargaoStableProject";

const completeProductionEnv = {
  CLERK_AUTH_MODE: "enabled",
  CLERK_AUTHORIZED_PARTIES: `${productionOrigin},${stagingOrigin}`,
  CLERK_DEPLOYMENT_CONTEXT: "production",
  CLERK_PRODUCTION_ORIGIN: productionOrigin,
  CLERK_PROTECTED_STAGING_GIT_COMMIT_REF: stagingBranch,
  CLERK_PROTECTED_STAGING_ORIGIN: stagingOrigin,
  CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV: stagingTargetEnv,
  CLERK_SECRET_KEY: "sk_live_secret",
  CLERK_VERCEL_PROJECT_ID: vercelProjectId,
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_secret",
  NEXT_PUBLIC_APP_URL: productionOrigin,
  NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: vercelProjectId,
  VERCEL_PROJECT_PRODUCTION_URL: productionProjectUrl,
  VERCEL_URL: productionVercelUrl,
} as const;

describe("Clerk deployment configuration", () => {
  test("accepts explicit disabled mode for local, test, and build contexts", () => {
    for (const context of ["local", "test", "build"] as const) {
      expect(
        readClerkDeploymentConfig({
          CLERK_AUTH_MODE: "disabled",
          CLERK_DEPLOYMENT_CONTEXT: context,
        }),
        context,
      ).toEqual({ ok: true, config: { context, mode: "disabled" } });
    }
  });

  test("accepts complete enabled production and protected staging configurations", () => {
    expect(readClerkDeploymentConfig(completeProductionEnv)).toEqual({
      ok: true,
      config: {
        authorizedParties: [productionOrigin, stagingOrigin],
        canonicalOrigin: productionOrigin,
        context: "production",
        mode: "enabled",
        productionOrigin,
        protectedStagingGitCommitRef: stagingBranch,
        protectedStagingOrigin: stagingOrigin,
        protectedStagingTargetEnv: stagingTargetEnv,
        vercelProjectId,
      },
    });

    expect(
      readClerkDeploymentConfig({
        ...completeProductionEnv,
        CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
        NEXT_PUBLIC_APP_URL: stagingOrigin,
        VERCEL_GIT_COMMIT_REF: stagingBranch,
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: stagingTargetEnv,
        VERCEL_URL: stagingVercelUrl,
      }),
    ).toMatchObject({
      ok: true,
      config: {
        canonicalOrigin: stagingOrigin,
        context: "protected-staging",
        mode: "enabled",
      },
    });
  });

  test("rejects missing mode in production and protected staging", () => {
    for (const context of ["production", "protected-staging"] as const) {
      const result = readClerkDeploymentConfig({
        ...completeProductionEnv,
        CLERK_AUTH_MODE: undefined,
        CLERK_DEPLOYMENT_CONTEXT: context,
      });

      expect(result.ok, context).toBe(false);
      expect(errorCodes(result)).toContain("missing_clerk_auth_mode");
    }
  });

  test("rejects invalid explicit deployment context values", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "prod",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("invalid_clerk_deployment_context");
    expect(errorFields(result)).toContain("CLERK_DEPLOYMENT_CONTEXT");
  });

  test("requires the public Clerk mode mirror for enabled deployments", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      NEXT_PUBLIC_CLERK_AUTH_MODE: undefined,
    });

    expect(result.ok).toBe(false);
    expect(errorFields(result)).toContain("NEXT_PUBLIC_CLERK_AUTH_MODE");
  });

  test("rejects public Clerk mode values that contradict the server mode", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("clerk_auth_mode_mismatch");
  });

  test("rejects every one-field-missing enabled production configuration", () => {
    const fields = [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_CLERK_AUTH_MODE",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "NEXT_PUBLIC_APP_URL",
      "CLERK_AUTHORIZED_PARTIES",
      "CLERK_VERCEL_PROJECT_ID",
    ] as const;

    for (const field of fields) {
      const result = readClerkDeploymentConfig({ ...completeProductionEnv, [field]: undefined });

      expect(result.ok, field).toBe(false);
      expect(errorFields(result), field).toContain(field);
    }
  });

  test("rejects disabled deployed and preview configurations that include Clerk keys", () => {
    for (const context of ["production", "protected-staging", "preview"] as const) {
      const result = readClerkDeploymentConfig({
        CLERK_AUTH_MODE: "disabled",
        CLERK_DEPLOYMENT_CONTEXT: context,
        CLERK_SECRET_KEY: "sk_should_not_be_here",
      });

      expect(result.ok, context).toBe(false);
      expect(errorCodes(result), context).toContain("disabled_mode_clerk_key_present");
    }
  });

  test("rejects Vercel production deployments that claim local disabled mode", () => {
    const result = readClerkDeploymentConfig({
      CLERK_AUTH_MODE: "disabled",
      CLERK_DEPLOYMENT_CONTEXT: "local",
      NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
      VERCEL_ENV: "production",
      VERCEL_URL: productionVercelUrl,
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("vercel_production_context_mismatch");
  });

  test("rejects production deployments without the platform production environment", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      VERCEL_ENV: undefined,
      VERCEL_URL: productionVercelUrl,
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("production_platform_context_mismatch");
  });

  test("accepts protected deployments when generated Vercel deployment URLs change", () => {
    expect(
      readClerkDeploymentConfig({
        ...completeProductionEnv,
        VERCEL_URL: "ask-siargao-production-x9y8z7.vercel.app",
      }).ok,
    ).toBe(true);

    expect(
      readClerkDeploymentConfig({
        ...completeProductionEnv,
        CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
        NEXT_PUBLIC_APP_URL: stagingOrigin,
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: stagingBranch,
        VERCEL_TARGET_ENV: stagingTargetEnv,
        VERCEL_URL: "ask-siargao-staging-x9y8z7.vercel.app",
      }).ok,
    ).toBe(true);
  });

  test("rejects protected deployments with the wrong stable Vercel project identity", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      VERCEL_PROJECT_ID: "prj_untrustedProject",
      VERCEL_URL: "ask-siargao-production-x9y8z7.vercel.app",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("vercel_project_id_mismatch");
  });

  test("rejects production deployments with the wrong stable Vercel production URL", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      VERCEL_PROJECT_PRODUCTION_URL: "wrong.example.com",
      VERCEL_URL: "ask-siargao-production-x9y8z7.vercel.app",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("vercel_project_production_url_mismatch");
  });

  test("rejects ordinary previews that claim protected staging with live secrets", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_URL: "random-preview.vercel.app",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("missing_vercel_target_env");
  });

  test("rejects protected staging without the configured stable target or branch identity", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      CLERK_PROTECTED_STAGING_GIT_COMMIT_REF: undefined,
      CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV: undefined,
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: stagingBranch,
      VERCEL_TARGET_ENV: stagingTargetEnv,
      VERCEL_URL: stagingVercelUrl,
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("missing_protected_staging_identity");
  });

  test("rejects protected staging with the wrong target or branch identity", () => {
    const wrongTarget = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: stagingBranch,
      VERCEL_TARGET_ENV: "preview",
      VERCEL_URL: "random-preview.vercel.app",
    });
    const wrongBranch = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature-preview",
      VERCEL_TARGET_ENV: stagingTargetEnv,
      VERCEL_URL: "random-preview.vercel.app",
    });

    expect(errorCodes(wrongTarget)).toContain("vercel_target_env_mismatch");
    expect(errorCodes(wrongBranch)).toContain("vercel_git_commit_ref_mismatch");
  });

  test("rejects local and test protected UI harness config with Vercel deployment signals", () => {
    for (const context of ["local", "test"] as const) {
      const result = readClerkDeploymentConfig({
        CLERK_AUTH_MODE: "disabled",
        CLERK_DEPLOYMENT_CONTEXT: context,
        NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
        PLAYWRIGHT_PROTECTED_UI_HARNESS: "1",
        PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN: "local-test-harness-token-1234567890",
        VERCEL_PROJECT_ID: vercelProjectId,
        VERCEL_PROJECT_PRODUCTION_URL: productionProjectUrl,
        VERCEL_URL: productionVercelUrl,
      });

      expect(result.ok, context).toBe(false);
      expect(errorCodes(result), context).toContain("protected_ui_harness_platform_signal");
    }
  });

  test("rejects wildcard, path, credential, query, fragment, and insecure deployed origins", () => {
    const badOrigins = [
      "https://*.vercel.app",
      "https://asksiargao.com/path",
      "https://user:pass@asksiargao.com",
      "https://asksiargao.com?debug=1",
      "https://asksiargao.com#fragment",
      "http://asksiargao.com",
    ];

    for (const origin of badOrigins) {
      const result = readClerkDeploymentConfig({
        ...completeProductionEnv,
        NEXT_PUBLIC_APP_URL: origin,
      });

      expect(result.ok, origin).toBe(false);
    }
  });

  test("allows localhost origins only outside deployed production and staging", () => {
    expect(
      readClerkDeploymentConfig({
        CLERK_AUTH_MODE: "enabled",
        CLERK_AUTHORIZED_PARTIES: "http://localhost:3000",
        CLERK_DEPLOYMENT_CONTEXT: "local",
        CLERK_SECRET_KEY: "sk_test_secret",
        CLERK_WEBHOOK_SIGNING_SECRET: "whsec_secret",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      }).ok,
    ).toBe(true);

    expect(
      readClerkDeploymentConfig({
        ...completeProductionEnv,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }).ok,
    ).toBe(false);
  });

  test("rejects authorized parties that do not exactly match production and staging", () => {
    const missingStaging = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_AUTHORIZED_PARTIES: productionOrigin,
    });
    const extraPreview = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_AUTHORIZED_PARTIES: `${productionOrigin},${stagingOrigin},https://preview.vercel.app`,
    });

    expect(errorCodes(missingStaging)).toContain("authorized_parties_mismatch");
    expect(errorCodes(extraPreview)).toContain("authorized_parties_mismatch");
  });

  test("redacts secret values from formatted errors", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_AUTHORIZED_PARTIES: "https://*.vercel.app",
      CLERK_SECRET_KEY: "sk_live_never_echo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const formatted = formatClerkConfigErrors(result.errors);
      expect(formatted).toContain("CLERK_AUTHORIZED_PARTIES");
      expect(formatted).not.toContain("sk_live_never_echo");
      expect(formatted).not.toContain("*.vercel.app");
    }
  });
});

function errorCodes(result: ReturnType<typeof readClerkDeploymentConfig>) {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function errorFields(result: ReturnType<typeof readClerkDeploymentConfig>) {
  return result.ok ? [] : result.errors.map((error) => error.field);
}
