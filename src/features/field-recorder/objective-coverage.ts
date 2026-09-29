import {
  captureWindowIdsForRecord,
  coverageWindowIdentityForRequirement,
  observationCoverageDisposition,
  validateFieldProtocolRecord,
} from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  EvidenceAsset,
  FieldObservation,
  FieldVisit,
  RouteRun,
  SchemaGap,
  SourceStatement,
} from "@/features/field-protocol/generated";
import type {
  ObjectiveCoverage,
  ObjectiveCoverageStatus,
  RecorderRecord,
  RequirementCoverage,
} from "./field-recorder-types";
import type { RecorderProtocol } from "./load-recorder-protocol";

type CoverageRequirement =
  RecorderProtocol["campaign"]["assignments"][number]["coverageRequirements"][number];

export function deriveAssignmentCoverage(input: {
  assignmentId: string;
  protocol: RecorderProtocol;
  records: readonly RecorderRecord[];
  selectedPartialCoverageSetId?: string;
}): readonly ObjectiveCoverage[] {
  const assignment = input.protocol.campaign.assignments.find(
    (candidate) => candidate.id === input.assignmentId,
  );
  if (!assignment) return [];
  const currentRecords = currentRecordSet(input.records);
  const selectedObjectives = input.selectedPartialCoverageSetId
    ? new Set<string>(
        assignment.partialCoverageSets.find((set) => set.id === input.selectedPartialCoverageSetId)
          ?.objectiveIds ?? [],
      )
    : undefined;
  return assignment.objectives.map((objective) => {
    const requirements = assignment.coverageRequirements
      .filter((requirement) => requirement.objectiveId === objective.id)
      .map((requirement) =>
        deriveRequirementCoverage({
          currentRecords,
          inSelectedVisit: !selectedObjectives || selectedObjectives.has(objective.id),
          protocol: input.protocol,
          requirement,
        }),
      );
    return {
      objectiveId: objective.id,
      requirements,
      sourceRecordIds: [...new Set(requirements.flatMap((entry) => entry.capturedRecordIds))],
      status: deriveObjectiveStatus(requirements),
    };
  });
}

