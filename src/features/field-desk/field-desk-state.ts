import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import { validateFieldProtocolRecord } from "@/features/field-protocol/field-protocol";
import type { FollowUpAssignment } from "@/features/field-protocol/generated";
import type { RecorderRecord, RecorderWork } from "@/features/field-recorder/field-recorder-types";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import type { FieldDeskRecoveryAudit } from "./desk-schemas";
import {
  FIELD_DESK_REVIEW_VERSION,
  type FieldDeskReviewEntry,
  fieldDeskCorrectionNoteSchema,
  fieldDeskRecoveryAuditSchema,
  fieldDeskReviewEntrySchema,
} from "./desk-schemas";
import type { DuplicateProposal, FieldDeskReviewInput, FieldDeskWork } from "./field-desk-types";

export type FieldDeskCorrectionDescriptor = Readonly<{
  label: string;
  path: readonly string[];
  inputMode: "text" | "numeric" | "choice";
  choices?: readonly string[];
}>;

const observationCorrectionDescriptors: Readonly<Record<string, FieldDeskCorrectionDescriptor>> = {
  identity: correctionDescriptor("Displayed name", ["value", "displayedName"]),
  opening_signal: correctionDescriptor("Opening state", ["value", "state"]),
  price: correctionDescriptor("Amount", ["value", "amount"]),
  route_duration: correctionDescriptor("Duration (seconds)", ["value", "durationSeconds"], {
    inputMode: "numeric",
  }),
  route_wait: correctionDescriptor("Wait (seconds)", ["value", "waitSeconds"], {
    inputMode: "numeric",
  }),
  road_condition: correctionDescriptor("Surface", ["value", "surface"]),
  facility: correctionDescriptor("Facility state", ["value", "state"]),
  accessibility: correctionDescriptor("Accessibility feature", ["value", "feature"]),
  payment_method: correctionDescriptor("Payment method", ["value", "method"]),
  connectivity: correctionDescriptor("Network", ["value", "network"]),
  power: correctionDescriptor("Power state", ["value", "state"]),
  crowd_snapshot: correctionDescriptor("Crowd boundary", ["value", "boundary"]),
  noise_snapshot: correctionDescriptor("Measurement position", ["value", "measurementPosition"]),
  weather_condition: correctionDescriptor("Weather condition", ["value", "condition"]),
  tide_context: correctionDescriptor("Tide source", ["value", "sourceId"]),
  menu_item: correctionDescriptor("Menu item", ["value", "itemName"]),
  service_status: correctionDescriptor("Service state", ["value", "state"]),
  contact_channel: correctionDescriptor("Public contact value", ["value", "publicValue"]),
  local_caveat: correctionDescriptor("Warning", ["value", "warning"]),
};

const evidencePurposes = [
  "orientation",
  "measurement_context",
  "posted_information",
  "transaction_receipt",
  "consent_record",
] as const;

export function fieldDeskCorrectionDescriptor(
  record: RecorderRecord,
): FieldDeskCorrectionDescriptor {
  switch (record.kind) {
    case "fieldVisit":
      return correctionDescriptor("Private visit context", ["privateContextNote"]);
    case "fieldObservation": {
      const descriptor = observationCorrectionDescriptors[record.value.observationKind];
      if (!descriptor) {
        throw new Error("This observation kind has no governed Desk correction field.");
      }
      return descriptor;
    }
    case "routeRun":
      return correctionDescriptor("Party context", ["partyContext"]);
    case "sourceStatement":
      return correctionDescriptor("Protected source statement", ["originalStatement"]);
    case "statementTranslation":
      return correctionDescriptor("Translated text", ["translatedText"]);
    case "evidenceAsset":
      return correctionDescriptor("Asset purpose", ["purpose"], {
        choices: evidencePurposes,
        inputMode: "choice",
      });
    case "captureException":
      return correctionDescriptor("Exception details", ["reasonDetails"]);
    case "schemaGap":
      return correctionDescriptor("Schema-gap description", ["description"]);
  }
}

