"use client";

import { useEffect, useRef, useState } from "react";
import { FieldPlanExplanation, formatConsequences } from "./FieldPlanExplanation";
import { applyFieldPlanAdjustment } from "./field-plan-adjustments";
import { confirmFieldPlanSnapshotAndHandoff } from "./field-plan-snapshot";
import { proposeFieldDayPlan } from "./field-planner";
import type {
  FieldCoverageSnapshot,
  FieldPlanAdjustment,
  FieldPlanProposal,
  FieldPlanSnapshot,
  PlannerInputs,
  PlannerProtocol,
} from "./field-planning-types";

export type FieldDayPlannerConfirmationIdentity = Readonly<{
  researcherId: string;
  deviceId: string;
}>;

type ConfirmationState =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "saving" }>
  | Readonly<{ phase: "saved"; snapshot: FieldPlanSnapshot }>
  | Readonly<{ phase: "failed" }>;

type PlannerFeedback = Readonly<{
  status: string;
  error: string;
}>;

export function FieldDayPlanner({
  protocol,
  coverageSnapshot,
  initialInputs,
  confirmationIdentity,
  onConfirm,
}: Readonly<{
  protocol: PlannerProtocol;
  coverageSnapshot: FieldCoverageSnapshot;
  initialInputs: PlannerInputs;
  confirmationIdentity?: FieldDayPlannerConfirmationIdentity;
  onConfirm?: (snapshot: FieldPlanSnapshot) => Promise<void>;
}>) {
  const plannerRoot = useRef<HTMLDivElement>(null);
  const confirmationResult = useRef<HTMLDivElement>(null);
  const confirmationError = useRef<HTMLDivElement>(null);
  const adjustments = useRef<readonly FieldPlanAdjustment[]>([]);
  const [inputs, setInputs] = useState(initialInputs);
  const [proposal, setProposal] = useState<FieldPlanProposal>(() =>
    proposeFieldDayPlan(protocol, coverageSnapshot, initialInputs),
  );
  const [proposalIsCurrent, setProposalIsCurrent] = useState(true);
  const [confirmation, setConfirmation] = useState<ConfirmationState>({ phase: "idle" });
  const [feedback, setFeedback] = useState<PlannerFeedback>({
    status: "Proposal generated from the verified offline package.",
    error: "",
  });

  useEffect(() => {
    plannerRoot.current?.setAttribute("data-field-planner-ready", "true");
  }, []);

  function generate() {
    setProposal(proposeFieldDayPlan(protocol, coverageSnapshot, inputs));
    adjustments.current = [];
    setProposalIsCurrent(true);
    setConfirmation({ phase: "idle" });
    setFeedback({
      status: "Proposal regenerated. Review selection and coverage consequences.",
      error: "",
    });
  }

  function updateInputs(nextInputs: PlannerInputs) {
    setInputs(nextInputs);
    setProposalIsCurrent(false);
    setConfirmation({ phase: "idle" });
    setFeedback({
      status: "Outing constraints changed. Regenerate the proposal before confirmation.",
      error: "",
    });
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
      adjustments.current = [...adjustments.current, result.adjustment];
      setConfirmation({ phase: "idle" });
      setFeedback({
        status: `${adjustment.kind} accepted. Coverage consequence: ${formatConsequences(result.coverageImpact)}.`,
        error: "",
      });
      retainAdjustmentFocus(focusKey);
    } catch (caught) {
      setFeedback((current) => ({
        ...current,
        error: caught instanceof Error ? caught.message : "Adjustment rejected by hard gates.",
      }));
      retainAdjustmentFocus(focusKey);
    }
  }

  async function confirmPlan() {
    if (!confirmationIdentity || !onConfirm || !proposalIsCurrent) return;
    setConfirmation({ phase: "saving" });
    setFeedback({
      status: "Saving the confirmed plan to protected offline storage.",
      error: "",
    });

    try {
      const snapshot = await confirmFieldPlanSnapshotAndHandoff(
        {
          protocol,
          coverageSnapshot,
          plannerInputs: inputs,
          proposal,
          adjustments: adjustments.current,
          metadata: {
            snapshotId: `field-plan-${crypto.randomUUID()}`,
            confirmedAt: new Date().toISOString(),
            researcherId: confirmationIdentity.researcherId,
            deviceId: confirmationIdentity.deviceId,
            revisionReason: "Confirmed current adjusted Field Day Plan.",
          },
        },
        onConfirm,
      );
      setConfirmation({ phase: "saved", snapshot });
      setFeedback({
        status: "Plan saved. The Recorder can now start from this confirmed snapshot.",
        error: "",
      });
      focusAfterRender(confirmationResult);
    } catch {
      setConfirmation({ phase: "failed" });
      setFeedback({
        status: "Plan not saved. Your reviewed proposal remains available.",
        error: "",
      });
      focusAfterRender(confirmationError);
    }
  }

  const confirmationAvailable = Boolean(confirmationIdentity && onConfirm);
  const confirmationBusy = confirmation.phase === "saving";
  const confirmationDisabled =
    !confirmationAvailable ||
    !proposalIsCurrent ||
    proposal.selected.length === 0 ||
    confirmationBusy ||
    confirmation.phase === "saved";

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

        <PlannerInputsSection
          busy={confirmationBusy}
          feedback={feedback}
          inputs={inputs}
          protocol={protocol}
          onChange={updateInputs}
          onGenerate={generate}
        />

        <section className="rounded-2xl bg-[var(--surface-default)] p-6 shadow-[var(--shadow-panel)]">
          <FieldPlanExplanation proposal={proposal} />
          <PlanAdjustmentControls busy={confirmationBusy} proposal={proposal} onAdjust={adjust} />
          <PlanConfirmationControls
            available={confirmationAvailable}
            busy={confirmationBusy}
            confirmation={confirmation}
            disabled={confirmationDisabled}
            errorRef={confirmationError}
            proposalIsCurrent={proposalIsCurrent}
            resultRef={confirmationResult}
            onConfirm={confirmPlan}
          />
        </section>
      </main>
    </div>
  );
}

