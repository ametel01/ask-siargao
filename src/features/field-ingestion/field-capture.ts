import { z } from "zod";

export const fieldRecordTypes = ["visit", "observation", "statement", "routeRun", "asset"] as const;

export type FieldRecordType = (typeof fieldRecordTypes)[number];

const isoDateTime = z.iso.datetime({ offset: true });
const uuid = z.uuid();

const fieldRecordSchema = z
  .object({
    schemaVersion: z.literal("field-record.v1"),
    recordType: z.enum(fieldRecordTypes),
    id: uuid,
    clientBatchId: uuid,
    campaignSlug: z.string().trim().min(1),
    capturedAt: isoDateTime,
    localTimezone: z.string().trim().min(1).default("Asia/Manila"),
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
    status: z
      .enum([
        "captured",
        "needs_resolution",
        "ready_for_review",
        "admitted",
        "rejected",
        "superseded",
      ])
      .optional(),
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
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    rightsScope: z.string().trim().min(1).optional(),
    redactionStatus: z.enum(["not_required", "pending", "complete", "blocked"]).optional(),
  })
  .passthrough()
  .superRefine((record, context) => {
    const requireField = (key: keyof typeof record, message: string) => {
      if (record[key] === undefined) {
        context.addIssue({ code: "custom", message, path: [key] });
      }
    };

    if (record.recordType === "visit") {
      requireField("observerKey", "A visit requires observerKey.");
      requireField("purposeCodes", "A visit requires purposeCodes.");
      requireField("startedAt", "A visit requires startedAt.");
      const subjectCount = [
        record.entityId,
        record.areaId,
        record.routeId,
        record.provisionalSubjectName,
      ].filter(Boolean).length;
      if (subjectCount !== 1) {
        context.addIssue({
          code: "custom",
          message: "A visit requires exactly one normalized or provisional subject.",
          path: ["provisionalSubjectName"],
        });
      }
    }

    if (record.recordType === "observation") {
      for (const [key, message] of [
        ["visitId", "An observation requires visitId."],
        ["observationKind", "An observation requires observationKind."],
        ["directness", "An observation requires directness."],
        ["observedAt", "An observation requires observedAt."],
        ["value", "An observation requires value."],
        ["method", "An observation requires method."],
        ["conditionTags", "An observation requires conditionTags."],
        ["fieldConfidence", "An observation requires fieldConfidence."],
        ["reviewDueAt", "An observation requires reviewDueAt."],
        ["status", "An observation requires status."],
      ] as const) {
        requireField(key, message);
      }
    }

    if (record.recordType === "statement") {
      requireField("visitId", "A statement requires visitId.");
      requireField("statementType", "A statement requires statementType.");
      requireField("statementText", "A statement requires statementText.");
      requireField("consentScope", "A statement requires an explicit consentScope.");
    }

    if (record.recordType === "routeRun") {
      for (const [key, message] of [
        ["visitId", "A route run requires visitId."],
        ["startedAt", "A route run requires startedAt."],
        ["endedAt", "A route run requires endedAt."],
        ["mode", "A route run requires mode."],
        ["originText", "A route run requires originText."],
        ["destinationText", "A route run requires destinationText."],
      ] as const) {
        requireField(key, message);
      }
    }

    if (record.recordType === "asset") {
      for (const [key, message] of [
        ["visitId", "An asset index requires visitId."],
        ["assetKind", "An asset index requires assetKind."],
        ["relativePath", "An asset index requires relativePath."],
        ["sha256", "An asset index requires a lowercase SHA-256 hash."],
        ["rightsScope", "An asset index requires rightsScope."],
        ["redactionStatus", "An asset index requires redactionStatus."],
      ] as const) {
        requireField(key, message);
      }
    }
  });

export type FieldRecord = z.infer<typeof fieldRecordSchema>;

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type StoredFieldRecord = {
  storageKey: string;
  signature: string;
  sourceName: string;
  importedAt: string;
  record: FieldRecord;
};

export type AnalyzedFieldRecord = StoredFieldRecord & {
  issues: ValidationIssue[];
  state: "ready" | "attention" | "conflict";
};

export type ParsedFieldFile = {
  records: Array<{ record: FieldRecord; sourceName: string }>;
  issues: ValidationIssue[];
};

