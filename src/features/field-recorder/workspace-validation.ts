import {
  captureWindowIdsForRecord,
  type FieldProtocolRecordKind,
  resolveProtocolForWork,
  validateFieldProtocolRecord,
} from "@/features/field-protocol/field-protocol";
import type {
  EvidenceAsset,
  FieldObservation,
  FieldVisit,
  SourceStatement,
  StatementTranslation,
} from "@/features/field-protocol/generated";
import type { RecorderRecord } from "./field-recorder-types";
import type { RecorderProtocol } from "./load-recorder-protocol";

export type RecorderWorkspaceIssue = Readonly<{
  code: string;
  message: string;
  recordId?: string;
}>;

export async function validateRecorderWorkspace(input: {
  applicationVersion: string;
  installedBundles: readonly unknown[];
  protocol: RecorderProtocol;
  protocolPackageId: string;
  protocolPackageVersion: string;
  records: readonly RecorderRecord[];
  committedAssets?: readonly Readonly<{
    assetId: string;
    byteSize: number;
    sha256: string;
  }>[];
}): Promise<{ success: boolean; issues: readonly RecorderWorkspaceIssue[] }> {
  const issues: RecorderWorkspaceIssue[] = [];
  let pinnedProtocol: Awaited<ReturnType<typeof resolveProtocolForWork>> | undefined;
  try {
    pinnedProtocol = await resolveProtocolForWork(
      {
        protocolPackageId: input.protocolPackageId,
        protocolPackageVersion: input.protocolPackageVersion,
      },
      input.installedBundles,
      { applicationVersion: input.applicationVersion },
    );
  } catch {
    issues.push({
      code: "pinned_protocol_unavailable",
      message: "The pinned Capture Protocol Package is not installed or trusted.",
    });
  }
  if (!pinnedProtocol) return { issues, success: false };

  const recordsById = new Map<string, RecorderRecord>();
  const successorCounts = new Map<string, number>();
  for (const entry of input.records) {
    if (recordsById.has(entry.value.id)) {
      issues.push({
        code: "duplicate_record_id",
        message: "Record IDs must be unique inside Recorder work.",
        recordId: entry.value.id,
      });
    }
    recordsById.set(entry.value.id, entry);
    const supersedesId = (entry.value as { supersedesId?: string }).supersedesId;
    if (supersedesId)
      successorCounts.set(supersedesId, (successorCounts.get(supersedesId) ?? 0) + 1);
    if (
      entry.value.protocolPackageId !== input.protocolPackageId ||
      entry.value.protocolPackageVersion !== input.protocolPackageVersion
    ) {
      issues.push({
        code: "record_protocol_mismatch",
        message: "A record does not reference the Recorder's pinned Capture Protocol Package.",
        recordId: entry.value.id,
      });
      continue;
    }
    const validation = validateFieldProtocolRecord(
      entry.kind as FieldProtocolRecordKind,
      entry.value,
      { protocolPackage: pinnedProtocol },
    );
    if (!validation.success) {
      issues.push(
        ...validation.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          recordId: entry.value.id,
        })),
      );
    }
  }

  const visits = new Map(
    input.records
      .filter(
        (entry): entry is RecorderRecord & { value: FieldVisit } => entry.kind === "fieldVisit",
      )
      .map((entry) => [entry.value.id, entry.value]),
  );
  const committedAssets = new Map(
    (input.committedAssets ?? []).map((asset) => [asset.assetId, asset]),
  );
  for (const entry of input.records) {
    validateVisitLink(entry, visits, issues);
    validateSupersession(entry, recordsById, successorCounts, issues);
    if (entry.kind === "evidenceAsset") {
      validateAsset(entry.value, recordsById, committedAssets, issues);
    }
    if (entry.kind === "statementTranslation") {
      validateTranslation(entry.value, recordsById, issues);
    }
    if (entry.kind === "fieldObservation") {
      validateContradictions(entry.value, recordsById, issues);
    }
  }
  validateSupersessionCycles(input.records, recordsById, issues);
  return { issues, success: issues.length === 0 };
}

function validateVisitLink(
  entry: RecorderRecord,
  visits: ReadonlyMap<string, FieldVisit>,
  issues: RecorderWorkspaceIssue[],
) {
  if (!("visitId" in entry.value) || !entry.value.visitId || entry.kind === "fieldVisit") return;
  const visit = visits.get(entry.value.visitId);
  if (!visit) {
    issues.push({
      code: "missing_visit",
      message: "The record's Visit is not present in this Recorder work.",
      recordId: entry.value.id,
    });
    return;
  }
  if ("assignmentId" in entry.value && entry.value.assignmentId !== visit.assignmentId) {
    issues.push({
      code: "visit_assignment_mismatch",
      message: "The record and its Visit must belong to the same Assignment.",
      recordId: entry.value.id,
    });
  }
  if (
    entry.kind === "fieldObservation" &&
    entry.value.subject.kind === "governed" &&
    visit.target.kind === "governed_subject" &&
    entry.value.subject.subjectId !== visit.target.subjectId
  ) {
    issues.push({
      code: "visit_subject_mismatch",
      message: "The observation Subject must match the governed Visit Subject.",
      recordId: entry.value.id,
    });
  }
  if (
    entry.kind === "fieldObservation" ||
    entry.kind === "routeRun" ||
    entry.kind === "sourceStatement" ||
    entry.kind === "evidenceAsset"
  ) {
    const visitWindows = new Set(
      (
        (visit as FieldVisit & { captureWindows?: readonly { id: string }[] }).captureWindows ?? []
      ).map((window) => window.id),
    );
    const linkedWindows = captureWindowIdsForRecord(entry.value);
    if (linkedWindows.length === 0 || linkedWindows.some((id) => !visitWindows.has(id))) {
      issues.push({
        code: "invalid_capture_window_link",
        message: "Countable evidence must link a governed capture window from its Visit.",
        recordId: entry.value.id,
      });
    }
  }
}