export function createFieldDeskCorrection(input: {
  correctedValue: string;
  id: string;
  original: RecorderRecord;
}): RecorderRecord {
  const correctedValue = fieldDeskCorrectionNoteSchema.parse(input.correctedValue);
  const descriptor = fieldDeskCorrectionDescriptor(input.original);
  const parsedValue = parseCorrectionValue(correctedValue, descriptor);
  const successorValue = structuredClone(input.original.value) as unknown as Record<
    string,
    unknown
  >;
  successorValue.id = input.id;
  successorValue.supersedesId = input.original.value.id;
  setPath(successorValue, descriptor.path, parsedValue);
  return recordWithValue(input.original.kind, successorValue);
}

function correctionDescriptor(
  label: string,
  path: readonly string[],
  options: Partial<Pick<FieldDeskCorrectionDescriptor, "choices" | "inputMode">> = {},
): FieldDeskCorrectionDescriptor {
  return Object.freeze({
    label,
    path,
    inputMode: options.inputMode ?? "text",
    ...(options.choices ? { choices: options.choices } : {}),
  });
}

function parseCorrectionValue(
  correctedValue: string,
  descriptor: FieldDeskCorrectionDescriptor,
): string | number {
  if (descriptor.inputMode === "numeric") {
    const numeric = Number(correctedValue);
    if (!Number.isFinite(numeric)) throw new Error("The corrected value must be a finite number.");
    return numeric;
  }
  if (descriptor.inputMode === "choice" && !descriptor.choices?.includes(correctedValue)) {
    throw new Error("The corrected value must use a governed option.");
  }
  return correctedValue;
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let parent = target;
  for (const segment of path.slice(0, -1)) {
    const child = parent[segment];
    if (typeof child !== "object" || child === null || Array.isArray(child)) {
      throw new Error("The governed correction field is unavailable on this record.");
    }
    parent = child as Record<string, unknown>;
  }
  const key = path.at(-1);
  if (!key) throw new Error("The governed correction field is unavailable on this record.");
  parent[key] = value;
}

function recordWithValue(
  kind: RecorderRecord["kind"],
  value: Record<string, unknown>,
): RecorderRecord {
  return { kind, value } as unknown as RecorderRecord;
}

export async function createFieldDeskWork(input: {
  archiveId: string;
  handedOffAt: string;
  recorderWork: RecorderWork;
}): Promise<FieldDeskWork> {
  if (!input.recorderWork.fieldDayClose) {
    throw new Error("Only a closed Recorder work item can move into Field Desk custody.");
  }
  const sourceRecorderSha256 = await canonicalSha256(input.recorderWork);
  return Object.freeze({
    schemaVersion: "field-desk-work.v1",
    archiveId: input.archiveId,
    revision: 1,
    sourceRecorderSha256,
    recorderWork: structuredClone(input.recorderWork),
    corrections: [],
    reviews: [],
    reviewFollowUps: [],
    recoveryAudit: [],
    createdAt: input.handedOffAt,
    updatedAt: input.handedOffAt,
  });
}

export async function appendFieldReview(input: {
  review: FieldDeskReviewInput;
  work: FieldDeskWork;
}): Promise<FieldDeskWork> {
  const original = allRecords(input.work).find((entry) => entry.value.id === input.review.recordId);
  if (!original) throw new Error("The reviewed immutable record is not in Desk custody.");
  const researcherId = original.value.researcherId;
  if (input.review.reviewerMatchesResearcher !== (input.review.reviewerId === researcherId)) {
    throw new Error("Reviewer independence disclosure does not match the recorded identities.");
  }
  const previous = effectiveReview(input.work, original.value.id);
  const successor = validateCorrection(input.review, original, input.work);
  const followUp = validateFollowUp(input.review, original);
  const entryWithoutHash = {
    schemaVersion: FIELD_DESK_REVIEW_VERSION,
    id: input.review.id,
    protocolPackageId: original.value.protocolPackageId,
    protocolPackageVersion: original.value.protocolPackageVersion,
    recordId: original.value.id,
    recordKind: original.kind,
    reviewerId: input.review.reviewerId,
    researcherId,
    reviewerMatchesResearcher: input.review.reviewerMatchesResearcher,
    reviewedAt: input.review.reviewedAt,
    decision: input.review.decision,
    ...(input.review.reason ? { reason: input.review.reason.trim() } : {}),
    ...(successor ? { supersedingRecordId: successor.value.id } : {}),
    ...(followUp ? { followUpAssignmentId: followUp.id } : {}),
    ...(previous ? { previousReviewId: previous.id } : {}),
    conflictDisposition: input.review.conflictDisposition ?? "not_applicable",
  } as const;
  const entry: FieldDeskReviewEntry = fieldDeskReviewEntrySchema.parse({
    ...entryWithoutHash,
    entrySha256: await canonicalSha256(entryWithoutHash),
  });
  if (input.work.reviews.some((candidate) => candidate.id === entry.id)) {
    throw new Error("Field Review audit IDs are immutable and unique.");
  }
  return Object.freeze({
    ...input.work,
    revision: input.work.revision + 1,
    corrections: successor
      ? [...input.work.corrections, structuredClone(successor)]
      : input.work.corrections,
    reviews: [...input.work.reviews, entry],
    reviewFollowUps: followUp
      ? [...input.work.reviewFollowUps, structuredClone(followUp)]
      : input.work.reviewFollowUps,
    updatedAt: input.review.reviewedAt,
  });
}