export function deriveRequirementCoverage(input: {
  currentRecords: readonly RecorderRecord[];
  inSelectedVisit: boolean;
  protocol: RecorderProtocol;
  requirement: CoverageRequirement;
}): RequirementCoverage {
  const relevant = input.currentRecords.filter((entry) =>
    hasCoverageRequirement(entry.value, input.requirement.id),
  );
  const exceptions = relevant
    .filter(
      (entry): entry is RecorderRecord & { value: CaptureException } =>
        entry.kind === "captureException",
    )
    .map((entry) => entry.value);
  const gaps = relevant.filter(
    (entry): entry is RecorderRecord & { value: SchemaGap } => entry.kind === "schemaGap",
  );
  const assets = relevant
    .filter(
      (entry): entry is RecorderRecord & { value: EvidenceAsset } => entry.kind === "evidenceAsset",
    )
    .map((entry) => entry.value)
    .filter((asset) => isUsableAsset(asset, input.protocol));
  const candidates = relevant.filter(
    (
      entry,
    ): entry is
      | Extract<RecorderRecord, { kind: "fieldObservation" }>
      | Extract<RecorderRecord, { kind: "routeRun" }>
      | Extract<RecorderRecord, { kind: "sourceStatement" }>
      | Extract<RecorderRecord, { kind: "evidenceAsset" }> =>
      entry.kind === "fieldObservation" ||
      entry.kind === "routeRun" ||
      entry.kind === "sourceStatement" ||
      entry.kind === "evidenceAsset",
  );
  const validCandidates = candidates.filter((entry) =>
    isAdmissible(input.requirement, entry, input.protocol),
  );
  const unknown = validCandidates.some((entry) =>
    hasUnknownDisposition(entry.value, input.protocol),
  );
  const provisional = validCandidates.some(
    (entry) => entry.kind === "fieldObservation" && entry.value.subject.kind === "provisional",
  );
  const contradiction = validCandidates.some(
    (entry) =>
      entry.kind === "fieldObservation" && (entry.value.contradictsObservationIds?.length ?? 0) > 0,
  );
  const admissible = validCandidates.filter(
    (entry) => !hasUnknownDisposition(entry.value, input.protocol),
  );
  const windowResults = admissible.map((entry) =>
    governedWindowKeys(entry, input.currentRecords, input.requirement),
  );
  const windows = new Map(
    windowResults.flatMap((result) => result.windows).map((window) => [window.key, window.id]),
  );
  const invalidWindowLink = candidates
    .filter((entry) => entry.value.captureState === "captured")
    .some((entry) => !governedWindowKeys(entry, input.currentRecords, input.requirement).valid);
  const requiresAsset =
    input.requirement.supportingAsset === "required" ||
    (input.requirement.supportingAsset === "required_for_posted_information" &&
      admissible.some(
        (entry) =>
          entry.kind === "fieldObservation" &&
          (entry.value.directness === "posted_notice" ||
            valueContains(entry.value.value, "posted")),
      ));
  const reasonCodes: string[] = [];
  if (!input.inSelectedVisit) reasonCodes.push("outside_partial_coverage_set");
  if (gaps.length > 0) reasonCodes.push("schema_gap");
  if (provisional) reasonCodes.push("provisional_subject");
  if (unknown) reasonCodes.push("unknown_or_not_tested");
  if (invalidWindowLink) reasonCodes.push("invalid_capture_window_link");
  if (contradiction) reasonCodes.push("unresolved_contradiction");
  if (admissible.length < input.requirement.minimumRecords) reasonCodes.push("record_threshold");
  if (windows.size < input.requirement.repetition.minimumDistinctWindows) {
    reasonCodes.push("distinct_window_threshold");
  }
  if (requiresAsset && assets.length === 0) reasonCodes.push("supporting_asset_required");

  let status: RequirementCoverage["status"] = "unstarted";
  const nonApplicable = exceptions.filter((entry) => entry.reason === "not_applicable");
  const blockers = exceptions.filter((entry) => entry.reason !== "not_applicable");
  if (gaps.length > 0 || provisional || unknown || contradiction || invalidWindowLink) {
    status = "needs_resolution";
  } else if (blockers.length > 0) status = "blocked";
  else if (nonApplicable.length > 0 && admissible.length === 0) status = "not_applicable";
  else if (
    admissible.length >= input.requirement.minimumRecords &&
    windows.size >= input.requirement.repetition.minimumDistinctWindows &&
    (!requiresAsset || assets.length > 0)
  ) {
    status = "satisfied";
  } else if (relevant.length > 0) status = "in_progress";

  return {
    capturedRecordIds: admissible.map((entry) => entry.value.id),
    capturedRecords: admissible.length,
    coverageRequirementId: input.requirement.id,
    distinctWindowIds: [...windows.values()],
    distinctWindows: windows.size,
    objectiveId: input.requirement.objectiveId,
    reasonCodes,
    requiredDistinctWindows: input.requirement.repetition.minimumDistinctWindows,
    requiredRecords: input.requirement.minimumRecords,
    status,
    supportingAssetIds: assets.map((asset) => asset.id),
    supportingAssets: assets.length,
  };
}

export function deterministicNextRequirement(
  coverage: readonly ObjectiveCoverage[],
): { objectiveId: string; coverageRequirementId: string } | undefined {
  for (const objective of coverage) {
    for (const requirement of objective.requirements) {
      if (requirement.status !== "satisfied" && requirement.status !== "not_applicable") {
        return {
          coverageRequirementId: requirement.coverageRequirementId,
          objectiveId: objective.objectiveId,
        };
      }
    }
  }
  return undefined;
}

function currentRecordSet(records: readonly RecorderRecord[]): readonly RecorderRecord[] {
  const supersededIds = new Set(
    records.flatMap((entry) => {
      const value = entry.value as { supersedesId?: string };
      return value.supersedesId ? [value.supersedesId] : [];
    }),
  );
  return records.filter((entry) => !supersededIds.has(entry.value.id));
}

function isAdmissible(
  requirement: CoverageRequirement,
  entry:
    | Extract<RecorderRecord, { kind: "fieldObservation" }>
    | Extract<RecorderRecord, { kind: "routeRun" }>
    | Extract<RecorderRecord, { kind: "sourceStatement" }>
    | Extract<RecorderRecord, { kind: "evidenceAsset" }>,
  protocol: RecorderProtocol,
): boolean {
  if (entry.value.captureState !== "captured") return false;
  if (entry.kind === "fieldObservation") {
    if (!requirement.admissibleRecordKinds.includes("field-observation.v1")) return false;
    if (
      !(requirement.admissibleObservationKinds as readonly string[]).includes(
        entry.value.observationKind,
      )
    ) {
      return false;
    }
    return validateFieldProtocolRecord("fieldObservation", entry.value, {
      protocolPackage: protocol,
    }).success;
  }
  if (entry.kind === "routeRun") {
    return (
      (requirement.admissibleRecordKinds as readonly string[]).includes("route-run.v1") &&
      validateFieldProtocolRecord("routeRun", entry.value, { protocolPackage: protocol }).success
    );
  }
  if (entry.kind === "sourceStatement") {
    return (
      (requirement.admissibleRecordKinds as readonly string[]).includes("source-statement.v1") &&
      entry.value.consents.participation.decision === "granted" &&
      validateFieldProtocolRecord("sourceStatement", entry.value, {
        protocolPackage: protocol,
      }).success
    );
  }
  if (entry.kind === "evidenceAsset") {
    return (
      (requirement.admissibleRecordKinds as readonly string[]).includes("evidence-asset.v1") &&
      isUsableAsset(entry.value, protocol)
    );
  }
  return false;
}

