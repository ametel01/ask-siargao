import { describe, expect, test } from "bun:test";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type { CaptureException, FieldVisit } from "@/features/field-protocol/generated";

import {
  addSupersedingCorrection,
  advanceRecorderStep,
  captureRecorderRecord,
  closeFieldDay,
  closeRecorderVisit,
  createRecorderWork,
  deferRecorderAssignment,
  startRecorderVisit,
} from "./field-recorder-state";
import { exampleObservation, exampleVisit, recorderSnapshot } from "./test-fixtures";

const now = "2026-08-22T08:00:00+08:00";

function initialWork() {
  return createRecorderWork({ id: "recorder-work-test", now, snapshot: recorderSnapshot() });
}

function draftVisit(): FieldVisit {
  const { endedAt: _, ...visit } = exampleVisit;
  return { ...visit, captureState: "draft", recordedAt: now, startedAt: now };
}

describe("Recorder state", () => {
  test("follows Briefing, Safety, durable Visit start, Objectives, Gaps, Close, Outcome", () => {
    let work = initialWork();
    expect(work.step.name).toBe("briefing");
    work = advanceRecorderStep({ now, work });
    expect(work.step.name).toBe("safety");
    work = advanceRecorderStep({ now, safetyEligible: true, work });
    expect(work.step.name).toBe("start_visit");
    expect(() => advanceRecorderStep({ now, work })).toThrow("durable Recorder action");

    work = startRecorderVisit({
      now,
      protocol: baselineFieldProtocolPackage,
      visit: draftVisit(),
      work,
    });
    expect(work.step.name).toBe("objectives");
    expect(work.objectiveCoverageRecords.length).toBeGreaterThan(0);
    work = captureRecorderRecord({
      now: "2026-08-22T09:05:00+08:00",
      protocol: baselineFieldProtocolPackage,
      record: { kind: "fieldObservation", value: exampleObservation },
      work,
    });
    expect(
      work.objectiveCoverage
        .flatMap((entry) => entry.requirements)
        .find((entry) => entry.coverageRequirementId === "coverage_payment")?.status,
    ).toBe("satisfied");
    work = advanceRecorderStep({ now, work });
    expect(work.step.name).toBe("gaps");
    work = advanceRecorderStep({ now, work });
    expect(work.step.name).toBe("close_visit");
    work = closeRecorderVisit({
      followUpId: "0192f060-4f41-7aa1-b322-4aa9fc9f1522",
      now: "2026-08-22T10:00:00+08:00",
      outcomeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1521",
      protocol: baselineFieldProtocolPackage,
      work,
    });
    expect(work.step.name).toBe("outcome");
    expect(work.assignmentOutcomes[0]?.status).toBe("closed_with_gaps");
    expect(work.followUps[0]).toMatchObject({
      originatingVisitIds: [exampleVisit.id],
      reason: "closed_with_gaps",
    });
    const closed = work.records.find((entry) => entry.kind === "fieldVisit");
    expect(closed?.value).toMatchObject({
      captureState: "captured",
      endedAt: "2026-08-22T10:00:00+08:00",
    });

    work = closeFieldDay({
      closeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1523",
      now: "2026-08-22T18:00:00+08:00",
      protocol: baselineFieldProtocolPackage,
      work,
    });
    expect(work.fieldDayClose?.recoveryStatus).toBe("recovery_required");
    expect(() => advanceRecorderStep({ now, work })).toThrow("immutable");
  });

  test("preserves a closed Visit and appends a same-lineage correction", () => {
    let work = advanceRecorderStep({ now, work: initialWork() });
    work = advanceRecorderStep({ now, safetyEligible: true, work });
    work = startRecorderVisit({
      now,
      protocol: baselineFieldProtocolPackage,
      visit: draftVisit(),
      work,
    });
    work = captureRecorderRecord({
      now,
      protocol: baselineFieldProtocolPackage,
      record: { kind: "fieldObservation", value: exampleObservation },
      work,
    });
    work = advanceRecorderStep({ now, work });
    work = advanceRecorderStep({ now, work });
    work = closeRecorderVisit({
      followUpId: "0192f060-4f41-7aa1-b322-4aa9fc9f1522",
      now,
      outcomeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1521",
      protocol: baselineFieldProtocolPackage,
      work,
    });
    const corrected = {
      ...exampleObservation,
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1591",
      supersedesId: exampleObservation.id,
    };
    const revised = addSupersedingCorrection({
      now,
      protocol: baselineFieldProtocolPackage,
      record: { kind: "fieldObservation", value: corrected },
      supersedesId: exampleObservation.id,
      work,
    });
    expect(revised.records).toHaveLength(work.records.length + 1);
    expect(work.records.find((entry) => entry.value.id === exampleObservation.id)?.value).toEqual(
      exampleObservation,
    );
  });

  test("records a planning safety exception and defers without inventing a Visit lineage", () => {
    const base = advanceRecorderStep({ now, work: initialWork() });
    const example = baselineFieldProtocolPackage.examples.examples.captureException;
    const exception = {
      ...example,
      assignmentId: base.step.assignmentId,
      coverageRequirementId: base.assignments[0]?.unresolvedRequirementIds[0],
      objectiveId: baselineFieldProtocolPackage.campaign.assignments.find(
        (entry) => entry.id === base.step.assignmentId,
      )?.coverageRequirements[0]?.objectiveId,
    } as CaptureException;
    const deferred = deferRecorderAssignment({
      exception,
      now,
      outcomeId: "0192f060-4f41-7aa1-b322-4aa9fc9f1521",
      protocol: baselineFieldProtocolPackage,
      work: base,
    });
    expect(deferred.assignmentOutcomes[0]).toMatchObject({
      followUpAssignmentIds: [],
      status: "deferred",
      visitIds: [],
    });
    expect(deferred.records[0]).toMatchObject({
      kind: "captureException",
      value: { context: "planning" },
    });
  });
});
