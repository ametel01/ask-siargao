import type {
  FieldDeskRecoveryAudit,
  FieldDeskReviewEntry,
} from "@/features/field-desk/desk-schemas";
import type { FollowUpAssignment } from "@/features/field-protocol/generated";
import type { RecorderRecord, RecorderWork } from "@/features/field-recorder/field-recorder-types";

export type FieldDeskWork = Readonly<{
  schemaVersion: "field-desk-work.v1";
  archiveId: string;
  revision: number;
  sourceRecorderSha256: string;
  recorderWork: RecorderWork;
  corrections: readonly RecorderRecord[];
  reviews: readonly FieldDeskReviewEntry[];
  reviewFollowUps: readonly FollowUpAssignment[];
  recoveryAudit: readonly FieldDeskRecoveryAudit[];
  createdAt: string;
  updatedAt: string;
}>;

export type FieldDeskReviewInput = Readonly<{
  id: string;
  recordId: string;
  reviewerId: string;
  reviewerMatchesResearcher: boolean;
  reviewedAt: string;
  decision: FieldDeskReviewEntry["decision"];
  reason?: string;
  supersedingRecord?: RecorderRecord;
  followUp?: FollowUpAssignment;
  conflictDisposition?: FieldDeskReviewEntry["conflictDisposition"];
}>;

export type DuplicateProposal = Readonly<{
  candidateRecordId: string;
  existingRecordId: string;
  reason: "identity_equivalent";
}>;
