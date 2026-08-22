import { z } from "zod";

import {
  baselineFieldProtocolPackageData,
  type CaptureException,
  type EvidenceAsset,
  type FieldBatch,
  type FieldObservation,
  type FieldRecoveryExport,
  type FieldReview,
  type FieldVisit,
  type ObservationKind,
  type ObservationValueByKind,
  type RouteRun,
  type SchemaGap,
  type SourceStatement,
  trustedFieldProtocolSignersData,
} from "@/features/field-protocol/generated";

export type FieldProtocolRecordByKind = {
  captureException: CaptureException;
  evidenceAsset: EvidenceAsset;
  fieldBatch: FieldBatch;
  fieldObservation: FieldObservation;
  fieldRecoveryExport: FieldRecoveryExport;
  fieldReview: FieldReview;
  fieldVisit: FieldVisit;
  routeRun: RouteRun;
  schemaGap: SchemaGap;
  sourceStatement: SourceStatement;
};

export type FieldProtocolRecordKind = keyof FieldProtocolRecordByKind;
export type FieldProtocolRecord = FieldProtocolRecordByKind[FieldProtocolRecordKind];

export type ProtocolValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type ProtocolValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ProtocolValidationIssue[] };

export type ProtocolVerificationFailure = {
  success: false;
  code:
    | "invalid_package"
    | "unknown_signer"
    | "invalid_signature"
    | "integrity_mismatch"
    | "incompatible_application"
    | "component_version_mismatch";
  message: string;
};

export type ProtocolVerificationResult =
  | {
      success: true;
      packageId: string;
      packageVersion: string;
      signerKeyId: string;
    }
  | ProtocolVerificationFailure;

export type MigrationPreviewResult = {
  original: unknown;
  status: "migrated" | "needs_resolution" | "failed";
  migrated?: FieldProtocolRecord;
  reason?: string;
};

export type ActiveProtocolReference = {
  protocolPackageId: string;
  protocolPackageVersion: string;
};

export const baselineFieldProtocolPackage = baselineFieldProtocolPackageData;

export const trustedFieldProtocolSigners = trustedFieldProtocolSignersData;

const recordSchemas = baselineFieldProtocolPackageData.schemas.records;
const distributionSchemas = baselineFieldProtocolPackageData.distributionSchemas.schemas;
const observationKindRegistry = new Map<string, ObservationRegistryEntry>(
  baselineFieldProtocolPackageData.observationKinds.kinds.map((entry) => [entry.kind, entry]),
);
const methodProfileRegistry = new Map<string, MethodProfileRegistryEntry>(
  baselineFieldProtocolPackageData.methodProfiles.profiles.map((entry) => [entry.id, entry]),
);
const governedSubjectIds = new Set<string>(
  baselineFieldProtocolPackageData.subjects.subjects.map((subject) => subject.id),
);

export function validateFieldProtocolRecord<K extends FieldProtocolRecordKind>(
  kind: K,
  value: unknown,
): ProtocolValidationResult<FieldProtocolRecordByKind[K]> {
  const schema = schemaFromArtifact(recordSchemas[kind]);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_error",
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  if (kind === "fieldObservation") {
    const issues = validateObservationSemantics(parsed.data as FieldObservation);
    if (issues.length > 0) return { success: false, issues };
  }

  return { success: true, data: parsed.data as FieldProtocolRecordByKind[K] };
}

