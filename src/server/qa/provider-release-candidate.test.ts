import { describe, expect, test } from "bun:test";

import {
  assertProviderBeforeApplication,
  buildProviderReleaseCandidateEvidence,
  providerReleaseCandidateScenarios,
  validateProviderReleaseCandidateContext,
} from "@/server/qa/provider-release-candidate";

const sha = "a".repeat(40);
const baseEnv = {
  GITHUB_ENVIRONMENT: "provider-release-candidate",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "ametel01/ask-siargao",
  PROVIDER_RC_APP_ORIGIN: "https://provider-rc.asksiargao.test",
  PROVIDER_RC_EXPECTED_SHA: sha,
  PROVIDER_RC_PRODUCTION_ORIGIN: "https://asksiargao.com",
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
        STRIPE_SECRET_KEY: "sk_live_redacted",
        STRIPE_TRIP_PASS_PRICE_ID: "price_test",
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
      "stripe_test_mode_key_required",
    ]);
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

  test("binds evidence to the exact SHA, lane, and migration checksums", () => {
    const first = buildProviderReleaseCandidateEvidence({
      checkedOutCommitSha: sha,
      lane: "stripe",
      migrations: [{ checksum: "checksum-a", name: "0001_a.sql" }],
    });
    const changedMigration = buildProviderReleaseCandidateEvidence({
      checkedOutCommitSha: sha,
      lane: "stripe",
      migrations: [{ checksum: "checksum-b", name: "0001_a.sql" }],
    });
    expect(first.scenarios).toEqual(providerReleaseCandidateScenarios.stripe);
    expect(first.codeAndMigrationFingerprint).not.toBe(
      changedMigration.codeAndMigrationFingerprint,
    );
  });

  test("enumerates every Clerk and Stripe acceptance flow", () => {
    expect(providerReleaseCandidateScenarios.clerk).toHaveLength(11);
    expect(providerReleaseCandidateScenarios.stripe).toHaveLength(13);
    expect(providerReleaseCandidateScenarios.stripe).toContain("paid_after_closure");
    expect(providerReleaseCandidateScenarios.clerk).toContain("step_up_account_closure");
  });
});
