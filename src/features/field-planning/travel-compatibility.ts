import type { PlannerProtocol } from "./field-planning-types";

export type TravelPathResult =
  | Readonly<{ success: true; minutes: number; areaIds: readonly string[] }>
  | Readonly<{ success: false; code: "transport_incompatible" | "transfer_boundary" }>;

export function findConservativeTravelPath(
  protocol: PlannerProtocol,
  from: string,
  to: string,
  mode: string,
): TravelPathResult {
  if (from === to) return { success: true, minutes: 0, areaIds: [from] };

  const blockedBoundary = protocol.travelEdges.some(
    (edge) =>
      edge.transferBoundary &&
      edge.modes.includes(mode) &&
      ((edge.from === from && edge.to === to) ||
        (edge.direction === "bidirectional" && edge.from === to && edge.to === from)),
  );
  const distances = new Map<string, { minutes: number; path: string[] }>([
    [from, { minutes: 0, path: [from] }],
  ]);
  const pending = new Set([from]);

  while (pending.size > 0) {
    const current = [...pending].sort((left, right) => compareNode(left, right, distances))[0];
    if (!current) break;
    pending.delete(current);
    const state = distances.get(current);
    if (!state) continue;
    if (current === to) {
      return { success: true, minutes: state.minutes, areaIds: state.path };
    }

    for (const edge of protocol.travelEdges) {
      if (edge.transferBoundary || !edge.modes.includes(mode)) continue;
      const destinations: string[] = [];
      if (edge.from === current) destinations.push(edge.to);
      if (edge.direction === "bidirectional" && edge.to === current) destinations.push(edge.from);
      for (const destination of destinations) {
        const candidate = {
          minutes: state.minutes + edge.durationBandMinutes[1],
          path: [...state.path, destination],
        };
        const existing = distances.get(destination);
        if (
          !existing ||
          candidate.minutes < existing.minutes ||
          (candidate.minutes === existing.minutes &&
            candidate.path.join("\u0000") < existing.path.join("\u0000"))
        ) {
          distances.set(destination, candidate);
          pending.add(destination);
        }
      }
    }
  }

  return {
    success: false,
    code: blockedBoundary ? "transfer_boundary" : "transport_incompatible",
  };
}

function compareNode(
  left: string,
  right: string,
  distances: ReadonlyMap<string, { minutes: number; path: string[] }>,
) {
  const leftState = distances.get(left);
  const rightState = distances.get(right);
  if (!leftState || !rightState) return left.localeCompare(right);
  return (
    leftState.minutes - rightState.minutes ||
    leftState.path.join("\u0000").localeCompare(rightState.path.join("\u0000"))
  );
}
