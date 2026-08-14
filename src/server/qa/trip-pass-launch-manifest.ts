import { createHash } from "node:crypto";

import type { MigrationFile } from "@/server/db/migration-files";
import {
  STRIPE_API_VERSION,
  STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION,
} from "@/server/payments/stripe-event-inbox";
import { foundationGateIds } from "@/server/qa/foundation-gates";
import {
  tripPassProductCatalog,
  tripPassProductFamily,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";

export const tripPassLaunchManifestSchemaVersion = "trip-pass-launch-manifest/v2";
export const tripPassLaunchManifestDirectory = ".tmp/trip-pass-launch";

type GateStatus = "pass" | "fail" | "blocked" | "skipped";
type BlockerOwner =
  | "builder-agent"
  | "checker-agent"
  | "coordinator"
  | "engineering"
  | "finance"
  | "legal"
  | "operator"
  | "security";

type ConfigurationKey =
  | "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY"
  | "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON"
  | "CLERK_AUTH_MODE"
  | "CLERK_SECRET_KEY"
  | "COMMERCE_RETENTION_POLICY_VERSION"
  | "DATABASE_URL"
  | "OPERATOR_ACCOUNT_IDS"
  | "REDIS_URL"
  | "SENTRY_DSN"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_TRIP_PASS_PRICE_ID"
  | "STRIPE_WEBHOOK_SECRET"
  | "TRIP_PASS_IDEMPOTENCY_HMAC_KEY"
  | "TRIP_PASS_CHECKOUT_MODE";

export type TripPassLaunchManifestMigration = {
  checksum: string;
  filename: string;
};

export type TripPassLaunchManifestGateResult = {
  evidenceLinks: string[];
  id: string;
  status: GateStatus;
};

export type TripPassLaunchManifestBlocker = {
  id: string;
  owner: BlockerOwner;
  reason: string;
};

export type TripPassLaunchManifest = {
  artifact: {
    path: string;
    shaQualified: true;
  };
  blockers: TripPassLaunchManifestBlocker[];
  checkout: {
    mode: "off";
  };
  configurationPresence: Record<ConfigurationKey, boolean> & {
    TRIP_PASS_CHECKOUT_MODE_OFF: boolean;
  };
  engineeringReadiness: {
    engineeringReady: boolean;
    gateResults: TripPassLaunchManifestGateResult[];
  };
  sourceCommitCommittedAt: string;
  humanLaunchAuthorization: {
    authorizedAt: null;
    authorizedBy: null;
    checkoutModeMayBeEnabled: false;
    requiredEvidence: Array<{
      id: "dedicated_github_launch_issue" | "protected_provider_release_candidate";
      status: "pending_human_action";
    }>;
    launchAuthorized: false;
  };
  migrations: TripPassLaunchManifestMigration[];
  productAndPolicyVersions: {
    commercialMeter: "chat_message:150";
    commerceRetentionPolicyVersion: string;
    durationHours: "336";
    launchPrice: "usd:999";
    manifestSchemaVersion: typeof tripPassLaunchManifestSchemaVersion;
    privacyPolicyVersion: string;
    productCode: string;
    refundPolicyVersion: string;
    stripeApiVersion: string;
    stripeEventSchemaVersion: string;
    termsVersion: string;
    tripPassProductFamilyVersion: string;
    tripPassProductVersion: string;
  };
  schemaVersion: typeof tripPassLaunchManifestSchemaVersion;
  source: {
    checkedOutCommitSha: string;
    repository: "ametel01/ask-siargao";
  };
};

export type BuildTripPassLaunchManifestInput = {
  blockers: TripPassLaunchManifestBlocker[];
  checkedOutCommitSha: string;
  env?: Record<string, string | undefined>;
  gateResults: TripPassLaunchManifestGateResult[];
  sourceCommitCommittedAt: string;
  migrations: readonly Pick<MigrationFile, "checksum" | "name">[];
};

const productAndPolicyVersions: TripPassLaunchManifest["productAndPolicyVersions"] = {
  commercialMeter: `chat_message:${tripPassProductCatalog.paidMeterLimits.chat_message}`,
  commerceRetentionPolicyVersion: tripPassProductCatalog.policyVersions.retention,
  durationHours: String(tripPassProductCatalog.durationHours) as "336",
  launchPrice:
    `${tripPassProductCatalog.currency}:${tripPassProductCatalog.amountTotalMinor}` as "usd:999",
  manifestSchemaVersion: tripPassLaunchManifestSchemaVersion,
  privacyPolicyVersion: tripPassProductCatalog.policyVersions.privacy,
  productCode: tripPassProductCatalog.code,
  refundPolicyVersion: tripPassProductCatalog.policyVersions.refund,
  stripeApiVersion: STRIPE_API_VERSION,
  stripeEventSchemaVersion: String(STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION),
  termsVersion: tripPassProductCatalog.policyVersions.terms,
  tripPassProductFamilyVersion: tripPassProductFamily,
  tripPassProductVersion: String(tripPassProductVersion),
};

const foundationGateIdSet = new Set<string>(foundationGateIds);

export function buildTripPassLaunchManifest(
  input: BuildTripPassLaunchManifestInput,
): TripPassLaunchManifest {
  const manifest: TripPassLaunchManifest = {
    artifact: {
      path: tripPassLaunchManifestArtifactPath(input.checkedOutCommitSha),
      shaQualified: true,
    },
    blockers: input.blockers.map((blocker) => ({ ...blocker })),
    checkout: { mode: "off" },
    configurationPresence: buildConfigurationPresence(input.env ?? {}),
    engineeringReadiness: {
      engineeringReady: input.gateResults.every((gate) => gate.status === "pass"),
      gateResults: input.gateResults.map((gate) => ({
        evidenceLinks: [...gate.evidenceLinks],
        id: gate.id,
        status: gate.status,
      })),
    },
    sourceCommitCommittedAt: input.sourceCommitCommittedAt,
    humanLaunchAuthorization: {
      authorizedAt: null,
      authorizedBy: null,
      checkoutModeMayBeEnabled: false,
      requiredEvidence: [
        { id: "dedicated_github_launch_issue", status: "pending_human_action" },
        { id: "protected_provider_release_candidate", status: "pending_human_action" },
      ],
      launchAuthorized: false,
    },
    migrations: input.migrations.map((migration) => ({
      checksum: migration.checksum,
      filename: migration.name,
    })),
    productAndPolicyVersions: { ...productAndPolicyVersions },
    schemaVersion: tripPassLaunchManifestSchemaVersion,
    source: {
      checkedOutCommitSha: input.checkedOutCommitSha,
      repository: "ametel01/ask-siargao",
    },
  };

  const validation = validateTripPassLaunchManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Trip Pass launch manifest is invalid: ${validation.errors.join(", ")}`);
  }

  return manifest;
}

export function serializeTripPassLaunchManifest(manifest: TripPassLaunchManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function tripPassLaunchManifestArtifactPath(checkedOutCommitSha: string) {
  return `${tripPassLaunchManifestDirectory}/trip-pass-launch-manifest-${checkedOutCommitSha}.json`;
}

export function validateTripPassLaunchManifest(manifest: unknown) {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return { errors: ["manifest_not_object"], valid: false };
  }

  const source = asRecord(manifest.source);
  const artifact = asRecord(manifest.artifact);
  const engineeringReadiness = asRecord(manifest.engineeringReadiness);
  const humanLaunchAuthorization = asRecord(manifest.humanLaunchAuthorization);
  const checkedOutCommitSha = source.checkedOutCommitSha;

  if (manifest.schemaVersion !== tripPassLaunchManifestSchemaVersion) {
    errors.push("invalid_schema_version");
  }
  if (!isSha(checkedOutCommitSha)) {
    errors.push("invalid_checked_out_commit_sha");
  }
  if (source.repository !== "ametel01/ask-siargao") {
    errors.push("invalid_source_repository");
  }
  if (!isIsoUtcTimestamp(manifest.sourceCommitCommittedAt)) {
    errors.push("source_commit_committed_at_invalid");
  }
  if (artifact.path !== tripPassLaunchManifestArtifactPath(String(checkedOutCommitSha))) {
    errors.push("artifact_path_not_sha_qualified_generated_output");
  }
  if (artifact.shaQualified !== true) {
    errors.push("artifact_not_sha_qualified");
  }
  if (asRecord(manifest.checkout).mode !== "off") {
    errors.push("checkout_mode_must_be_off");
  }

  validateConfigurationPresence(manifest.configurationPresence, errors);
  validateMigrations(manifest.migrations, errors);
  validateProductAndPolicyVersions(manifest.productAndPolicyVersions, errors);
  validateGateResults(engineeringReadiness.gateResults, errors);
  validateBlockers(manifest.blockers, errors);
  validateEngineeringReadinessConsistency(
    engineeringReadiness,
    engineeringReadiness.gateResults,
    errors,
  );

  if (humanLaunchAuthorization.launchAuthorized !== false) {
    errors.push("human_launch_authorization_must_be_false");
  }
  if (humanLaunchAuthorization.checkoutModeMayBeEnabled !== false) {
    errors.push("checkout_permission_must_be_false");
  }
  if (humanLaunchAuthorization.authorizedBy !== null) {
    errors.push("human_authorizer_must_be_null");
  }
  if (humanLaunchAuthorization.authorizedAt !== null) {
    errors.push("human_authorization_time_must_be_null");
  }
  validateRequiredHumanEvidence(humanLaunchAuthorization.requiredEvidence, errors);
  if (containsUnredactedSecretShape(safeSerialize(manifest))) {
    errors.push("manifest_contains_unredacted_secret_shape");
  }

  return {
    errors,
    valid: errors.length === 0,
  };
}

export function createFoundationGateResults(
  status: GateStatus,
): TripPassLaunchManifestGateResult[] {
  return foundationGateIds.map((id) => ({
    evidenceLinks: [`local-command://${id}`],
    id,
    status,
  }));
}