export type FieldBatchEnvelope = {
  schemaVersion: "field-batch.v1";
  clientBatchId: string;
  campaignSlug: string;
  createdAt: string;
  localTimezone: string;
  recordCounts: Record<FieldRecordType, number>;
  payloadSha256: string;
  records: FieldRecord[];
};

export function parseFieldFile(sourceName: string, text: string): ParsedFieldFile {
  const rawRecords: unknown[] = [];
  const issues: ValidationIssue[] = [];
  const isJsonLines = sourceName.toLowerCase().endsWith(".jsonl");

  if (isJsonLines) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        rawRecords.push(JSON.parse(line));
      } catch {
        issues.push({
          code: "invalid_json_line",
          message: `Line ${index + 1} is not valid JSON.`,
          path: `${sourceName}:${index + 1}`,
        });
      }
    }
  } else {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        rawRecords.push(...parsed);
      } else if (isObject(parsed) && Array.isArray(parsed.records)) {
        rawRecords.push(...parsed.records);
      } else {
        rawRecords.push(parsed);
      }
    } catch {
      issues.push({
        code: "invalid_json",
        message: "The file is not valid JSON.",
        path: sourceName,
      });
    }
  }

  const inferredType = inferRecordType(sourceName);
  const records: ParsedFieldFile["records"] = [];
  for (const [index, rawRecord] of rawRecords.entries()) {
    const candidate =
      inferredType && isObject(rawRecord) && rawRecord.recordType === undefined
        ? { ...rawRecord, recordType: inferredType }
        : rawRecord;
    const result = fieldRecordSchema.safeParse(candidate);
    if (result.success) {
      records.push({ record: result.data, sourceName });
      continue;
    }
    for (const issue of result.error.issues) {
      issues.push({
        code: "schema_error",
        message: issue.message,
        path: `${sourceName}:${index + 1}${issue.path.length ? `.${issue.path.join(".")}` : ""}`,
      });
    }
  }

  return { records, issues };
}

export function toStoredFieldRecord(
  record: FieldRecord,
  sourceName: string,
  importedAt = new Date().toISOString(),
): StoredFieldRecord {
  const signature = canonicalStringify(record);
  return {
    storageKey: `${record.id}:${signature}`,
    signature,
    sourceName,
    importedAt,
    record,
  };
}

export function mergeFieldRecords(
  current: StoredFieldRecord[],
  incoming: StoredFieldRecord[],
): StoredFieldRecord[] {
  const byStorageKey = new Map(current.map((entry) => [entry.storageKey, entry]));
  for (const entry of incoming) byStorageKey.set(entry.storageKey, entry);
  return [...byStorageKey.values()].sort(compareStoredRecords);
}

export function analyzeFieldRecords(records: StoredFieldRecord[]): AnalyzedFieldRecord[] {
  const variantsById = new Map<string, Set<string>>();
  const visitIds = new Set<string>();
  const batchIds = new Set<string>();
  const campaigns = new Set<string>();

  for (const entry of records) {
    const record = entry.record;
    const variants = variantsById.get(record.id) ?? new Set<string>();
    variants.add(entry.signature);
    variantsById.set(record.id, variants);
    if (record.recordType === "visit") visitIds.add(record.id);
    batchIds.add(record.clientBatchId);
    campaigns.add(record.campaignSlug);
  }

  return records.map((entry) => {
    const issues: ValidationIssue[] = [];
    const record = entry.record;
    const conflict = (variantsById.get(record.id)?.size ?? 0) > 1;

    if (conflict) {
      issues.push({
        code: "id_payload_conflict",
        message:
          "This ID appears with different content. Keep one corrected variant before export.",
      });
    }
    if (batchIds.size > 1) {
      issues.push({
        code: "mixed_client_batches",
        message: "The workspace contains more than one client batch ID.",
      });
    }
    if (campaigns.size > 1) {
      issues.push({
        code: "mixed_campaigns",
        message: "The workspace contains more than one campaign.",
      });
    }
    if (record.recordType !== "visit" && record.visitId && !visitIds.has(record.visitId)) {
      issues.push({
        code: "missing_visit",
        message: `Referenced visit ${record.visitId} is not in this workspace.`,
        path: "visitId",
      });
    }
    if (
      record.recordType === "observation" &&
      (record.llmUseAllowed || record.articleUseAllowed || record.publicRepublishAllowed)
    ) {
      issues.push({
        code: "capture_permission_escalation",
        message: "Captured observations must keep LLM, article, and public permissions false.",
      });
    }
    if (
      record.recordType === "statement" &&
      (record.consentScope ?? []).some((scope) => scope !== "internal") &&
      (!record.consentRecordedAt || !record.consentMethod)
    ) {
      issues.push({
        code: "consent_evidence_missing",
        message: "Non-internal statement use requires consentRecordedAt and consentMethod.",
      });
    }
    if (record.recordType === "asset" && record.redactionStatus === "pending") {
      issues.push({
        code: "redaction_pending",
        message: "The referenced asset still needs redaction review.",
      });
    }
    if (record.recordType === "asset" && record.redactionStatus === "blocked") {
      issues.push({
        code: "asset_blocked",
        message: "The referenced asset is blocked from this export.",
      });
    }

    return {
      ...entry,
      issues,
      state: conflict ? "conflict" : issues.length > 0 ? "attention" : "ready",
    };
  });
}