function isUsableAsset(asset: EvidenceAsset, protocol: RecorderProtocol): boolean {
  return (
    asset.captureState === "captured" &&
    asset.retentionState === "active" &&
    asset.consentState !== "denied" &&
    asset.consentState !== "withdrawn" &&
    asset.redactionState !== "pending" &&
    asset.redactionState !== "blocked" &&
    validateFieldProtocolRecord("evidenceAsset", asset, { protocolPackage: protocol }).success
  );
}

function hasCoverageRequirement(value: RecorderRecord["value"], id: string): boolean {
  if ("coverageRequirementId" in value) return value.coverageRequirementId === id;
  if ("coverageRequirementIds" in value) return value.coverageRequirementIds.includes(id);
  return false;
}

function hasUnknownDisposition(
  value: FieldObservation | RouteRun | SourceStatement | EvidenceAsset,
  protocol: RecorderProtocol,
): boolean {
  if (value.schemaVersion === "route-run.v1") return value.notTested.length > 0;
  if (value.schemaVersion === "source-statement.v1") {
    return value.basisOfKnowledge === "unknown";
  }
  if (value.schemaVersion === "evidence-asset.v1") return false;
  return (
    observationCoverageDisposition(value.observationKind as never, value.value, {
      protocolPackage: protocol,
    }) === "unknown"
  );
}

function valueContains(value: unknown, token: string): boolean {
  if (typeof value === "string") return value === token;
  if (Array.isArray(value)) return value.some((child) => valueContains(child, token));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((child) => valueContains(child, token));
}

function governedWindowKeys(
  entry:
    | Extract<RecorderRecord, { kind: "fieldObservation" }>
    | Extract<RecorderRecord, { kind: "routeRun" }>
    | Extract<RecorderRecord, { kind: "sourceStatement" }>
    | Extract<RecorderRecord, { kind: "evidenceAsset" }>,
  records: readonly RecorderRecord[],
  requirement: CoverageRequirement,
): { windows: readonly Readonly<{ id: string; key: string }>[]; valid: boolean } {
  const identity = coverageWindowIdentityForRequirement(requirement);
  const ids = captureWindowIdsForRecord(entry.value);
  const visit = records.find(
    (candidate): candidate is Extract<RecorderRecord, { kind: "fieldVisit" }> =>
      candidate.kind === "fieldVisit" && candidate.value.id === entry.value.visitId,
  );
  if (!identity || ids.length === 0 || !visit) return { windows: [], valid: false };
  const captureWindows = (
    visit.value as FieldVisit & {
      captureWindows?: readonly {
        id: string;
        windowIdentity: string;
        localHourStartedAt?: string;
      }[];
    }
  ).captureWindows;
  if (!captureWindows) return { windows: [], valid: false };
  const windowsById = new Map<string, (typeof captureWindows)[number]>(
    captureWindows.map((window) => [window.id, window]),
  );
  const selected = ids.map((id) => windowsById.get(id));
  if (
    selected.some((window) => !window || window.windowIdentity !== identity) ||
    selected.length === 0
  ) {
    return { windows: [], valid: false };
  }
  return {
    windows: selected.map((window) => ({
      id: window?.id ?? "",
      key: window?.localHourStartedAt ?? window?.id ?? "",
    })),
    valid: true,
  };
}

function deriveObjectiveStatus(
  requirements: readonly RequirementCoverage[],
): ObjectiveCoverageStatus {
  if (requirements.length === 0 || requirements.every((entry) => entry.status === "unstarted")) {
    return "unstarted";
  }
  if (requirements.some((entry) => entry.status === "needs_resolution")) return "needs_resolution";
  if (requirements.some((entry) => entry.status === "blocked")) return "blocked";
  if (
    requirements.every((entry) => entry.status === "satisfied" || entry.status === "not_applicable")
  ) {
    return "satisfied";
  }
  return "in_progress";
}
