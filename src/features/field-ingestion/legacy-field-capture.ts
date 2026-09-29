import { z } from "zod";

import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import type { MigrationPreviewResult } from "@/features/field-protocol/field-protocol";
import { fieldTextDecoder, fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";

export const LEGACY_CAPTURE_PREVIEW_VERSION = "legacy-capture-preview.v1" as const;
export const LEGACY_RECORD_SCHEMA_VERSION = "field-record.v1" as const;
export const LEGACY_BATCH_SCHEMA_VERSION = "field-batch.v1" as const;
export const LEGACY_SOURCE_PACKAGE_VERSION = "0.9.0" as const;
export const LEGACY_TARGET_PACKAGE = "field-protocol-siargao-baseline@1.0.1" as const;

const recordTypes = ["visit", "observation", "statement", "routeRun", "asset"] as const;
const legacyKnownFields = new Set([
  "schemaVersion",
  "recordType",
  "id",
  "clientBatchId",
  "campaignSlug",
  "capturedAt",
  "localTimezone",
  "visitId",
  "observerKey",
  "entityId",
  "areaId",
  "routeId",
  "provisionalSubjectName",
  "purposeCodes",
  "startedAt",
  "endedAt",
  "observationKind",
  "directness",
  "observedAt",
  "value",
  "method",
  "conditionTags",
  "fieldConfidence",
  "reviewDueAt",
  "status",
  "llmUseAllowed",
  "articleUseAllowed",
  "publicRepublishAllowed",
  "statementType",
  "statementText",
  "consentScope",
  "consentRecordedAt",
  "consentMethod",
  "mode",
  "originText",
  "destinationText",
  "assetKind",
  "relativePath",
  "sha256",
  "rightsScope",
  "redactionStatus",
]);
const isoDateTime = z.iso.datetime({ offset: true });
const uuid = z.uuid();

const legacyFieldRecordSchema = z
  .looseObject({
    schemaVersion: z.literal(LEGACY_RECORD_SCHEMA_VERSION),
    recordType: z.enum(recordTypes),
    id: uuid,
    clientBatchId: uuid,
    campaignSlug: z.string().trim().min(1),
    capturedAt: isoDateTime,
    localTimezone: z.string().trim().min(1),
    visitId: uuid.optional(),
    observerKey: z.string().trim().min(1).optional(),
    entityId: z.string().trim().min(1).optional(),
    areaId: z.string().trim().min(1).optional(),
    routeId: z.string().trim().min(1).optional(),
    provisionalSubjectName: z.string().trim().min(1).optional(),
    purposeCodes: z.array(z.string().trim().min(1)).optional(),
    startedAt: isoDateTime.optional(),
    endedAt: isoDateTime.optional(),
    observationKind: z.string().trim().min(1).optional(),
    directness: z
      .enum([
        "direct_observation",
        "instrument_measurement",
        "transaction_record",
        "official_posted_notice",
        "operator_statement",
        "community_statement",
        "derived",
      ])
      .optional(),
    observedAt: isoDateTime.optional(),
    value: z.unknown().optional(),
    method: z.string().trim().min(1).optional(),
    conditionTags: z.array(z.string().trim().min(1)).optional(),
    fieldConfidence: z.enum(["low", "medium", "high"]).optional(),
    reviewDueAt: isoDateTime.optional(),
    status: z.string().trim().min(1).optional(),
    llmUseAllowed: z.boolean().optional(),
    articleUseAllowed: z.boolean().optional(),
    publicRepublishAllowed: z.boolean().optional(),
    statementType: z.enum(["quote", "paraphrase", "operational_answer"]).optional(),
    statementText: z.string().trim().min(1).optional(),
    consentScope: z.array(z.string().trim().min(1)).optional(),
    consentRecordedAt: isoDateTime.optional(),
    consentMethod: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
    originText: z.string().trim().min(1).optional(),
    destinationText: z.string().trim().min(1).optional(),
    assetKind: z
      .enum(["photo", "video", "audio", "document", "receipt", "route_trace", "measurement"])
      .optional(),
    relativePath: z.string().trim().min(1).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    rightsScope: z.string().trim().min(1).optional(),
    redactionStatus: z.enum(["not_required", "pending", "complete", "blocked"]).optional(),
  })
  .superRefine((record, context) => {
    const requireField = (key: keyof typeof record, message: string) => {
      if (record[key] === undefined) context.addIssue({ code: "custom", message, path: [key] });
    };
    if (record.recordType === "visit") {
      requireField("observerKey", "A Legacy Visit requires observerKey.");
      requireField("purposeCodes", "A Legacy Visit requires purposeCodes.");
      requireField("startedAt", "A Legacy Visit requires startedAt.");
      const subjects = [
        record.entityId,
        record.areaId,
        record.routeId,
        record.provisionalSubjectName,
      ].filter(Boolean);
      if (subjects.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "A Legacy Visit requires exactly one subject reference.",
          path: ["provisionalSubjectName"],
        });
      }
    }
    if (record.recordType === "observation") {
      for (const key of [
        "visitId",
        "observationKind",
        "directness",
        "observedAt",
        "value",
        "method",
        "conditionTags",
        "fieldConfidence",
        "reviewDueAt",
        "status",
      ] as const) {
        requireField(key, `A Legacy Observation requires ${key}.`);
      }
    }
    if (record.recordType === "statement") {
      for (const key of ["visitId", "statementType", "statementText", "consentScope"] as const) {
        requireField(key, `A Legacy Statement requires ${key}.`);
      }
    }
    if (record.recordType === "routeRun") {
      for (const key of [
        "visitId",
        "startedAt",
        "endedAt",
        "mode",
        "originText",
        "destinationText",
      ] as const) {
        requireField(key, `A Legacy Route Run requires ${key}.`);
      }
    }
    if (record.recordType === "asset") {
      for (const key of [
        "visitId",
        "assetKind",
        "relativePath",
        "sha256",
        "rightsScope",
        "redactionStatus",
      ] as const) {
        requireField(key, `A Legacy Asset requires ${key}.`);
      }
    }
  });

