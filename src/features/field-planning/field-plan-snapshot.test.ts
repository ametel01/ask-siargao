import { describe, expect, test } from "bun:test";
import { confirmFieldPlanSnapshot } from "./field-plan-snapshot";
import { proposeFieldDayPlan } from "./field-planner";
import { createTestPlannerFixture } from "./fixtures/test-fixtures";

describe("immutable Field Plan Snapshots", () => {
  test("hashes explicit confirmation context and preserves the prior revision", async () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
    );
    const original = await confirmFieldPlanSnapshot({
      protocol: fixture.protocol,
      coverageSnapshot: fixture.coverageSnapshot,
      plannerInputs: fixture.inputs,
      proposal,
      metadata: {
        snapshotId: "plan-snapshot-1",
        confirmedAt: "2026-08-23T08:05:00.000Z",
        researcherId: "researcher-1",
        deviceId: "device-1",
        revisionReason: "initial confirmation",
      },
    });
    const originalBytes = JSON.stringify(original);
    const revisedInputs = {
      ...fixture.inputs,
      eligibilityEvidence: fixture.inputs.eligibilityEvidence.map((entry) =>
        entry.assignmentId === "assignment_a"
          ? { ...entry, fingerprint: "eligibility-assignment-a-v2" }
          : entry,
      ),
    };
    const revision = await confirmFieldPlanSnapshot({
      protocol: fixture.protocol,
      coverageSnapshot: fixture.coverageSnapshot,
      plannerInputs: revisedInputs,
      proposal: proposeFieldDayPlan(fixture.protocol, fixture.coverageSnapshot, revisedInputs),
      priorSnapshot: original,
      metadata: {
        snapshotId: "plan-snapshot-2",
        confirmedAt: "2026-08-23T08:10:00.000Z",
        researcherId: "researcher-1",
        deviceId: "device-1",
        revisionReason: "preflight evidence changed",
      },
    });

    expect(original.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(Object.isFrozen(original)).toBe(true);
    expect(revision.revision).toBe(2);
    expect(revision.priorSnapshotId).toBe(original.snapshotId);
    expect(revision.priorContentHash).toBe(original.contentHash);
    expect(revision.invalidatedEvidenceIds).toEqual(["eligibility-assignment_a"]);
  });

  test("requires explicit time and a new revision identity", async () => {
    const fixture = createTestPlannerFixture();
    const proposal = proposeFieldDayPlan(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
    );
    await expect(
      confirmFieldPlanSnapshot({
        protocol: fixture.protocol,
        coverageSnapshot: fixture.coverageSnapshot,
        plannerInputs: fixture.inputs,
        proposal,
        metadata: {
          snapshotId: "snapshot",
          confirmedAt: "not-a-date",
          researcherId: "researcher",
          deviceId: "device",
          revisionReason: "invalid",
        },
      }),
    ).rejects.toThrow("explicit timestamp");
  });

  test("forces changed or stale preflight through hard-gate re-evaluation", async () => {
    const fixture = createTestPlannerFixture();
    const oldProposal = proposeFieldDayPlan(
      fixture.protocol,
      fixture.coverageSnapshot,
      fixture.inputs,
    );
    const staleInputs = {
      ...fixture.inputs,
      eligibilityEvidence: fixture.inputs.eligibilityEvidence.map((entry) =>
        entry.assignmentId === "assignment_a"
          ? { ...entry, validUntil: "2026-08-23T07:59:00.000Z" }
          : entry,
      ),
    };

    await expect(
      confirmFieldPlanSnapshot({
        protocol: fixture.protocol,
        coverageSnapshot: fixture.coverageSnapshot,
        plannerInputs: staleInputs,
        proposal: oldProposal,
        metadata: {
          snapshotId: "snapshot-stale",
          confirmedAt: "2026-08-23T08:05:00.000Z",
          researcherId: "researcher",
          deviceId: "device",
          revisionReason: "preflight expired",
        },
      }),
    ).rejects.toThrow("does not match current hard-gated planning inputs");
  });
});