function PlannerInputsSection({
  busy,
  feedback,
  inputs,
  protocol,
  onChange,
  onGenerate,
}: {
  busy: boolean;
  feedback: PlannerFeedback;
  inputs: PlannerInputs;
  protocol: PlannerProtocol;
  onChange: (inputs: PlannerInputs) => void;
  onGenerate: () => void;
}) {
  return (
    <section
      aria-labelledby="planner-inputs-title"
      className="rounded-2xl bg-[var(--surface-default)] p-6 text-[var(--text-default)] shadow-[var(--shadow-panel)]"
    >
      <h2 id="planner-inputs-title" className="text-2xl font-semibold text-[var(--text-strong)]">
        Outing constraints
      </h2>
      <fieldset disabled={busy} className="mt-5 grid gap-5 md:grid-cols-2">
        <legend className="sr-only">Editable outing constraints</legend>
        <fieldset className="space-y-3">
          <legend className="font-semibold">Travel context</legend>
          <label className="block">
            <span className="block text-sm font-medium">Starting area</span>
            <select
              aria-describedby="start-area-help"
              className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-white p-2"
              value={inputs.startingAreaId}
              onChange={(event) => onChange({ ...inputs, startingAreaId: event.target.value })}
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
              onChange={(event) => onChange({ ...inputs, transportMode: event.target.value })}
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
            onChange={(availableMinutes) => onChange({ ...inputs, availableMinutes })}
          />
          {(["safety", "documentation", "rest", "daylight"] as const).map((kind) => (
            <NumberInput
              key={kind}
              label={`${kind[0]?.toUpperCase()}${kind.slice(1)} reserve minutes`}
              value={inputs.reserveMinutes[kind]}
              onChange={(value) =>
                onChange({
                  ...inputs,
                  reserveMinutes: { ...inputs.reserveMinutes, [kind]: value },
                })
              }
            />
          ))}
        </fieldset>
      </fieldset>
      <button
        className="mt-6 rounded-lg bg-[var(--brand-lagoon-700)] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        disabled={busy}
        type="button"
        onClick={onGenerate}
      >
        Generate deterministic proposal
      </button>
      <p role="status" className="mt-3 text-sm font-medium text-[var(--brand-lagoon-700)]">
        {feedback.status}
      </p>
      {feedback.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-[var(--risk-high-soft)] p-3 text-[var(--risk-high-foreground)]"
        >
          {feedback.error}
        </p>
      ) : null}
    </section>
  );
}