export async function verifyFieldProtocolPackage(input: {
  applicationVersion: string;
  bundle?: unknown;
  trustedSigners?: unknown;
}): Promise<ProtocolVerificationResult> {
  const bundle = asObject(input.bundle ?? baselineFieldProtocolPackageData);
  const manifest = bundle ? asObject(bundle.manifest) : undefined;
  if (!bundle || !manifest) return invalidPackage("The package bundle or manifest is missing.");

  const parsedManifest = schemaFromArtifact(distributionSchemas.packageManifest).safeParse(
    manifest,
  );
  if (!parsedManifest.success) {
    return invalidPackage(
      `The package manifest is invalid: ${parsedManifest.error.issues[0]?.message ?? "unknown schema error"}`,
    );
  }

  const typedManifest = parsedManifest.data as Manifest;
  if (
    !versionInRange(
      input.applicationVersion,
      typedManifest.compatibility.minimumApplicationVersion,
      typedManifest.compatibility.maximumApplicationVersionExclusive,
    )
  ) {
    return {
      success: false,
      code: "incompatible_application",
      message: `Application ${input.applicationVersion} is outside the package compatibility range.`,
    };
  }

  const components = packageComponents(bundle);
  for (const [component, expectedVersion] of Object.entries(typedManifest.componentVersions)) {
    const artifact = components[component];
    if (!artifact || artifact.componentVersion !== expectedVersion) {
      return {
        success: false,
        code: "component_version_mismatch",
        message: `Component ${component} does not match pinned version ${expectedVersion}.`,
      };
    }
  }

  for (const file of typedManifest.files) {
    const artifact = artifactForManifestPath(bundle, file.path);
    if (!artifact || (await sha256(canonicalStringify(artifact))) !== file.sha256) {
      return {
        success: false,
        code: "integrity_mismatch",
        message: `Package integrity failed for ${file.path}.`,
      };
    }
  }

  const trust = asObject(input.trustedSigners ?? trustedFieldProtocolSignersData);
  const signers = Array.isArray(trust?.signers) ? trust.signers : [];
  const signer = signers
    .map((candidate) => asObject(candidate))
    .find(
      (candidate) =>
        candidate?.keyId === typedManifest.signerKeyId && candidate.status === "trusted",
    );
  if (!signer || typeof signer.publicKeySpkiBase64 !== "string") {
    return {
      success: false,
      code: "unknown_signer",
      message: `Signer ${typedManifest.signerKeyId} is not trusted.`,
    };
  }

  const { signature, ...unsignedManifest } = typedManifest;
  const validSignature = await verifyEd25519(
    signer.publicKeySpkiBase64,
    signature.value,
    canonicalStringify(unsignedManifest),
  );
  if (!validSignature) {
    return {
      success: false,
      code: "invalid_signature",
      message: "The Field Protocol Package signature is invalid.",
    };
  }

  return {
    success: true,
    packageId: typedManifest.packageId,
    packageVersion: typedManifest.packageVersion,
    signerKeyId: typedManifest.signerKeyId,
  };
}

export async function activateFieldProtocolPackage(input: {
  applicationVersion: string;
  bundle?: unknown;
  trustedSigners?: unknown;
  activeWork?: readonly ActiveProtocolReference[];
  installedBundles?: readonly unknown[];
}): Promise<
  | {
      success: true;
      activePackage: ActiveProtocolReference;
      pinnedWork: readonly ActiveProtocolReference[];
    }
  | ProtocolVerificationFailure
> {
  const bundle = input.bundle ?? baselineFieldProtocolPackageData;
  const verification = await verifyFieldProtocolPackage({
    applicationVersion: input.applicationVersion,
    bundle,
    trustedSigners: input.trustedSigners,
  });
  if (!verification.success) return verification;

  const installedBundles = [...(input.installedBundles ?? []), bundle];
  const pinnedWork = (input.activeWork ?? []).map((reference) => ({ ...reference }));
  try {
    for (const reference of pinnedWork) resolveProtocolForWork(reference, installedBundles);
  } catch (error) {
    return invalidPackage(
      error instanceof Error ? error.message : "Pinned work cannot be resolved.",
    );
  }

  return {
    success: true,
    activePackage: {
      protocolPackageId: verification.packageId,
      protocolPackageVersion: verification.packageVersion,
    },
    pinnedWork,
  };
}

export function resolveProtocolForWork(
  reference: { protocolPackageId: string; protocolPackageVersion: string },
  installedBundles: readonly unknown[],
) {
  const resolved = installedBundles.find((candidate) => {
    const manifest = asObject(asObject(candidate)?.manifest);
    return (
      manifest?.packageId === reference.protocolPackageId &&
      manifest.packageVersion === reference.protocolPackageVersion
    );
  });
  if (!resolved) {
    throw new Error(
      `Pinned Field Protocol Package ${reference.protocolPackageId}@${reference.protocolPackageVersion} is not installed.`,
    );
  }
  return resolved;
}

export function previewProtocolMigration(input: {
  migration?: unknown;
  records: readonly unknown[];
}): { migrationId: string; results: MigrationPreviewResult[] } {
  const migrationValue = input.migration ?? baselineFieldProtocolPackageData.migration;
  const parsed = schemaFromArtifact(distributionSchemas.protocolMigration).safeParse(
    migrationValue,
  );
  if (!parsed.success) {
    throw new Error(
      `Protocol Migration is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`,
    );
  }
  const migration = parsed.data as ProtocolMigration;
  return {
    migrationId: migration.migrationId,
    results: input.records.map((record) => previewRecordMigration(migration, record)),
  };
}

export function observationValue<K extends ObservationKind>(
  kind: K,
  value: ObservationValueByKind[K],
) {
  return { kind, value } as const;
}

