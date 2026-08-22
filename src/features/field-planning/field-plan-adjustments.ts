import { proposeFieldDayPlan } from "./field-planner";
import type {
  FieldCoverageSnapshot,
  FieldPlanAdjustment,
  FieldPlanAdjustmentResult,
  FieldPlanProposal,
  PlannedAssignment,
  PlannerInputs,
  PlannerProtocol,
} from "./field-planning-types";
import { findConservativeTravelPath } from "./travel-compatibility";

export function applyFieldPlanAdjustment(
  protocol: PlannerProtocol,
  coverageSnapshot: FieldCoverageSnapshot,
  inputs: PlannerInputs,
  current: FieldPlanProposal,
  adjustment: FieldPlanAdjustment,
): FieldPlanAdjustmentResult {
  const ids = current.selected.map(({ assignmentId }) => assignmentId);
  const adjustedPartialSets = { ...(inputs.partialCoverageSetIds ?? {}) };
  let coverageImpact =
    current.selected.find(({ assignmentId }) => assignmentId === adjustment.assignmentId)
      ?.consequences ?? [];

  if (adjustment.kind === "remove") {
    const index = ids.indexOf(adjustment.assignmentId);
    if (index < 0) throw new Error("Only a selected Assignment can be removed.");
    ids.splice(index, 1);
  } else if (adjustment.kind === "move") {
    const index = ids.indexOf(adjustment.assignmentId);
    if (index < 0) throw new Error("Only a selected Assignment can be moved.");
    const nextIndex = adjustment.direction === "earlier" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= ids.length)
      throw new Error("Assignment cannot move farther.");
    [ids[index], ids[nextIndex]] = [ids[nextIndex] as string, ids[index] as string];
  } else {
    if (ids.includes(adjustment.assignmentId)) throw new Error("Assignment is already selected.");
    ids.push(adjustment.assignmentId);
    if (adjustment.partialCoverageSetId) {
      adjustedPartialSets[adjustment.assignmentId] = adjustment.partialCoverageSetId;
    }
  }

  const adjustedInputs = { ...inputs, partialCoverageSetIds: adjustedPartialSets };
  const eligible = proposeFieldDayPlan(protocol, coverageSnapshot, {
    ...adjustedInputs,
    availableMinutes: 1_000_000,
    reserveMinutes: { safety: 0, documentation: 0, rest: 0, daylight: 0 },
  });
  const eligibleById = new Map(eligible.selected.map((entry) => [entry.assignmentId, entry]));
  const selected = ids.map((id) => {
    const entry = eligibleById.get(id);
    if (!entry) throw new Error(`Adjustment rejected: ${id} does not pass every hard gate.`);
    return entry;
  });
  if (adjustment.kind === "add") {
    coverageImpact = eligibleById.get(adjustment.assignmentId)?.consequences ?? [];
  }

  return deepFreeze({
    proposal: rebuildInOrder(protocol, inputs, current, selected),
    adjustment,
    coverageImpact,
  });
}

function rebuildInOrder(
  protocol: PlannerProtocol,
  inputs: PlannerInputs,
  current: FieldPlanProposal,
  selected: readonly PlannedAssignment[],
): FieldPlanProposal {
  const reserveMinutes = Object.values(inputs.reserveMinutes).reduce(
    (sum, value) => sum + value,
    0,
  );
  const usableMinutes = Math.max(0, inputs.availableMinutes - reserveMinutes);
  const rebuilt: PlannedAssignment[] = [];
  let currentArea = inputs.startingAreaId;
  let consumedMinutes = 0;
  let plannedReturnMinutes = 0;

  for (const assignment of selected) {
    const outward = findConservativeTravelPath(
      protocol,
      currentArea,
      assignment.areaId,
      inputs.transportMode,
    );
    const home = findConservativeTravelPath(
      protocol,
      assignment.areaId,
      inputs.startingAreaId,
      inputs.transportMode,
    );
    if (!outward.success || !home.success) {
      throw new Error(`Adjustment rejected: ${assignment.assignmentId} has no safe return path.`);
    }
    const projected = consumedMinutes + outward.minutes + assignment.workMinutes + home.minutes;
    if (projected > usableMinutes) {
      throw new Error(
        `Adjustment rejected: ${assignment.assignmentId} exceeds usable capacity by ${projected - usableMinutes} minutes.`,
      );
    }
    consumedMinutes += outward.minutes + assignment.workMinutes;
    plannedReturnMinutes = home.minutes;
    currentArea = assignment.areaId;
    rebuilt.push({
      ...assignment,
      travelFromPreviousMinutes: outward.minutes,
      returnToStartMinutes: home.minutes,
    });
  }

  return {
    ...current,
    selected: rebuilt,
    availableMinutes: inputs.availableMinutes,
    reserveMinutes,
    usableMinutes,
    consumedMinutes,
    plannedReturnMinutes,
    remainingMinutes: usableMinutes - consumedMinutes - plannedReturnMinutes,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
