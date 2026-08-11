import { createHash } from "node:crypto";
import type Stripe from "stripe";

import type { MigrationFile } from "@/server/db/migration-files";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";

export const providerReleaseCandidateSchemaVersion = "provider-release-candidate/v2";
export const providerReleaseCandidateEnvironment = "provider-release-candidate";

export type ProviderReleaseCandidateLane = "clerk" | "stripe";

export const providerReleaseCandidateStripeEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const satisfies readonly Stripe.Event.Type[];

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
    "profile_convergence",
    "account_management",
    "step_up_account_closure",
    "webhook_convergence",
    "provider_user_deletion",
  ],
  stripe: [
    "card_checkout",
    "thirty_minute_expiry_boundary",
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

export type ProviderReleaseCandidateScenario<
  Lane extends ProviderReleaseCandidateLane = ProviderReleaseCandidateLane,
> = (typeof providerReleaseCandidateScenarios)[Lane][number];

export type ProviderReleaseCandidateEnv = Partial<
  Record<
    | "CLERK_PUBLISHABLE_KEY"
    | "CLERK_SECRET_KEY"
    | "CLERK_WEBHOOK_SIGNING_SECRET"
    | "DATABASE_URL"
    | "GITHUB_ENVIRONMENT"
    | "GITHUB_EVENT_NAME"
    | "GITHUB_REPOSITORY"
    | "PROVIDER_RC_APP_ORIGIN"
    | "PROVIDER_RC_BOUNDARY_USER"
    | "PROVIDER_RC_CLERK_GOOGLE_EMAIL"
    | "PROVIDER_RC_CLERK_GOOGLE_PASSWORD"
    | "PROVIDER_RC_EXPECTED_SHA"
    | "PROVIDER_RC_DATABASE_ENVIRONMENT"
    | "PROVIDER_RC_DATABASE_EXPECTED_HOST"
    | "PROVIDER_RC_DATABASE_EXPECTED_NAME"
    | "PROVIDER_RC_DATABASE_RESOURCE_NAME"
    | "PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT"
    | "PROVIDER_RC_PRODUCTION_ORIGIN"
    | "PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET"
    | "PROVIDER_RC_STRIPE_ACTIVE_USER"
    | "PROVIDER_RC_STRIPE_CLOSURE_USER"
    | "PROVIDER_RC_STRIPE_REVERSED_USER"
    | "STRIPE_RESTRICTED_KEY"
    | "STRIPE_SECRET_KEY"
    | "STRIPE_TRIP_PASS_PRICE_ID"
    | "STRIPE_WEBHOOK_SECRET",
    string | undefined
  >
>;

export type ProviderReleaseCandidateValidation = {
  errors: string[];
  valid: boolean;
};

export type ProviderReleaseCandidateEvidence = {
  codeAndMigrationFingerprint: string;
  deployedMigrationLedgerFingerprint: string;
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

export type ProviderReleaseCandidateLifecycleFiles = {
  append(path: string, content: string): Promise<void>;
  read(path: string): Promise<string | undefined>;
  withLock<T>(path: string, work: () => Promise<T>): Promise<T>;
  writeExclusive(path: string, content: string): Promise<void>;
};

export type ProviderReleaseCandidateLifecycleDependencies = {
  env: ProviderReleaseCandidateEnv;
  files: ProviderReleaseCandidateLifecycleFiles;
  loadMigrations(): Promise<readonly Pick<MigrationFile, "checksum" | "name">[]>;
  readCheckedOutCommitSha(): Promise<string>;
  withDatabase<T>(work: (database: DatabaseQueryClient) => Promise<T>): Promise<T>;
};

type ProviderReleaseCandidateDatabaseReceipt = {
  checkedOutCommitSha: string;
  deployedMigrationLedgerFingerprint: string;
  lane: ProviderReleaseCandidateLane;
  migrationCount: number;
  protectedDatabaseEnvironment: "protected-test";
};

type ProviderReleaseCandidateIdentity = {
  checkedOutCommitSha: string;
  lane: ProviderReleaseCandidateLane;
};

type ProviderReleaseCandidateFinalBoundaryReceipt = {
  checkedOutCommitSha: string;
  databaseFingerprint: string;
  deployedCommitSha: string;
  lane: ProviderReleaseCandidateLane;
};

const fullSha = /^[0-9a-f]{40}$/;
const fingerprint = /^[0-9a-f]{64}$/;
const nonProductionDatabaseMarker =
  /(test|testing|staging|stage|qa|sandbox|nonprod|provider[-_]?rc)/i;
const productionDatabaseMarker = /(prod(uction)?|live|main)/i;
const releaseEvidenceDirectory = ".tmp/provider-release-candidate";

export async function createProviderReleaseCandidateLifecycle<
  Lane extends ProviderReleaseCandidateLane,
>(lane: Lane, dependencies: ProviderReleaseCandidateLifecycleDependencies) {
  async function readInitialReceipt(identity: ProviderReleaseCandidateIdentity) {
    return (await readRequiredReceipt(
      dependencies,
      databaseReceiptPath(identity),
      "Protected Release Evidence scenarios cannot run before preflight.",
    )) as ProviderReleaseCandidateDatabaseReceipt;
  }

  async function readFinalBoundaryReceipt(identity: ProviderReleaseCandidateIdentity) {
    return (await readRequiredReceipt(
      dependencies,
      finalBoundaryReceiptPath(identity),
      "Protected Release Evidence cannot be completed before the final boundary is sealed.",
    )) as ProviderReleaseCandidateFinalBoundaryReceipt;
  }

  async function readScenarios(identity: ProviderReleaseCandidateIdentity) {
    const contents = await dependencies.files.read(scenarioReceiptPath(identity));
    return contents?.split("\n").filter(Boolean) ?? [];
  }

  async function readIdentity() {
    const checkedOutCommitSha = await dependencies.readCheckedOutCommitSha();
    assertProviderReleaseCandidateContext({
      checkedOutCommitSha,
      env: dependencies.env,
      lane,
    });
    return { checkedOutCommitSha, lane } as const;
  }

  async function begin() {
    const identity = await readIdentity();
    return dependencies.files.withLock(lifecycleLockPath(identity), async () => {
      const migrations = await dependencies.loadMigrations();
      const database = await inspectProtectedDatabase(migrations);
      const receipt: ProviderReleaseCandidateDatabaseReceipt = {
        ...identity,
        deployedMigrationLedgerFingerprint: database.fingerprint,
        migrationCount: database.migrationCount,
        protectedDatabaseEnvironment: "protected-test",
      };
      await dependencies.files.writeExclusive(
        databaseReceiptPath(identity),
        JSON.stringify(receipt),
      );
      return receipt;
    });
  }

  async function recordScenarios(scenarios: readonly ProviderReleaseCandidateScenario<Lane>[]) {
    const identity = await readIdentity();
    await dependencies.files.withLock(lifecycleLockPath(identity), async () => {
      const migrations = await dependencies.loadMigrations();
      const initial = await readInitialReceipt(identity);
      assertInitialReceipt(initial, identity, migrations.length);
      const database = await inspectProtectedDatabase(migrations);
      assertProviderReleaseCandidateBoundaryStable({
        currentDatabaseFingerprint: database.fingerprint,
        deployedCommitSha: identity.checkedOutCommitSha,
        expectedCommitSha: identity.checkedOutCommitSha,
        initialDatabaseFingerprint: initial.deployedMigrationLedgerFingerprint,
      });
      if (await dependencies.files.read(finalBoundaryReceiptPath(identity))) {
        throw new Error("Protected Release Evidence lifecycle is already sealed.");
      }

      const allowedScenarios = new Set<string>(providerReleaseCandidateScenarios[lane]);
      for (const scenario of scenarios) {
        if (!allowedScenarios.has(scenario)) {
          throw new Error(`Unknown protected ${lane} scenario: ${scenario}.`);
        }
      }
      const executedScenarios = new Set(await readScenarios(identity));
      const additions = scenarios.filter((scenario) => !executedScenarios.has(scenario));
      if (additions.length > 0) {
        await dependencies.files.append(scenarioReceiptPath(identity), `${additions.join("\n")}\n`);
      }
    });
  }

  async function revalidate(deployedCommitSha: string) {
    const identity = await readIdentity();
    const migrations = await dependencies.loadMigrations();
    const initial = await readInitialReceipt(identity);
    assertInitialReceipt(initial, identity, migrations.length);
    const database = await inspectProtectedDatabase(migrations);
    assertProviderReleaseCandidateBoundaryStable({
      currentDatabaseFingerprint: database.fingerprint,
      deployedCommitSha,
      expectedCommitSha: identity.checkedOutCommitSha,
      initialDatabaseFingerprint: initial.deployedMigrationLedgerFingerprint,
    });
    return database.fingerprint;
  }

  async function seal(deployedCommitSha: string) {
    const identity = await readIdentity();
    return dependencies.files.withLock(lifecycleLockPath(identity), async () => {
      assertCompleteScenarios(lane, await readScenarios(identity));
      const databaseFingerprint = await revalidate(deployedCommitSha);
      const receipt: ProviderReleaseCandidateFinalBoundaryReceipt = {
        ...identity,
        databaseFingerprint,
        deployedCommitSha,
      };
      await dependencies.files.writeExclusive(
        finalBoundaryReceiptPath(identity),
        JSON.stringify(receipt),
      );
      return receipt;
    });
  }

  async function complete() {
    const identity = await readIdentity();
    return dependencies.files.withLock(lifecycleLockPath(identity), async () => {
      const migrations = await dependencies.loadMigrations();
      const [initial, finalBoundary, scenarios, database] = await Promise.all([
        readInitialReceipt(identity),
        readFinalBoundaryReceipt(identity),
        readScenarios(identity),
        inspectProtectedDatabase(migrations),
      ]);
      assertInitialReceipt(initial, identity, migrations.length);
      assertFinalBoundaryReceipt(finalBoundary, identity, database.fingerprint);
      assertCompleteScenarios(lane, scenarios);
      assertProviderReleaseCandidateBoundaryStable({
        currentDatabaseFingerprint: database.fingerprint,
        deployedCommitSha: finalBoundary.deployedCommitSha,
        expectedCommitSha: identity.checkedOutCommitSha,
        initialDatabaseFingerprint: initial.deployedMigrationLedgerFingerprint,
      });

      const evidence = buildProviderReleaseCandidateEvidence({
        ...identity,
        deployedMigrationLedgerFingerprint: initial.deployedMigrationLedgerFingerprint,
        migrations,
        scenarios,
      });
      const evidencePath = finalEvidencePath(identity);
      await dependencies.files.writeExclusive(
        evidencePath,
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
      return { evidence, evidencePath };
    });
  }

  async function inspectProtectedDatabase(
    migrations: readonly Pick<MigrationFile, "checksum" | "name">[],
  ) {
    return dependencies.withDatabase(async (database) => {
      const [ledger, sentinel] = await Promise.all([
        database.query<{ checksum: string; name: string }>(
          "select name, checksum from schema_migrations order by applied_at asc, name asc",
        ),
        database.query<{ environment: string; fingerprint: string }>(
          "select environment, fingerprint from provider_release_candidate_sentinel where id = 'provider-release-candidate' limit 1",
        ),
      ]);
      return {
        fingerprint: verifyProviderReleaseCandidateDatabase({
          expectedMigrations: migrations,
          expectedSentinelFingerprint:
            dependencies.env.PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT ?? "",
          ledgerRows: ledger.rows,
          sentinel: sentinel.rows[0],
        }),
        migrationCount: ledger.rows.length,
      };
    });
  }

  await readIdentity();
  return { begin, complete, recordScenarios, revalidate, seal };
}

export function validateProviderReleaseCandidateContext(input: {
  checkedOutCommitSha: string;
  env?: ProviderReleaseCandidateEnv;
  lane: ProviderReleaseCandidateLane;
}): ProviderReleaseCandidateValidation {
  const env = input.env ?? (process.env as ProviderReleaseCandidateEnv);
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
  if (!env.PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET) {
    errors.push("vercel_automation_bypass_required");
  }
  validateProtectedDatabaseConfiguration(env, errors);

  const stripeKey = env.STRIPE_RESTRICTED_KEY ?? env.STRIPE_SECRET_KEY;
  if (!stripeKey || (!stripeKey.startsWith("rk_test_") && !stripeKey.startsWith("sk_test_"))) {
    errors.push("stripe_test_mode_key_required");
  }

  if (!env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    errors.push("clerk_test_publishable_key_required");
  }
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    errors.push("clerk_test_secret_key_required");
  }
  if (!env.PROVIDER_RC_BOUNDARY_USER?.includes("+clerk_test@")) {
    errors.push("dedicated_boundary_test_user_required");
  }

  if (input.lane === "clerk") {
    if (!env.CLERK_WEBHOOK_SIGNING_SECRET?.startsWith("whsec_")) {
      errors.push("clerk_test_webhook_secret_required");
    }
    if (!env.PROVIDER_RC_CLERK_GOOGLE_EMAIL || !env.PROVIDER_RC_CLERK_GOOGLE_PASSWORD) {
      errors.push("clerk_google_oauth_credentials_required");
    }
  } else {
    if (!env.STRIPE_TRIP_PASS_PRICE_ID?.startsWith("price_")) {
      errors.push("stripe_test_price_required");
    }
    if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      errors.push("stripe_test_webhook_secret_required");
    }
    for (const name of [
      "PROVIDER_RC_STRIPE_ACTIVE_USER",
      "PROVIDER_RC_STRIPE_REVERSED_USER",
      "PROVIDER_RC_STRIPE_CLOSURE_USER",
    ] as const) {
      if (!env[name]?.includes("+clerk_test@")) errors.push("dedicated_stripe_test_users_required");
    }
  }

  return { errors, valid: errors.length === 0 };
}

export function buildProviderReleaseCandidateStripeEvent(input: {
  eventId: string;
  object: object;
  type: (typeof providerReleaseCandidateStripeEventTypes)[number];
}): Stripe.Event {
  return {
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1_000),
    data: { object: input.object } as Stripe.Event.Data,
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: input.type,
  } as Stripe.Event;
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

function buildProviderReleaseCandidateEvidence(input: {
  checkedOutCommitSha: string;
  deployedMigrationLedgerFingerprint: string;
  lane: ProviderReleaseCandidateLane;
  migrations: readonly Pick<MigrationFile, "checksum" | "name">[];
  scenarios: readonly string[];
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
    .update("\0")
    .update(input.deployedMigrationLedgerFingerprint)
    .digest("hex");

  const expectedScenarios = providerReleaseCandidateScenarios[input.lane];
  const scenarios = [...new Set(input.scenarios)];
  if (
    scenarios.length !== expectedScenarios.length ||
    expectedScenarios.some((scenario) => !scenarios.includes(scenario))
  ) {
    throw new Error("Protected evidence requires every scenario to have an executed receipt.");
  }

  return {
    codeAndMigrationFingerprint: fingerprint,
    deployedMigrationLedgerFingerprint: input.deployedMigrationLedgerFingerprint,
    lane: input.lane,
    migrations,
    protectedEnvironment: providerReleaseCandidateEnvironment,
    scenarios,
    schemaVersion: providerReleaseCandidateSchemaVersion,
    source: {
      checkedOutCommitSha: input.checkedOutCommitSha,
      repository: "ametel01/ask-siargao",
    },
  };
}

function verifyProviderReleaseCandidateDatabase(input: {
  expectedMigrations: readonly Pick<MigrationFile, "checksum" | "name">[];
  ledgerRows: readonly { checksum: string; name: string }[];
  sentinel: { environment: string; fingerprint: string } | undefined;
  expectedSentinelFingerprint: string;
}) {
  if (
    input.sentinel?.environment !== "protected-test" ||
    input.sentinel.fingerprint !== input.expectedSentinelFingerprint
  ) {
    throw new Error("Protected database sentinel mismatch.");
  }
  if (input.ledgerRows.length !== input.expectedMigrations.length) {
    throw new Error("Protected database migration ledger count mismatch.");
  }
  for (const [index, expected] of input.expectedMigrations.entries()) {
    const actual = input.ledgerRows[index];
    if (actual?.name !== expected.name || actual.checksum !== expected.checksum) {
      throw new Error("Protected database migration ledger content mismatch.");
    }
  }
  return createHash("sha256").update(JSON.stringify(input.ledgerRows)).digest("hex");
}

function assertProviderReleaseCandidateBoundaryStable(input: {
  currentDatabaseFingerprint: string;
  deployedCommitSha: string;
  expectedCommitSha: string;
  initialDatabaseFingerprint: string;
}) {
  if (
    input.deployedCommitSha !== input.expectedCommitSha ||
    input.currentDatabaseFingerprint !== input.initialDatabaseFingerprint
  ) {
    throw new Error("Protected release-candidate deployment or database drifted mid-run.");
  }
}

export function providerReleaseCandidateCheckoutExpiryMatches(input: {
  createdEpochSeconds: number;
  expiryEpochSeconds: number;
  providerExpiryEpochSeconds: number;
}) {
  const expectedExpiryEpochSeconds = Math.floor(input.createdEpochSeconds) + 30 * 60;
  return (
    Number.isInteger(input.expiryEpochSeconds) &&
    input.expiryEpochSeconds === expectedExpiryEpochSeconds &&
    input.providerExpiryEpochSeconds === input.expiryEpochSeconds
  );
}

function databaseReceiptPath(identity: ProviderReleaseCandidateIdentity) {
  return `${releaseEvidenceDirectory}/${identity.lane}-${identity.checkedOutCommitSha}.database.json`;
}

function scenarioReceiptPath(identity: ProviderReleaseCandidateIdentity) {
  return `${releaseEvidenceDirectory}/${identity.lane}-${identity.checkedOutCommitSha}.scenarios`;
}

function finalBoundaryReceiptPath(identity: ProviderReleaseCandidateIdentity) {
  return `${releaseEvidenceDirectory}/${identity.lane}-${identity.checkedOutCommitSha}.final-boundary.json`;
}

function finalEvidencePath(identity: ProviderReleaseCandidateIdentity) {
  return `${releaseEvidenceDirectory}/${identity.lane}-${identity.checkedOutCommitSha}.json`;
}

function lifecycleLockPath(identity: ProviderReleaseCandidateIdentity) {
  return `${releaseEvidenceDirectory}/${identity.lane}-${identity.checkedOutCommitSha}.lock`;
}

async function readRequiredReceipt(
  dependencies: ProviderReleaseCandidateLifecycleDependencies,
  path: string,
  missingMessage: string,
) {
  const contents = await dependencies.files.read(path);
  if (!contents) throw new Error(missingMessage);
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error("Protected Release Evidence receipt is invalid.");
  }
}

function assertCompleteScenarios(lane: ProviderReleaseCandidateLane, scenarios: readonly string[]) {
  const expectedScenarios = providerReleaseCandidateScenarios[lane];
  const uniqueScenarios = new Set(scenarios);
  if (
    uniqueScenarios.size !== expectedScenarios.length ||
    expectedScenarios.some((scenario) => !uniqueScenarios.has(scenario))
  ) {
    throw new Error("Protected evidence requires every scenario to have an executed receipt.");
  }
}

function assertInitialReceipt(
  receipt: ProviderReleaseCandidateDatabaseReceipt,
  identity: ProviderReleaseCandidateIdentity,
  migrationCount: number,
) {
  if (
    receipt.checkedOutCommitSha !== identity.checkedOutCommitSha ||
    receipt.lane !== identity.lane ||
    receipt.protectedDatabaseEnvironment !== "protected-test" ||
    receipt.migrationCount !== migrationCount ||
    !fingerprint.test(receipt.deployedMigrationLedgerFingerprint)
  ) {
    throw new Error("Protected database receipt does not match this exact lane and SHA.");
  }
}

function assertFinalBoundaryReceipt(
  receipt: ProviderReleaseCandidateFinalBoundaryReceipt,
  identity: ProviderReleaseCandidateIdentity,
  databaseFingerprint: string,
) {
  if (
    receipt.checkedOutCommitSha !== identity.checkedOutCommitSha ||
    receipt.lane !== identity.lane ||
    receipt.deployedCommitSha !== identity.checkedOutCommitSha ||
    receipt.databaseFingerprint !== databaseFingerprint
  ) {
    throw new Error("Final live deployment boundary receipt does not match evidence state.");
  }
}

function validateProtectedDatabaseConfiguration(
  env: ProviderReleaseCandidateEnv,
  errors: string[],
) {
  if (env.PROVIDER_RC_DATABASE_ENVIRONMENT !== "protected-test") {
    errors.push("protected_test_database_marker_required");
  }
  if (!env.PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT) {
    errors.push("protected_database_sentinel_required");
  }
  const expectedHost = env.PROVIDER_RC_DATABASE_EXPECTED_HOST ?? "";
  const expectedName = env.PROVIDER_RC_DATABASE_EXPECTED_NAME ?? "";
  const resourceName = env.PROVIDER_RC_DATABASE_RESOURCE_NAME ?? "";
  if (
    !nonProductionDatabaseMarker.test(resourceName) ||
    productionDatabaseMarker.test(resourceName)
  ) {
    errors.push("protected_test_database_resource_required");
  }
  if (!env.DATABASE_URL) {
    errors.push("dedicated_database_required");
    return;
  }
  try {
    const databaseUrl = new URL(env.DATABASE_URL);
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
    if (!databaseUrl.protocol.startsWith("postgres")) throw new Error("protocol");
    if (databaseUrl.hostname !== expectedHost) errors.push("protected_database_host_mismatch");
    if (databaseName !== expectedName) errors.push("protected_database_name_mismatch");
    if (
      productionDatabaseMarker.test(databaseUrl.hostname) ||
      productionDatabaseMarker.test(databaseName)
    ) {
      errors.push("production_database_forbidden");
    }
  } catch {
    errors.push("dedicated_database_url_invalid");
  }
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
