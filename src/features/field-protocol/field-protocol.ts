import { z } from "zod";

import { parseFieldFile } from "@/features/field-ingestion/field-capture";
import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  type AssignmentOutcome,
  baselineFieldProtocolPackageData,
  type CaptureException,
  type EvidenceAsset,
  type FieldBatch,
  type FieldDayClose,
  type FieldObservation,
  type FieldProtocolPackageManifest,
  type FieldRecoveryExport,
  type FieldReview,
  type FieldVisit,
  type FollowUpAssignment,
  type ObjectiveCoverage,
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
  assignmentOutcome: AssignmentOutcome;
  captureException: CaptureException;
  evidenceAsset: EvidenceAsset;
  fieldBatch: FieldBatch;
  fieldObservation: FieldObservation;
  fieldRecoveryExport: FieldRecoveryExport;
  fieldReview: FieldReview;
  fieldVisit: FieldVisit;
  fieldDayClose: FieldDayClose;
  followUpAssignment: FollowUpAssignment;
  objectiveCoverage: ObjectiveCoverage;
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

export type ProtocolValidationOptions = {
  protocolPackage?: unknown;
};

export type ObservationCoverageDisposition = "positive" | "negative" | "unknown";

export const baselineFieldProtocolPackage = baselineFieldProtocolPackageData;

export const trustedFieldProtocolSigners = trustedFieldProtocolSignersData;

const recordSchemas = baselineFieldProtocolPackageData.schemas.records;
const distributionSchemas = baselineFieldProtocolPackageData.distributionSchemas.schemas;
const baselineValidationContext = createProtocolValidationContext(baselineFieldProtocolPackageData);