export function createFoundationBlockers(): TripPassLaunchManifestBlocker[] {
  return [
    {
      id: "dedicated-github-launch-issue-pending",
      owner: "operator",
      reason:
        "An eligible human must create and complete the dedicated GitHub launch issue after merge.",
    },
    {
      id: "protected-provider-release-candidate-pending",
      owner: "operator",
      reason:
        "An eligible human must run the protected Clerk and Stripe release-candidate workflow after merge.",
    },
    {
      id: "production-configuration-and-change-review-pending",
      owner: "security",
      reason:
        "An eligible human must verify production configuration presence, ownership, rotation, and the reviewed checkout rollout change.",
    },
    {
      id: "launch-signoffs-and-rollback-ownership-pending",
      owner: "coordinator",
      reason:
        "The dedicated launch issue must record legal, privacy, finance, monitoring, backup, rollback, and non-author approval evidence.",
    },
  ];
}

export function checksumManifestJson(json: string) {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export function attestFoundationCiGates(input: {
  checkedOutCommitSha: string;
  env: Record<string, string | undefined>;
  requested: boolean;
}): GateStatus {
  if (!input.requested) return "blocked";
  if (
    input.env.GITHUB_ACTIONS !== "true" ||
    input.env.GITHUB_REPOSITORY !== "ametel01/ask-siargao" ||
    input.env.GITHUB_SHA !== input.checkedOutCommitSha ||
    !["push", "pull_request"].includes(input.env.GITHUB_EVENT_NAME ?? "")
  ) {
    throw new Error("foundation_ci_gate_attestation_untrusted");
  }
  return "pass";
}

function buildConfigurationPresence(env: Record<string, string | undefined>) {
  return {
    ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY: hasEnvValue(env.ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY),
    ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON: hasEnvValue(
      env.ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON,
    ),
    CLERK_AUTH_MODE: hasEnvValue(env.CLERK_AUTH_MODE),
    CLERK_SECRET_KEY: hasEnvValue(env.CLERK_SECRET_KEY),
    COMMERCE_RETENTION_POLICY_VERSION: hasEnvValue(env.COMMERCE_RETENTION_POLICY_VERSION),
    DATABASE_URL: hasEnvValue(env.DATABASE_URL),
    OPERATOR_ACCOUNT_IDS: hasEnvValue(env.OPERATOR_ACCOUNT_IDS),
    REDIS_URL: hasEnvValue(env.REDIS_URL),
    SENTRY_DSN: hasEnvValue(env.SENTRY_DSN),
    STRIPE_SECRET_KEY: hasEnvValue(env.STRIPE_SECRET_KEY),
    STRIPE_TRIP_PASS_PRICE_ID: hasEnvValue(env.STRIPE_TRIP_PASS_PRICE_ID),
    STRIPE_WEBHOOK_SECRET: hasEnvValue(env.STRIPE_WEBHOOK_SECRET),
    TRIP_PASS_IDEMPOTENCY_HMAC_KEY: hasEnvValue(env.TRIP_PASS_IDEMPOTENCY_HMAC_KEY),
    TRIP_PASS_CHECKOUT_MODE: hasEnvValue(env.TRIP_PASS_CHECKOUT_MODE),
    TRIP_PASS_CHECKOUT_MODE_OFF:
      !hasEnvValue(env.TRIP_PASS_CHECKOUT_MODE) || env.TRIP_PASS_CHECKOUT_MODE === "off",
  };
}

function validateConfigurationPresence(configurationPresence: unknown, errors: string[]) {
  const expectedKeys = [
    "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_KEY",
    "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON",
    "CLERK_AUTH_MODE",
    "CLERK_SECRET_KEY",
    "COMMERCE_RETENTION_POLICY_VERSION",
    "DATABASE_URL",
    "OPERATOR_ACCOUNT_IDS",
    "REDIS_URL",
    "SENTRY_DSN",
    "STRIPE_SECRET_KEY",
    "STRIPE_TRIP_PASS_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "TRIP_PASS_IDEMPOTENCY_HMAC_KEY",
    "TRIP_PASS_CHECKOUT_MODE",
    "TRIP_PASS_CHECKOUT_MODE_OFF",
  ];

  if (!isRecord(configurationPresence)) {
    errors.push("configuration_presence_missing");
    return;
  }

  const expectedKeySet = new Set(expectedKeys);
  for (const key of Object.keys(configurationPresence)) {
    if (!expectedKeySet.has(key)) {
      errors.push(`configuration_presence_unknown_key:${key}`);
    }
  }

  for (const key of expectedKeys) {
    if (typeof configurationPresence[key] !== "boolean") {
      errors.push(`configuration_presence_not_boolean:${key}`);
    }
  }

  if (configurationPresence.TRIP_PASS_CHECKOUT_MODE_OFF !== true) {
    errors.push("trip_pass_checkout_mode_not_off");
  }
}

function validateMigrations(migrations: unknown, errors: string[]) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    errors.push("migrations_missing");
    return;
  }

  const seen = new Set<string>();
  let previousFilename = "";
  for (const migration of migrations) {
    if (!isRecord(migration)) {
      errors.push("migration_not_object");
      continue;
    }

    const filename = migration.filename;
    const checksum = migration.checksum;
    if (typeof filename !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(filename)) {
      errors.push(`migration_filename_invalid:${String(filename)}`);
    }
    if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/.test(checksum)) {
      errors.push(`migration_checksum_invalid:${String(filename)}`);
    }
    if (seen.has(String(filename))) {
      errors.push(`migration_duplicate:${String(filename)}`);
    }
    if (previousFilename && String(filename) <= previousFilename) {
      errors.push(`migration_unordered:${String(filename)}`);
    }

    seen.add(String(filename));
    previousFilename = String(filename);
  }
}