export function effectiveReview(
  work: FieldDeskWork,
  recordId: string,
): FieldDeskReviewEntry | undefined {
  let effective: FieldDeskReviewEntry | undefined;
  for (const review of work.reviews) {
    if (review.recordId !== recordId) continue;
    if (!effective && review.previousReviewId) {
      throw new Error("Field Review history is ambiguous: the first decision has a predecessor.");
    }
    if (effective && review.previousReviewId !== effective.id) {
      throw new Error(
        "Field Review history is ambiguous: decisions must form one append-only chain.",
      );
    }
    effective = review;
  }
  return effective;
}

export function proposeIdentityEquivalentDuplicates(
  records: readonly RecorderRecord[],
): readonly DuplicateProposal[] {
  const proposals: DuplicateProposal[] = [];
  const identities = new Map<string, RecorderRecord>();
  for (const record of records) {
    const { id: _id, ...withoutId } = record.value;
    const identity = canonicalStringify({ kind: record.kind, value: withoutId });
    const existing = identities.get(identity);
    if (existing) {
      proposals.push({
        candidateRecordId: record.value.id,
        existingRecordId: existing.value.id,
        reason: "identity_equivalent",
      });
    } else {
      identities.set(identity, record);
    }
  }
  return proposals;
}

export function allRecords(work: FieldDeskWork): readonly RecorderRecord[] {
  return [...work.recorderWork.records, ...work.corrections];
}

export function appendDeskRecoveryAudit(input: {
  audit: FieldDeskRecoveryAudit;
  work: FieldDeskWork;
}): FieldDeskWork {
  const audit = fieldDeskRecoveryAuditSchema.parse(input.audit);
  if (audit.archiveId !== input.work.archiveId) {
    throw new Error("Recovery audit must remain in its archived outing custody.");
  }
  const previous = input.work.recoveryAudit.at(-1);
  if ((previous && audit.previousAuditId !== previous.id) || (!previous && audit.previousAuditId)) {
    throw new Error("Recovery audit events must form one append-only chain.");
  }
  const allowedNext: Record<
    FieldDeskRecoveryAudit["operation"],
    FieldDeskRecoveryAudit["operation"][]
  > = {
    created: ["locally_reopened"],
    locally_reopened: ["destination_verified"],
    destination_verified: ["source_verified"],
    source_verified: [],
  };
  if (previous && !allowedNext[previous.operation].includes(audit.operation)) {
    throw new Error("Recovery verification operations are out of order.");
  }
  if (!previous && audit.operation !== "created") {
    throw new Error("Recovery custody begins only after artifact creation completes.");
  }
  return Object.freeze({
    ...input.work,
    recoveryAudit: [...input.work.recoveryAudit, audit],
    revision: input.work.revision + 1,
    updatedAt: audit.occurredAt,
  });
}

export function derivedRecorderRecoveryStatus(
  work: FieldDeskWork,
): "recovery_required" | "recovery_verified_locally" | "transfer_verified" {
  const latest = work.recoveryAudit.at(-1)?.operation;
  if (latest === "source_verified") return "transfer_verified";
  if (["locally_reopened", "destination_verified"].includes(latest ?? "")) {
    return "recovery_verified_locally";
  }
  return "recovery_required";
}

