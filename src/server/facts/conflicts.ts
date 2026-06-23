import type { GovernedFact } from "@/server/facts/types";

export type FactConflictType =
  | "area_location_mismatch"
  | "stale_policy_conflict"
  | "route_schedule_conflict"
  | "contradictory_accommodation_fact";

export type FactConflict = {
  type: FactConflictType;
  primaryFactId: string;
  conflictingFactId: string;
  severity: "low" | "medium" | "high";
  preferredFactId?: string;
  reason: string;
};

const officialPrecedenceFactTypes = new Set([
  "policy",
  "fee",
  "accreditation",
  "route_schedule",
  "public_sector",
]);

export function detectFactConflicts(facts: readonly GovernedFact[]): FactConflict[] {
  const conflicts: FactConflict[] = [];

  for (let index = 0; index < facts.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < facts.length; otherIndex += 1) {
      const left = facts[index];
      const right = facts[otherIndex];
      if (!left || !right || left.entityId !== right.entityId || left.factType !== right.factType) {
        continue;
      }
      if (normalizeClaim(left.claim) === normalizeClaim(right.claim)) {
        continue;
      }

      const type = conflictTypeFor(left.factType);
      const preferredFactId = choosePreferredFact(left, right);
      conflicts.push({
        type,
        primaryFactId: left.id,
        conflictingFactId: right.id,
        severity:
          type === "route_schedule_conflict" || type === "stale_policy_conflict"
            ? "high"
            : "medium",
        preferredFactId,
        reason: preferredFactId
          ? "Official or higher-authority source takes precedence for this fact type."
          : "Claims disagree and require confidence reduction or targeted refresh.",
      });
    }
  }

  return conflicts;
}

function choosePreferredFact(left: GovernedFact, right: GovernedFact) {
  if (!officialPrecedenceFactTypes.has(left.factType)) {
    return left.sourceAuthority === right.sourceAuthority
      ? undefined
      : left.sourceAuthority > right.sourceAuthority
        ? left.id
        : right.id;
  }
  if (left.sourceType === "official" && right.sourceType !== "official") {
    return left.id;
  }
  if (right.sourceType === "official" && left.sourceType !== "official") {
    return right.id;
  }
  return left.sourceAuthority === right.sourceAuthority
    ? undefined
    : left.sourceAuthority > right.sourceAuthority
      ? left.id
      : right.id;
}

function conflictTypeFor(factType: string): FactConflictType {
  if (factType === "area" || factType === "location") {
    return "area_location_mismatch";
  }
  if (factType === "policy" || factType === "fee" || factType === "accreditation") {
    return "stale_policy_conflict";
  }
  if (factType === "route_schedule") {
    return "route_schedule_conflict";
  }
  return "contradictory_accommodation_fact";
}

function normalizeClaim(claim: string) {
  return claim.trim().toLowerCase().replaceAll(/\s+/g, " ");
}