export type LegacyFieldRecord = z.infer<typeof legacyFieldRecordSchema>;
export type LegacyCaptureIssue = Readonly<{ code: string; message: string; path: string }>;

export type RecognizedLegacyArtifact = Readonly<{
  artifactKind: "record" | "record_array" | "jsonl" | "embedded_batch";
  records: readonly LegacyFieldRecord[];
  sourceSchemaVersion: typeof LEGACY_RECORD_SCHEMA_VERSION;
}>;

export type LegacyRecordPreview = Readonly<{
  candidateTargetSha256?: string;
  gaps: readonly LegacyCaptureIssue[];
  mappings: readonly {
    sourcePath: string;
    targetPath: string;
    sourceValue: string;
    targetValue: string;
  }[];
  omissions: readonly string[];
  originalSha256: string;
  recordId: string;
  recordType: LegacyFieldRecord["recordType"];
  status: "mappable_preview" | "needs_resolution" | "quarantined_conflict" | "rejected";
}>;

export type LegacyCapturePreview = Readonly<{
  schemaVersion: typeof LEGACY_CAPTURE_PREVIEW_VERSION;
  previewId: string;
  previewSha256: string;
  migrationId: string;
  sourcePackageVersion: typeof LEGACY_SOURCE_PACKAGE_VERSION;
  sourceSchemaVersion: typeof LEGACY_RECORD_SCHEMA_VERSION;
  targetPackage: typeof LEGACY_TARGET_PACKAGE;
  source: {
    artifactKind: RecognizedLegacyArtifact["artifactKind"];
    byteCount: number;
    canonicalCorpusSha256: string;
    importedAt: string;
    originalFilename: string;
    sha256: string;
  };
  destinationStateSha256: string;
  additions: readonly string[];
  exactReplays: readonly string[];
  sameIdConflicts: readonly string[];
  rejected: readonly string[];
  records: readonly LegacyRecordPreview[];
  state: "mappable_preview" | "needs_resolution" | "quarantined_conflict" | "rejected";
  promotion: "quarantined_only";
}>;

export class LegacyCaptureRecognitionError extends Error {
  constructor(
    readonly issues: readonly LegacyCaptureIssue[],
    message = "The artifact is not an exact supported Legacy Capture version.",
  ) {
    super(message);
    this.name = "LegacyCaptureRecognitionError";
  }
}