async function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(fieldTextEncoder.encode(canonicalStringify(value)));
}

function validateCorrection(
  review: FieldDeskReviewInput,
  original: RecorderRecord,
  work: FieldDeskWork,
): RecorderRecord | undefined {
  if (review.decision !== "correct_by_supersession") {
    if (review.supersedingRecord)
      throw new Error("Only a correction decision may append a successor.");
    return undefined;
  }
  const successor = review.supersedingRecord;
  if (!successor || successor.kind !== original.kind) {
    throw new Error("A correction requires a new captured record of the same type.");
  }
  if ((successor.value as { captureState?: string }).captureState !== "captured") {
    throw new Error("A correction successor must be Captured before Desk review.");
  }
  if ((successor.value as { supersedesId?: string }).supersedesId !== original.value.id) {
    throw new Error("A correction must directly supersede the reviewed record.");
  }
  if (allRecords(work).some((record) => record.value.id === successor.value.id)) {
    throw new Error("A correction successor must have a new immutable ID.");
  }
  const descriptor = fieldDeskCorrectionDescriptor(original);
  const originalValue = structuredClone(original.value) as unknown as Record<string, unknown>;
  const successorValue = structuredClone(successor.value) as unknown as Record<string, unknown>;
  const originalCorrection = valueAtPath(originalValue, descriptor.path);
  const successorCorrection = valueAtPath(successorValue, descriptor.path);
  if (canonicalStringify(originalCorrection) === canonicalStringify(successorCorrection)) {
    throw new Error("A correction must change the governed typed value.");
  }
  delete originalValue.id;
  delete originalValue.supersedesId;
  delete successorValue.id;
  delete successorValue.supersedesId;
  setPath(originalValue, descriptor.path, null);
  setPath(successorValue, descriptor.path, null);
  if (canonicalStringify(originalValue) !== canonicalStringify(successorValue)) {
    throw new Error("A correction must preserve immutable capture lineage and context.");
  }
  const validated = validateRecorderProtocolRecord(successor);
  if (!validated) {
    throw new Error("A correction must remain valid under the pinned Field Protocol.");
  }
  return successor;
}

function valueAtPath(target: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = target;
  for (const segment of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function validateRecorderProtocolRecord(record: RecorderRecord): boolean {
  switch (record.kind) {
    case "fieldVisit":
      return validateFieldProtocolRecord("fieldVisit", record.value).success;
    case "fieldObservation":
      return validateFieldProtocolRecord("fieldObservation", record.value).success;
    case "routeRun":
      return validateFieldProtocolRecord("routeRun", record.value).success;
    case "sourceStatement":
      return validateFieldProtocolRecord("sourceStatement", record.value).success;
    case "statementTranslation":
      return validateFieldProtocolRecord("statementTranslation", record.value).success;
    case "evidenceAsset":
      return validateFieldProtocolRecord("evidenceAsset", record.value).success;
    case "captureException":
      return validateFieldProtocolRecord("captureException", record.value).success;
    case "schemaGap":
      return validateFieldProtocolRecord("schemaGap", record.value).success;
  }
}

function validateFollowUp(
  review: FieldDeskReviewInput,
  original: RecorderRecord,
): FollowUpAssignment | undefined {
  if (review.decision !== "needs_more_evidence") {
    if (review.followUp) throw new Error("Only Needs more evidence may create a follow-up.");
    return undefined;
  }
  if (["captureException", "schemaGap"].includes(original.kind)) {
    throw new Error("This record kind cannot create a follow-up assignment.");
  }
  const followUp = review.followUp;
  const value = original.value as unknown as Record<string, unknown>;
  if (
    !followUp ||
    followUp.originatingAssignmentId !== value.assignmentId ||
    (value.visitId && !followUp.originatingVisitIds.includes(String(value.visitId))) ||
    (value.coverageRequirementId &&
      !followUp.coverageRequirementIds.includes(String(value.coverageRequirementId)))
  ) {
    throw new Error(
      "Needs more evidence requires an unscheduled follow-up linked to this capture.",
    );
  }
  return followUp;
}
