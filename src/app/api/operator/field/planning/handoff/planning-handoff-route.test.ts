import { describe, expect, test } from "bun:test";

import { createPlannerFixture } from "@/features/field-planning/fixtures/planner-fixtures";
import { loadPlannerProtocol } from "@/features/field-planning/load-planner-protocol";
import { getFieldPlanningHandoffResponse } from "./planning-handoff-route";

describe("Field Planner initial handoff route", () => {
  test("serves only a configured protocol-pinned handoff to an allowlisted researcher", async () => {
    const protocol = await loadPlannerProtocol();
    const fixture = createPlannerFixture(protocol);
    const now = new Date().toISOString();
    const handoff = {
      version: 1 as const,
      handoffId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
      handedOffAt: now,
      source: { kind: "approved_local_handoff" as const, id: "field_readiness_preseeded_20260823" },
      protocolPackageId: protocol.packageId,
      protocolPackageVersion: protocol.packageVersion,
      coverageSnapshot: fixture.coverageSnapshot,
      inputs: {
        ...fixture.inputs,
        assignmentGates: fixture.inputs.assignmentGates.map((gate) => ({
          ...gate,
          sourceId: "field-readiness-authority",
          fingerprint: `authority-${gate.assignmentId}`,
        })),
        eligibilityEvidence: fixture.inputs.eligibilityEvidence.map((evidence) => ({
          ...evidence,
          sourceId: "field-preflight-authority",
          fingerprint: `authority-${evidence.assignmentId}-${evidence.kind}`,
        })),
      },
    };
    const response = await getFieldPlanningHandoffResponse(
      new Request("https://asksiargao.com/api/operator/field/planning/handoff"),
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: false }),
        initialHandoff: () => JSON.stringify(handoff),
        protocol,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handoff: { handoffId: handoff.handoffId } });
  });

  test("fails closed when the deployment has no pre-seeded handoff", async () => {
    const protocol = await loadPlannerProtocol();
    const response = await getFieldPlanningHandoffResponse(
      new Request("https://asksiargao.com/api/operator/field/planning/handoff"),
      {
        allowlist: new Set(["researcher"]),
        auth: async () => ({ accountId: "researcher", mfaFresh: false }),
        initialHandoff: () => undefined,
        protocol,
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "field_planning_handoff_unconfigured" });
  });
});
