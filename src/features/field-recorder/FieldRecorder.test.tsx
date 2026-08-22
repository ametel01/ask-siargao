import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

import { FieldRecorder } from "./FieldRecorder";
import { createHarnessWork, FieldRecorderShell } from "./FieldRecorderShell";
import { ObservationForm, observationKinds } from "./forms/ObservationForm";

const actions = {
  advance: () => {},
  capture: () => {},
  closeFieldDay: () => {},
  closeVisit: () => {},
  returnToObjectives: () => {},
  startVisit: () => {},
};

const runtime = {
  grantExpiresAt: "2026-08-23T18:00:00.000Z",
  location: "coarse",
  online: false,
  save: { revision: 4, savedAt: "2026-08-23T08:04:00.000Z", status: "saved" },
  storageAvailableBytes: 1_073_741_824,
  vault: "unlocked",
  waitingUpdate: true,
  writer: "active",
} as const;

describe("FieldRecorder", () => {
  test("renders the restrained evidence station, persistent rail, and deterministic sequence", () => {
    const html = renderToStaticMarkup(
      <FieldRecorderShell harness protocol={baselineFieldProtocolPackage} />,
    );

    expect(html).toContain("Island Field Desk");
    expect(html).toContain("Evidence station");
    expect(html).toContain('id="field-recorder-scroll-owner"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Station status");
    expect(html).toContain("Briefing");
    expect(html).toContain("Safety");
    expect(html).toContain("Start Visit");
    expect(html).toContain("Objectives");
    expect(html).toContain("Gaps");
    expect(html).toContain("Close Visit");
    expect(html).toContain("Outcome");
    expect(html).not.toContain("JSON");
  });

  test("announces durable, offline, location, vault, grant, update, and storage state", () => {
    const work = createHarnessWork(baselineFieldProtocolPackage);
    const html = renderToStaticMarkup(
      <FieldRecorder
        actions={actions}
        protocol={baselineFieldProtocolPackage}
        runtime={runtime}
        work={work}
      />,
    );

    expect(html).toContain("Saved durably");
    expect(html).toContain("Offline — capture continues");
    expect(html).toContain("Coarse");
    expect(html).toContain("Unlocked");
    expect(html).toContain("Waiting until Visit closes");
    expect(html).toContain("1.0 GB available");
    expect(html).toContain('role="status"');
  });

  test.each([
    ["briefing", "Assignment brief"],
    ["safety", "Stop-work authority"],
    ["start_visit", "Visit target"],
    ["objectives", "Current coverage requirement"],
    ["gaps", "Closing now creates a linked follow-up"],
    ["close_visit", "Captured records freeze at close"],
    ["outcome", "closed with gaps"],
  ] as const)("renders the %s task", (step, expected) => {
    const base = createHarnessWork(baselineFieldProtocolPackage);
    const firstCoverage = base.objectiveCoverage[0]?.requirements[0];
    const work = {
      ...base,
      step: {
        assignmentId: base.step.assignmentId,
        coverageRequirementId: firstCoverage?.coverageRequirementId,
        name: step,
        objectiveId: firstCoverage?.objectiveId,
        visitId:
          step === "briefing" || step === "safety" || step === "start_visit"
            ? undefined
            : "visit_test",
      },
    } as const;
    const html = renderToStaticMarkup(
      <FieldRecorder
        actions={actions}
        protocol={baselineFieldProtocolPackage}
        runtime={runtime}
        work={work}
      />,
    );
    expect(html).toContain(expected);
  });

  test.each([...observationKinds])("renders non-JSON typed controls for %s", (kind) => {
    const html = renderToStaticMarkup(
      <ObservationForm
        allowedKinds={[kind]}
        governedSubjects={[{ id: "subject_area_del_carmen", label: "Del Carmen" }]}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain(
      `${kind.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase())} value`,
    );
    expect(html).not.toContain("JSON");
    expect(html).not.toContain('name="unit" type="text"');
    expect(html).not.toContain('name="conditions" type="text"');
  });
});
