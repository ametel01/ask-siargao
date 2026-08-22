import type { FieldPlanSnapshot } from "@/features/field-planning/field-planning-types";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type { FieldObservation, FieldVisit } from "@/features/field-protocol/generated";

export const exampleVisit = structuredClone(
  baselineFieldProtocolPackage.examples.examples.fieldVisit,
) as unknown as FieldVisit;

export const exampleObservation = structuredClone(
  baselineFieldProtocolPackage.examples.examples.fieldObservation,
) as unknown as FieldObservation;

export function recorderSnapshot(
  assignmentId = "assignment_del_carmen_essentials",
): FieldPlanSnapshot {
  const assignment = baselineFieldProtocolPackage.campaign.assignments.find(
    (candidate) => candidate.id === assignmentId,
  );
  if (!assignment) throw new Error(`Unknown test Assignment ${assignmentId}`);
  const areaId = "areaId" in assignment.geography ? assignment.geography.areaId : "area_del_carmen";
  const anchorAreaId =
    "anchorAreaId" in assignment.geography ? assignment.geography.anchorAreaId : areaId;
  return {
    adjustments: [],
    confirmedAt: "2026-08-22T08:00:00+08:00",
    contentHash: "0".repeat(64),
    coverageSnapshot: {
      capturedAt: "2026-08-22T07:55:00+08:00",
      id: "coverage-test",
      protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
      protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
      requirementStates: [],
      resolvedAssignmentAreaIds: { [assignmentId]: areaId },
      version: "1",
    },
    deviceId: "device_example",
    inputs: {
      assignmentGates: [],
      availableMinutes: 240,
      eligibilityEvidence: [],
      planningAt: "2026-08-22T08:00:00+08:00",
      reserveMinutes: { daylight: 10, documentation: 10, rest: 10, safety: 10 },
      startingAreaId: anchorAreaId,
      transportMode: "motorbike",
    },
    invalidatedEvidenceIds: [],
    proposal: {
      availableMinutes: 240,
      consumedMinutes: assignment.estimatedMinutes,
      coverageSnapshotId: "coverage-test",
      exclusions: [],
      plannedReturnMinutes: 10,
      protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
      protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
      remainingMinutes: 240 - assignment.estimatedMinutes - 50,
      reserveMinutes: 40,
      selected: [
        {
          areaId,
          assignmentId,
          consequences: assignment.coverageRequirements.map((requirement) => ({
            coverageRequirementId: requirement.id,
            remainingDistinctWindows: requirement.repetition.minimumDistinctWindows,
            remainingRecords: requirement.minimumRecords,
          })),
          outstandingRequiredCoverage: assignment.coverageRequirements.length,
          reasons: [],
          returnToStartMinutes: 10,
          title: assignment.title,
          travelFromPreviousMinutes: 0,
          workMinutes: assignment.estimatedMinutes,
        },
      ],
      usableMinutes: 200,
    },
    protocol: {
      campaignId: baselineFieldProtocolPackage.campaign.campaignId,
      campaignVersion: baselineFieldProtocolPackage.campaign.componentVersion,
      geographyVersion: baselineFieldProtocolPackage.geography.componentVersion,
      packageId: baselineFieldProtocolPackage.manifest.packageId,
      packageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
    },
    researcherId: "researcher_example",
    revision: 1,
    revisionReason: "test",
    schemaVersion: "field-plan-snapshot.v1",
    snapshotId: "0192f060-4f41-7aa1-b322-4aa9fc9f1524",
  };
}
