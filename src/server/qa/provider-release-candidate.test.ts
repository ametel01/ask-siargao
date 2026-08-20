import { describe, expect, test } from "bun:test";

import {
  assertProviderBeforeApplication,
  providerReleaseCandidateCheckoutExpiryMatches,
  providerReleaseCandidateConfigurationFingerprint,
  providerReleaseCandidateScenarios,
  validateProviderReleaseCandidateContext,
} from "@/server/qa/provider-release-candidate";

const sha = "a".repeat(40);
const baseEnv = {
  GITHUB_ENVIRONMENT: "provider-release-candidate",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "ametel01/ask-siargao",
  PROVIDER_RC_APP_ORIGIN: "https://provider-rc.asksiargao.test",
  PROVIDER_RC_BOUNDARY_USER: "boundary+clerk_test@example.test",
  PROVIDER_RC_DATABASE_ENVIRONMENT: "protected-test",
  PROVIDER_RC_DATABASE_EXPECTED_HOST: "provider-rc-db.test",
  PROVIDER_RC_DATABASE_EXPECTED_NAME: "ask_siargao_provider_rc_test",
  PROVIDER_RC_DATABASE_RESOURCE_NAME: "ask-siargao-staging",
  PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT: "sentinel-redacted",
  PROVIDER_RC_EXPECTED_SHA: sha,
  PROVIDER_RC_PRODUCTION_ORIGIN: "https://asksiargao.com",
  PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET: "vercel-bypass-redacted",
};

