import { z } from "zod";

import { parseFieldFile } from "@/features/field-ingestion/field-capture";
import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  baselineFieldProtocolPackageData,
  type CaptureException,
  type EvidenceAsset,
  type FieldBatch,
  type FieldObservation,
  type FieldProtocolPackageManifest,
  type FieldRecoveryExport,
  type FieldReview,
  type FieldVisit,
  type ObservationKind,
  type ObservationValueByKind,
  type ProtocolMigration,
  type RouteRun,
  type SchemaGap,
  type SourceStatement,
  type StatementTranslation,
  trustedFieldProtocolSignersData,
} from "@/features/field-protocol/generated";
import { fieldProtocolPackageComponents } from "@/features/field-protocol/package-components";

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
  statementTranslation: StatementTranslation;
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
const coverageRequirementsByAssignment = new Map<
  string,
  ReadonlyMap<string, CoverageRequirementConstraint>
>(
  baselineFieldProtocolPackageData.campaign.assignments.map((assignment) => [
    assignment.id,
    new Map<string, CoverageRequirementConstraint>(
      assignment.coverageRequirements.map((requirement) => [requirement.id, requirement] as const),
    ),
  ]),
);
const objectiveConstraintsByAssignment = new Map<string, ReadonlyMap<string, ObjectiveConstraint>>(
  baselineFieldProtocolPackageData.campaign.assignments.map((assignment) => [
    assignment.id,
    new Map<string, ObjectiveConstraint>(
      assignment.objectives.map((objective) => [
        objective.id,
        {
          observationKinds: "observationKinds" in objective ? objective.observationKinds : [],
          recordKinds: "recordKinds" in objective ? objective.recordKinds : [],
        },
      ]),
    ),
  ]),
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

  const packageIssues = validateRecordPackageReference(parsed.data);
  if (packageIssues.length > 0) return { success: false, issues: packageIssues };

  if (kind === "fieldObservation") {
    const issues = validateObservationSemantics(parsed.data as FieldObservation);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "fieldBatch") {
    const issues = validateFieldBatchSemantics(parsed.data as FieldBatch);
    if (issues.length > 0) return { success: false, issues };
  }
  const coverageIssues = validateCoverageRequirementLinks(parsed.data);
  if (coverageIssues.length > 0) return { success: false, issues: coverageIssues };

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

  const typedManifest = parsedManifest.data as FieldProtocolPackageManifest;
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

  const expectedPaths = fieldProtocolPackageComponents.map(
    ({ filename }) => `canonical/v1/${filename}`,
  );
  const actualPaths = typedManifest.files.map(({ path }) => path);
  if (
    expectedPaths.length !== actualPaths.length ||
    expectedPaths.some((path) => !actualPaths.includes(path))
  ) {
    return {
      success: false,
      code: "integrity_mismatch",
      message: "The package manifest does not contain the complete canonical artifact set.",
    };
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

  const migrationDeclarationFailure = verifyMigrationDeclaration(typedManifest, components);
  if (migrationDeclarationFailure) return migrationDeclarationFailure;

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
    for (const reference of pinnedWork) {
      await resolveProtocolForWork(reference, installedBundles, {
        applicationVersion: input.applicationVersion,
        trustedSigners: input.trustedSigners,
      });
    }
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

export async function resolveProtocolForWork(
  reference: { protocolPackageId: string; protocolPackageVersion: string },
  installedBundles: readonly unknown[],
  verification: { applicationVersion?: string; trustedSigners?: unknown } = {},
) {
  const candidates = installedBundles.filter((candidate) => {
    const manifest = asObject(asObject(candidate)?.manifest);
    return (
      manifest?.packageId === reference.protocolPackageId &&
      manifest.packageVersion === reference.protocolPackageVersion
    );
  });
  if (candidates.length === 0) {
    throw new Error(
      `Pinned Field Protocol Package ${reference.protocolPackageId}@${reference.protocolPackageVersion} is not installed.`,
    );
  }
  let lastFailure: ProtocolVerificationFailure | undefined;
  for (const candidate of candidates) {
    const result = await verifyFieldProtocolPackage({
      applicationVersion: verification.applicationVersion ?? "0.1.0",
      bundle: candidate,
      trustedSigners: verification.trustedSigners,
    });
    if (result.success) return candidate;
    lastFailure = result;
  }
  throw new Error(
    `Pinned Field Protocol Package ${reference.protocolPackageId}@${reference.protocolPackageVersion} is not verified: ${lastFailure?.message ?? "verification failed"}`,
  );
}

export async function previewProtocolMigration(input: {
  applicationVersion?: string;
  bundle?: unknown;
  records: readonly unknown[];
  trustedSigners?: unknown;
}): Promise<{ migrationId: string; results: MigrationPreviewResult[] }> {
  if (Object.hasOwn(input, "migration")) {
    throw new Error(
      "Raw Protocol Migration artifacts cannot be previewed; provide a signed Field Protocol Package.",
    );
  }
  const bundleValue = input.bundle ?? baselineFieldProtocolPackageData;
  const verification = await verifyFieldProtocolPackage({
    applicationVersion: input.applicationVersion ?? "0.1.0",
    bundle: bundleValue,
    trustedSigners: input.trustedSigners,
  });
  if (!verification.success) {
    throw new Error(`Field Protocol Package is not verified: ${verification.message}`);
  }
  const migrationValue = asObject(bundleValue)?.migration;
  const parsed = schemaFromArtifact(distributionSchemas.protocolMigration).safeParse(
    migrationValue,
  );
  if (!parsed.success) {
    throw new Error(
      `Protocol Migration is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`,
    );
  }
  const migration = parsed.data as ProtocolMigration;
  const legacyVisits = new Map<string, Record<string, unknown>>();
  for (const recordValue of input.records) {
    const record = asObject(recordValue);
    if (record?.recordType === "visit" && typeof record.id === "string") {
      legacyVisits.set(record.id, record);
    }
  }
  return {
    migrationId: migration.migrationId,
    results: input.records.map((record) => previewRecordMigration(migration, record, legacyVisits)),
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
    if (!registryEntry.allowedUnits.includes(observation.normalizedMeasurement.unit)) {
      issues.push(
        issue(
          "unit_not_allowed",
          `Unit ${observation.normalizedMeasurement.unit} is not allowed for ${registryEntry.kind}.`,
          "normalizedMeasurement.unit",
        ),
      );
    }
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

function validateFieldBatchSemantics(batch: FieldBatch): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const fileCounts = new Map<string, number>();
  for (const file of batch.files) {
    fileCounts.set(file.recordType, (fileCounts.get(file.recordType) ?? 0) + file.recordCount);
  }
  for (const [recordType, expectedCount] of Object.entries(batch.recordCounts)) {
    if ((fileCounts.get(recordType) ?? 0) !== expectedCount) {
      issues.push(
        issue(
          "batch_record_count_mismatch",
          `Typed files contain ${fileCounts.get(recordType) ?? 0} ${recordType} records but the batch declares ${expectedCount}.`,
          `recordCounts.${recordType}`,
        ),
      );
    }
  }

  const expectedIndependentReviews =
    batch.reviewerSummary.reviewerIds.length - (batch.reviewerSummary.includesSelfReview ? 1 : 0);
  if (batch.reviewerSummary.independentReviewCount !== expectedIndependentReviews) {
    issues.push(
      issue(
        "batch_reviewer_independence_mismatch",
        "Independent review count does not match the declared reviewer identities and self-review state.",
        "reviewerSummary.independentReviewCount",
      ),
    );
  }
  return issues;
}

function validateCoverageRequirementLinks(value: unknown): ProtocolValidationIssue[] {
  const record = asObject(value);
  if (!record || typeof record.assignmentId !== "string") return [];
  const requirements = coverageRequirementsByAssignment.get(record.assignmentId);
  const objectives = objectiveConstraintsByAssignment.get(record.assignmentId);
  if (!requirements || !objectives) {
    return [
      issue(
        "unknown_assignment",
        `Assignment ${record.assignmentId} is not governed by the baseline Campaign.`,
        "assignmentId",
      ),
    ];
  }

  const links =
    typeof record.coverageRequirementId === "string"
      ? [record.coverageRequirementId]
      : Array.isArray(record.coverageRequirementIds)
        ? record.coverageRequirementIds.filter(
            (candidate): candidate is string => typeof candidate === "string",
          )
        : [];
  const objectiveIds =
    typeof record.objectiveId === "string"
      ? new Set([record.objectiveId])
      : new Set(
          Array.isArray(record.objectiveIds)
            ? record.objectiveIds.filter(
                (candidate): candidate is string => typeof candidate === "string",
              )
            : [],
        );

  const issues: ProtocolValidationIssue[] = [];
  for (const [index, requirementId] of links.entries()) {
    const requirement = requirements.get(requirementId);
    const path =
      typeof record.coverageRequirementId === "string"
        ? "coverageRequirementId"
        : `coverageRequirementIds.${index}`;
    if (!requirement) {
      issues.push(
        issue(
          "unknown_coverage_requirement",
          `Coverage Requirement ${requirementId} does not belong to Assignment ${record.assignmentId}.`,
          path,
        ),
      );
    } else if (!objectiveIds.has(requirement.objectiveId)) {
      issues.push(
        issue(
          "coverage_objective_mismatch",
          `Coverage Requirement ${requirementId} belongs to Objective ${requirement.objectiveId}.`,
          path,
        ),
      );
    } else if (
      record.schemaVersion === "field-observation.v1" &&
      typeof record.observationKind === "string" &&
      !objectives.get(requirement.objectiveId)?.observationKinds.includes(record.observationKind)
    ) {
      issues.push(
        issue(
          "objective_observation_kind_mismatch",
          `Objective ${requirement.objectiveId} does not accept ${record.observationKind} observations.`,
          "observationKind",
        ),
      );
    } else if (
      record.schemaVersion !== "field-observation.v1" &&
      record.schemaVersion !== "capture-exception.v1" &&
      record.schemaVersion !== "schema-gap.v1" &&
      typeof record.schemaVersion === "string" &&
      !objectives.get(requirement.objectiveId)?.recordKinds.includes(record.schemaVersion)
    ) {
      issues.push(
        issue(
          "objective_record_kind_mismatch",
          `Objective ${requirement.objectiveId} does not accept ${record.schemaVersion} evidence.`,
          path,
        ),
      );
    } else if (
      record.schemaVersion !== "capture-exception.v1" &&
      record.schemaVersion !== "schema-gap.v1" &&
      typeof record.schemaVersion === "string" &&
      !requirement.admissibleRecordKinds.includes(record.schemaVersion)
    ) {
      issues.push(
        issue(
          "coverage_record_kind_mismatch",
          `Coverage Requirement ${requirementId} does not accept ${record.schemaVersion} evidence.`,
          path,
        ),
      );
    } else if (
      record.schemaVersion === "field-observation.v1" &&
      typeof record.observationKind === "string" &&
      !requirement.admissibleObservationKinds.includes(record.observationKind)
    ) {
      issues.push(
        issue(
          "coverage_observation_kind_mismatch",
          `Coverage Requirement ${requirementId} does not accept ${record.observationKind} observations.`,
          path,
        ),
      );
    }
  }
  return issues;
}

function validateRecordPackageReference(value: unknown): ProtocolValidationIssue[] {
  const record = asObject(value);
  if (!record) return [];
  const manifest = baselineFieldProtocolPackageData.manifest;
  if (
    typeof record.protocolPackageId === "string" &&
    record.protocolPackageId !== manifest.packageId
  ) {
    return [
      issue(
        "protocol_package_mismatch",
        `This validator is bound to ${manifest.packageId}@${manifest.packageVersion}.`,
        "protocolPackageId",
      ),
    ];
  }
  if (
    typeof record.protocolPackageVersion === "string" &&
    record.protocolPackageVersion !== manifest.packageVersion
  ) {
    return [
      issue(
        "protocol_package_mismatch",
        `This validator is bound to ${manifest.packageId}@${manifest.packageVersion}.`,
        "protocolPackageVersion",
      ),
    ];
  }
  return [];
}

function previewRecordMigration(
  migration: ProtocolMigration,
  originalValue: unknown,
  legacyVisits: ReadonlyMap<string, Record<string, unknown>>,
): MigrationPreviewResult {
  const original = structuredClone(originalValue);
  const record = asObject(originalValue);
  if (!record) {
    return {
      original,
      status: "failed",
      reason: "Record is not an object.",
    };
  }

  if (
    typeof record.schemaVersion === "string" &&
    migration.sourceSchemaVersions.includes(record.schemaVersion)
  ) {
    return previewLegacyCaptureMigration(migration, record, original, legacyVisits);
  }

  if (record.protocolPackageVersion !== migration.fromPackageVersion) {
    return {
      original,
      status: "failed",
      reason: `Record is neither a supported Legacy Capture schema nor pinned to source package ${migration.fromPackageVersion}.`,
    };
  }

  const observationKind =
    typeof record.observationKind === "string" ? record.observationKind : undefined;
  const classificationFailure = classifyMigrationKind(migration, observationKind);
  if (classificationFailure) return { original, ...classificationFailure };

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

function previewLegacyCaptureMigration(
  migration: ProtocolMigration,
  record: Record<string, unknown>,
  original: unknown,
  legacyVisits: ReadonlyMap<string, Record<string, unknown>>,
): MigrationPreviewResult {
  const parsedLegacy = parseFieldFile("legacy-field-record.json", JSON.stringify(record));
  if (parsedLegacy.issues.length > 0 || parsedLegacy.records.length !== 1) {
    return {
      original,
      status: "failed",
      reason: parsedLegacy.issues[0]?.message ?? "Legacy Capture did not validate.",
    };
  }
  if (record.recordType !== "observation") {
    return {
      original,
      status: "needs_resolution",
      reason: `Legacy ${String(record.recordType)} records require an explicit record-type mapping.`,
    };
  }

  const observationKind = typeof record.observationKind === "string" ? record.observationKind : "";
  const classificationFailure = classifyMigrationKind(migration, observationKind);
  if (classificationFailure) return { original, ...classificationFailure };

  const kindMapping = migration.kindMappings.find((entry) => entry.from === observationKind);
  if (!kindMapping) {
    return {
      original,
      status: "needs_resolution",
      reason: `Legacy Observation Kind ${observationKind || "(missing)"} has no governed mapping.`,
    };
  }

  const legacyVisit =
    typeof record.visitId === "string" ? legacyVisits.get(record.visitId) : undefined;
  const legacySubjectId = firstString(record.entityId, legacyVisit?.entityId, legacyVisit?.areaId);
  const subjectMapping = migration.subjectMappings.find((entry) => entry.from === legacySubjectId);
  if (!subjectMapping) {
    return {
      original,
      status: "needs_resolution",
      reason: `Legacy Subject ${legacySubjectId || "(missing)"} has no unambiguous governed mapping.`,
    };
  }

  const legacyMethod = typeof record.method === "string" ? record.method : "";
  const methodMapping = migration.methodMappings.find((entry) => entry.from === legacyMethod);
  if (!methodMapping) {
    return {
      original,
      status: "needs_resolution",
      reason: `Legacy method ${legacyMethod || "(missing)"} has no governed Method Profile.`,
    };
  }

  const requiredStrings = [
    "id",
    "clientBatchId",
    "capturedAt",
    "localTimezone",
    "visitId",
    "observedAt",
    "reviewDueAt",
  ] as const;
  const missing = requiredStrings.find(
    (key) => typeof record[key] !== "string" || record[key].length === 0,
  );
  if (missing) {
    return {
      original,
      status: "needs_resolution",
      reason: `Legacy Capture is missing ${missing}, which is required for attributable migration.`,
    };
  }
  const researcherId = firstString(record.observerKey, legacyVisit?.observerKey);
  if (!researcherId) {
    return {
      original,
      status: "needs_resolution",
      reason: "Legacy Capture has no attributable researcher on the observation or its Visit.",
    };
  }

  const route = migration.legacyObservationRoutes.find(
    (entry) => entry.subjectId === subjectMapping.to && entry.observationKind === kindMapping.to,
  );
  if (!route) {
    return {
      original,
      status: "needs_resolution",
      reason: `Governed Subject ${subjectMapping.to} and Observation Kind ${kindMapping.to} have no signed migration route.`,
    };
  }

  const captureConfidence =
    record.fieldConfidence === "high" ||
    record.fieldConfidence === "medium" ||
    record.fieldConfidence === "low"
      ? record.fieldConfidence
      : "low";
  const migrated: Record<string, unknown> = {
    schemaVersion: "field-observation.v1",
    id: record.id,
    protocolPackageId: migration.targetProtocolPackageId,
    protocolPackageVersion: migration.toPackageVersion,
    campaignId: migration.targetCampaignId,
    assignmentId: route.assignmentId,
    visitId: record.visitId,
    objectiveId: route.objectiveId,
    coverageRequirementId: route.coverageRequirementId,
    researcherId,
    deviceId: `legacy-batch-${record.clientBatchId}`,
    recordedAt: record.capturedAt,
    localTimezone: record.localTimezone,
    captureState: record.status === "captured" ? "captured" : "draft",
    subject: { kind: "governed", subjectId: subjectMapping.to },
    observationKind: kindMapping.to,
    valueSchemaVersion: "1.0.0",
    directness: record.directness,
    observedAt: record.observedAt,
    utcOffsetMinutes: utcOffsetMinutes(String(record.observedAt)),
    timeCorrected: false,
    value: record.value,
    methodProfileId: methodMapping.to,
    conditions: Array.isArray(record.conditionTags) ? record.conditionTags : [],
    captureConfidence,
    reviewDueAt: record.reviewDueAt,
    permissions: {
      llmUse: record.llmUseAllowed === true,
      articleUse: record.articleUseAllowed === true,
      quotationUse: false,
      publicUse: record.publicRepublishAllowed === true,
    },
    assetIds: [],
    contradictsObservationIds: [],
  };
  if (captureConfidence !== "high") {
    migrated.captureConfidenceReason =
      "Preserved from Legacy Capture without a structured confidence reason.";
  }

  const validation = validateFieldProtocolRecord("fieldObservation", migrated);
  if (!validation.success) {
    return {
      original,
      status: "failed",
      reason: validation.issues[0]?.message ?? "Migrated record did not validate.",
    };
  }
  return { original, status: "migrated", migrated: validation.data };
}

function classifyMigrationKind(
  migration: ProtocolMigration,
  observationKind: string | undefined,
): Pick<MigrationPreviewResult, "status" | "reason"> | undefined {
  const ambiguity = migration.ambiguousKinds.find((entry) => entry.kind === observationKind);
  if (ambiguity) return { status: "needs_resolution", reason: ambiguity.reason };
  if (observationKind && migration.unsupportedKinds.includes(observationKind)) {
    return {
      status: "failed",
      reason: `Observation Kind ${observationKind} cannot be migrated without distortion.`,
    };
  }
}

function utcOffsetMinutes(value: string) {
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function firstString(...values: unknown[]) {
  return (
    values.find((value): value is string => typeof value === "string" && value.length > 0) ?? ""
  );
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
  return Object.fromEntries(
    fieldProtocolPackageComponents.map(({ key }) => [key, asObject(bundle[key])]),
  );
}

function verifyMigrationDeclaration(
  manifest: FieldProtocolPackageManifest,
  components: Record<string, Record<string, unknown> | undefined>,
): ProtocolVerificationFailure | undefined {
  const parsedMigration = schemaFromArtifact(distributionSchemas.protocolMigration).safeParse(
    components.migration,
  );
  if (!parsedMigration.success) {
    return invalidPackage(
      `The pinned Protocol Migration is invalid: ${parsedMigration.error.issues[0]?.message ?? "unknown schema error"}`,
    );
  }
  const migration = parsedMigration.data as ProtocolMigration;
  const declaration = manifest.migrationDeclaration;
  if (declaration.strategy !== "explicit_preview_required") {
    return invalidPackage(
      "The migration declaration must require an explicit preview for the pinned migration.",
    );
  }
  if (
    declaration.migrationIds.length !== 1 ||
    declaration.migrationIds[0] !== migration.migrationId
  ) {
    return invalidPackage("The migration declaration does not identify the pinned migration.");
  }
  if (
    declaration.supportedFromVersions.length !== 1 ||
    declaration.supportedFromVersions[0] !== migration.fromPackageVersion
  ) {
    return invalidPackage(
      "The migration declaration source versions do not match the pinned migration.",
    );
  }
  if (
    migration.targetProtocolPackageId !== manifest.packageId ||
    migration.toPackageVersion !== manifest.packageVersion
  ) {
    return invalidPackage(
      "The pinned migration target does not match the package ID and version in the manifest.",
    );
  }
  if (migration.targetCampaignId !== components.campaign?.campaignId) {
    return invalidPackage(
      "The pinned migration target campaign does not match the package campaign.",
    );
  }
  const routeFailure = verifyLegacyObservationRoutes(
    migration,
    components.campaign,
    components.subjects,
  );
  if (routeFailure) return invalidPackage(routeFailure);
}

function verifyLegacyObservationRoutes(
  migration: ProtocolMigration,
  campaign: Record<string, unknown> | undefined,
  subjects: Record<string, unknown> | undefined,
): string | undefined {
  const assignments = Array.isArray(campaign?.assignments) ? campaign.assignments : [];
  const governedSubjectsById = new Map(
    (Array.isArray(subjects?.subjects) ? subjects.subjects : [])
      .map((candidate) => asObject(candidate))
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
      .filter((candidate) => typeof candidate.id === "string")
      .map((candidate) => [candidate.id as string, candidate] as const),
  );
  const subjectTargets = new Set(migration.subjectMappings.map((mapping) => mapping.to));
  const kindTargets = new Set(migration.kindMappings.map((mapping) => mapping.to));
  const routeKeys = new Set<string>();

  for (const route of migration.legacyObservationRoutes) {
    if (
      !subjectTargets.has(route.subjectId) ||
      !governedSubjectsById.has(route.subjectId) ||
      !kindTargets.has(route.observationKind)
    ) {
      return "A legacy observation route does not match the migration's governed mapping targets.";
    }
    const routeKey = `${route.subjectId}\u0000${route.observationKind}`;
    if (routeKeys.has(routeKey)) {
      return "The pinned migration declares more than one route for a legacy observation target.";
    }
    routeKeys.add(routeKey);

    const assignment = assignments
      .map((candidate) => asObject(candidate))
      .find((candidate) => candidate?.id === route.assignmentId);
    const subject = governedSubjectsById.get(route.subjectId);
    const assignmentGeography = asObject(assignment?.geography);
    const geographyIsCompatible =
      assignmentGeography?.form === "governed_area" &&
      typeof subject?.governedAreaId === "string" &&
      assignmentGeography.areaId === subject.governedAreaId;
    const objectives = Array.isArray(assignment?.objectives) ? assignment.objectives : [];
    const objective = objectives
      .map((candidate) => asObject(candidate))
      .find((candidate) => candidate?.id === route.objectiveId);
    const objectiveObservationKinds = Array.isArray(objective?.observationKinds)
      ? objective.observationKinds
      : [];
    const coverageRequirements = Array.isArray(assignment?.coverageRequirements)
      ? assignment.coverageRequirements
      : [];
    const coverageRequirement = coverageRequirements
      .map((candidate) => asObject(candidate))
      .find((candidate) => candidate?.id === route.coverageRequirementId);
    const admissibleRecordKinds = Array.isArray(coverageRequirement?.admissibleRecordKinds)
      ? coverageRequirement.admissibleRecordKinds
      : [];
    const admissibleObservationKinds = Array.isArray(
      coverageRequirement?.admissibleObservationKinds,
    )
      ? coverageRequirement.admissibleObservationKinds
      : [];
    if (
      !assignment ||
      !geographyIsCompatible ||
      !objective ||
      !objectiveObservationKinds.includes(route.observationKind) ||
      !coverageRequirement ||
      coverageRequirement.objectiveId !== route.objectiveId ||
      !admissibleRecordKinds.includes("field-observation.v1") ||
      !admissibleObservationKinds.includes(route.observationKind)
    ) {
      return "A legacy observation route does not resolve to a compatible Assignment, Objective, and Coverage Requirement in the pinned campaign.";
    }
  }
}

function artifactForManifestPath(bundle: Record<string, unknown>, path: string) {
  const filename = path.split("/").at(-1);
  const component = fieldProtocolPackageComponents.find(
    (candidate) => candidate.filename === filename,
  );
  return component ? bundle[component.key] : undefined;
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

type CoverageRequirementConstraint = {
  objectiveId: string;
  admissibleRecordKinds: readonly string[];
  admissibleObservationKinds: readonly string[];
};

type ObjectiveConstraint = {
  observationKinds: readonly string[];
  recordKinds: readonly string[];
};
