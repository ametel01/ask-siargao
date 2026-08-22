import { allRecords, effectiveReview } from "@/features/field-desk/field-desk-state";
import type { FieldDeskWork } from "@/features/field-desk/field-desk-types";
import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import type { RecorderRecord } from "@/features/field-recorder/field-recorder-types";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import {
  type AuthenticatedRegistrySnapshot,
  FIELD_BATCH_CONTAINER_VERSION,
  type FieldBatchOuterReceipt,
  fieldBatchOuterReceiptSchema,
} from "./artifact-schemas";
import type { ArtifactRecordFile } from "./package-format";
import {
  DEFAULT_ARTIFACT_CHUNK_SIZE,
  packageCanonicalArtifact,
  type StagedArtifactSink,
} from "./package-format";
import { assertRecipientAuthority, sealContentKeyForRecipient } from "./recipient-envelope";

export type FieldBatchIssue = Readonly<{
  code: string;
  recordId?: string;
  message: string;
}>;

export type FieldBatchGraph = Readonly<{
  files: readonly ArtifactRecordFile[];
  issues: readonly FieldBatchIssue[];
  referentialClosureSha256?: string;
  selectedRecordIds: readonly string[];
}>;

export async function createFieldBatchExport(input: {
  artifactId: string;
  contentKey: Uint8Array;
  createdAt: Date;
  graph: FieldBatchGraph;
  recipientDeviceId: string;
  registry: AuthenticatedRegistrySnapshot;
  sink: StagedArtifactSink;
  transferId: string;
}): Promise<FieldBatchOuterReceipt> {
  if (
    input.graph.issues.length > 0 ||
    input.graph.files.length === 0 ||
    !input.graph.referentialClosureSha256
  ) {
    throw new Error(
      "Field Batch is blocked until a reviewed referentially closed graph is derived.",
    );
  }
  const recipient = assertRecipientAuthority({
    deviceId: input.recipientDeviceId,
    now: input.createdAt,
    registry: input.registry,
  });
  const contentKeyEnvelope = await sealContentKeyForRecipient({
    artifactKind: "field_batch",
    contentKey: input.contentKey,
    recipient,
    transferId: input.transferId,
  });
  const packaged = await packageCanonicalArtifact({
    authorityExclusions: [
      "device_private_keys",
      "webauthn_credentials",
      "session_authority",
      "offline_field_grants",
    ],
    contentKey: input.contentKey,
    files: input.graph.files,
    preamble: {
      containerVersion: FIELD_BATCH_CONTAINER_VERSION,
      artifactKind: "field_batch",
      artifactId: input.artifactId,
      transferId: input.transferId,
      createdAt: input.createdAt.toISOString(),
      chunkSize: DEFAULT_ARTIFACT_CHUNK_SIZE,
      contentKeyEnvelope,
    },
    referentialClosureSha256: input.graph.referentialClosureSha256,
    sink: input.sink,
  });
  const suffix = input.artifactId.replaceAll("-", "").slice(0, 12);
  return fieldBatchOuterReceiptSchema.parse({
    schemaVersion: "field-batch-outer-receipt.v1",
    artifactId: input.artifactId,
    filename: `ask-siargao-field-batch-${suffix}.asfbatch`,
    formatVersion: FIELD_BATCH_CONTAINER_VERSION,
    createdAt: input.createdAt.toISOString(),
    encryptedBytes: packaged.encryptedBytes,
    ciphertextSha256: packaged.ciphertextSha256,
    recipientDeviceId: recipient.id,
    transferId: input.transferId,
    state: "created",
  });
}

