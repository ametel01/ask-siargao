import { createHash } from "node:crypto";

import type { MigrationFile } from "@/server/db/migration-files";

export const providerReleaseCandidateSchemaVersion = "provider-release-candidate/v1";
export const providerReleaseCandidateEnvironment = "provider-release-candidate";

export type ProviderReleaseCandidateLane = "clerk" | "stripe";

export const providerReleaseCandidateScenarios = {
  clerk: [
    "email_code_sign_in",
    "google_sign_in",
    "verified_email",
    "session_persistence_and_policy",
    "sign_out",
    "single_session",
    "route_and_api_denial",
    "ownership_denial",
    "step_up_account_closure",
    "webhook_convergence",
    "provider_user_deletion",
  ],
  stripe: [
    "card_checkout",
    "explicit_expiry",
    "return_before_event",
    "verified_activation",
    "duplicate_delivery",
    "reversed_delivery",
    "ambiguous_retry",
    "authenticated_cancellation",
    "cumulative_refunds",
    "dispute",
    "closure_race",
    "paid_after_closure",
    "paid_answer_settlement",
  ],
} as const satisfies Record<ProviderReleaseCandidateLane, readonly string[]>;

export type ProviderReleaseCandidateEnv = Partial<
  Record<
    | "CLERK_PUBLISHABLE_KEY"
    | "CLERK_SECRET_KEY"
    | "GITHUB_ENVIRONMENT"
    | "GITHUB_EVENT_NAME"
    | "GITHUB_REPOSITORY"
    | "PROVIDER_RC_APP_ORIGIN"
    | "PROVIDER_RC_EXPECTED_SHA"
    | "PROVIDER_RC_PRODUCTION_ORIGIN"
    | "STRIPE_RESTRICTED_KEY"
    | "STRIPE_SECRET_KEY"
    | "STRIPE_TRIP_PASS_PRICE_ID",
    string | undefined
  >
>;

export type ProviderReleaseCandidateValidation = {
  errors: string[];
  valid: boolean;
};

export type ProviderReleaseCandidateEvidence = {
  codeAndMigrationFingerprint: string;
  lane: ProviderReleaseCandidateLane;
  migrations: Array<{ checksum: string; filename: string }>;
  protectedEnvironment: typeof providerReleaseCandidateEnvironment;
  scenarios: readonly string[];
  schemaVersion: typeof providerReleaseCandidateSchemaVersion;
  source: {
    checkedOutCommitSha: string;
    repository: "ametel01/ask-siargao";
  };
};

const fullSha = /^[0-9a-f]{40}$/;

export function validateProviderReleaseCandidateContext(input: {
  checkedOutCommitSha: string;
  env?: ProviderReleaseCandidateEnv;
  lane: ProviderReleaseCandidateLane;
}): ProviderReleaseCandidateValidation {
  const env = input.env ?? process.env;
  const errors: string[] = [];
  const expectedSha = env.PROVIDER_RC_EXPECTED_SHA ?? "";

  if (!fullSha.test(expectedSha)) errors.push("expected_sha_must_be_full_lowercase_sha");
  if (!fullSha.test(input.checkedOutCommitSha)) errors.push("checked_out_sha_must_be_full_sha");
  if (expectedSha !== input.checkedOutCommitSha)
    errors.push("checked_out_sha_does_not_match_input");
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") errors.push("manual_dispatch_required");
  if (env.GITHUB_ENVIRONMENT !== providerReleaseCandidateEnvironment) {
    errors.push("protected_environment_required");
  }
  if (env.GITHUB_REPOSITORY !== "ametel01/ask-siargao") errors.push("trusted_repository_required");

  const appOrigin = readHttpsOrigin(env.PROVIDER_RC_APP_ORIGIN);
  if (!appOrigin) errors.push("dedicated_https_app_origin_required");
  const productionOrigin = readHttpsOrigin(env.PROVIDER_RC_PRODUCTION_ORIGIN);
  if (!productionOrigin) errors.push("production_https_origin_required");
  if (appOrigin && productionOrigin && appOrigin === productionOrigin) {
    errors.push("production_origin_forbidden");
  }

  if (input.lane === "clerk") {
    if (!env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
      errors.push("clerk_test_publishable_key_required");
    }
    if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
      errors.push("clerk_test_secret_key_required");
    }
  } else {
    const stripeKey = env.STRIPE_RESTRICTED_KEY ?? env.STRIPE_SECRET_KEY;
    if (!stripeKey || (!stripeKey.startsWith("rk_test_") && !stripeKey.startsWith("sk_test_"))) {
      errors.push("stripe_test_mode_key_required");
    }
    if (!env.STRIPE_TRIP_PASS_PRICE_ID?.startsWith("price_")) {
      errors.push("stripe_test_price_required");
    }
  }

  return { errors, valid: errors.length === 0 };
}

export function assertProviderReleaseCandidateContext(
  input: Parameters<typeof validateProviderReleaseCandidateContext>[0],
) {
  const result = validateProviderReleaseCandidateContext(input);
  if (!result.valid) {
    throw new Error(`Protected provider lane denied: ${result.errors.join(", ")}`);
  }
}

export function assertProviderBeforeApplication(events: readonly string[]) {
  const lookupStarted = events.indexOf("provider_lookup_started");
  const lookupCompleted = events.indexOf("provider_lookup_completed");
  const applicationStarted = events.indexOf("application_started");
  if (
    lookupStarted < 0 ||
    lookupCompleted <= lookupStarted ||
    applicationStarted <= lookupCompleted
  ) {
    throw new Error("Provider lookup must complete before dependent application starts.");
  }
}

export function buildProviderReleaseCandidateEvidence(input: {
  checkedOutCommitSha: string;
  lane: ProviderReleaseCandidateLane;
  migrations: readonly Pick<MigrationFile, "checksum" | "name">[];
}): ProviderReleaseCandidateEvidence {
  const migrations = input.migrations.map((migration) => ({
    checksum: migration.checksum,
    filename: migration.name,
  }));
  const fingerprint = createHash("sha256")
    .update(input.checkedOutCommitSha)
    .update("\0")
    .update(input.lane)
    .update("\0")
    .update(JSON.stringify(migrations))
    .digest("hex");

  return {
    codeAndMigrationFingerprint: fingerprint,
    lane: input.lane,
    migrations,
    protectedEnvironment: providerReleaseCandidateEnvironment,
    scenarios: providerReleaseCandidateScenarios[input.lane],
    schemaVersion: providerReleaseCandidateSchemaVersion,
    source: {
      checkedOutCommitSha: input.checkedOutCommitSha,
      repository: "ametel01/ask-siargao",
    },
  };
}

function readHttpsOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
