import type { FollowUpAssignment } from "@/features/field-protocol/generated";
import type { RecorderRecord } from "@/features/field-recorder/field-recorder-types";

type FollowUpFields = Readonly<{
  assignmentId: string;
  visitId: string;
  coverageRequirementId: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
}>;

function followUpFields(record: RecorderRecord): FollowUpFields | undefined {
  const value = record.value as unknown as Record<string, unknown>;
  if (
    typeof value.assignmentId !== "string" ||
    typeof value.visitId !== "string" ||
    typeof value.coverageRequirementId !== "string" ||
    typeof value.protocolPackageId !== "string" ||
    typeof value.protocolPackageVersion !== "string" ||
    typeof value.campaignId !== "string"
  ) {
    return undefined;
  }
  return {
    assignmentId: value.assignmentId,
    visitId: value.visitId,
    coverageRequirementId: value.coverageRequirementId,
    protocolPackageId: value.protocolPackageId,
    protocolPackageVersion: value.protocolPackageVersion,
    campaignId: value.campaignId,
  };
}

export function canCreateDeskFollowUp(record: RecorderRecord): boolean {
  return followUpFields(record) !== undefined;
}

export function createDeskFollowUp(
  record: RecorderRecord,
  id: string,
  createdAt: string,
): FollowUpAssignment | undefined {
  const fields = followUpFields(record);
  if (!fields) return undefined;
  return {
    schemaVersion: "follow-up-assignment.v1",
    id,
    protocolPackageId: fields.protocolPackageId,
    protocolPackageVersion: fields.protocolPackageVersion,
    campaignId: fields.campaignId,
    originatingAssignmentId: fields.assignmentId,
    originatingVisitIds: [fields.visitId],
    coverageRequirementIds: [fields.coverageRequirementId],
    createdAt,
    reason: "needs_resolution",
  };
}