function PlanAdjustmentControls({
  busy,
  proposal,
  onAdjust,
}: {
  busy: boolean;
  proposal: FieldPlanProposal;
  onAdjust: (adjustment: FieldPlanAdjustment, button: HTMLButtonElement) => void;
}) {
  return (
    <section aria-labelledby="plan-adjustments-title" className="mt-6 space-y-3">
      <h2 id="plan-adjustments-title" className="text-2xl font-semibold text-[var(--text-strong)]">
        Researcher adjustments
      </h2>
      {proposal.selected.map((assignment, index) => (
        <div className="flex flex-wrap gap-2" key={assignment.assignmentId}>
          <button
            type="button"
            data-focus-key={`move-earlier-${assignment.assignmentId}`}
            disabled={busy || index === 0}
            aria-describedby={`consequence-${assignment.assignmentId}`}
            onClick={(event) =>
              onAdjust(
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
            disabled={busy || index === proposal.selected.length - 1}
            aria-describedby={`consequence-${assignment.assignmentId}`}
            onClick={(event) =>
              onAdjust(
                { kind: "move", assignmentId: assignment.assignmentId, direction: "later" },
                event.currentTarget,
              )
            }
          >
            Move {assignment.title} later
          </button>
          <button
            type="button"
            disabled={busy}
            data-focus-key={`remove-${assignment.assignmentId}`}
            aria-describedby={`consequence-${assignment.assignmentId}`}
            onClick={(event) =>
              onAdjust(
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
          disabled={busy}
          data-focus-key={`add-${exclusion.assignmentId}`}
          key={`add-${exclusion.assignmentId}`}
          onClick={(event) =>
            onAdjust({ kind: "add", assignmentId: exclusion.assignmentId }, event.currentTarget)
          }
        >
          Add {exclusion.assignmentId}
        </button>
      ))}
    </section>
  );
}

function PlanConfirmationControls({
  available,
  busy,
  confirmation,
  disabled,
  errorRef,
  proposalIsCurrent,
  resultRef,
  onConfirm,
}: {
  available: boolean;
  busy: boolean;
  confirmation: ConfirmationState;
  disabled: boolean;
  errorRef: React.RefObject<HTMLDivElement | null>;
  proposalIsCurrent: boolean;
  resultRef: React.RefObject<HTMLDivElement | null>;
  onConfirm: () => void;
}) {
  return (
    <section
      aria-labelledby="confirm-plan-title"
      aria-busy={busy}
      className="mt-8 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-soft)] p-5"
    >
      <h2 id="confirm-plan-title" className="text-2xl font-semibold text-[var(--text-strong)]">
        Confirm this plan
      </h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Confirmation freezes this adjusted proposal into an immutable snapshot. Protected offline
        storage must finish before the plan is reported as saved.
      </p>
      <button
        className="mt-4 min-h-11 rounded-lg bg-[var(--brand-lagoon-700)] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        type="button"
        onClick={onConfirm}
      >
        {busy
          ? "Saving confirmed plan…"
          : confirmation.phase === "saved"
            ? "Plan saved"
            : "Confirm Plan"}
      </button>
      {!available ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Unlock protected offline storage before confirming this plan.
        </p>
      ) : !proposalIsCurrent ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Regenerate the proposal to include the changed outing constraints.
        </p>
      ) : null}
      <div aria-live="polite" className="mt-3" role="status">
        {busy ? "Saving. Keep this page open." : null}
      </div>
      {confirmation.phase === "saved" ? (
        <div
          ref={resultRef}
          className="mt-3 rounded-lg bg-[var(--confidence-high-soft)] p-3 text-[var(--confidence-high-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2"
          tabIndex={-1}
        >
          Confirmed plan saved. Snapshot {confirmation.snapshot.snapshotId} is ready for Capture.
        </div>
      ) : null}
      {confirmation.phase === "failed" ? (
        <div
          ref={errorRef}
          className="mt-3 rounded-lg bg-[var(--risk-high-soft)] p-3 text-[var(--risk-high-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2"
          role="alert"
          tabIndex={-1}
        >
          The confirmed plan was not saved. Review protected storage, then retry. The current
          proposal has not been reported as saved.
        </div>
      ) : null}
    </section>
  );
}

function focusAfterRender(target: React.RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => target.current?.focus());
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
        onChange={(event) => {
          if (event.target.value === "") return;
          const nextValue = Number(event.target.value);
          if (Number.isFinite(nextValue)) onChange(nextValue);
        }}
      />
    </label>
  );
}