describe("protected provider release-candidate policy", () => {
  test("accepts an opaque managed PostgreSQL identity when its resource name and sentinel are staging-only", () => {
    const host = "xy12z.horizon.psdb.cloud";
    expect(
      validateProviderReleaseCandidateContext({
        checkedOutCommitSha: sha,
        env: {
          ...baseEnv,
          CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
          CLERK_SECRET_KEY: "sk_test_redacted",
          CLERK_WEBHOOK_SIGNING_SECRET: "whsec_redacted",
          DATABASE_URL: `postgres://role:secret@${host}:5432/postgres`,
          PROVIDER_RC_CLERK_GOOGLE_EMAIL: "oauth@example.test",
          PROVIDER_RC_DATABASE_EXPECTED_HOST: host,
          PROVIDER_RC_DATABASE_EXPECTED_NAME: "postgres",
          PROVIDER_RC_DATABASE_RESOURCE_NAME: "ask-siargao-staging",
        },
        lane: "clerk",
      }),
    ).toEqual({ errors: [], valid: true });
  });

  test("accepts only exact manual Clerk test-instance evidence", () => {
    expect(
      validateProviderReleaseCandidateContext({
        checkedOutCommitSha: sha,
        env: {
          ...baseEnv,
          CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
          CLERK_SECRET_KEY: "sk_test_redacted",
          CLERK_WEBHOOK_SIGNING_SECRET: "whsec_redacted",
          DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
          PROVIDER_RC_CLERK_GOOGLE_EMAIL: "oauth@example.test",
        },
        lane: "clerk",
      }),
    ).toEqual({ errors: [], valid: true });
  });

  test("accepts only an isolated Lemon Squeezy test-mode commerce context", () => {
    expect(
      validateProviderReleaseCandidateContext({
        checkedOutCommitSha: sha,
        env: {
          ...baseEnv,
          CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
          CLERK_SECRET_KEY: "sk_test_redacted",
          DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
          LEMON_SQUEEZY_ALLOW_TEST_MODE: "true",
          LEMON_SQUEEZY_API_KEY: "lemon_test_key_redacted",
          LEMON_SQUEEZY_PRODUCT_ID: "202",
          LEMON_SQUEEZY_STORE_ID: "101",
          LEMON_SQUEEZY_VARIANT_ID: "303",
          LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_test_webhook_secret",
          PROVIDER_RC_LEMON_SQUEEZY_ACTIVE_USER: "active+clerk_test@example.test",
          PROVIDER_RC_LEMON_SQUEEZY_CLOSURE_USER: "closure+clerk_test@example.test",
          PROVIDER_RC_LEMON_SQUEEZY_DUPLICATE_USER: "duplicate+clerk_test@example.test",
          PROVIDER_RC_LEMON_SQUEEZY_FRAUD_USER: "fraud+clerk_test@example.test",
        },
        lane: "lemon-squeezy",
      }),
    ).toEqual({ errors: [], valid: true });
  });

  test("denies forks, automatic events, SHA drift, production origins, and mixed commerce modes", () => {
    const result = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: "b".repeat(40),
      env: {
        ...baseEnv,
        GITHUB_ENVIRONMENT: "pull-request",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REPOSITORY: "fork/ask-siargao",
        PROVIDER_RC_APP_ORIGIN: "https://asksiargao.com",
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
        PROVIDER_RC_CLERK_GOOGLE_EMAIL: "oauth@example.test",
        DATABASE_URL: "postgres://production-db.test/production",
        LEMON_SQUEEZY_ALLOW_TEST_MODE: "false",
        LEMON_SQUEEZY_API_KEY: "lemon_live_key_redacted",
        LEMON_SQUEEZY_PRODUCT_ID: "202",
        LEMON_SQUEEZY_STORE_ID: "101",
        LEMON_SQUEEZY_VARIANT_ID: "303",
        LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_live_webhook_secret",
        PROVIDER_RC_LEMON_SQUEEZY_ACTIVE_USER: "active+clerk_test@example.test",
        PROVIDER_RC_LEMON_SQUEEZY_CLOSURE_USER: "closure+clerk_test@example.test",
        PROVIDER_RC_LEMON_SQUEEZY_DUPLICATE_USER: "duplicate+clerk_test@example.test",
        PROVIDER_RC_LEMON_SQUEEZY_FRAUD_USER: "fraud+clerk_test@example.test",
      },
      lane: "lemon-squeezy",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "checked_out_sha_does_not_match_input",
      "manual_dispatch_required",
      "protected_environment_required",
      "trusted_repository_required",
      "production_origin_forbidden",
      "dedicated_protected_staging_origin_required",
      "protected_database_host_mismatch",
      "protected_database_name_mismatch",
      "production_database_forbidden",
      "lemon_squeezy_test_mode_required",
    ]);
  });

  test("denies production aliases and origins without an explicit staging identity", () => {
    for (const appOrigin of [
      "https://www.asksiargao.com",
      "https://preview.asksiargao.com",
      "https://latest.asksiargao.com",
      "https://production-staging.asksiargao.com",
    ]) {
      const result = validateProviderReleaseCandidateContext({
        checkedOutCommitSha: sha,
        env: {
          ...baseEnv,
          CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
          CLERK_SECRET_KEY: "sk_test_redacted",
          CLERK_WEBHOOK_SIGNING_SECRET: "whsec_redacted",
          DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
          PROVIDER_RC_APP_ORIGIN: appOrigin,
          PROVIDER_RC_CLERK_GOOGLE_EMAIL: "oauth@example.test",
        },
        lane: "clerk",
      });

      expect(result.errors, appOrigin).toContain("dedicated_protected_staging_origin_required");
    }
  });

  test("denies either lane when protected app webhook or database configuration is absent", () => {
    const clerk = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: sha,
      env: {
        ...baseEnv,
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
      },
      lane: "clerk",
    });
    expect(clerk.errors).toContain("dedicated_database_required");
    expect(clerk.errors).toContain("clerk_test_webhook_secret_required");
    expect(clerk.errors).toContain("clerk_google_oauth_identity_required");

    const lemonSqueezy = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: sha,
      env: {
        ...baseEnv,
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
        LEMON_SQUEEZY_ALLOW_TEST_MODE: "true",
        LEMON_SQUEEZY_API_KEY: "lemon_test_key_redacted",
        LEMON_SQUEEZY_PRODUCT_ID: "202",
        LEMON_SQUEEZY_STORE_ID: "101",
        LEMON_SQUEEZY_VARIANT_ID: "303",
      },
      lane: "lemon-squeezy",
    });
    expect(lemonSqueezy.errors).toContain("dedicated_database_required");
    expect(lemonSqueezy.errors).toContain("lemon_squeezy_test_webhook_secret_required");
    expect(
      lemonSqueezy.errors.filter(
        (error) => error === "dedicated_lemon_squeezy_test_users_required",
      ),
    ).toHaveLength(4);
  });

  test("requires lookup completion before application rather than a broad green result", () => {
    expect(() =>
      assertProviderBeforeApplication([
        "provider_lookup_started",
        "provider_lookup_completed",
        "application_started",
      ]),
    ).not.toThrow();
    expect(() =>
      assertProviderBeforeApplication([
        "provider_lookup_started",
        "application_started",
        "provider_lookup_completed",
      ]),
    ).toThrow("Provider lookup must complete");
  });

  test("fingerprints exact Lemon Squeezy resources without exposing their identifiers", () => {
    const fingerprint = providerReleaseCandidateConfigurationFingerprint("lemon-squeezy", {
      LEMON_SQUEEZY_PRODUCT_ID: "202",
      LEMON_SQUEEZY_STORE_ID: "101",
      LEMON_SQUEEZY_VARIANT_ID: "303",
    });

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("101");
    expect(
      providerReleaseCandidateConfigurationFingerprint("lemon-squeezy", {
        LEMON_SQUEEZY_PRODUCT_ID: "202",
        LEMON_SQUEEZY_STORE_ID: "101",
        LEMON_SQUEEZY_VARIANT_ID: "304",
      }),
    ).not.toBe(fingerprint);
    expect(providerReleaseCandidateConfigurationFingerprint("clerk", {})).toBeNull();
  });

  test("rejects production-like database identities", () => {
    const result = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: sha,
      env: {
        ...baseEnv,
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
        DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
        PROVIDER_RC_DATABASE_EXPECTED_HOST: "db.production.example",
        PROVIDER_RC_DATABASE_EXPECTED_NAME: "main",
        PROVIDER_RC_DATABASE_RESOURCE_NAME: "ask-siargao-production",
      },
      lane: "clerk",
    });
    expect(result.errors).toContain("protected_test_database_resource_required");
  });

  test("proves exact Checkout expiry from floored fractional database creation time", () => {
    for (const createdEpochSeconds of [1_800_000_000.001, 1_800_000_000.999]) {
      const expiryEpochSeconds = Math.floor(createdEpochSeconds) + 30 * 60;
      expect(
        providerReleaseCandidateCheckoutExpiryMatches({
          createdEpochSeconds,
          expiryEpochSeconds,
          providerExpiryEpochSeconds: expiryEpochSeconds,
        }),
      ).toBe(true);
      for (const incorrectExpiryEpochSeconds of [expiryEpochSeconds - 1, expiryEpochSeconds + 1]) {
        expect(
          providerReleaseCandidateCheckoutExpiryMatches({
            createdEpochSeconds,
            expiryEpochSeconds: incorrectExpiryEpochSeconds,
            providerExpiryEpochSeconds: incorrectExpiryEpochSeconds,
          }),
        ).toBe(false);
      }
      expect(
        providerReleaseCandidateCheckoutExpiryMatches({
          createdEpochSeconds,
          expiryEpochSeconds,
          providerExpiryEpochSeconds: expiryEpochSeconds + 1,
        }),
      ).toBe(false);
    }
  });

  test("enumerates every Clerk and Lemon Squeezy acceptance flow", () => {
    expect(providerReleaseCandidateScenarios.clerk).toHaveLength(13);
    expect(providerReleaseCandidateScenarios["lemon-squeezy"]).toEqual([
      "test_mode_checkout_creation",
      "checkout_correlation",
      "thirty_minute_expiry_boundary",
      "return_before_webhook_convergence",
      "signed_webhook_ingestion",
      "duplicate_payment_fact",
      "paid_answer_settlement",
      "partial_refund",
      "full_refund",
      "out_of_order_payment_fact",
      "fraudulent_state",
      "account_closure_race",
      "duplicate_payment_refund_recovery",
      "commerce_reconciliation",
    ]);
    expect(providerReleaseCandidateScenarios.clerk).toContain("step_up_account_closure");
    expect(providerReleaseCandidateScenarios.clerk).toContain("account_management");
  });
});
