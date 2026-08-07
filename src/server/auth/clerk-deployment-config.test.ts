import { describe, expect, test } from "bun:test";

import {
  formatClerkConfigErrors,
  readClerkDeploymentConfig,
} from "@/server/auth/clerk-deployment-config";

const productionOrigin = "https://asksiargao.com";
const stagingOrigin = "https://staging.asksiargao.com";
const productionVercelUrl = "ask-siargao-production.vercel.app";
const stagingVercelUrl = "ask-siargao-staging.vercel.app";

const completeProductionEnv = {
  CLERK_AUTH_MODE: "enabled",
  CLERK_AUTHORIZED_PARTIES: `${productionOrigin},${stagingOrigin}`,
  CLERK_DEPLOYMENT_CONTEXT: "production",
  CLERK_PRODUCTION_ORIGIN: productionOrigin,
  CLERK_PRODUCTION_VERCEL_URL: productionVercelUrl,
  CLERK_PROTECTED_STAGING_ORIGIN: stagingOrigin,
  CLERK_PROTECTED_STAGING_VERCEL_URL: stagingVercelUrl,
  CLERK_SECRET_KEY: "sk_live_secret",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_secret",
  NEXT_PUBLIC_APP_URL: productionOrigin,
  NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
  VERCEL_ENV: "production",
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
        productionVercelUrl,
        protectedStagingOrigin: stagingOrigin,
        protectedStagingVercelUrl: stagingVercelUrl,
      },
    });

    expect(
      readClerkDeploymentConfig({
        ...completeProductionEnv,
        CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
        NEXT_PUBLIC_APP_URL: stagingOrigin,
        VERCEL_ENV: "preview",
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

  test("rejects ordinary previews that claim protected staging with live secrets", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_URL: "random-preview.vercel.app",
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("vercel_deployment_url_mismatch");
  });

  test("rejects protected staging without the exact platform deployment identity", () => {
    const result = readClerkDeploymentConfig({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      CLERK_PROTECTED_STAGING_VERCEL_URL: undefined,
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_URL: stagingVercelUrl,
    });

    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain("missing_protected_staging_vercel_url");
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