function validateAsset(
  asset: EvidenceAsset,
  recordsById: ReadonlyMap<string, RecorderRecord>,
  committedAssets: ReadonlyMap<string, { byteSize: number; sha256: string }>,
  issues: RecorderWorkspaceIssue[],
) {
  const committed = committedAssets.get(asset.id);
  if (
    !committed ||
    committed.byteSize !== asset.byteSize ||
    committed.sha256 !== asset.contentSha256
  ) {
    issues.push({
      code: "asset_not_durably_committed",
      message: "Captured asset metadata must match encrypted bytes committed in the vault.",
      recordId: asset.id,
    });
  }
  for (const recordId of asset.recordIds) {
    const record = recordsById.get(recordId);
    if (!record || record.kind === "evidenceAsset") {
      issues.push({
        code: "invalid_asset_link",
        message: "An Evidence Asset must link to an existing non-asset record.",
        recordId: asset.id,
      });
      continue;
    }
    if ("visitId" in record.value && record.value.visitId !== asset.visitId) {
      issues.push({
        code: "asset_visit_mismatch",
        message: "An Evidence Asset and its linked record must share a Visit.",
        recordId: asset.id,
      });
    }
  }
}

function validateTranslation(
  translation: StatementTranslation,
  recordsById: ReadonlyMap<string, RecorderRecord>,
  issues: RecorderWorkspaceIssue[],
) {
  const source = recordsById.get(translation.sourceStatementId);
  if (source?.kind !== "sourceStatement") {
    issues.push({
      code: "missing_source_statement",
      message: "A translation must preserve a link to its Source Statement.",
      recordId: translation.id,
    });
    return;
  }
  const statement = source.value as SourceStatement;
  const translationWithLineage = translation as StatementTranslation & {
    assignmentId?: string;
    visitId?: string;
  };
  if (
    (translationWithLineage.assignmentId &&
      translationWithLineage.assignmentId !== statement.assignmentId) ||
    (translationWithLineage.visitId && translationWithLineage.visitId !== statement.visitId)
  ) {
    issues.push({
      code: "translation_lineage_mismatch",
      message: "A translation must retain the Source Statement's capture lineage.",
      recordId: translation.id,
    });
  }
}

function validateSupersession(
  entry: RecorderRecord,
  recordsById: ReadonlyMap<string, RecorderRecord>,
  successorCounts: ReadonlyMap<string, number>,
  issues: RecorderWorkspaceIssue[],
) {
  const supersedesId = (entry.value as { supersedesId?: string }).supersedesId;
  if (!supersedesId) return;
  const original = recordsById.get(supersedesId);
  if (!original || original.kind !== entry.kind || original.value.id === entry.value.id) {
    issues.push({
      code: "invalid_supersession",
      message: "A correction must supersede an existing record of the same type.",
      recordId: entry.value.id,
    });
    return;
  }
  if ((original.value as { captureState?: string }).captureState !== "captured") {
    issues.push({
      code: "supersedes_non_captured_record",
      message: "A correction may supersede only a frozen Captured record.",
      recordId: entry.value.id,
    });
  }
  if (successorCounts.get(supersedesId) !== 1) {
    issues.push({
      code: "supersession_fork",
      message: "A record may have only one direct superseding correction.",
      recordId: entry.value.id,
    });
  }
  for (const key of [
    "protocolPackageId",
    "protocolPackageVersion",
    "campaignId",
    "assignmentId",
    "visitId",
    "objectiveId",
    "coverageRequirementId",
  ] as const) {
    const left = (entry.value as unknown as Record<string, unknown>)[key];
    const right = (original.value as unknown as Record<string, unknown>)[key];
    if (left !== undefined && right !== undefined && left !== right) {
      issues.push({
        code: "supersession_lineage_mismatch",
        message: "A correction must preserve the original capture lineage.",
        recordId: entry.value.id,
      });
      break;
    }
  }
}

function validateContradictions(
  observation: FieldObservation,
  recordsById: ReadonlyMap<string, RecorderRecord>,
  issues: RecorderWorkspaceIssue[],
) {
  for (const targetId of observation.contradictsObservationIds ?? []) {
    const target = recordsById.get(targetId);
    if (
      target?.kind !== "fieldObservation" ||
      target.value.assignmentId !== observation.assignmentId ||
      target.value.coverageRequirementId !== observation.coverageRequirementId
    ) {
      issues.push({
        code: "invalid_contradiction_link",
        message: "Contradictions must link observations for the same exact requirement.",
        recordId: observation.id,
      });
    }
  }
}

function validateSupersessionCycles(
  records: readonly RecorderRecord[],
  recordsById: ReadonlyMap<string, RecorderRecord>,
  issues: RecorderWorkspaceIssue[],
) {
  for (const entry of records) {
    const seen = new Set([entry.value.id]);
    let current: RecorderRecord | undefined = entry;
    while (current) {
      const parent = (current.value as { supersedesId?: string }).supersedesId;
      if (!parent) break;
      if (seen.has(parent)) {
        issues.push({
          code: "supersession_cycle",
          message: "Record supersession lineage cannot contain a cycle.",
          recordId: entry.value.id,
        });
        break;
      }
      seen.add(parent);
      current = recordsById.get(parent);
    }
  }
}
