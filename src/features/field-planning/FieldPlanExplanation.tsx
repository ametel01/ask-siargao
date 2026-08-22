import type { FieldPlanProposal, PlanningReason } from "./field-planning-types";

export function FieldPlanExplanation({ proposal }: { proposal: FieldPlanProposal }) {
  return (
    <section aria-labelledby="plan-explanation-title" className="space-y-5">
      <div>
        <h2
          id="plan-explanation-title"
          className="text-2xl font-semibold text-[var(--text-strong)]"
        >
          Why this plan
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {proposal.consumedMinutes} minutes of work and travel, {proposal.plannedReturnMinutes}
          minutes held for the return, and {proposal.reserveMinutes} minutes protected as reserve.
        </p>
      </div>

      <ol aria-label="Selected Field Assignments" className="space-y-3">
        {proposal.selected.map((assignment) => (
          <li
            className="rounded-xl border border-[var(--border-default)] bg-white p-4 text-[var(--text-default)]"
            key={assignment.assignmentId}
          >
            <h3 className="font-semibold text-[var(--text-strong)]">{assignment.title}</h3>
            <p>{formatReason(assignment.reasons[0])}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {assignment.travelFromPreviousMinutes} min travel · {assignment.workMinutes} min work
              · {assignment.returnToStartMinutes} min conservative return
            </p>
            <p id={`consequence-${assignment.assignmentId}`} className="mt-2 text-sm">
              Coverage consequence: {formatConsequences(assignment.consequences)}
            </p>
          </li>
        ))}
      </ol>

      <details className="rounded-xl border border-[var(--border-default)] bg-white p-4 text-[var(--text-default)]">
        <summary className="cursor-pointer font-semibold">
          Relevant exclusions ({proposal.exclusions.length})
        </summary>
        <ul aria-label="Excluded Field Assignments" className="mt-3 space-y-2">
          {proposal.exclusions.map((exclusion) => (
            <li key={`${exclusion.assignmentId}-${exclusion.code}`}>
              <code>{exclusion.assignmentId}</code>: {formatReason(exclusion)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function formatReason(reason: PlanningReason | undefined): string {
  if (!reason) return "No explanation was recorded.";
  switch (reason.code) {
    case "included":
      return `Included because it passed every hard gate, has ${reason.facts.outstandingRequiredCoverage} outstanding coverage points, and fits with a conservative return.`;
    case "hard_gate_blocked":
      return `Excluded because the ${reason.facts.gate ?? "required"} hard gate is blocked.`;
    case "missing_gate_evidence":
      return "Excluded because current hard-gate evidence is missing or unknown.";
    case "eligibility_not_current":
      return `Excluded because ${reason.facts.kind} eligibility evidence is missing, blocked, or stale.`;
    case "eligibility_value_mismatch":
      return `Excluded because ${reason.facts.kind} does not match an allowed protocol value.`;
    case "transport_incompatible":
      return "Excluded because the selected transport mode has no governed outbound and return path.";
    case "transfer_boundary":
      return "Excluded because the route crosses a governed transfer boundary.";
    case "unresolved_geography":
      return "Excluded because governed Assignment geography has not been resolved.";
    case "insufficient_capacity":
      return `Excluded because it exceeds usable capacity by ${reason.facts.overByMinutes} minutes.`;
    case "coverage_complete":
      return "Excluded because its required coverage is already complete.";
    case "partial_coverage_selected":
      return `Included only as governed Partial Coverage Set ${reason.facts.partialCoverageSetId}.`;
    case "not_selected_after_ranking":
      return "Excluded after deterministic ranking.";
  }
}

export function formatConsequences(
  consequences: FieldPlanProposal["selected"][number]["consequences"],
) {
  return consequences
    .map(
      (entry) =>
        `${entry.coverageRequirementId}: ${entry.remainingRecords} record(s), ${entry.remainingDistinctWindows} window(s) outstanding`,
    )
    .join("; ");
}