export async function recognizeLegacyCaptureArtifact(
  sourceName: string,
  bytes: Uint8Array,
): Promise<RecognizedLegacyArtifact> {
  const text = fieldTextDecoder.decode(bytes);
  const rows: unknown[] = [];
  let artifactKind: RecognizedLegacyArtifact["artifactKind"];
  if (sourceName.toLowerCase().endsWith(".jsonl")) {
    artifactKind = "jsonl";
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        throw new LegacyCaptureRecognitionError([
          issue(
            "invalid_json_line",
            `Line ${index + 1} is not valid JSON.`,
            `${sourceName}:${index + 1}`,
          ),
        ]);
      }
    }
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LegacyCaptureRecognitionError([
        issue("invalid_json", "The source is not valid JSON.", sourceName),
      ]);
    }
    if (Array.isArray(parsed)) {
      artifactKind = "record_array";
      rows.push(...parsed);
    } else if (isObject(parsed) && parsed.schemaVersion === LEGACY_BATCH_SCHEMA_VERSION) {
      artifactKind = "embedded_batch";
      return recognizeEmbeddedBatch(parsed);
    } else if (isObject(parsed) && "records" in parsed) {
      throw new LegacyCaptureRecognitionError([
        issue(
          "unrecognized_envelope",
          "Only an exact field-batch.v1 embedded-record envelope is supported.",
          "schemaVersion",
        ),
      ]);
    } else {
      artifactKind = "record";
      rows.push(parsed);
    }
  }
  if (rows.length === 0) {
    throw new LegacyCaptureRecognitionError([
      issue("empty_artifact", "The source contains no Legacy Capture records.", sourceName),
    ]);
  }
  return {
    artifactKind,
    records: parseExactRecords(rows, sourceName),
    sourceSchemaVersion: LEGACY_RECORD_SCHEMA_VERSION,
  };
}

export function parseLegacyFieldRecord(value: unknown): LegacyFieldRecord {
  const result = legacyFieldRecordSchema.safeParse(value);
  if (!result.success) {
    throw new LegacyCaptureRecognitionError(
      result.error.issues.map((entry) =>
        issue("schema_error", entry.message, entry.path.join(".")),
      ),
    );
  }
  return result.data;
}

async function recognizeEmbeddedBatch(
  value: Record<string, unknown>,
): Promise<RecognizedLegacyArtifact> {
  const envelope = z
    .strictObject({
      schemaVersion: z.literal(LEGACY_BATCH_SCHEMA_VERSION),
      clientBatchId: uuid,
      campaignSlug: z.string().trim().min(1),
      createdAt: isoDateTime,
      localTimezone: z.string().trim().min(1),
      recordCounts: z.record(z.enum(recordTypes), z.number().int().nonnegative()),
      payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      records: z.array(z.unknown()).min(1),
    })
    .safeParse(value);
  if (!envelope.success) {
    throw new LegacyCaptureRecognitionError(
      envelope.error.issues.map((entry) =>
        issue("invalid_legacy_batch", entry.message, entry.path.join(".")),
      ),
    );
  }
  const records = parseExactRecords(envelope.data.records, "field-batch.v1");
  const counts = Object.fromEntries(recordTypes.map((type) => [type, 0])) as Record<
    (typeof recordTypes)[number],
    number
  >;
  const issues: LegacyCaptureIssue[] = [];
  for (const record of records) {
    counts[record.recordType] += 1;
    if (record.clientBatchId !== envelope.data.clientBatchId) {
      issues.push(
        issue(
          "batch_identity_mismatch",
          "Record clientBatchId differs from its envelope.",
          record.id,
        ),
      );
    }
    if (record.campaignSlug !== envelope.data.campaignSlug) {
      issues.push(
        issue("batch_campaign_mismatch", "Record campaign differs from its envelope.", record.id),
      );
    }
    if (record.localTimezone !== envelope.data.localTimezone) {
      issues.push(
        issue("batch_timezone_mismatch", "Record timezone differs from its envelope.", record.id),
      );
    }
  }
  if (canonicalStringify(counts) !== canonicalStringify(envelope.data.recordCounts)) {
    issues.push(
      issue(
        "batch_count_mismatch",
        "Embedded-record plural counts are inconsistent.",
        "recordCounts",
      ),
    );
  }
  if (
    (await sha256Hex(fieldTextEncoder.encode(canonicalStringify(records)))) !==
    envelope.data.payloadSha256
  ) {
    issues.push(
      issue(
        "batch_hash_mismatch",
        "Embedded-record canonical payload hash is inconsistent.",
        "payloadSha256",
      ),
    );
  }
  if (issues.length > 0) throw new LegacyCaptureRecognitionError(issues);
  return {
    artifactKind: "embedded_batch",
    records,
    sourceSchemaVersion: LEGACY_RECORD_SCHEMA_VERSION,
  };
}