export async function createFieldBatchEnvelope(
  records: StoredFieldRecord[],
  createdAt = new Date().toISOString(),
): Promise<FieldBatchEnvelope> {
  const analyzed = analyzeFieldRecords(records);
  if (analyzed.length === 0 || analyzed.some((entry) => entry.state !== "ready")) {
    throw new Error("Only a non-empty workspace with no blocking issues can be exported.");
  }

  const orderedRecords = analyzed.map((entry) => entry.record).sort(compareFieldRecords);
  const first = orderedRecords[0];
  const recordCounts = Object.fromEntries(fieldRecordTypes.map((type) => [type, 0])) as Record<
    FieldRecordType,
    number
  >;
  for (const record of orderedRecords) recordCounts[record.recordType] += 1;

  return {
    schemaVersion: "field-batch.v1",
    clientBatchId: first.clientBatchId,
    campaignSlug: first.campaignSlug,
    createdAt,
    localTimezone: first.localTimezone,
    recordCounts,
    payloadSha256: await sha256(canonicalStringify(orderedRecords)),
    records: orderedRecords,
  };
}

export function createFieldTemplate(now = new Date()): FieldRecord[] {
  const capturedAt = now.toISOString();
  const clientBatchId = crypto.randomUUID();
  const visitId = crypto.randomUUID();
  return [
    fieldRecordSchema.parse({
      schemaVersion: "field-record.v1",
      recordType: "visit",
      id: visitId,
      clientBatchId,
      campaignSlug: "island-baseline-2026",
      capturedAt,
      localTimezone: "Asia/Manila",
      observerKey: "replace-with-private-observer-key",
      provisionalSubjectName: "Replace with the observed place or route",
      purposeCodes: ["guide_fact_check"],
      startedAt: capturedAt,
      conditions: {},
    }),
    fieldRecordSchema.parse({
      schemaVersion: "field-record.v1",
      recordType: "observation",
      id: crypto.randomUUID(),
      clientBatchId,
      campaignSlug: "island-baseline-2026",
      capturedAt,
      localTimezone: "Asia/Manila",
      visitId,
      observationKind: "replace_with_controlled_kind",
      directness: "direct_observation",
      observedAt: capturedAt,
      value: { text: "Replace with one atomic observation" },
      method: "structured_visual_check",
      conditionTags: [],
      fieldConfidence: "medium",
      reviewDueAt: capturedAt,
      status: "captured",
      llmUseAllowed: false,
      articleUseAllowed: false,
      publicRepublishAllowed: false,
    }),
  ];
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
  );
}

function inferRecordType(sourceName: string): FieldRecordType | undefined {
  const normalized = sourceName.toLowerCase();
  if (normalized.includes("observation")) return "observation";
  if (normalized.includes("visit")) return "visit";
  if (normalized.includes("statement")) return "statement";
  if (normalized.includes("route-run") || normalized.includes("route_run")) return "routeRun";
  if (normalized.includes("asset")) return "asset";
  return undefined;
}

function compareStoredRecords(left: StoredFieldRecord, right: StoredFieldRecord): number {
  return (
    compareFieldRecords(left.record, right.record) || left.signature.localeCompare(right.signature)
  );
}

function compareFieldRecords(left: FieldRecord, right: FieldRecord): number {
  return (
    fieldRecordTypes.indexOf(left.recordType) - fieldRecordTypes.indexOf(right.recordType) ||
    left.capturedAt.localeCompare(right.capturedAt) ||
    left.id.localeCompare(right.id)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
