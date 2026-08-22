"use client";

import { useEffect, useRef, useState } from "react";
import { FieldPlanExplanation, formatConsequences } from "./FieldPlanExplanation";
import { applyFieldPlanAdjustment } from "./field-plan-adjustments";
import { proposeFieldDayPlan } from "./field-planner";
import type {
  FieldCoverageSnapshot,
  FieldPlanProposal,
  PlannerInputs,
  PlannerProtocol,
} from "./field-planning-types";

export function FieldDayPlanner({
  protocol,
  coverageSnapshot,
  initialInputs,
}: {
  protocol: PlannerProtocol;
  coverageSnapshot: FieldCoverageSnapshot;
  initialInputs: PlannerInputs;
}) {
  const plannerRoot = useRef<HTMLDivElement>(null);
  const [inputs, setInputs] = useState(initialInputs);
  const [proposal, setProposal] = useState<FieldPlanProposal>(() =>
    proposeFieldDayPlan(protocol, coverageSnapshot, initialInputs),
  );
  const [status, setStatus] = useState("Proposal generated from the verified offline package.");
  const [error, setError] = useState("");

  useEffect(() => {
    plannerRoot.current?.setAttribute("data-field-planner-ready", "true");
  }, []);

  function generate() {
    setError("");
    setProposal(proposeFieldDayPlan(protocol, coverageSnapshot, inputs));
    setStatus("Proposal regenerated. Review selection and coverage consequences.");
  }

  function adjust(
    adjustment: Parameters<typeof applyFieldPlanAdjustment>[4],
    button: HTMLButtonElement,
  ) {
    const focusKey = button.dataset.focusKey;
    try {
      const result = applyFieldPlanAdjustment(
        protocol,
        coverageSnapshot,
        inputs,
        proposal,
        adjustment,
      );
      setProposal(result.proposal);
      setError("");
      setStatus(
        `${adjustment.kind} accepted. Coverage consequence: ${formatConsequences(result.coverageImpact)}.`,
      );
      retainAdjustmentFocus(focusKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adjustment rejected by hard gates.");
      retainAdjustmentFocus(focusKey);
    }
  }

  return (
    <div
      ref={plannerRoot}
      className="min-h-screen bg-[var(--surface-soft)] px-4 py-8 sm:px-8"
      data-field-planner-ready="false"
    >
      <main className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-2xl bg-[var(--brand-navy-950)] p-6 text-[var(--text-on-dark)] shadow-[var(--shadow-panel)]">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--brand-lagoon-300)]">
            Field Workspace · Offline package ready
          </p>
          <h1 className="mt-2 text-4xl font-semibold">Build a Field Day Plan</h1>
          <p className="mt-3 max-w-3xl text-[var(--text-on-dark-muted)]">
            Group unscheduled Field Assignments with hard safety gates, conservative travel, and a
            protected return margin. No map, live routing, date assignment, or LLM is used.
          </p>
        </header>

        <section
          aria-labelledby="planner-inputs-title"
          className="rounded-2xl bg-[var(--surface-default)] p-6 text-[var(--text-default)] shadow-[var(--shadow-panel)]"
        >
          <h2
            id="planner-inputs-title"
            className="text-2xl font-semibold text-[var(--text-strong)]"
          >
            Outing constraints
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="font-semibold">Travel context</legend>
              <label className="block">
                <span className="block text-sm font-medium">Starting area</span>
                <select
                  aria-describedby="start-area-help"
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-white p-2"
                  value={inputs.startingAreaId}
                  onChange={(event) => setInputs({ ...inputs, startingAreaId: event.target.value })}
                >
                  {protocol.areas.map((area) => (
                    <option key={area} value={area}>
                      {area.replace("area_", "").replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <p id="start-area-help" className="text-sm text-[var(--text-muted)]">
                Governed area only. Precise location is not required.
              </p>
              <label className="block">
                <span className="block text-sm font-medium">Transport mode</span>
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-white p-2"
                  value={inputs.transportMode}
                  onChange={(event) => setInputs({ ...inputs, transportMode: event.target.value })}
                >
                  {protocol.transportModes.map((mode) => (
                    <option key={mode}>{mode}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="font-semibold">Capacity and protected margins</legend>
              <NumberInput
                label="Available minutes"
                value={inputs.availableMinutes}
                onChange={(availableMinutes) => setInputs({ ...inputs, availableMinutes })}
              />
              {(["safety", "documentation", "rest", "daylight"] as const).map((kind) => (
                <NumberInput
                  key={kind}
                  label={`${kind[0]?.toUpperCase()}${kind.slice(1)} reserve minutes`}
                  value={inputs.reserveMinutes[kind]}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      reserveMinutes: { ...inputs.reserveMinutes, [kind]: value },
                    })
                  }
                />
              ))}
            </fieldset>
          </div>
          <button
            className="mt-6 rounded-lg bg-[var(--brand-lagoon-700)] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
            type="button"
            onClick={generate}
          >
            Generate deterministic proposal
          </button>
          <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-lagoon-700)]">
            {status}
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-[var(--risk-high-soft)] p-3 text-[var(--risk-high-foreground)]"
            >
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl bg-[var(--surface-default)] p-6 shadow-[var(--shadow-panel)]">
          <FieldPlanExplanation proposal={proposal} />
          <section aria-labelledby="plan-adjustments-title" className="mt-6 space-y-3">
            <h2
              id="plan-adjustments-title"
              className="text-2xl font-semibold text-[var(--text-strong)]"
            >
              Researcher adjustments
            </h2>
            {proposal.selected.map((assignment, index) => (
              <div className="flex flex-wrap gap-2" key={assignment.assignmentId}>
                <button
                  type="button"
                  data-focus-key={`move-earlier-${assignment.assignmentId}`}
                  disabled={index === 0}
                  aria-describedby={`consequence-${assignment.assignmentId}`}
                  onClick={(event) =>
                    adjust(
                      { kind: "move", assignmentId: assignment.assignmentId, direction: "earlier" },
                      event.currentTarget,
                    )
                  }
                >
                  Move {assignment.title} earlier
                </button>
                <button
                  type="button"
                  data-focus-key={`move-later-${assignment.assignmentId}`}
                  disabled={index === proposal.selected.length - 1}
                  aria-describedby={`consequence-${assignment.assignmentId}`}
                  onClick={(event) =>
                    adjust(
                      { kind: "move", assignmentId: assignment.assignmentId, direction: "later" },
                      event.currentTarget,
                    )
                  }
                >
                  Move {assignment.title} later
                </button>
                <button
                  type="button"
                  data-focus-key={`remove-${assignment.assignmentId}`}
                  aria-describedby={`consequence-${assignment.assignmentId}`}
                  onClick={(event) =>
                    adjust(
                      { kind: "remove", assignmentId: assignment.assignmentId },
                      event.currentTarget,
                    )
                  }
                >
                  Remove {assignment.title}
                </button>
              </div>
            ))}
            {proposal.exclusions.slice(0, 4).map((exclusion) => (
              <button
                type="button"
                data-focus-key={`add-${exclusion.assignmentId}`}
                key={`add-${exclusion.assignmentId}`}
                onClick={(event) =>
                  adjust({ kind: "add", assignmentId: exclusion.assignmentId }, event.currentTarget)
                }
              >
                Add {exclusion.assignmentId}
              </button>
            ))}
          </section>
        </section>
      </main>
    </div>
  );
}

function retainAdjustmentFocus(focusKey: string | undefined) {
  if (!focusKey) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  });
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-white p-2"
        min="0"
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
