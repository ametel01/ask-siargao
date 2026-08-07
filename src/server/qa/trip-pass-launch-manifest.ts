import { createHash } from "node:crypto";

import type { MigrationFile } from "@/server/db/migration-files";

export const tripPassLaunchManifestSchemaVersion = "trip-pass-launch-manifest/v1";
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
  | "CLERK_AUTH_MODE"
  | "CLERK_SECRET_KEY"
  | "DATABASE_URL"
  | "REDIS_URL"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_TRIP_PASS_PRICE_ID"
  | "STRIPE_WEBHOOK_SECRET"
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
  configurationPresence: Record<ConfigurationKey, boolean> & {
    TRIP_PASS_CHECKOUT_MODE_OFF: boolean;
  };
  engineeringReadiness: {
    engineeringReady: boolean;
    gateResults: TripPassLaunchManifestGateResult[];
  };
  generatedAt: string;
  humanLaunchAuthorization: {
    authorizedAt: null;
    authorizedBy: null;
    checkoutModeMayBeEnabled: false;
    launchAuthorized: false;
  };
  migrations: TripPassLaunchManifestMigration[];
  productAndPolicyVersions: {
    commerceRetentionPolicyVersion: string;
    manifestSchemaVersion: typeof tripPassLaunchManifestSchemaVersion;
    privacyPolicyVersion: string;
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
  generatedAt: string;
  migrations: readonly Pick<MigrationFile, "checksum" | "name">[];
};

const productAndPolicyVersions: TripPassLaunchManifest["productAndPolicyVersions"] = {
  commerceRetentionPolicyVersion: "commerce-retention-policy-pending-human-approval",
  manifestSchemaVersion: tripPassLaunchManifestSchemaVersion,
  privacyPolicyVersion: "privacy-policy-pending-human-approval",
  stripeEventSchemaVersion: "stripe-event-schema-v1",
  termsVersion: "trip-pass-terms-pending-human-approval",
  tripPassProductFamilyVersion: "trip-pass-direct-stripe-family-v1",
  tripPassProductVersion: "trip-pass-direct-stripe-14d-150answers-v1",
};

export function buildTripPassLaunchManifest(
  input: BuildTripPassLaunchManifestInput,
): TripPassLaunchManifest {
  const manifest: TripPassLaunchManifest = {
    artifact: {
      path: tripPassLaunchManifestArtifactPath(input.checkedOutCommitSha),
      shaQualified: true,
    },
    blockers: input.blockers.map((blocker) => ({ ...blocker })),
    configurationPresence: buildConfigurationPresence(input.env ?? {}),
    engineeringReadiness: {
      engineeringReady:
        input.blockers.length === 0 && input.gateResults.every((gate) => gate.status === "pass"),
      gateResults: input.gateResults.map((gate) => ({
        evidenceLinks: [...gate.evidenceLinks],
        id: gate.id,
        status: gate.status,
      })),
    },
    generatedAt: input.generatedAt,
    humanLaunchAuthorization: {
      authorizedAt: null,
      authorizedBy: null,
      checkoutModeMayBeEnabled: false,
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
  if (!isIsoUtcTimestamp(manifest.generatedAt)) {
    errors.push("generated_at_invalid");
  }
  if (artifact.path !== tripPassLaunchManifestArtifactPath(String(checkedOutCommitSha))) {
    errors.push("artifact_path_not_sha_qualified_generated_output");
  }
  if (artifact.shaQualified !== true) {
    errors.push("artifact_not_sha_qualified");
  }

  validateConfigurationPresence(manifest.configurationPresence, errors);
  validateMigrations(manifest.migrations, errors);
  validateProductAndPolicyVersions(manifest.productAndPolicyVersions, errors);
  validateGateResults(engineeringReadiness.gateResults, errors);
  validateBlockers(manifest.blockers, errors);
  validateEngineeringReadinessConsistency(
    engineeringReadiness,
    manifest.blockers,
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
  return [
    "bun_run_lint",
    "bun_run_typecheck_incremental_false",
    "bun_test",
    "bun_run_db_migrate_test",
    "bun_run_db_seed_test",
    "bun_run_build",
    "bun_run_test_e2e",
    "bun_run_test_integration_postgres",
    "bun_run_test_integration_redis",
  ].map((id) => ({
    evidenceLinks: [`local-command://${id}`],
    id,
    status,
  }));
}

export function createFoundationBlockers(): TripPassLaunchManifestBlocker[] {
  return [
    {
      id: "issue-146-154-engineering-readiness-pending",
      owner: "coordinator",
      reason:
        "Auth, identity, checkout, payment lifecycle, account closure, metering, diagnostics, and protected provider lanes remain assigned to downstream issues #146-#154.",
    },
    {
      id: "issue-155-156-human-launch-evidence-pending",
      owner: "coordinator",
      reason:
        "Protected provider lanes, final as-built evidence, and human launch approvals remain assigned to downstream issues #155-#156.",
    },
  ];
}

export function checksumManifestJson(json: string) {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function buildConfigurationPresence(env: Record<string, string | undefined>) {
  return {
    CLERK_AUTH_MODE: hasEnvValue(env.CLERK_AUTH_MODE),
    CLERK_SECRET_KEY: hasEnvValue(env.CLERK_SECRET_KEY),
    DATABASE_URL: hasEnvValue(env.DATABASE_URL),
    REDIS_URL: hasEnvValue(env.REDIS_URL),
    STRIPE_SECRET_KEY: hasEnvValue(env.STRIPE_SECRET_KEY),
    STRIPE_TRIP_PASS_PRICE_ID: hasEnvValue(env.STRIPE_TRIP_PASS_PRICE_ID),
    STRIPE_WEBHOOK_SECRET: hasEnvValue(env.STRIPE_WEBHOOK_SECRET),
    TRIP_PASS_CHECKOUT_MODE: hasEnvValue(env.TRIP_PASS_CHECKOUT_MODE),
    TRIP_PASS_CHECKOUT_MODE_OFF:
      !hasEnvValue(env.TRIP_PASS_CHECKOUT_MODE) || env.TRIP_PASS_CHECKOUT_MODE === "off",
  };
}

function validateConfigurationPresence(configurationPresence: unknown, errors: string[]) {
  const expectedKeys = [
    "CLERK_AUTH_MODE",
    "CLERK_SECRET_KEY",
    "DATABASE_URL",
    "REDIS_URL",
    "STRIPE_SECRET_KEY",
    "STRIPE_TRIP_PASS_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "TRIP_PASS_CHECKOUT_MODE",
    "TRIP_PASS_CHECKOUT_MODE_OFF",
  ];

  if (!isRecord(configurationPresence)) {
    errors.push("configuration_presence_missing");
    return;
  }

  for (const key of Object.keys(configurationPresence)) {
    if (!expectedKeys.includes(key)) {
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
}

function validateEngineeringReadinessConsistency(
  engineeringReadiness: Record<string, unknown>,
  blockers: unknown,
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
  const noBlockers = Array.isArray(blockers) && blockers.length === 0;
  const expectedEngineeringReady = noBlockers && allGatesPassed;

  if (engineeringReadiness.engineeringReady !== expectedEngineeringReady) {
    errors.push("engineering_readiness_inconsistent");
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