function validateObservationSemantics(observation: FieldObservation): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const registryEntry = observationKindRegistry.get(observation.observationKind as ObservationKind);
  if (!registryEntry) {
    issues.push(
      issue("unknown_observation_kind", "Observation Kind is not governed.", "observationKind"),
    );
    return issues;
  }
  if (observation.valueSchemaVersion !== registryEntry.valueSchemaVersion) {
    issues.push(
      issue(
        "value_schema_version_mismatch",
        `Observation Kind ${registryEntry.kind} requires value schema ${registryEntry.valueSchemaVersion}.`,
        "valueSchemaVersion",
      ),
    );
  }

  const parsedValue = schemaFromArtifact(registryEntry.valueSchema).safeParse(observation.value);
  if (!parsedValue.success) {
    for (const valueIssue of parsedValue.error.issues) {
      issues.push(
        issue(
          "invalid_observation_value",
          valueIssue.message,
          ["value", ...valueIssue.path].join("."),
        ),
      );
    }
  }

  const method = methodProfileRegistry.get(observation.methodProfileId);
  if (!method?.supportedKinds.includes(registryEntry.kind)) {
    issues.push(
      issue(
        "incompatible_method_profile",
        `Method Profile ${observation.methodProfileId} does not support ${registryEntry.kind}.`,
        "methodProfileId",
      ),
    );
  }

  if (
    observation.subject.kind === "governed" &&
    !governedSubjectIds.has(observation.subject.subjectId)
  ) {
    issues.push(
      issue("unknown_subject", "The governed Subject is not in this package.", "subject.subjectId"),
    );
  }

  if (observation.rawMeasurement) {
    if (!registryEntry.allowedUnits.includes(observation.rawMeasurement.unit)) {
      issues.push(
        issue(
          "unit_not_allowed",
          `Unit ${observation.rawMeasurement.unit} is not allowed for ${registryEntry.kind}.`,
          "rawMeasurement.unit",
        ),
      );
    }
    if (method && !method.supportedUnits.includes(observation.rawMeasurement.unit)) {
      issues.push(
        issue(
          "method_unit_not_allowed",
          `Method Profile ${method.id} does not produce ${observation.rawMeasurement.unit}.`,
          "rawMeasurement.unit",
        ),
      );
    }
  }

  if (observation.normalizedMeasurement) {
    if (!observation.rawMeasurement) {
      issues.push(
        issue(
          "raw_measurement_missing",
          "A Normalized Measurement requires its immutable Raw Measurement.",
          "normalizedMeasurement",
        ),
      );
    } else if (
      observation.normalizedMeasurement.sourceRawMeasurementId !== observation.rawMeasurement.id
    ) {
      issues.push(
        issue(
          "conversion_lineage_mismatch",
          "Normalized Measurement lineage does not point to the Raw Measurement.",
          "normalizedMeasurement.sourceRawMeasurementId",
        ),
      );
    }
  }

  if (observation.captureConfidence !== "high" && !observation.captureConfidenceReason?.trim()) {
    issues.push(
      issue(
        "capture_confidence_reason_missing",
        "Medium and low Capture Confidence require a reason.",
        "captureConfidenceReason",
      ),
    );
  }

  const observedAt = Date.parse(observation.observedAt);
  const reviewDueAt = Date.parse(observation.reviewDueAt);
  const maximumReviewDueAt = observedAt + registryEntry.freshness.defaultReviewMinutes * 60 * 1000;
  if (reviewDueAt > maximumReviewDueAt) {
    issues.push(
      issue(
        "freshness_extension_not_allowed",
        "The review due time may be shortened but cannot exceed the Observation Kind default.",
        "reviewDueAt",
      ),
    );
  }

  return issues;
}

function previewRecordMigration(
  migration: ProtocolMigration,
  originalValue: unknown,
): MigrationPreviewResult {
  const original = structuredClone(originalValue);
  const record = asObject(originalValue);
  if (!record || record.protocolPackageVersion !== migration.fromPackageVersion) {
    return {
      original,
      status: "failed",
      reason: `Record is not pinned to source package ${migration.fromPackageVersion}.`,
    };
  }

  const observationKind =
    typeof record.observationKind === "string" ? record.observationKind : undefined;
  const ambiguity = migration.ambiguousKinds.find((entry) => entry.kind === observationKind);
  if (ambiguity) return { original, status: "needs_resolution", reason: ambiguity.reason };
  if (observationKind && migration.unsupportedKinds.includes(observationKind)) {
    return {
      original,
      status: "failed",
      reason: `Observation Kind ${observationKind} cannot be migrated without distortion.`,
    };
  }

  const migrated = structuredClone(record);
  migrated.protocolPackageVersion = migration.toPackageVersion;
  const kindMapping = migration.kindMappings.find((entry) => entry.from === observationKind);
  if (kindMapping) migrated.observationKind = kindMapping.to;
  const subject = asObject(migrated.subject);
  if (subject?.kind === "governed" && typeof subject.subjectId === "string") {
    const subjectMapping = migration.subjectMappings.find(
      (entry) => entry.from === subject.subjectId,
    );
    if (subjectMapping) subject.subjectId = subjectMapping.to;
    else if (subject.subjectId.startsWith("legacy_")) {
      return {
        original,
        status: "needs_resolution",
        reason: `Legacy Subject ${subject.subjectId} has no unambiguous governed mapping.`,
      };
    }
  }

  const recordKind = recordKindForSchemaVersion(migrated.schemaVersion);
  if (!recordKind) {
    return { original, status: "failed", reason: "Record schema is not governed by this package." };
  }
  const validation = validateFieldProtocolRecord(recordKind, migrated);
  if (!validation.success) {
    return {
      original,
      status: "failed",
      reason: validation.issues[0]?.message ?? "Migrated record did not validate.",
    };
  }
  return { original, status: "migrated", migrated: validation.data };
}