export async function deriveFieldBatchGraph(input: {
  batchId: string;
  intendedUse: "research_internal" | "public";
  selectedRecordIds: readonly string[];
  validateRecorderWork: (
    work: FieldDeskWork["recorderWork"],
  ) => Promise<readonly FieldBatchIssue[]>;
  works: readonly FieldDeskWork[];
}): Promise<FieldBatchGraph> {
  const issues: FieldBatchIssue[] = [];
  const recordsById = new Map<string, { record: RecorderRecord; work: FieldDeskWork }>();
  for (const work of input.works) {
    issues.push(...(await input.validateRecorderWork(work.recorderWork)));
    for (const record of allRecords(work)) {
      const existing = recordsById.get(record.value.id);
      if (existing && canonicalStringify(existing.record) !== canonicalStringify(record)) {
        issues.push(issue("same_id_different_content", record.value.id));
      } else if (!existing) {
        recordsById.set(record.value.id, { record, work });
      }
    }
  }
  const selectedIds = [...new Set(input.selectedRecordIds)].toSorted(compareCanonicalStrings);
  if (selectedIds.length !== input.selectedRecordIds.length) {
    issues.push(issue("duplicate_selection"));
  }
  const included = new Map<string, RecorderRecord>();
  const pendingReferences: string[] = [];
  const reviewIds = new Set<string>();
  const followUpIds = new Set<string>();
  const edges = new Set<string>();

  const includeRecord = (recordId: string, edge?: string) => {
    const located = recordsById.get(recordId);
    if (!located) {
      issues.push(issue("missing_reference", recordId));
      return;
    }
    if (!included.has(recordId)) pendingReferences.push(recordId);
    included.set(recordId, located.record);
    if (edge) edges.add(edge);
  };

  for (const recordId of selectedIds) {
    const located = recordsById.get(recordId);
    if (!located) {
      issues.push(issue("missing_selected_record", recordId));
      continue;
    }
    const { record, work } = located;
    if ((record.value as { captureState?: string }).captureState !== "captured") {
      issues.push(issue("record_not_ready_for_desk", recordId));
    }
    const review = effectiveReview(work, recordId);
    if (review?.decision !== "include") {
      issues.push(issue("effective_review_not_include", recordId));
      continue;
    }
    reviewIds.add(review.id);
    includeRecord(recordId, `review:${review.id}->record:${recordId}`);
  }

  while (pendingReferences.length > 0) {
    const recordId = pendingReferences.shift();
    if (!recordId) continue;
    const located = recordsById.get(recordId);
    if (!located) continue;
    includeRequiredReferences(located.record, located.work, includeRecord, edges, issues);
    validateRecordBlockers(
      located.record,
      located.work,
      effectiveReview(located.work, recordId),
      input.intendedUse,
      issues,
    );
  }

  for (const work of input.works) {
    for (const review of work.reviews) {
      if (!reviewIds.has(review.id)) continue;
      let previous = review.previousReviewId;
      while (previous) {
        const historical = work.reviews.find((candidate) => candidate.id === previous);
        if (!historical) {
          issues.push(issue("missing_review_history", review.recordId));
          break;
        }
        reviewIds.add(historical.id);
        previous = historical.previousReviewId;
      }
      if (review.followUpAssignmentId) followUpIds.add(review.followUpAssignmentId);
    }
  }

  if (issues.length > 0) {
    return { files: [], issues, selectedRecordIds: selectedIds };
  }

  const files = buildBatchFiles({
    batchId: input.batchId,
    edges,
    followUpIds,
    included,
    reviewIds,
    works: input.works,
  });
  const referentialClosureSha256 = await sha256Hex(
    fieldTextEncoder.encode(canonicalStringify([...edges].toSorted(compareCanonicalStrings))),
  );
  return { files, issues: [], referentialClosureSha256, selectedRecordIds: selectedIds };
}

function includeRequiredReferences(
  record: RecorderRecord,
  work: FieldDeskWork,
  includeRecord: (recordId: string, edge?: string) => void,
  edges: Set<string>,
  issues: FieldBatchIssue[],
) {
  const value = record.value as unknown as Record<string, unknown>;
  for (const key of ["visitId", "sourceStatementId", "supersedesId"] as const) {
    if (typeof value[key] === "string") {
      includeRecord(String(value[key]), `${record.value.id}:${key}->${String(value[key])}`);
    }
  }
  const referencedIds = new Set<string>();
  for (const key of ["assetIds", "contradictsObservationIds", "translationIds"] as const) {
    if (Array.isArray(value[key])) {
      for (const id of value[key] as unknown[]) if (typeof id === "string") referencedIds.add(id);
    }
  }
  if (record.kind === "routeRun" && record.value.price?.receiptAssetId) {
    referencedIds.add(record.value.price.receiptAssetId);
  }
  for (const id of referencedIds) {
    includeRecord(id, `${record.value.id}:reference->${id}`);
  }
  if (typeof value.assignmentId === "string") {
    const assignment = work.recorderWork.assignments.find(
      (candidate) => candidate.assignmentId === value.assignmentId,
    );
    if (!assignment) issues.push(issue("missing_assignment", record.value.id));
    edges.add(`${record.value.id}:assignment->${String(value.assignmentId)}`);
  }
  if (typeof value.campaignId === "string") {
    if (value.campaignId !== work.recorderWork.planSnapshot.protocol.campaignId) {
      issues.push(issue("missing_campaign", record.value.id));
    }
    edges.add(`${record.value.id}:campaign->${String(value.campaignId)}`);
  }
  for (const key of ["objectiveId", "coverageRequirementId"] as const) {
    if (typeof value[key] === "string")
      edges.add(`${record.value.id}:${key}->${String(value[key])}`);
  }
}