export function validateFieldProtocolRecord<K extends FieldProtocolRecordKind>(
  kind: K,
  value: unknown,
  options: ProtocolValidationOptions = {},
): ProtocolValidationResult<FieldProtocolRecordByKind[K]> {
  const context = options.protocolPackage
    ? createProtocolValidationContext(options.protocolPackage)
    : baselineValidationContext;
  if (!context) {
    return {
      success: false,
      issues: [issue("invalid_package", "The pinned Field Protocol Package is incomplete.", "")],
    };
  }
  const schemaArtifact = context.recordSchemas[kind];
  if (!schemaArtifact) {
    return {
      success: false,
      issues: [issue("unknown_record_kind", `Record kind ${kind} is not in this package.`, "")],
    };
  }
  const schema = schemaFromArtifact(schemaArtifact);
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

  const packageIssues = validateRecordPackageReference(parsed.data, context);
  if (packageIssues.length > 0) return { success: false, issues: packageIssues };
  const campaignIssues = validateCampaignAssignmentReferences(parsed.data, context);
  if (campaignIssues.length > 0) return { success: false, issues: campaignIssues };

  if (kind === "fieldObservation") {
    const issues = validateObservationSemantics(parsed.data as FieldObservation, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "fieldVisit") {
    const issues = validateFieldVisitSemantics(parsed.data as FieldVisit, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "routeRun") {
    const issues = validateRouteRunSemantics(parsed.data as RouteRun, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "sourceStatement") {
    const statement = parsed.data as SourceStatement;
    const issues = validateAssignmentSubjectReference(
      statement.assignmentId,
      statement.subjectId,
      "subjectId",
      context,
    );
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "schemaGap") {
    const gap = parsed.data as SchemaGap;
    const issues =
      gap.subject.kind === "governed"
        ? validateAssignmentSubjectReference(
            gap.assignmentId,
            gap.subject.subjectId,
            "subject.subjectId",
            context,
          )
        : [];
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "fieldBatch") {
    const issues = validateFieldBatchSemantics(parsed.data as FieldBatch, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "objectiveCoverage") {
    const issues = validateObjectiveCoverageSemantics(parsed.data as ObjectiveCoverage, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "assignmentOutcome") {
    const issues = validateAssignmentOutcomeSemantics(parsed.data as AssignmentOutcome, context);
    if (issues.length > 0) return { success: false, issues };
  }
  if (kind === "followUpAssignment") {
    const issues = validateFollowUpAssignmentSemantics(parsed.data as FollowUpAssignment, context);
    if (issues.length > 0) return { success: false, issues };
  }
  const coverageIssues = validateCoverageRequirementLinks(parsed.data, context);
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

export function observationCoverageDisposition(
  kind: ObservationKind,
  value: unknown,
  options: ProtocolValidationOptions = {},
): ObservationCoverageDisposition {
  const context = options.protocolPackage
    ? createProtocolValidationContext(options.protocolPackage)
    : baselineValidationContext;
  const rule = context?.observationKindRegistry.get(kind)?.coverageDisposition;
  if (!rule) return "unknown";
  if (rule.strategy === "constant") return rule.value;
  const candidate = asObject(value)?.[rule.path];
  if (typeof candidate !== "string") return "unknown";
  if (rule.positiveValues.includes(candidate)) return "positive";
  if (rule.negativeValues.includes(candidate)) return "negative";
  return "unknown";
}

export function captureWindowIdsForRecord(value: unknown): readonly string[] {
  const record = asObject(value);
  return Array.isArray(record?.captureWindowIds)
    ? record.captureWindowIds.filter(
        (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
      )
    : [];
}

export function coverageWindowIdentityForRequirement(value: unknown): "local_hour" | undefined {
  const repetition = asObject(asObject(value)?.repetition);
  return repetition?.windowIdentity === "local_hour" ? "local_hour" : undefined;
}

function validateObservationSemantics(
  observation: FieldObservation,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const registryEntry = context.observationKindRegistry.get(
    observation.observationKind as ObservationKind,
  );
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
  } else if (registryEntry.kind === "route_duration") {
    const routeDuration = parsedValue.data as {
      originSubjectId: string;
      destinationSubjectId: string;
    };
    issues.push(
      ...validateAssignmentEndpointReferences(
        observation.assignmentId,
        routeDuration.originSubjectId,
        routeDuration.destinationSubjectId,
        "value.originSubjectId",
        "value.destinationSubjectId",
        context,
      ),
    );
  }

  const method = context.methodProfileRegistry.get(observation.methodProfileId);
  if (!method?.supportedKinds.includes(registryEntry.kind)) {
    issues.push(
      issue(
        "incompatible_method_profile",
        `Method Profile ${observation.methodProfileId} does not support ${registryEntry.kind}.`,
        "methodProfileId",
      ),
    );
  }

  if (observation.subject.kind === "governed") {
    issues.push(
      ...validateAssignmentSubjectReference(
        observation.assignmentId,
        observation.subject.subjectId,
        "subject.subjectId",
        context,
      ),
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

function validateFieldVisitSemantics(
  visit: FieldVisit,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  if (visit.target.kind === "governed_subject") {
    issues.push(
      ...validateAssignmentSubjectReference(
        visit.assignmentId,
        visit.target.subjectId,
        "target.subjectId",
        context,
      ),
    );
  } else if (visit.target.kind === "governed_area") {
    issues.push(
      ...validateAssignmentAreaReference(
        visit.assignmentId,
        visit.target.areaId,
        "target.areaId",
        context,
      ),
    );
  } else if (visit.target.kind === "governed_route") {
    issues.push(
      ...validateAssignmentRouteReference(
        visit.assignmentId,
        visit.target.routeId,
        "target.routeId",
        context,
      ),
    );
  } else {
    issues.push(
      ...validateAssignmentAreaReference(
        visit.assignmentId,
        visit.target.provisionalSubject.governedAreaId,
        "target.provisionalSubject.governedAreaId",
        context,
      ),
    );
  }

  return issues;
}

function validateRouteRunSemantics(
  routeRun: RouteRun,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const issues = [
    ...validateAssignmentEndpointReferences(
      routeRun.assignmentId,
      routeRun.originSubjectId,
      routeRun.destinationSubjectId,
      "originSubjectId",
      "destinationSubjectId",
      context,
    ),
  ];
  const method = context.methodProfileRegistry.get(routeRun.methodProfileId);
  if (!method) {
    issues.push(
      issue(
        "unknown_method_profile",
        `Method Profile ${routeRun.methodProfileId} is not in this package.`,
        "methodProfileId",
      ),
    );
  } else {
    const objective = context.objectiveConstraintsByAssignment
      .get(routeRun.assignmentId)
      ?.get(routeRun.objectiveId);
    const coverageRequirement = context.coverageRequirementsByAssignment
      .get(routeRun.assignmentId)
      ?.get(routeRun.coverageRequirementId);
    const admissibleKinds = objective?.observationKinds.filter((kind) =>
      coverageRequirement?.admissibleObservationKinds.includes(kind),
    );
    if (
      objective &&
      coverageRequirement &&
      !admissibleKinds?.some((kind) => method.supportedKinds.includes(kind))
    ) {
      issues.push(
        issue(
          "incompatible_method_profile",
          `Method Profile ${routeRun.methodProfileId} does not support this Route Run's Objective and Coverage Requirement.`,
          "methodProfileId",
        ),
      );
    }
  }
  return issues;
}

function validateGovernedSubjectReference(
  subjectId: string,
  path: string,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  return context.governedSubjectIds.has(subjectId)
    ? []
    : [issue("unknown_subject", "The governed Subject is not in this package.", path)];
}

function validateAssignmentSubjectReference(
  assignmentId: string,
  subjectId: string,
  path: string,
  context: ProtocolValidationContext,
  endpoint?: "origin" | "destination",
): ProtocolValidationIssue[] {
  const membershipIssues = validateGovernedSubjectReference(subjectId, path, context);
  if (membershipIssues.length > 0) return membershipIssues;

  const geography = context.assignmentGeographyById.get(assignmentId);
  const subject = context.governedSubjectsById.get(subjectId);
  if (!geography || !subject) return [];
  let compatible: boolean;
  if (geography.form === "governed_subject_subset") {
    compatible = true;
  } else if (geography.form === "origin_destination_route" && endpoint) {
    compatible =
      subjectId ===
      (endpoint === "origin" ? geography.originSubjectId : geography.destinationSubjectId);
  } else if (geography.form === "origin_destination_route") {
    const route = context.governedRoutesById.get(geography.routeId);
    compatible =
      subjectId === geography.originSubjectId ||
      subjectId === geography.destinationSubjectId ||
      subjectId === route?.subjectId;
  } else if (geography.form === "access_point" && !endpoint) {
    compatible = subjectId === geography.subjectId;
  } else if (geography.form === "route_corridor") {
    compatible = geography.areaIds.includes(subject.governedAreaId);
  } else {
    compatible = subject.governedAreaId === geography.areaId;
  }

  return compatible
    ? []
    : [
        issue(
          "assignment_geography_mismatch",
          `Subject ${subjectId} is outside Assignment ${assignmentId}'s governed geography.`,
          path,
        ),
      ];
}

function validateAssignmentEndpointReferences(
  assignmentId: string,
  originSubjectId: string,
  destinationSubjectId: string,
  originPath: string,
  destinationPath: string,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const geography = context.assignmentGeographyById.get(assignmentId);
  if (geography?.form === "access_point") {
    const membershipIssues = [
      ...validateGovernedSubjectReference(originSubjectId, originPath, context),
      ...validateGovernedSubjectReference(destinationSubjectId, destinationPath, context),
    ];
    if (membershipIssues.length > 0) return membershipIssues;
    return originSubjectId === geography.subjectId || destinationSubjectId === geography.subjectId
      ? []
      : [
          issue(
            "assignment_geography_mismatch",
            `Route endpoints must include Assignment ${assignmentId}'s principal access-point Subject.`,
            originPath,
          ),
        ];
  }
  return [
    ...validateAssignmentSubjectReference(
      assignmentId,
      originSubjectId,
      originPath,
      context,
      "origin",
    ),
    ...validateAssignmentSubjectReference(
      assignmentId,
      destinationSubjectId,
      destinationPath,
      context,
      "destination",
    ),
  ];
}

function validateAssignmentAreaReference(
  assignmentId: string,
  areaId: string,
  path: string,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  if (!context.governedAreaIds.has(areaId)) {
    return [issue("unknown_area", "The governed area is not in this package.", path)];
  }
  const geography = context.assignmentGeographyById.get(assignmentId);
  if (!geography) return [];
  let compatible: boolean;
  if (geography.form === "governed_subject_subset") {
    compatible = true;
  } else if (geography.form === "origin_destination_route") {
    compatible = Boolean(
      context.governedRoutesById.get(geography.routeId)?.areaIds.includes(areaId),
    );
  } else if (geography.form === "route_corridor") {
    compatible = geography.areaIds.includes(areaId);
  } else if (geography.form === "access_point") {
    compatible = false;
  } else {
    compatible = geography.areaId === areaId;
  }
  return compatible
    ? []
    : [
        issue(
          "assignment_geography_mismatch",
          `Area ${areaId} is outside Assignment ${assignmentId}'s governed geography.`,
          path,
        ),
      ];
}

function validateAssignmentRouteReference(
  assignmentId: string,
  routeId: string,
  path: string,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const route = context.governedRoutesById.get(routeId);
  if (!route) return [issue("unknown_route", "The governed route is not in this package.", path)];
  const geography = context.assignmentGeographyById.get(assignmentId);
  if (!geography) return [];
  let compatible: boolean;
  if (geography.form === "governed_subject_subset") {
    compatible = true;
  } else if (geography.form === "origin_destination_route") {
    compatible = geography.routeId === routeId;
  } else if (geography.form === "route_corridor") {
    compatible = route.areaIds.every((areaId) => geography.areaIds.includes(areaId));
  } else if (geography.form === "access_point") {
    compatible = false;
  } else {
    compatible = route.areaIds.every((areaId) => areaId === geography.areaId);
  }
  return compatible
    ? []
    : [
        issue(
          "assignment_geography_mismatch",
          `Route ${routeId} is outside Assignment ${assignmentId}'s governed geography.`,
          path,
        ),
      ];
}

function validateFieldBatchSemantics(
  batch: FieldBatch,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const manifest = context.manifest;
  for (const [packageIndex, protocolPackage] of batch.protocolPackages.entries()) {
    if (protocolPackage.packageId !== manifest.packageId) {
      issues.push(
        issue(
          "unknown_protocol_package",
          `Field Protocol Package ${protocolPackage.packageId} is not installed for this validator.`,
          `protocolPackages.${packageIndex}.packageId`,
        ),
      );
      continue;
    }
    if (protocolPackage.version !== manifest.packageVersion) {
      issues.push(
        issue(
          "protocol_package_mismatch",
          `Field Protocol Package ${protocolPackage.packageId} must use version ${manifest.packageVersion}.`,
          `protocolPackages.${packageIndex}.version`,
        ),
      );
    }
    for (const [component, expectedVersion] of Object.entries(manifest.componentVersions)) {
      if (
        protocolPackage.componentVersions[
          component as keyof typeof protocolPackage.componentVersions
        ] !== expectedVersion
      ) {
        issues.push(
          issue(
            "component_version_mismatch",
            `Component ${component} must use pinned version ${expectedVersion}.`,
            `protocolPackages.${packageIndex}.componentVersions.${component}`,
          ),
        );
      }
    }
  }
  for (const [campaignIndex, campaignId] of batch.lineage.campaignIds.entries()) {
    if (campaignId !== context.campaignId) {
      issues.push(
        issue(
          "unknown_campaign",
          `Campaign ${campaignId} is not governed by this package.`,
          `lineage.campaignIds.${campaignIndex}`,
        ),
      );
    }
  }
  for (const [assignmentIndex, assignmentId] of batch.lineage.assignmentIds.entries()) {
    if (!context.objectiveConstraintsByAssignment.has(assignmentId)) {
      issues.push(
        issue(
          "unknown_assignment",
          `Assignment ${assignmentId} is not governed by the baseline Campaign.`,
          `lineage.assignmentIds.${assignmentIndex}`,
        ),
      );
    }
  }
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

function validateObjectiveCoverageSemantics(
  coverage: ObjectiveCoverage,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const requirements = context.coverageRequirementsByAssignment.get(coverage.assignmentId);
  if (!requirements) return [];
  const issues: ProtocolValidationIssue[] = [];
  for (const [index, result] of coverage.requirements.entries()) {
    const requirement = requirements.get(result.coverageRequirementId);
    const path = `requirements.${index}.coverageRequirementId`;
    if (!requirement) {
      issues.push(
        issue(
          "unknown_coverage_requirement",
          `Coverage Requirement ${result.coverageRequirementId} does not belong to Assignment ${coverage.assignmentId}.`,
          path,
        ),
      );
      continue;
    }
    if (requirement.objectiveId !== coverage.objectiveId) {
      issues.push(
        issue(
          "coverage_objective_mismatch",
          `Coverage Requirement ${result.coverageRequirementId} belongs to Objective ${requirement.objectiveId}.`,
          path,
        ),
      );
    }
    if (
      result.requiredRecords !== requirement.minimumRecords ||
      result.requiredDistinctWindows !== requirement.repetition.minimumDistinctWindows
    ) {
      issues.push(
        issue(
          "coverage_threshold_mismatch",
          "Derived coverage thresholds must match the pinned Coverage Requirement.",
          `requirements.${index}`,
        ),
      );
    }
  }
  return issues;
}

function validateAssignmentOutcomeSemantics(
  outcome: AssignmentOutcome,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const requirements = context.coverageRequirementsByAssignment.get(outcome.assignmentId);
  if (!requirements) return [];
  return outcome.unresolvedRequirementIds.flatMap((requirementId, index) =>
    requirements.has(requirementId)
      ? []
      : [
          issue(
            "unknown_coverage_requirement",
            `Coverage Requirement ${requirementId} does not belong to Assignment ${outcome.assignmentId}.`,
            `unresolvedRequirementIds.${index}`,
          ),
        ],
  );
}

function validateFollowUpAssignmentSemantics(
  followUp: FollowUpAssignment,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const requirements = context.coverageRequirementsByAssignment.get(
    followUp.originatingAssignmentId,
  );
  if (!requirements) {
    return [
      issue(
        "unknown_assignment",
        `Assignment ${followUp.originatingAssignmentId} is not governed by this Campaign.`,
        "originatingAssignmentId",
      ),
    ];
  }
  return followUp.coverageRequirementIds.flatMap((requirementId, index) =>
    requirements.has(requirementId)
      ? []
      : [
          issue(
            "unknown_coverage_requirement",
            `Coverage Requirement ${requirementId} does not belong to Assignment ${followUp.originatingAssignmentId}.`,
            `coverageRequirementIds.${index}`,
          ),
        ],
  );
}

function validateCoverageRequirementLinks(
  value: unknown,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const record = asObject(value);
  if (!record || typeof record.assignmentId !== "string") return [];
  const requirements = context.coverageRequirementsByAssignment.get(record.assignmentId);
  const objectives = context.objectiveConstraintsByAssignment.get(record.assignmentId);
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
      record.schemaVersion !== "statement-translation.v1" &&
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
      record.schemaVersion !== "statement-translation.v1" &&
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

function validateCampaignAssignmentReferences(
  value: unknown,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const record = asObject(value);
  if (!record) return [];
  const issues: ProtocolValidationIssue[] = [];
  if (typeof record.campaignId === "string" && record.campaignId !== context.campaignId) {
    issues.push(
      issue(
        "unknown_campaign",
        `Campaign ${record.campaignId} is not governed by this package.`,
        "campaignId",
      ),
    );
  }
  if (typeof record.assignmentId !== "string") return issues;

  const objectives = context.objectiveConstraintsByAssignment.get(record.assignmentId);
  if (!objectives) {
    issues.push(
      issue(
        "unknown_assignment",
        `Assignment ${record.assignmentId} is not governed by the baseline Campaign.`,
        "assignmentId",
      ),
    );
    return issues;
  }

  const objectiveIds =
    typeof record.objectiveId === "string"
      ? [{ id: record.objectiveId, path: "objectiveId" }]
      : Array.isArray(record.objectiveIds)
        ? record.objectiveIds
            .map((candidate, index) =>
              typeof candidate === "string"
                ? { id: candidate, path: `objectiveIds.${index}` }
                : undefined,
            )
            .filter((candidate): candidate is { id: string; path: string } => Boolean(candidate))
        : [];
  for (const objective of objectiveIds) {
    if (!objectives.has(objective.id)) {
      issues.push(
        issue(
          "unknown_objective",
          `Objective ${objective.id} does not belong to Assignment ${record.assignmentId}.`,
          objective.path,
        ),
      );
    }
  }
  return issues;
}

function validateRecordPackageReference(
  value: unknown,
  context: ProtocolValidationContext,
): ProtocolValidationIssue[] {
  const record = asObject(value);
  if (!record) return [];
  const manifest = context.manifest;
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
    captureWindowIds: [record.visitId],
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

function createProtocolValidationContext(value: unknown): ProtocolValidationContext | undefined {
  const bundle = asObject(value);
  const manifest = asObject(bundle?.manifest);
  const schemas = asObject(bundle?.schemas);
  const records = asObject(schemas?.records);
  const observationKinds = asObject(bundle?.observationKinds);
  const methodProfiles = asObject(bundle?.methodProfiles);
  const subjects = asObject(bundle?.subjects);
  const geography = asObject(bundle?.geography);
  const campaign = asObject(bundle?.campaign);
  if (
    !bundle ||
    !manifest ||
    typeof manifest.packageId !== "string" ||
    typeof manifest.packageVersion !== "string" ||
    !records ||
    !Array.isArray(observationKinds?.kinds) ||
    !Array.isArray(methodProfiles?.profiles) ||
    !Array.isArray(subjects?.subjects) ||
    !Array.isArray(geography?.areas) ||
    !Array.isArray(geography?.routes) ||
    typeof campaign?.campaignId !== "string" ||
    !Array.isArray(campaign.assignments)
  ) {
    return undefined;
  }

  const typedSubjects = subjects.subjects as GovernedSubjectRegistryEntry[];
  const governedSubjectsById = new Map<string, GovernedSubjectConstraint>(
    typedSubjects.map((subject) => [subject.id, subject]),
  );
  const assignments = campaign.assignments as AssignmentConstraint[];
  return {
    assignmentGeographyById: new Map(
      assignments.map((assignment) => [assignment.id, assignment.geography]),
    ),
    campaignId: campaign.campaignId,
    coverageRequirementsByAssignment: new Map(
      assignments.map((assignment) => [
        assignment.id,
        new Map(
          assignment.coverageRequirements.map((requirement) => [requirement.id, requirement]),
        ),
      ]),
    ),
    governedAreaIds: new Set(
      (geography.areas as GovernedAreaRegistryEntry[]).map((area) => area.id),
    ),
    governedRoutesById: new Map(
      (geography.routes as GovernedRouteRegistryEntry[]).map((route) => [route.id, route]),
    ),
    governedSubjectIds: new Set(governedSubjectsById.keys()),
    governedSubjectsById,
    manifest: manifest as unknown as FieldProtocolPackageManifest,
    methodProfileRegistry: new Map(
      (methodProfiles.profiles as MethodProfileRegistryEntry[]).map((profile) => [
        profile.id,
        profile,
      ]),
    ),
    objectiveConstraintsByAssignment: new Map(
      assignments.map((assignment) => [
        assignment.id,
        new Map(
          assignment.objectives.map((objective) => [
            objective.id,
            {
              observationKinds: objective.observationKinds ?? [],
              recordKinds: objective.recordKinds ?? [],
            },
          ]),
        ),
      ]),
    ),
    observationKindRegistry: new Map(
      (observationKinds.kinds as ObservationRegistryEntry[]).map((entry) => [entry.kind, entry]),
    ),
    recordSchemas: records,
  };
}

type ProtocolValidationContext = {
  assignmentGeographyById: ReadonlyMap<string, AssignmentGeographyConstraint>;
  campaignId: string;
  coverageRequirementsByAssignment: ReadonlyMap<
    string,
    ReadonlyMap<string, CoverageRequirementConstraint>
  >;
  governedAreaIds: ReadonlySet<string>;
  governedRoutesById: ReadonlyMap<string, GovernedRouteConstraint>;
  governedSubjectIds: ReadonlySet<string>;
  governedSubjectsById: ReadonlyMap<string, GovernedSubjectConstraint>;
  manifest: FieldProtocolPackageManifest;
  methodProfileRegistry: ReadonlyMap<string, MethodProfileRegistryEntry>;
  objectiveConstraintsByAssignment: ReadonlyMap<string, ReadonlyMap<string, ObjectiveConstraint>>;
  observationKindRegistry: ReadonlyMap<string, ObservationRegistryEntry>;
  recordSchemas: Record<string, unknown>;
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
  coverageDisposition:
    | { strategy: "constant"; value: ObservationCoverageDisposition }
    | {
        strategy: "value";
        path: string;
        positiveValues: readonly string[];
        negativeValues: readonly string[];
        unknownValues: readonly string[];
      };
  valueSchema: unknown;
};

type MethodProfileRegistryEntry = {
  id: string;
  supportedKinds: readonly string[];
  supportedUnits: readonly string[];
};

type GovernedSubjectConstraint = {
  governedAreaId: string;
};

type GovernedSubjectRegistryEntry = GovernedSubjectConstraint & { id: string };

type GovernedAreaRegistryEntry = { id: string };

type GovernedRouteRegistryEntry = GovernedRouteConstraint & { id: string };

type GovernedRouteConstraint = {
  subjectId: string;
  areaIds: readonly string[];
};

type AssignmentGeographyConstraint =
  | { form: "governed_area"; areaId: string }
  | {
      form: "origin_destination_route";
      routeId: string;
      originSubjectId: string;
      destinationSubjectId: string;
    }
  | { form: "route_corridor"; areaIds: readonly string[] }
  | { form: "access_point"; areaId: string; subjectId: string }
  | { form: "governed_subject_subset" };

type CoverageRequirementConstraint = {
  id: string;
  objectiveId: string;
  minimumRecords: number;
  repetition: { minimumDistinctWindows: number; windowIdentity: "local_hour" };
  admissibleRecordKinds: readonly string[];
  admissibleObservationKinds: readonly string[];
};

type ObjectiveConstraint = {
  observationKinds: readonly string[];
  recordKinds: readonly string[];
};

type AssignmentConstraint = {
  id: string;
  geography: AssignmentGeographyConstraint;
  coverageRequirements: CoverageRequirementConstraint[];
  objectives: Array<{
    id: string;
    observationKinds?: readonly string[];
    recordKinds?: readonly string[];
  }>;
};
