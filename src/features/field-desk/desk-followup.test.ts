import { describe, expect, test } from "bun:test";

import type { RecorderRecord } from "@/features/field-recorder/field-recorder-types";
import { exampleObservation } from "@/features/field-recorder/test-fixtures";
import { canCreateDeskFollowUp, createDeskFollowUp } from "./desk-followup";

const base = {
  assignmentId: "assignment-1",
  protocolPackageId: exampleObservation.protocolPackageId,
  protocolPackageVersion: exampleObservation.protocolPackageVersion,
  campaignId: exampleObservation.campaignId,
};

describe("Desk follow-up derivation", () => {
  test("creates a governed linked follow-up for scalar visit evidence", () => {
    const record: RecorderRecord = {
      kind: "fieldObservation",
      value: {
        ...exampleObservation,
        ...base,
        visitId: "visit-1",
        coverageRequirementId: "coverage-1",
      },
    };
    expect(canCreateDeskFollowUp(record)).toBe(true);
    expect(createDeskFollowUp(record, "follow-up-1", "2026-08-23T02:00:00.000Z")).toMatchObject({
      originatingAssignmentId: "assignment-1",
      originatingVisitIds: ["visit-1"],
      coverageRequirementIds: ["coverage-1"],
      reason: "needs_resolution",
    });
  });

  test.each([
    ["fieldVisit", { ...base, objectiveIds: ["objective-1"], captureWindows: [] }],
    [
      "evidenceAsset",
      {
        ...base,
        visitId: "visit-1",
        objectiveIds: ["objective-1"],
        coverageRequirementIds: ["coverage-1"],
      },
    ],
    ["captureException", { ...base, coverageRequirementId: "coverage-1" }],
    ["schemaGap", { ...base, coverageRequirementId: "coverage-1" }],
  ] as const)("does not offer a follow-up for unsupported %s records", (kind, value) => {
    const record = { kind, value } as unknown as RecorderRecord;
    expect(canCreateDeskFollowUp(record)).toBe(false);
    expect(createDeskFollowUp(record, "id", "now")).toBeUndefined();
  });
});
