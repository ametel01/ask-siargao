import { z } from "zod";

import { fieldDeskReviewEntrySchema } from "@/features/field-desk/desk-schemas";
import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import {
  baselineFieldProtocolPackage,
  type FieldProtocolRecordKind,
  validateFieldProtocolRecord,
} from "@/features/field-protocol/field-protocol";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import type { FieldTransferStateRow } from "@/features/field-security/vault";
import {
  type ActiveRecipientDevice,
  type ArtifactPreamble,
  type ArtifactRootManifest,
  type FieldBatchOuterReceipt,
  fieldBatchOuterReceiptSchema,
  type TransferReceipt,
} from "./artifact-schemas";
import { openCanonicalArtifact } from "./package-format";
import { openRecipientContentKey } from "./recipient-envelope";
import {
  completeDestinationVerification,
  signDestinationTransferReceipt,
  verifyDestinationTransferReceipt,
} from "./transfer-receipt";

const fieldBatchSelectionSchema = z.strictObject({
  id: z.string().uuid(),
  schemaVersion: z.literal("field-batch-selection.v1"),
  edgeSet: z.array(z.string().min(1)).min(1),
  selectedRecordIds: z.array(z.string().uuid()).min(1),
});

type FieldBatchSelection = z.infer<typeof fieldBatchSelectionSchema>;
type OpenedRecord = { kind: FieldProtocolRecordKind; value: Record<string, unknown> };

const recorderPaths = {
  "capture-exceptions.jsonl": "captureException",
  "evidence-assets.jsonl": "evidenceAsset",
  "field-observations.jsonl": "fieldObservation",
  "field-visits.jsonl": "fieldVisit",
  "route-runs.jsonl": "routeRun",
  "schema-gaps.jsonl": "schemaGap",
  "source-statements.jsonl": "sourceStatement",
  "statement-translations.jsonl": "statementTranslation",
} as const satisfies Record<string, FieldProtocolRecordKind>;

export async function verifyReceivedFieldBatch(input: {
  agreementPrivateKey: CryptoKey;
  challengeNonce: string;
  expectedRecipient: ActiveRecipientDevice;
  now: Date;
  receiptId?: string;
  signingPrivateKey: CryptoKey;
  source: AsyncIterable<Uint8Array>;
  sourceReceipt: unknown;
}): Promise<TransferReceipt> {
  const sourceReceipt = fieldBatchOuterReceiptSchema.parse(input.sourceReceipt);
  assertSourceReceipt(sourceReceipt, input.expectedRecipient, input.challengeNonce);
  const validator = new FieldBatchReferenceValidator();

  const receipt = await completeDestinationVerification({
    decryptIntegrityAndReferenceValidate: async () => {
      const opened = await openCanonicalArtifact({
        expectedCiphertextSha256: sourceReceipt.ciphertextSha256,
        expectedKind: "field_batch",
        openContentKey: async (preamble) => {
          assertPreambleMatchesSourceReceipt(preamble, sourceReceipt);
          return openRecipientContentKey({
            agreementPrivateKey: input.agreementPrivateKey,
            artifactKind: "field_batch",
            envelope: preamble.contentKeyEnvelope,
            expectedRecipient: input.expectedRecipient,
            transferId: preamble.transferId,
          });
        },
        onRecord: (record) => validator.accept(record),
        source: input.source,
      });
      await validator.finalize(opened.rootManifest);
      return opened;
    },
    signReceipt: () =>
      signDestinationTransferReceipt({
        artifactCiphertextSha256: sourceReceipt.ciphertextSha256,
        artifactKind: "field_batch",
        challengeNonce: input.challengeNonce,
        receiptId: input.receiptId ?? crypto.randomUUID(),
        recipient: input.expectedRecipient,
        signingPrivateKey: input.signingPrivateKey,
        transferId: sourceReceipt.transferId,
        verifiedAt: input.now.toISOString(),
      }),
  });

  await verifyDestinationTransferReceipt({
    outstanding: outstandingFromSource(sourceReceipt, input.challengeNonce),
    receipt,
    recipient: input.expectedRecipient,
  });
  return receipt;
}

export function destinationReceiptFilename(receipt: TransferReceipt): string {
  return `ask-siargao-field-transfer-${receipt.receiptId.replaceAll("-", "").slice(0, 12)}.asftransferreceipt`;
}

class FieldBatchReferenceValidator {
  private readonly ids = new Set<string>();
  private readonly records = new Map<string, OpenedRecord>();
  private readonly reviews = new Map<string, z.infer<typeof fieldDeskReviewEntrySchema>>();
  private readonly followUps = new Map<string, Record<string, unknown>>();
  private selection?: FieldBatchSelection;