function validateRecordBlockers(
  record: RecorderRecord,
  work: FieldDeskWork,
  review: FieldDeskWork["reviews"][number] | undefined,
  intendedUse: "research_internal" | "public",
  issues: FieldBatchIssue[],
) {
  if (record.kind === "schemaGap") issues.push(issue("unresolved_schema_gap", record.value.id));
  if (
    (record.kind === "fieldVisit" && record.value.target.kind === "provisional_subject") ||
    (record.kind === "fieldObservation" && record.value.subject.kind === "provisional")
  ) {
    issues.push(issue("unresolved_provisional_subject", record.value.id));
  }
  if (record.kind === "fieldObservation") {
    if (
      (record.value.contradictsObservationIds?.length ?? 0) > 0 &&
      !["resolved", "intentional_repetition"].includes(review?.conflictDisposition ?? "unresolved")
    ) {
      issues.push(issue("unresolved_conflict", record.value.id));
    }
    if (intendedUse === "public" && !Object.values(record.value.permissions).every(Boolean)) {
      issues.push(issue("observation_permission_insufficient", record.value.id));
    }
  }
  if (record.kind === "sourceStatement") {
    if (record.value.consents.participation.decision !== "granted") {
      issues.push(issue("source_participation_consent_missing", record.value.id));
    }
    if (
      intendedUse === "public" &&
      [
        record.value.consents.publicUse,
        record.value.consents.articleUse,
        record.value.consents.quotationUse,
      ].some((consent) => consent.decision !== "granted")
    ) {
      issues.push(issue("source_use_consent_insufficient", record.value.id));
    }
  }
  if (record.kind === "evidenceAsset") {
    const committed = work.recorderWork.mediaReceipts.find(
      (asset) => asset.assetId === record.value.id,
    );
    if (!committed) issues.push(issue("asset_missing", record.value.id));
    else {
      if (committed.byteSize !== record.value.byteSize)
        issues.push(issue("asset_bytes_mismatch", record.value.id));
      if (committed.sha256 !== record.value.contentSha256)
        issues.push(issue("asset_hash_mismatch", record.value.id));
    }
    if (record.value.retentionState !== "active")
      issues.push(issue("asset_retention_inactive", record.value.id));
    if (!["not_required", "complete"].includes(record.value.redactionState)) {
      issues.push(issue("asset_redaction_incomplete", record.value.id));
    }
    if (["denied", "withdrawn"].includes(record.value.consentState)) {
      issues.push(issue("asset_consent_insufficient", record.value.id));
    }
    if (intendedUse === "public" && record.value.rights !== "public_use_granted") {
      issues.push(issue("asset_rights_insufficient", record.value.id));
    }
  }
  if (record.kind === "routeRun" && record.value.notTested.length > 0) {
    issues.push(issue("route_run_unresolved", record.value.id));
  }
}

function buildBatchFiles(input: {
  batchId: string;
  edges: ReadonlySet<string>;
  followUpIds: ReadonlySet<string>;
  included: ReadonlyMap<string, RecorderRecord>;
  reviewIds: ReadonlySet<string>;
  works: readonly FieldDeskWork[];
}): ArtifactRecordFile[] {
  const recordsByKind = new Map<string, unknown[]>();
  for (const record of input.included.values()) {
    const list = recordsByKind.get(record.kind) ?? [];
    list.push(record.value);
    recordsByKind.set(record.kind, list);
  }
  const reviews = input.works
    .flatMap((work) => work.reviews.filter((review) => input.reviewIds.has(review.id)))
    .toSorted(byId);
  const followUps = input.works
    .flatMap((work) =>
      work.reviewFollowUps.filter((followUp) => input.followUpIds.has(followUp.id)),
    )
    .toSorted(byId);
  const selection = {
    id: input.batchId,
    schemaVersion: "field-batch-selection.v1",
    edgeSet: [...input.edges].toSorted(compareCanonicalStrings),
    selectedRecordIds: [...input.included.keys()].toSorted(compareCanonicalStrings),
  };
  const files: ArtifactRecordFile[] = [
    { path: "batch-selection.jsonl", recordType: "fieldBatchSelection", records: [selection] },
  ];
  const pathByKind: Record<string, string> = {
    captureException: "capture-exceptions.jsonl",
    evidenceAsset: "evidence-assets.jsonl",
    fieldObservation: "field-observations.jsonl",
    fieldVisit: "field-visits.jsonl",
    routeRun: "route-runs.jsonl",
    schemaGap: "schema-gaps.jsonl",
    sourceStatement: "source-statements.jsonl",
    statementTranslation: "statement-translations.jsonl",
  };
  for (const [kind, records] of recordsByKind) {
    files.push({ path: pathByKind[kind], recordType: kind, records: records.toSorted(byId) });
  }
  if (reviews.length)
    files.push({ path: "field-reviews.jsonl", recordType: "fieldReview", records: reviews });
  if (followUps.length) {
    files.push({
      path: "follow-up-assignments.jsonl",
      recordType: "followUpAssignment",
      records: followUps,
    });
  }
  return files.toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
}

function byId(left: unknown, right: unknown): number {
  return compareCanonicalStrings(
    String((left as { id: string }).id),
    String((right as { id: string }).id),
  );
}

function issue(code: string, recordId?: string): FieldBatchIssue {
  return { code, ...(recordId ? { recordId } : {}), message: code.replaceAll("_", " ") };
}