export async function createLegacyCapturePreview(input: {
  bytes: Uint8Array;
  destination: ReadonlyMap<string, ReadonlySet<string>>;
  importedAt: string;
  sourceName: string;
}): Promise<LegacyCapturePreview> {
  const recognized = await recognizeLegacyCaptureArtifact(input.sourceName, input.bytes);
  const [sourceSha256, destinationStateSha256, sourceRecords] = await Promise.all([
    sha256Hex(input.bytes),
    sha256Hex(
      fieldTextEncoder.encode(
        canonicalStringify(
          [...input.destination.entries()]
            .map(([id, hashes]) => [id, [...hashes].toSorted(compareCanonicalStrings)] as const)
            .toSorted(([left], [right]) => compareCanonicalStrings(left, right)),
        ),
      ),
    ),
    Promise.all(
      recognized.records.map(async (record) => ({
        record,
        hash: await sha256Hex(fieldTextEncoder.encode(canonicalStringify(record))),
      })),
    ),
  ]);
  sourceRecords.sort((left, right) =>
    compareCanonicalStrings(`${left.record.id}:${left.hash}`, `${right.record.id}:${right.hash}`),
  );
  const canonicalCorpusSha256 = await sha256Hex(
    fieldTextEncoder.encode(canonicalStringify(sourceRecords.map(({ record }) => record))),
  );
  const variants = new Map<string, Set<string>>();
  const visitIds = new Set(
    sourceRecords
      .filter(({ record }) => record.recordType === "visit")
      .map(({ record }) => record.id),
  );
  for (const entry of sourceRecords) {
    const recordId = entry.record.id;
    const hashes = variants.get(recordId) ?? new Set<string>();
    hashes.add(entry.hash);
    for (const existing of input.destination.get(recordId) ?? []) hashes.add(existing);
    variants.set(recordId, hashes);
  }
  const { previewProtocolMigration } = await import("@/features/field-protocol/field-protocol");
  const signed = await previewProtocolMigration({
    records: sourceRecords.map(({ record }) => record),
  });
  const records = await Promise.all(
    sourceRecords.map(async (entry, index) =>
      buildRecordPreview(entry.record, entry.hash, signed.results[index], variants, visitIds),
    ),
  );
  const additions: string[] = [];
  const exactReplays: string[] = [];
  const sameIdConflicts: string[] = [];
  const rejected: string[] = [];
  for (const record of records) {
    const existing = input.destination.get(record.recordId);
    if (record.status === "quarantined_conflict") sameIdConflicts.push(record.recordId);
    else if (record.status === "rejected") rejected.push(record.recordId);
    else if (existing?.has(record.originalSha256)) exactReplays.push(record.recordId);
    else additions.push(record.recordId);
  }
  for (const values of [additions, exactReplays, sameIdConflicts, rejected]) {
    values.sort(compareCanonicalStrings);
  }
  const state = aggregateState(records);
  const previewId = `legacy_preview_${(
    await sha256Hex(fieldTextEncoder.encode(`${canonicalCorpusSha256}:${destinationStateSha256}`))
  ).slice(0, 32)}`;
  const withoutHash = {
    schemaVersion: LEGACY_CAPTURE_PREVIEW_VERSION,
    previewId,
    migrationId: signed.migrationId,
    sourcePackageVersion: LEGACY_SOURCE_PACKAGE_VERSION,
    sourceSchemaVersion: LEGACY_RECORD_SCHEMA_VERSION,
    targetPackage: LEGACY_TARGET_PACKAGE,
    source: {
      artifactKind: recognized.artifactKind,
      byteCount: input.bytes.byteLength,
      canonicalCorpusSha256,
      importedAt: input.importedAt,
      originalFilename: input.sourceName,
      sha256: sourceSha256,
    },
    destinationStateSha256,
    additions,
    exactReplays,
    sameIdConflicts,
    rejected,
    records,
    state,
    promotion: "quarantined_only" as const,
  };
  const hashMaterial = {
    ...withoutHash,
    source: { canonicalCorpusSha256 },
  };
  return {
    ...withoutHash,
    previewSha256: await sha256Hex(fieldTextEncoder.encode(canonicalStringify(hashMaterial))),
  };
}