  async accept(input: { path: string; recordType: string; value: unknown }): Promise<void> {
    if (input.path === "batch-selection.jsonl" && input.recordType === "fieldBatchSelection") {
      if (this.selection) invalid();
      this.selection = fieldBatchSelectionSchema.parse(input.value);
      return;
    }
    if (input.path === "field-reviews.jsonl" && input.recordType === "fieldReview") {
      const review = fieldDeskReviewEntrySchema.parse(input.value);
      await assertReviewHash(review);
      this.addUnique(review.id);
      this.reviews.set(review.id, review);
      return;
    }
    if (input.path === "follow-up-assignments.jsonl" && input.recordType === "followUpAssignment") {
      const result = validateFieldProtocolRecord("followUpAssignment", input.value, {
        protocolPackage: baselineFieldProtocolPackage,
      });
      if (!result.success) invalid();
      const value = result.data as unknown as Record<string, unknown>;
      this.addUnique(String(value.id));
      this.followUps.set(String(value.id), value);
      return;
    }
    const kind = recorderPaths[input.path as keyof typeof recorderPaths];
    if (!kind || input.recordType !== kind) invalid();
    const result = validateFieldProtocolRecord(kind, input.value, {
      protocolPackage: baselineFieldProtocolPackage,
    });
    if (!result.success) invalid();
    const value = result.data as unknown as Record<string, unknown>;
    const id = String(value.id);
    this.addUnique(id);
    this.records.set(id, { kind, value });
  }

  async finalize(rootManifest: ArtifactRootManifest): Promise<void> {
    const selection = this.selection;
    if (!selection || !rootManifest.referentialClosureSha256) invalid();
    assertSortedUnique(selection.edgeSet);
    assertSortedUnique(selection.selectedRecordIds);
    const recordIds = [...this.records.keys()].toSorted(compareCanonicalStrings);
    if (canonicalStringify(selection.selectedRecordIds) !== canonicalStringify(recordIds)) {
      invalid();
    }
    if (
      (await sha256Hex(fieldTextEncoder.encode(canonicalStringify(selection.edgeSet)))) !==
      rootManifest.referentialClosureSha256
    ) {
      invalid();
    }

    const requiredEdges = new Set<string>();
    for (const [id, record] of this.records) {
      this.addRequiredRecordEdges(id, record, requiredEdges);
    }
    const reviewEdges = selection.edgeSet.filter((edge) => edge.startsWith("review:"));
    if (reviewEdges.length === 0) invalid();
    for (const edge of reviewEdges) {
      this.assertReviewEdge(edge);
      requiredEdges.add(edge);
    }
    this.assertReviewChains();
    if (
      canonicalStringify([...requiredEdges].toSorted(compareCanonicalStrings)) !==
      canonicalStringify(selection.edgeSet)
    ) {
      invalid();
    }
  }

  private addRequiredRecordEdges(id: string, record: OpenedRecord, edges: Set<string>): void {
    for (const [key, expectedKind] of [
      ["visitId", "fieldVisit"],
      ["sourceStatementId", "sourceStatement"],
      ["supersedesId", record.kind],
    ] as const) {
      const targetId = record.value[key];
      if (typeof targetId !== "string") continue;
      this.assertRecordKind(targetId, expectedKind);
      edges.add(`${id}:${key}->${targetId}`);
    }
    for (const [key, expectedKind] of [
      ["assetIds", "evidenceAsset"],
      ["contradictsObservationIds", "fieldObservation"],
      ["translationIds", "statementTranslation"],
    ] as const) {
      const targetIds = record.value[key];
      if (!Array.isArray(targetIds)) continue;
      for (const targetId of targetIds) {
        if (typeof targetId !== "string") invalid();
        this.assertRecordKind(targetId, expectedKind);
        edges.add(`${id}:reference->${targetId}`);
      }
    }
    if (record.kind === "routeRun") {
      const receiptAssetId = (record.value.price as { receiptAssetId?: unknown } | undefined)
        ?.receiptAssetId;
      if (typeof receiptAssetId === "string") {
        this.assertRecordKind(receiptAssetId, "evidenceAsset");
        edges.add(`${id}:reference->${receiptAssetId}`);
      }
    }
    for (const key of [
      "assignmentId",
      "campaignId",
      "objectiveId",
      "coverageRequirementId",
    ] as const) {
      const targetId = record.value[key];
      if (typeof targetId === "string") edges.add(`${id}:${key}->${targetId}`);
    }
  }

