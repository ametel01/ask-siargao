import { z } from "zod";

export const FIELD_DESK_ARCHIVE_VERSION = "field-desk-archive.v1" as const;
export const FIELD_DESK_REVIEW_VERSION = "field-desk-review-audit.v1" as const;
export const FIELD_DESK_RECOVERY_AUDIT_VERSION = "field-desk-recovery-audit.v1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();

export const deskReviewDecisionSchema = z.enum([
  "include",
  "exclude",
  "needs_more_evidence",
  "correct_by_supersession",
]);

export const fieldDeskReviewEntrySchema = z
  .strictObject({
    schemaVersion: z.literal(FIELD_DESK_REVIEW_VERSION),
    id: uuidSchema,
    protocolPackageId: z.string().regex(/^field-protocol-[a-z0-9-]+$/u),
    protocolPackageVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    recordId: uuidSchema,
    recordKind: z.string().min(1).max(80),
    reviewerId: z.string().min(1).max(200),
    researcherId: z.string().min(1).max(200),
    reviewerMatchesResearcher: z.boolean(),
    reviewedAt: instantSchema,
    decision: deskReviewDecisionSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    supersedingRecordId: uuidSchema.optional(),
    followUpAssignmentId: uuidSchema.optional(),
    previousReviewId: uuidSchema.optional(),
    conflictDisposition: z
      .enum(["not_applicable", "resolved", "intentional_repetition", "unresolved"])
      .default("not_applicable"),
    entrySha256: sha256Schema,
  })
  .superRefine((entry, context) => {
    const reasonRequired = entry.decision === "exclude" || entry.decision === "needs_more_evidence";
    if (reasonRequired !== Boolean(entry.reason)) {
      context.addIssue({
        code: "custom",
        message: reasonRequired
          ? "This review decision requires a reason."
          : "Only Exclude and Needs more evidence accept a reason.",
        path: ["reason"],
      });
    }
    if ((entry.decision === "correct_by_supersession") !== Boolean(entry.supersedingRecordId)) {
      context.addIssue({
        code: "custom",
        message: "Correct by supersession requires exactly one successor record.",
        path: ["supersedingRecordId"],
      });
    }
    if ((entry.decision === "needs_more_evidence") !== Boolean(entry.followUpAssignmentId)) {
      context.addIssue({
        code: "custom",
        message: "Needs more evidence requires exactly one linked Follow-up Assignment.",
        path: ["followUpAssignmentId"],
      });
    }
    if (entry.reviewerMatchesResearcher !== (entry.reviewerId === entry.researcherId)) {
      context.addIssue({
        code: "custom",
        message: "Reviewer independence disclosure must match the recorded identities.",
        path: ["reviewerMatchesResearcher"],
      });
    }
  });

export const fieldDeskRecoveryAuditSchema = z.strictObject({
  schemaVersion: z.literal(FIELD_DESK_RECOVERY_AUDIT_VERSION),
  id: uuidSchema,
  archiveId: uuidSchema,
  artifactId: uuidSchema,
  operation: z.enum(["created", "locally_reopened", "destination_verified", "source_verified"]),
  occurredAt: instantSchema,
  ciphertextSha256: sha256Schema,
  previousAuditId: uuidSchema.optional(),
});

export const fieldDeskArchiveHeaderSchema = z.strictObject({
  schemaVersion: z.literal(FIELD_DESK_ARCHIVE_VERSION),
  archiveId: uuidSchema,
  recorderWorkId: uuidSchema,
  recorderOpaqueRecordKey: z.string().regex(/^field_record_[A-Za-z0-9_-]{16,}$/u),
  sourceRecorderSha256: sha256Schema,
  handedOffAt: instantSchema,
  protocolPackageId: z.string().regex(/^field-protocol-[a-z0-9-]+$/u),
  protocolPackageVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  latestRevision: z.number().int().positive(),
  latestEnvelopeKey: z.string().regex(/^field_record_[A-Za-z0-9_-]{16,}$/u),
});

export type DeskReviewDecision = z.infer<typeof deskReviewDecisionSchema>;
export type FieldDeskReviewEntry = z.infer<typeof fieldDeskReviewEntrySchema>;
export type FieldDeskArchiveHeader = z.infer<typeof fieldDeskArchiveHeaderSchema>;
export type FieldDeskRecoveryAudit = z.infer<typeof fieldDeskRecoveryAuditSchema>;