async function buildRecordPreview(
  record: LegacyFieldRecord,
  originalSha256: string,
  signed: MigrationPreviewResult | undefined,
  variants: ReadonlyMap<string, ReadonlySet<string>>,
  visitIds: ReadonlySet<string>,
): Promise<LegacyRecordPreview> {
  const gaps = classifyGaps(record);
  const mappings = signed?.migrated ? exactMappings(record, signed.migrated) : [];
  const omissions = signed?.migrated ? omittedPaths(record, signed.migrated) : [];
  const conflict = (variants.get(record.id)?.size ?? 0) > 1;
  if (conflict) {
    gaps.push(
      issue(
        "same_id_different_content",
        "Every variant of this immutable ID remains quarantined.",
        "id",
      ),
    );
  }
  if (record.recordType !== "visit" && record.visitId && !visitIds.has(record.visitId)) {
    gaps.push(
      issue("reference_gap", "The referenced Legacy Visit is absent from this corpus.", "visitId"),
    );
  }
  if (signed?.reason) gaps.push(issue("signed_migration_result", signed.reason, "record"));
  const rightsBlock = gaps.some((entry) =>
    ["permission_escalation", "rights_gap", "redaction_blocker"].includes(entry.code),
  );
  const status = conflict
    ? "quarantined_conflict"
    : signed?.status === "failed"
      ? "rejected"
      : signed?.status !== "migrated" || gaps.length > 0 || rightsBlock
        ? "needs_resolution"
        : "mappable_preview";
  const candidateTargetSha256 = signed?.migrated
    ? await sha256Hex(fieldTextEncoder.encode(canonicalStringify(signed.migrated)))
    : undefined;
  return {
    ...(candidateTargetSha256 ? { candidateTargetSha256 } : {}),
    gaps: gaps.toSorted(compareIssue),
    mappings,
    omissions,
    originalSha256,
    recordId: record.id,
    recordType: record.recordType,
    status,
  };
}

function classifyGaps(record: LegacyFieldRecord): LegacyCaptureIssue[] {
  const gaps: LegacyCaptureIssue[] = [];
  for (const key of Object.keys(record)) {
    if (!legacyKnownFields.has(key))
      gaps.push(
        issue("passthrough_omission", `Legacy property ${key} has no automatic target.`, key),
      );
  }
  if (
    record.recordType === "observation" &&
    (record.llmUseAllowed === true ||
      record.articleUseAllowed === true ||
      record.publicRepublishAllowed === true)
  ) {
    gaps.push(
      issue(
        "permission_escalation",
        "Historical permission claims cannot grant current use.",
        "permissions",
      ),
    );
  }
  if (
    record.recordType === "statement" &&
    (record.consentScope ?? []).some((scope) => scope !== "internal") &&
    (!record.consentRecordedAt || !record.consentMethod)
  ) {
    gaps.push(
      issue("rights_gap", "Non-internal consent lacks time or method evidence.", "consentScope"),
    );
  }
  if (record.recordType === "asset") {
    if (record.rightsScope !== "internal") {
      gaps.push(
        issue(
          "rights_gap",
          "Legacy asset rights are not a governed current permission.",
          "rightsScope",
        ),
      );
    }
    if (record.redactionStatus === "pending" || record.redactionStatus === "blocked") {
      gaps.push(
        issue(
          "redaction_blocker",
          "Pending or blocked redaction prevents mapping.",
          "redactionStatus",
        ),
      );
    }
    if (["audio", "video", "route_trace", "measurement"].includes(record.assetKind ?? "")) {
      gaps.push(
        issue(
          "schema_gap_candidate",
          "The current asset schema cannot represent this media kind without distortion.",
          "assetKind",
        ),
      );
    }
  }
  const recordTypeGaps: Record<LegacyFieldRecord["recordType"], readonly string[]> = {
    visit: ["Assignment and Objective", "capture windows", "location precision", "device identity"],
    observation: [],
    statement: ["Source role", "basis of knowledge", "question", "withdrawal route", "translation"],
    routeRun: ["governed origin and destination", "travel context", "checkpoints and barriers"],
    asset: ["media size and type", "people and consent", "retention", "content-link closure"],
  };
  for (const detail of recordTypeGaps[record.recordType]) {
    gaps.push(
      issue(
        "schema_gap_candidate",
        `${detail} is not attributable from Legacy Capture.`,
        record.recordType,
      ),
    );
  }
  return gaps;
}