function validateProductAndPolicyVersions(
  productAndPolicyVersionsValue: unknown,
  errors: string[],
) {
  if (!isRecord(productAndPolicyVersionsValue)) {
    errors.push("product_and_policy_versions_missing");
    return;
  }

  for (const key of Object.keys(productAndPolicyVersionsValue)) {
    if (!(key in productAndPolicyVersions)) {
      errors.push(`product_and_policy_version_unknown_key:${key}`);
    }
  }

  for (const [key, expectedValue] of Object.entries(productAndPolicyVersions)) {
    if (productAndPolicyVersionsValue[key] !== expectedValue) {
      errors.push(`product_and_policy_version_invalid:${key}`);
    }
  }
}

function validateGateResults(gateResults: unknown, errors: string[]) {
  if (!Array.isArray(gateResults) || gateResults.length === 0) {
    errors.push("gate_results_missing");
    return;
  }

  const seen = new Set<string>();
  for (const gate of gateResults) {
    if (!isRecord(gate)) {
      errors.push("gate_result_not_object");
      continue;
    }

    if (typeof gate.id !== "string" || !/^[a-z0-9_:-]+$/.test(gate.id)) {
      errors.push(`gate_result_id_invalid:${String(gate.id)}`);
    } else if (!foundationGateIdSet.has(gate.id)) {
      errors.push(`gate_result_unknown:${gate.id}`);
    }
    if (!["pass", "fail", "blocked", "skipped"].includes(String(gate.status))) {
      errors.push(`gate_result_status_invalid:${String(gate.id)}`);
    }
    if (!Array.isArray(gate.evidenceLinks) || gate.evidenceLinks.length === 0) {
      errors.push(`gate_result_evidence_missing:${String(gate.id)}`);
    } else if (gate.evidenceLinks.some((link) => typeof link !== "string" || !link.trim())) {
      errors.push(`gate_result_evidence_malformed:${String(gate.id)}`);
    }
    if (seen.has(String(gate.id))) {
      errors.push(`gate_result_duplicate:${String(gate.id)}`);
    }
    seen.add(String(gate.id));
  }

  for (const gateId of foundationGateIds) {
    if (!seen.has(gateId)) {
      errors.push(`gate_result_missing:${gateId}`);
    }
  }
}

