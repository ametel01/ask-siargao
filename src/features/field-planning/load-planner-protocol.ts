import {
  baselineFieldProtocolPackage,
  verifyFieldProtocolPackage,
} from "@/features/field-protocol/field-protocol";

import type {
  EligibilityWindowRule,
  PlannerAssignment,
  PlannerProtocol,
  TravelEdge,
} from "./field-planning-types";

type JsonObject = Record<string, unknown>;

export async function loadPlannerProtocol(
  input: { applicationVersion?: string; bundle?: unknown; trustedSigners?: unknown } = {},
): Promise<PlannerProtocol> {
  const bundle = input.bundle ?? baselineFieldProtocolPackage;
  const verification = await verifyFieldProtocolPackage({
    applicationVersion: input.applicationVersion ?? "0.1.0",
    bundle,
    trustedSigners: input.trustedSigners,
  });
  if (!verification.success) {
    throw new Error(`Field Protocol Package is not verified: ${verification.message}`);
  }

  const root = object(bundle, "package");
  const campaign = object(root.campaign, "campaign");
  const geography = object(root.geography, "geography");
  const planningRules = object(campaign.planningRules, "campaign.planningRules");
  const eligibilityRules = array(
    planningRules.eligibilityWindowKinds,
    "eligibilityWindowKinds",
  ).map(parseEligibilityRule);
  const assignments = array(campaign.assignments, "assignments").map(parseAssignment);
  const travelEdges = array(geography.edges, "edges").map(parseTravelEdge);

  assertUnique(
    assignments.map(({ id }) => id),
    "Assignment",
  );
  assertUnique(
    eligibilityRules.map(({ kind }) => kind),
    "Eligibility Window kind",
  );
  const ruleKinds = new Set(eligibilityRules.map(({ kind }) => kind));
  for (const assignment of assignments) {
    for (const window of assignment.eligibilityWindows) {
      if (!ruleKinds.has(window.kind)) {
        throw new Error(`Assignment ${assignment.id} has no governed rule for ${window.kind}.`);
      }
    }
  }

  return freeze({
    packageId: verification.packageId,
    packageVersion: verification.packageVersion,
    campaignId: string(campaign.campaignId, "campaignId"),
    campaignVersion: string(campaign.componentVersion, "campaign.componentVersion"),
    geographyVersion: string(geography.componentVersion, "geography.componentVersion"),
    areas: array(geography.areas, "areas").map((value) =>
      string(object(value, "area").id, "area.id"),
    ),
    transportModes: stringArray(geography.transportModes, "transportModes"),
    eligibilityRules,
    assignments,
    travelEdges,
  });
}

function parseEligibilityRule(value: unknown): EligibilityWindowRule {
  const rule = object(value, "eligibility rule");
  if (rule.hardGate !== true) throw new Error("Eligibility Window rules must be hard gates.");
  return {
    kind: string(rule.kind, "eligibility rule kind"),
    rarityRank: positiveNumber(rule.rarityRank, "rarityRank"),
    maximumAgeMinutes: positiveNumber(rule.maximumAgeMinutes, "maximumAgeMinutes"),
    hardGate: true,
  };
}

function parseAssignment(value: unknown): PlannerAssignment {
  const assignment = object(value, "assignment");
  const geography = object(assignment.geography, "assignment.geography");
  const anchorResolution = geography.anchorResolution;
  if (anchorResolution !== undefined && anchorResolution !== "coverage_snapshot_required") {
    throw new Error("Unknown assignment anchor resolution.");
  }
  return {
    id: string(assignment.id, "assignment.id"),
    title: string(assignment.title, "assignment.title"),
    estimatedMinutes: positiveNumber(assignment.estimatedMinutes, "estimatedMinutes"),
    editorialPriority: positiveNumber(assignment.editorialPriority, "editorialPriority"),
    evidenceFreshnessReviewMinutes: positiveNumber(
      assignment.evidenceFreshnessReviewMinutes,
      "evidenceFreshnessReviewMinutes",
    ),
    anchorAreaId:
      geography.anchorAreaId === undefined
        ? undefined
        : string(geography.anchorAreaId, "anchorAreaId"),
    anchorResolution,
    eligibilityWindows: array(assignment.eligibilityWindows, "eligibilityWindows").map((entry) => {
      const window = object(entry, "eligibilityWindow");
      return {
        kind: string(window.kind, "eligibilityWindow.kind"),
        values: stringArray(window.values, "eligibilityWindow.values"),
      };
    }),
    coverageRequirements: array(assignment.coverageRequirements, "coverageRequirements").map(
      (entry) => {
        const requirement = object(entry, "coverageRequirement");
        const repetition = object(requirement.repetition, "coverageRequirement.repetition");
        return {
          id: string(requirement.id, "coverageRequirement.id"),
          objectiveId: string(requirement.objectiveId, "coverageRequirement.objectiveId"),
          required: requirement.required === true,
          minimumRecords: positiveNumber(requirement.minimumRecords, "minimumRecords"),
          minimumDistinctWindows: positiveNumber(
            repetition.minimumDistinctWindows,
            "minimumDistinctWindows",
          ),
        };
      },
    ),
    partialCoverageSets: array(assignment.partialCoverageSets, "partialCoverageSets").map(
      (entry) => {
        const set = object(entry, "partialCoverageSet");
        return {
          id: string(set.id, "partialCoverageSet.id"),
          objectiveIds: stringArray(set.objectiveIds, "partialCoverageSet.objectiveIds"),
        };
      },
    ),
    safeFallbackAssignmentId:
      assignment.safeFallbackAssignmentId === undefined
        ? undefined
        : string(assignment.safeFallbackAssignmentId, "safeFallbackAssignmentId"),
  };
}

function parseTravelEdge(value: unknown): TravelEdge {
  const edge = object(value, "travel edge");
  const duration = array(edge.durationBandMinutes, "durationBandMinutes");
  if (duration.length !== 2) throw new Error("Travel duration bands require two values.");
  const direction = edge.direction;
  if (direction !== "directed" && direction !== "bidirectional") {
    throw new Error("Travel edge direction is not governed.");
  }
  return {
    from: string(edge.from, "edge.from"),
    to: string(edge.to, "edge.to"),
    modes: stringArray(edge.modes, "edge.modes"),
    durationBandMinutes: [
      positiveNumber(duration[0], "duration lower bound"),
      positiveNumber(duration[1], "duration upper bound"),
    ],
    direction,
    transferBoundary: edge.transferBoundary === true,
  };
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((entry) => string(entry, label));
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} IDs must be unique.`);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