function recordKindForSchemaVersion(value: unknown): FieldProtocolRecordKind | undefined {
  const match = (
    Object.entries(recordSchemas) as Array<
      [FieldProtocolRecordKind, { properties: { schemaVersion: { const: string } } }]
    >
  ).find(([, schema]) => schema.properties.schemaVersion.const === value);
  return match?.[0];
}

function packageComponents(
  bundle: Record<string, unknown>,
): Record<string, Record<string, unknown> | undefined> {
  return {
    schemas: asObject(bundle.schemas),
    distributionSchemas: asObject(bundle.distributionSchemas),
    observationKinds: asObject(bundle.observationKinds),
    methodProfiles: asObject(bundle.methodProfiles),
    subjects: asObject(bundle.subjects),
    geography: asObject(bundle.geography),
    campaign: asObject(bundle.campaign),
    help: asObject(bundle.help),
    migration: asObject(bundle.migration),
    examples: asObject(bundle.examples),
  } satisfies Record<string, Record<string, unknown> | undefined>;
}

function artifactForManifestPath(bundle: Record<string, unknown>, path: string) {
  const filename = path.split("/").at(-1);
  const keyByFilename: Record<string, string> = {
    "campaign-island-baseline.v1.json": "campaign",
    "distribution-schemas.v1.json": "distributionSchemas",
    "examples.v1.json": "examples",
    "geography.v1.json": "geography",
    "help.v1.json": "help",
    "method-profiles.v1.json": "methodProfiles",
    "migration-legacy-0.9.0.v1.json": "migration",
    "observation-kinds.v1.json": "observationKinds",
    "schemas.v1.json": "schemas",
    "subjects.v1.json": "subjects",
  };
  return filename ? bundle[keyByFilename[filename] ?? ""] : undefined;
}

async function verifyEd25519(publicKeyBase64: string, signatureBase64: string, message: string) {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(publicKeyBase64), (character) => character.charCodeAt(0)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(atob(signatureBase64), (character) => character.charCodeAt(0)),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

function versionInRange(value: string, minimum: string, maximumExclusive: string) {
  return compareVersions(value, minimum) >= 0 && compareVersions(value, maximumExclusive) < 0;
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseVersion(value: string) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return undefined;
  return value.split(".").map(Number);
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function issue(code: string, message: string, path: string): ProtocolValidationIssue {
  return { code, message, path };
}

function invalidPackage(message: string): ProtocolVerificationFailure {
  return { success: false, code: "invalid_package", message };
}

function schemaFromArtifact(value: unknown) {
  return z.fromJSONSchema(structuredClone(value) as Parameters<typeof z.fromJSONSchema>[0]);
}

type Manifest = {
  packageId: string;
  packageVersion: string;
  signerKeyId: string;
  componentVersions: Record<string, string>;
  compatibility: {
    minimumApplicationVersion: string;
    maximumApplicationVersionExclusive: string;
  };
  files: Array<{ path: string; sha256: string }>;
  signature: { algorithm: "Ed25519"; value: string };
};

type ProtocolMigration = {
  migrationId: string;
  fromPackageVersion: string;
  toPackageVersion: string;
  kindMappings: Array<{ from: string; to: string }>;
  subjectMappings: Array<{ from: string; to: string }>;
  ambiguousKinds: Array<{ kind: string; reason: string }>;
  unsupportedKinds: string[];
};

type ObservationRegistryEntry = {
  kind: string;
  valueSchemaVersion: string;
  allowedUnits: readonly string[];
  requiredContext: readonly string[];
  freshness: {
    defaultReviewMinutes: number;
    maximumReviewMinutes: number;
  };
  valueSchema: unknown;
};

type MethodProfileRegistryEntry = {
  id: string;
  supportedKinds: readonly string[];
  supportedUnits: readonly string[];
};
