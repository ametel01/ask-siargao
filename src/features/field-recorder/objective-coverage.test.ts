import { describe, expect, test } from "bun:test";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

import type { RecorderRecord } from "./field-recorder-types";
import { deriveAssignmentCoverage, deterministicNextRequirement } from "./objective-coverage";
import { exampleObservation, exampleVisit } from "./test-fixtures";

const visitRecord = { kind: "fieldVisit", value: exampleVisit } as const;

function requirement(records: readonly RecorderRecord[], id: string) {
  return deriveAssignmentCoverage({
    assignmentId: "assignment_del_carmen_essentials",
    protocol: baselineFieldProtocolPackage,
    records,
  })
    .flatMap((objective) => objective.requirements)
    .find((candidate) => candidate.coverageRequirementId === id);
}

describe("Recorder objective coverage", () => {
  test("derives captured IDs and protocol-governed window identity", () => {
    const result = requirement(
      [visitRecord, { kind: "fieldObservation", value: exampleObservation }],
      "coverage_payment",
    );
    expect(result).toMatchObject({
      capturedRecordIds: [exampleObservation.id],
      distinctWindowIds: [exampleObservation.captureWindowIds[0]],
      status: "satisfied",
    });
  });

  test("counts negative evidence while unknown evidence needs resolution", () => {
    const openingBase = {
      ...exampleObservation,
      coverageRequirementId: "coverage_opening",
      directness: "direct_observation" as const,
      methodProfileId: "method_structured_visual_check@1.0.0" as const,
      objectiveId: "objective_del_carmen_observe_services",
      observationKind: "opening_signal" as const,
      value: {
        basis: "observed" as const,
        postedHoursSeparatelyEvidenced: false,
        state: "closed" as const,
      },
      valueSchemaVersion: "1.0.0" as const,
    };
    expect(
      requirement(
        [visitRecord, { kind: "fieldObservation", value: openingBase }],
        "coverage_opening",
      )?.status,
    ).toBe("satisfied");
    expect(
      requirement(
        [
          visitRecord,
          {
            kind: "fieldObservation",
            value: {
              ...openingBase,
              id: "0192f060-4f41-7aa1-b322-4aa9fc9f1590",
              value: { ...openingBase.value, state: "unknown" },
            },
          },
        ],
        "coverage_opening",
      ),
    ).toMatchObject({
      reasonCodes: expect.arrayContaining(["unknown_or_not_tested"]),
      status: "needs_resolution",
    });
  });

  test("rejects invented or duplicate capture windows and ignores superseded records", () => {
    const invalid = {
      ...exampleObservation,
      captureWindowIds: ["invented-window"] as [string],
    };
    expect(
      requirement([visitRecord, { kind: "fieldObservation", value: invalid }], "coverage_payment"),
    ).toMatchObject({
      reasonCodes: expect.arrayContaining(["invalid_capture_window_link"]),
      status: "needs_resolution",
    });

    const replacement = {
      ...exampleObservation,
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1591",
      supersedesId: exampleObservation.id,
    };
    expect(
      requirement(
        [
          visitRecord,
          { kind: "fieldObservation", value: exampleObservation },
          { kind: "fieldObservation", value: replacement },
        ],
        "coverage_payment",
      )?.capturedRecordIds,
    ).toEqual(["0192f060-4f41-7aa1-b322-4aa9fc9f1591"]);
  });

  test("keeps unselected partial coverage outstanding and chooses the same next objective", () => {
    const coverage = deriveAssignmentCoverage({
      assignmentId: "assignment_del_carmen_essentials",
      protocol: baselineFieldProtocolPackage,
      records: [visitRecord],
      selectedPartialCoverageSetId: "partial_del_carmen_practical",
    });
    expect(
      coverage
        .flatMap((entry) => entry.requirements)
        .some((entry) => entry.reasonCodes.includes("outside_partial_coverage_set")),
    ).toBe(true);
    expect(deterministicNextRequirement(coverage)).toEqual(deterministicNextRequirement(coverage));
  });
});
