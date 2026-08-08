import { describe, expect, test } from "bun:test";

import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";
import {
  assertProviderBeforeApplication,
  assertProviderReleaseCandidateBoundaryStable,
  buildProviderReleaseCandidateEvidence,
  buildProviderReleaseCandidateStripeEvent,
  providerReleaseCandidateScenarios,
  validateProviderReleaseCandidateContext,
  verifyProviderReleaseCandidateDatabase,
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
  PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT: "sentinel-redacted",
  PROVIDER_RC_EXPECTED_SHA: sha,
  PROVIDER_RC_PRODUCTION_ORIGIN: "https://asksiargao.com",
  STRIPE_RESTRICTED_KEY: "rk_test_redacted",
};

describe("protected provider release-candidate policy", () => {
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
          PROVIDER_RC_CLERK_GOOGLE_PASSWORD: "redacted-password",
        },
        lane: "clerk",
      }),
    ).toEqual({ errors: [], valid: true });
  });

  test("denies forks, automatic events, SHA drift, production origins, and live credentials", () => {
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
        PROVIDER_RC_CLERK_GOOGLE_PASSWORD: "redacted-password",
        DATABASE_URL: "postgres://production-db.test/production",
        PROVIDER_RC_STRIPE_ACTIVE_USER: "active+clerk_test@example.test",
        PROVIDER_RC_STRIPE_CLOSURE_USER: "closure+clerk_test@example.test",
        PROVIDER_RC_STRIPE_REVERSED_USER: "reversed+clerk_test@example.test",
        STRIPE_RESTRICTED_KEY: undefined,
        STRIPE_SECRET_KEY: "sk_live_redacted",
        STRIPE_TRIP_PASS_PRICE_ID: "price_test",
        STRIPE_WEBHOOK_SECRET: "whsec_redacted",
      },
      lane: "stripe",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "checked_out_sha_does_not_match_input",
      "manual_dispatch_required",
      "protected_environment_required",
      "trusted_repository_required",
      "production_origin_forbidden",
      "protected_database_host_mismatch",
      "protected_database_name_mismatch",
      "production_database_forbidden",
      "stripe_test_mode_key_required",
    ]);
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
    expect(clerk.errors).toContain("clerk_google_oauth_credentials_required");

    const stripe = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: sha,
      env: {
        ...baseEnv,
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
        STRIPE_RESTRICTED_KEY: "rk_test_redacted",
        STRIPE_TRIP_PASS_PRICE_ID: "price_test",
      },
      lane: "stripe",
    });
    expect(stripe.errors).toContain("dedicated_database_required");
    expect(stripe.errors).toContain("stripe_test_webhook_secret_required");
    expect(
      stripe.errors.filter((error) => error === "dedicated_stripe_test_users_required"),
    ).toHaveLength(3);
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

  test("builds protected Stripe envelopes from the production inbox API version", () => {
    const event = buildProviderReleaseCandidateStripeEvent({
      eventId: "evt_provider_rc_version",
      object: { id: "cs_provider_rc_version", object: "checkout.session" },
      type: "checkout.session.completed",
    });

    expect(event.api_version).toBe(STRIPE_API_VERSION);
  });

  test("binds evidence to the exact SHA, lane, and migration checksums", () => {
    const first = buildProviderReleaseCandidateEvidence({
      checkedOutCommitSha: sha,
      deployedMigrationLedgerFingerprint: "ledger-a",
      lane: "stripe",
      migrations: [{ checksum: "checksum-a", name: "0001_a.sql" }],
      scenarios: providerReleaseCandidateScenarios.stripe,
    });
    const changedMigration = buildProviderReleaseCandidateEvidence({
      checkedOutCommitSha: sha,
      deployedMigrationLedgerFingerprint: "ledger-b",
      lane: "stripe",
      migrations: [{ checksum: "checksum-b", name: "0001_a.sql" }],
      scenarios: providerReleaseCandidateScenarios.stripe,
    });
    expect(first.scenarios).toEqual(providerReleaseCandidateScenarios.stripe);
    expect(first.codeAndMigrationFingerprint).not.toBe(
      changedMigration.codeAndMigrationFingerprint,
    );
  });

  test("rejects production-like database identities and missing executed scenarios", () => {
    const result = validateProviderReleaseCandidateContext({
      checkedOutCommitSha: sha,
      env: {
        ...baseEnv,
        CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
        CLERK_SECRET_KEY: "sk_test_redacted",
        DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
        PROVIDER_RC_DATABASE_EXPECTED_HOST: "db.production.example",
        PROVIDER_RC_DATABASE_EXPECTED_NAME: "main",
      },
      lane: "clerk",
    });
    expect(result.errors).toContain("protected_test_database_host_required");
    expect(result.errors).toContain("protected_test_database_name_required");
    expect(() =>
      buildProviderReleaseCandidateEvidence({
        checkedOutCommitSha: sha,
        deployedMigrationLedgerFingerprint: "ledger",
        lane: "stripe",
        migrations: [{ checksum: "checksum", name: "0001_a.sql" }],
        scenarios: providerReleaseCandidateScenarios.stripe.filter(
          (scenario) => scenario !== "ambiguous_retry",
        ),
      }),
    ).toThrow("every scenario");
  });

  test("requires the deployed ledger and sentinel to exactly match the checkout", () => {
    const expectedMigrations = [{ checksum: "one", name: "0001_one.sql" }];
    expect(
      verifyProviderReleaseCandidateDatabase({
        expectedMigrations,
        expectedSentinelFingerprint: "sentinel",
        ledgerRows: expectedMigrations,
        sentinel: { environment: "protected-test", fingerprint: "sentinel" },
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      verifyProviderReleaseCandidateDatabase({
        expectedMigrations,
        expectedSentinelFingerprint: "sentinel",
        ledgerRows: [{ checksum: "changed", name: "0001_one.sql" }],
        sentinel: { environment: "protected-test", fingerprint: "sentinel" },
      }),
    ).toThrow("ledger content mismatch");
    expect(() =>
      verifyProviderReleaseCandidateDatabase({
        expectedMigrations,
        expectedSentinelFingerprint: "sentinel",
        ledgerRows: expectedMigrations,
        sentinel: { environment: "production", fingerprint: "sentinel" },
      }),
    ).toThrow("sentinel mismatch");
  });

  test("rejects mid-run deployed-SHA and database-ledger drift", () => {
    const stable = {
      currentDatabaseFingerprint: "ledger-a",
      deployedCommitSha: sha,
      expectedCommitSha: sha,
      initialDatabaseFingerprint: "ledger-a",
    };
    expect(() => assertProviderReleaseCandidateBoundaryStable(stable)).not.toThrow();
    expect(() =>
      assertProviderReleaseCandidateBoundaryStable({
        ...stable,
        deployedCommitSha: "b".repeat(40),
      }),
    ).toThrow("drifted mid-run");
    expect(() =>
      assertProviderReleaseCandidateBoundaryStable({
        ...stable,
        currentDatabaseFingerprint: "ledger-b",
      }),
    ).toThrow("drifted mid-run");
  });

  test("enumerates every Clerk and Stripe acceptance flow", () => {
    expect(providerReleaseCandidateScenarios.clerk).toHaveLength(13);
    expect(providerReleaseCandidateScenarios.stripe).toHaveLength(13);
    expect(providerReleaseCandidateScenarios.stripe).toContain("paid_after_closure");
    expect(providerReleaseCandidateScenarios.stripe).toContain("thirty_minute_expiry_boundary");
    expect(providerReleaseCandidateScenarios.clerk).toContain("step_up_account_closure");
    expect(providerReleaseCandidateScenarios.clerk).toContain("account_management");
  });
});