function exactMappings(
  source: LegacyFieldRecord,
  target: unknown,
): LegacyRecordPreview["mappings"] {
  if (!isObject(target)) return [];
  const candidates = [
    ["observationKind", "observationKind"],
    ["method", "methodProfileId"],
    ["areaId", "subject.subjectId"],
    ["entityId", "subject.subjectId"],
  ] as const;
  return candidates
    .flatMap(([sourcePath, targetPath]) => {
      const sourceValue = source[sourcePath as keyof LegacyFieldRecord];
      const targetValue = getPath(target, targetPath);
      return typeof sourceValue === "string" && typeof targetValue === "string"
        ? [{ sourcePath, targetPath, sourceValue, targetValue }]
        : [];
    })
    .toSorted((left, right) => compareCanonicalStrings(left.sourcePath, right.sourcePath));
}

function omittedPaths(source: LegacyFieldRecord, target: unknown): string[] {
  if (!isObject(target)) return Object.keys(source).toSorted(compareCanonicalStrings);
  const explicitlyMapped = new Set([
    "schemaVersion",
    "id",
    "capturedAt",
    "localTimezone",
    "visitId",
    "observerKey",
    "observationKind",
    "directness",
    "observedAt",
    "value",
    "method",
    "conditionTags",
    "fieldConfidence",
    "reviewDueAt",
    "status",
    "llmUseAllowed",
    "articleUseAllowed",
    "publicRepublishAllowed",
  ]);
  return Object.keys(source)
    .filter((key) => !explicitlyMapped.has(key))
    .toSorted(compareCanonicalStrings);
}

function aggregateState(records: readonly LegacyRecordPreview[]): LegacyCapturePreview["state"] {
  if (records.some((record) => record.status === "quarantined_conflict"))
    return "quarantined_conflict";
  if (records.every((record) => record.status === "rejected")) return "rejected";
  if (records.some((record) => record.status !== "mappable_preview")) return "needs_resolution";
  return "mappable_preview";
}

function parseExactRecords(rows: readonly unknown[], sourceName: string): LegacyFieldRecord[] {
  const records: LegacyFieldRecord[] = [];
  const issues: LegacyCaptureIssue[] = [];
  for (const [index, row] of rows.entries()) {
    const result = legacyFieldRecordSchema.safeParse(row);
    if (result.success) records.push(result.data);
    else {
      for (const entry of result.error.issues) {
        const version = isObject(row) ? row.schemaVersion : undefined;
        issues.push(
          issue(
            version === undefined
              ? "missing_schema_version"
              : version === "field-batch.v2"
                ? "current_batch_not_legacy"
                : "unsupported_schema_version",
            entry.message,
            `${sourceName}:${index + 1}${entry.path.length ? `.${entry.path.join(".")}` : ""}`,
          ),
        );
      }
    }
  }
  const versions = new Set(rows.map((row) => (isObject(row) ? row.schemaVersion : undefined)));
  if (versions.size > 1) {
    issues.push(
      issue("mixed_schema_versions", "Mixed record schema versions are not supported.", sourceName),
    );
  }
  if (issues.length > 0) throw new LegacyCaptureRecognitionError(issues);
  return records;
}

function getPath(value: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) => (isObject(current) ? current[segment] : undefined),
      value,
    );
}

function issue(code: string, message: string, path: string): LegacyCaptureIssue {
  return { code, message, path };
}

function compareIssue(left: LegacyCaptureIssue, right: LegacyCaptureIssue): number {
  return compareCanonicalStrings(`${left.code}:${left.path}`, `${right.code}:${right.path}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