  private assertReviewEdge(edge: string): void {
    const match = /^review:([^>]+)->record:(.+)$/u.exec(edge);
    if (!match) invalid();
    const review = this.reviews.get(match[1]);
    const record = this.records.get(match[2]);
    if (!review || !record || review.recordId !== match[2] || review.decision !== "include") {
      invalid();
    }
    if (review.recordKind !== record.kind || this.hasReviewSuccessor(review.id)) invalid();
  }

  private assertReviewChains(): void {
    const rootsByRecord = new Map<string, number>();
    const leavesByRecord = new Map<string, number>();
    const successorCounts = new Map<string, number>();
    for (const review of this.reviews.values()) {
      const record = this.records.get(review.recordId);
      if (!record || record.kind !== review.recordKind) invalid();
      if (review.previousReviewId) {
        const previous = this.reviews.get(review.previousReviewId);
        if (!previous || previous.recordId !== review.recordId) invalid();
        successorCounts.set(
          review.previousReviewId,
          (successorCounts.get(review.previousReviewId) ?? 0) + 1,
        );
      } else {
        rootsByRecord.set(review.recordId, (rootsByRecord.get(review.recordId) ?? 0) + 1);
      }
      if (review.followUpAssignmentId && !this.followUps.has(review.followUpAssignmentId))
        invalid();
      if (review.supersedingRecordId && !this.records.has(review.supersedingRecordId)) invalid();
      const visited = new Set<string>();
      let current: typeof review | undefined = review;
      while (current?.previousReviewId) {
        if (visited.has(current.id)) invalid();
        visited.add(current.id);
        current = this.reviews.get(current.previousReviewId);
        if (!current) invalid();
      }
      if (!this.hasReviewSuccessor(review.id)) {
        leavesByRecord.set(review.recordId, (leavesByRecord.get(review.recordId) ?? 0) + 1);
      }
    }
    const reviewedRecordIds = new Set([...this.reviews.values()].map((review) => review.recordId));
    for (const recordId of reviewedRecordIds) {
      if (rootsByRecord.get(recordId) !== 1 || leavesByRecord.get(recordId) !== 1) invalid();
      const leaf = [...this.reviews.values()].find(
        (review) => review.recordId === recordId && !this.hasReviewSuccessor(review.id),
      );
      if (!leaf || !this.selection?.edgeSet.includes(`review:${leaf.id}->record:${recordId}`)) {
        invalid();
      }
    }
    if ([...successorCounts.values()].some((count) => count !== 1)) invalid();
  }

  private hasReviewSuccessor(reviewId: string): boolean {
    return [...this.reviews.values()].some((review) => review.previousReviewId === reviewId);
  }

  private assertRecordKind(id: string, kind: FieldProtocolRecordKind): void {
    if (this.records.get(id)?.kind !== kind) invalid();
  }

  private addUnique(id: string): void {
    if (this.ids.has(id)) invalid();
    this.ids.add(id);
  }
}

async function assertReviewHash(review: z.infer<typeof fieldDeskReviewEntrySchema>): Promise<void> {
  const { entrySha256, ...withoutHash } = review;
  if (entrySha256 !== (await sha256Hex(fieldTextEncoder.encode(canonicalStringify(withoutHash))))) {
    invalid();
  }
}

function assertSourceReceipt(
  receipt: FieldBatchOuterReceipt,
  recipient: ActiveRecipientDevice,
  challengeNonce: string,
): void {
  if (
    receipt.state !== "created" ||
    receipt.recipientDeviceId !== recipient.id ||
    challengeNonce.length < 22 ||
    challengeNonce.length > 200
  ) {
    invalid();
  }
}

function assertPreambleMatchesSourceReceipt(
  preamble: ArtifactPreamble,
  receipt: FieldBatchOuterReceipt,
): void {
  if (
    preamble.artifactId !== receipt.artifactId ||
    preamble.transferId !== receipt.transferId ||
    preamble.createdAt !== receipt.createdAt
  ) {
    invalid();
  }
}

function outstandingFromSource(
  receipt: FieldBatchOuterReceipt,
  nonce: string,
): FieldTransferStateRow {
  return {
    artifactKind: "field_batch",
    ciphertextSha256: receipt.ciphertextSha256,
    createdAt: receipt.createdAt,
    nonce,
    recipientDeviceId: receipt.recipientDeviceId,
    state: "outstanding",
    transferId: receipt.transferId,
  };
}

function assertSortedUnique(values: readonly string[]): void {
  if (
    new Set(values).size !== values.length ||
    canonicalStringify([...values].toSorted(compareCanonicalStrings)) !== canonicalStringify(values)
  ) {
    invalid();
  }
}

function invalid(): never {
  throw new FieldSecurityError("field_artifact_invalid");
}
