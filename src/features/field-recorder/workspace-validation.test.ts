import { describe, expect, test } from "bun:test";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

import { exampleObservation, exampleVisit } from "./test-fixtures";
import { validateRecorderWorkspace } from "./workspace-validation";

const base = {
  applicationVersion: "0.1.0",
  installedBundles: [baselineFieldProtocolPackage],
  protocol: baselineFieldProtocolPackage,
  protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
  protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
} as const;

describe("Recorder cross-record validation", () => {
  test("accepts a captured record with exact pinned Visit and window lineage", async () => {
    const result = await validateRecorderWorkspace({
      ...base,
      records: [
        { kind: "fieldVisit", value: exampleVisit },
        { kind: "fieldObservation", value: exampleObservation },
      ],
    });
    expect(result).toEqual({ issues: [], success: true });
  });

  test("fails closed for missing Visits, invented windows, and contradiction targets", async () => {
    const result = await validateRecorderWorkspace({
      ...base,
      records: [
        {
          kind: "fieldObservation",
          value: {
            ...exampleObservation,
            captureWindowIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1599"] as [string],
            contradictsObservationIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1598"],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_visit", "invalid_contradiction_link"]),
    );
  });

  test("rejects supersession forks and changed lineage", async () => {
    const correction = {
      ...exampleObservation,
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1591",
      supersedesId: exampleObservation.id,
    };
    const result = await validateRecorderWorkspace({
      ...base,
      records: [
        { kind: "fieldVisit", value: exampleVisit },
        { kind: "fieldObservation", value: exampleObservation },
        { kind: "fieldObservation", value: correction },
        {
          kind: "fieldObservation",
          value: {
            ...correction,
            assignmentId: "assignment_airport_arrival",
            id: "0192f060-4f41-7aa1-b322-4aa9fc9f1592",
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["supersession_fork", "supersession_lineage_mismatch"]),
    );
  });

  test("requires the exact installed trusted package", async () => {
    const result = await validateRecorderWorkspace({
      ...base,
      installedBundles: [],
      records: [],
    });
    expect(result).toEqual({
      issues: [
        {
          code: "pinned_protocol_unavailable",
          message: "The pinned Capture Protocol Package is not installed or trusted.",
        },
      ],
      success: false,
    });
  });
});