function validateEngineeringReadinessConsistency(
  engineeringReadiness: Record<string, unknown>,
  gateResults: unknown,
  errors: string[],
) {
  if (typeof engineeringReadiness.engineeringReady !== "boolean") {
    errors.push("engineering_ready_not_boolean");
    return;
  }

  const allGatesPassed =
    Array.isArray(gateResults) &&
    gateResults.length > 0 &&
    gateResults.every((gate) => isRecord(gate) && gate.status === "pass");
  const expectedEngineeringReady = allGatesPassed;

  if (engineeringReadiness.engineeringReady !== expectedEngineeringReady) {
    errors.push("engineering_readiness_inconsistent");
  }
}

function validateRequiredHumanEvidence(value: unknown, errors: string[]) {
  const expected = ["dedicated_github_launch_issue", "protected_provider_release_candidate"];
  if (!Array.isArray(value)) {
    errors.push("human_required_evidence_missing");
    return;
  }
  for (const id of expected) {
    const receipt = value.find((item) => isRecord(item) && item.id === id);
    if (!receipt) {
      errors.push(`human_required_evidence_missing:${id}`);
    } else if (receipt.status !== "pending_human_action") {
      errors.push(`human_required_evidence_not_pending:${id}`);
    }
  }
}

function validateBlockers(blockers: unknown, errors: string[]) {
  if (!Array.isArray(blockers)) {
    errors.push("blockers_missing");
    return;
  }

  const seen = new Set<string>();
  for (const blocker of blockers) {
    if (!isRecord(blocker)) {
      errors.push("blocker_not_object");
      continue;
    }

    if (typeof blocker.id !== "string" || !/^[a-z0-9-]+$/.test(blocker.id)) {
      errors.push(`blocker_id_invalid:${String(blocker.id)}`);
    }
    if (typeof blocker.owner !== "string" || !blocker.owner.trim()) {
      errors.push(`blocker_owner_invalid:${String(blocker.id)}`);
    }
    if (typeof blocker.reason !== "string" || !blocker.reason.trim()) {
      errors.push(`blocker_reason_invalid:${String(blocker.id)}`);
    }
    if (seen.has(String(blocker.id))) {
      errors.push(`blocker_duplicate:${String(blocker.id)}`);
    }
    seen.add(String(blocker.id));
  }
}

function hasEnvValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isSha(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isIsoUtcTimestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }

  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function containsUnredactedSecretShape(value: string) {
  return (
    /(?:DATABASE_URL|REDIS_URL|SECRET|TOKEN|KEY)["']?\s*[:=]\s*["'][^"']{4,}/i.test(value) ||
    /(?:sk_live|sk_test|pk_live|whsec|postgres:\/\/[^*]|redis:\/\/[^*]|sentinel-secret)/i.test(
      value,
    )
  );
}
