"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecorderRecord } from "@/features/field-recorder/field-recorder-types";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
import { FieldMain } from "@/features/field-workspace/FieldMain";
import { canCreateDeskFollowUp, createDeskFollowUp } from "./desk-followup";
import { fieldDeskCorrectionNoteSchema } from "./desk-schemas";
import { FieldDeskRepository } from "./field-desk-repository";
import { allRecords, appendFieldReview, effectiveReview } from "./field-desk-state";
import type { FieldDeskWork } from "./field-desk-types";

const decisions = [
  ["include", "Include", "Keep this immutable record in the reviewed selection."],
  ["exclude", "Exclude", "Keep it in custody, with a recorded reason for exclusion."],
  [
    "needs_more_evidence",
    "Needs more evidence",
    "Create a linked unscheduled Follow-up Assignment.",
  ],
  [
    "correct_by_supersession",
    "Correct by supersession",
    "Append a typed successor; never edit this capture.",
  ],
] as const;

type DeskDecisionOption = (typeof decisions)[number];
type DeskDecision = DeskDecisionOption[0];

type DeskCorrectionDescriptor = Readonly<{
  key: string;
  label: string;
  parse: (value: string) => string | number;
}>;

function deskCorrectionDescriptor(
  observation: RecorderRecord & { kind: "fieldObservation" },
): DeskCorrectionDescriptor {
  const descriptors: Record<string, DeskCorrectionDescriptor> = {
    identity: { key: "displayedName", label: "Displayed name", parse: String },
    opening_signal: { key: "state", label: "Opening state", parse: String },
    price: { key: "amount", label: "Amount", parse: String },
    route_duration: { key: "durationSeconds", label: "Duration (seconds)", parse: Number },
    route_wait: { key: "waitSeconds", label: "Wait (seconds)", parse: Number },
    road_condition: { key: "surface", label: "Surface", parse: String },
    facility: { key: "state", label: "Facility state", parse: String },
    accessibility: { key: "feature", label: "Accessibility feature", parse: String },
    payment_method: { key: "method", label: "Payment method", parse: String },
    connectivity: { key: "network", label: "Network", parse: String },
    power: { key: "state", label: "Power state", parse: String },
    crowd_snapshot: { key: "boundary", label: "Crowd boundary", parse: String },
    noise_snapshot: { key: "measurementPosition", label: "Measurement position", parse: String },
    weather_condition: { key: "condition", label: "Weather condition", parse: String },
    tide_context: { key: "sourceId", label: "Tide source", parse: String },
    menu_item: { key: "itemName", label: "Menu item", parse: String },
    service_status: { key: "state", label: "Service state", parse: String },
    contact_channel: { key: "publicValue", label: "Public contact value", parse: String },
    local_caveat: { key: "warning", label: "Warning", parse: String },
  };
  return (
    descriptors[observation.value.observationKind] ?? {
      key: "captureConfidenceReason",
      label: "Correction note",
      parse: String,
    }
  );
}

export function availableFieldDeskDecisions(
  recordKind: RecorderRecord["kind"] | undefined,
): readonly DeskDecisionOption[] {
  return decisions.filter(([value]) => {
    if (value === "correct_by_supersession") return recordKind === "fieldObservation";
    if (value === "needs_more_evidence") {
      return recordKind !== undefined && !["captureException", "schemaGap"].includes(recordKind);
    }
    return true;
  });
}

export function normalizeFieldDeskDecision(
  recordKind: RecorderRecord["kind"] | undefined,
  decision: DeskDecision,
): DeskDecision {
  return availableFieldDeskDecisions(recordKind).some(([value]) => value === decision)
    ? decision
    : "include";
}

export function FieldDesk(props: { embedded?: boolean; harness?: boolean }) {
  return props.harness ? <HarnessFieldDesk /> : <ProductionFieldDesk embedded={props.embedded} />;
}

function ProductionFieldDesk(props: { embedded?: boolean }) {
  const security = useFieldSecuritySession();
  const [works, setWorks] = useState<readonly FieldDeskWork[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string>();
  const [status, setStatus] = useState("Unlock the Authorized Field Device to load Desk custody.");
  const [loading, setLoading] = useState(false);
  const repository = useMemo(() => new FieldDeskRepository("0.1.0"), []);
  const selected = works.find((work) => work.archiveId === selectedArchiveId) ?? works[0];

  const loadCustody = useCallback(async () => {
    if (security.status !== "unlocked") return;
    setLoading(true);
    try {
      const loaded = await security.withVaultKey(async (key) => {
        let current = await repository.list(key);
        if (current.length === 0) {
          try {
            await repository.handoffClosedRecorder({
              archiveId: crypto.randomUUID(),
              handedOffAt: new Date().toISOString(),
              key,
              validate: async (work) => {
                if (!work.fieldDayClose) throw new Error("field_recorder_resume_invalid");
              },
            });
            current = await repository.list(key);
          } catch {
            // A Recorder that is not closed is genuinely unavailable to Desk.
          }
        }
        return current;
      });
      setWorks(loaded);
      setSelectedArchiveId((current) => current ?? loaded[0]?.archiveId);
      setStatus(
        loaded.length > 0
          ? `${loaded.length} closed outing${loaded.length === 1 ? "" : "s"} loaded from encrypted Desk custody.`
          : "No closed Recorder outing is available in this device's encrypted custody.",
      );
    } catch {
      setWorks([]);
      setStatus(
        "Desk custody could not be opened. Verify locally again or use Diagnostics and Recovery.",
      );
    } finally {
      setLoading(false);
    }
  }, [repository, security]);

  useEffect(() => {
    void loadCustody();
  }, [loadCustody]);

  if (security.status !== "unlocked") {
    return (
      <>
        <OfflineFieldUnlock />
        <LockedDeskState embedded={props.embedded} />
      </>
    );
  }
  if (!selected)
    return (
      <EmptyDeskState
        embedded={props.embedded}
        loading={loading}
        message={status}
        onReload={loadCustody}
      />
    );
  return (
    <DeskReviewSurface
      key={selected.archiveId}
      status={status}
      work={selected}
      embedded={props.embedded}
      onReload={loadCustody}
      onSave={async (next) => {
        await security.withVaultKey((key) =>
          repository.save({ key, previous: selected, work: next }),
        );
        setWorks((current) =>
          current.map((work) => (work.archiveId === next.archiveId ? next : work)),
        );
      }}
    />
  );
}

function DeskReviewSurface(props: {
  embedded?: boolean;
  status: string;
  work: FieldDeskWork;
  onReload: () => Promise<void>;
  onSave: (work: FieldDeskWork) => Promise<void>;
}) {
  const security = useFieldSecuritySession();
  const [recordIndex, setRecordIndex] = useState(0);
  const [decision, setDecision] = useState<(typeof decisions)[number][0]>("include");
  const [reason, setReason] = useState("");
  const [correction, setCorrection] = useState("");
  const [conflictDisposition, setConflictDisposition] = useState<
    "resolved" | "intentional_repetition" | "unresolved"
  >("unresolved");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const records = allRecords(props.work);
  const record = records[recordIndex] ?? records[0];
  const recordId = record?.value.id;
  const prior = record ? effectiveReview(props.work, record.value.id) : undefined;
  const followUpSupported = record ? canCreateDeskFollowUp(record) : false;
  const availableDecisions = availableFieldDeskDecisions(record?.kind).filter(
    ([value]) => value !== "needs_more_evidence" || followUpSupported,
  );
  const selectedDecision = availableDecisions.some(([value]) => value === decision)
    ? decision
    : "include";
  const conflictReviewRequired =
    record?.kind === "fieldObservation" &&
    (record.value.contradictsObservationIds?.length ?? 0) > 0;
  const parsedCorrection = fieldDeskCorrectionNoteSchema.safeParse(correction);
  const correctionDescriptor =
    record?.kind === "fieldObservation" ? deskCorrectionDescriptor(record) : undefined;
  const canSubmit =
    (!conflictReviewRequired || conflictDisposition !== "unresolved") &&
    (selectedDecision === "include" ||
      (selectedDecision === "correct_by_supersession"
        ? parsedCorrection.success
        : reason.trim().length > 0 &&
          (selectedDecision !== "needs_more_evidence" || followUpSupported)));

  async function saveDecision() {
    if (!record || !canSubmit || saving) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      let supersedingRecord: RecorderRecord | undefined;
      let followUp: ReturnType<typeof createDeskFollowUp>;
      if (selectedDecision === "needs_more_evidence") {
        followUp = createDeskFollowUp(record, crypto.randomUUID(), new Date().toISOString());
        if (!followUp) throw new Error("Needs more evidence requires a linked follow-up.");
      }
      if (selectedDecision === "correct_by_supersession") {
        if (record.kind !== "fieldObservation") {
          throw new Error("Typed correction is currently available for observations only.");
        }
        if (!parsedCorrection.success || !correctionDescriptor) {
          throw new Error("A typed correction value is required.");
        }
        supersedingRecord = {
          kind: "fieldObservation",
          value: {
            ...record.value,
            id: crypto.randomUUID(),
            supersedesId: record.value.id,
            captureConfidenceReason: parsedCorrection.data,
            value: {
              ...record.value.value,
              [correctionDescriptor.key]: correctionDescriptor.parse(parsedCorrection.data),
            },
          },
        };
      }
      const review = await appendFieldReview({
        review: {
          decision: selectedDecision,
          id,
          recordId: record.value.id,
          reviewerId: security.claims?.accountId ?? "unknown",
          reviewerMatchesResearcher: security.claims?.accountId === record.value.researcherId,
          reviewedAt: new Date().toISOString(),
          ...(selectedDecision === "exclude" || selectedDecision === "needs_more_evidence"
            ? { reason }
            : {}),
          ...(followUp ? { followUp } : {}),
          ...(conflictReviewRequired ? { conflictDisposition } : {}),
          ...(supersedingRecord ? { supersedingRecord } : {}),
        },
        work: props.work,
      });
      await props.onSave(review);
      setReason("");
      setCorrection("");
      setMessage("Decision appended to encrypted Desk custody.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision was not saved.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const normalized = availableDecisions.some(([value]) => value === decision)
      ? decision
      : "include";
    if (normalized !== decision) setDecision(normalized);
  }, [availableDecisions, decision]);

  useEffect(() => {
    if (!recordId) {
      setConflictDisposition("unresolved");
      return;
    }
    const disposition = prior?.conflictDisposition;
    setConflictDisposition(
      disposition === "resolved" || disposition === "intentional_repetition"
        ? disposition
        : "unresolved",
    );
  }, [prior?.conflictDisposition, recordId]);

  return (
    <FieldMain
      landmark={!props.embedded}
      className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6"
    >
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#review-record"
      >
        Skip to record review
      </a>
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ddd8ef] bg-[#05082a] px-5 py-4 text-[#fff9e9]">
          <div>
            <h1 className="text-2xl font-semibold">Field review</h1>
            <p className="mt-1 text-sm text-[#d8d5f4]">
              Assignment-centred, append-only Desk custody
            </p>
          </div>
          <span className="text-sm" role="status">
            {props.status}
          </span>
        </header>
        <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            className="border-b border-[#ddd8ef] bg-[#fbf6e8] p-5 lg:border-b-0 lg:border-r"
            aria-label="Assignment queue"
          >
            <h2 className="text-base font-bold">Assignment queue</h2>
            <div className="mt-4 space-y-2">
              {records.map((entry, index) => (
                <button
                  className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm ${index === recordIndex ? "bg-[#ddfbf4] font-bold" : "bg-white"}`}
                  key={entry.value.id}
                  onClick={() => setRecordIndex(index)}
                  type="button"
                >
                  {entry.kind}
                  <span className="mt-1 block text-xs font-normal">{entry.value.id}</span>
                </button>
              ))}
            </div>
            <dl className="mt-5 space-y-3 border-t border-[#ddd8ef] pt-4 text-sm">
              <div>
                <dt className="font-bold">Custody</dt>
                <dd className="text-[#5f5f87]">Encrypted · saved durably</dd>
              </div>
              <div>
                <dt className="font-bold">Archive revision</dt>
                <dd className="text-[#5f5f87]">{props.work.revision}</dd>
              </div>
            </dl>
          </aside>
          <section className="p-5 sm:p-7" id="review-record">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ddd8ef] pb-5">
              <div>
                <h2 className="text-xl font-semibold">Visit evidence</h2>
                <p className="mt-1 text-sm text-[#5f5f87]">{record?.kind} · immutable original</p>
              </div>
              <span className="rounded-full bg-[#f5f3ff] px-3 py-2 text-xs font-bold text-[#271776]">
                {prior?.decision ?? "Awaiting review"}
              </span>
            </div>
            <RecordSummary prior={prior} record={record} work={props.work} />
            <fieldset className="mt-6">
              <legend className="text-base font-bold">Record a Field Review decision</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {availableDecisions.map(([value, label, description]) => (
                  <label
                    className="flex min-h-16 cursor-pointer gap-3 rounded-lg border border-[#ddd8ef] p-3 has-[:checked]:border-[#0a6f67] has-[:checked]:bg-[#ddfbf4]"
                    key={value}
                  >
                    <input
                      checked={selectedDecision === value}
                      className="mt-1"
                      name="field-review-decision"
                      onChange={() => setDecision(value)}
                      type="radio"
                      value={value}
                    />
                    <span>
                      <span className="block font-bold">{label}</span>
                      <span className="text-sm text-[#5f5f87]">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {decision === "exclude" || decision === "needs_more_evidence" ? (
              <label className="mt-5 block font-bold" htmlFor="review-reason">
                Review reason
                <textarea
                  className="mt-2 min-h-24 w-full rounded-lg border border-[#b9b2d0] bg-white p-3 font-normal"
                  id="review-reason"
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
              </label>
            ) : null}
            {selectedDecision === "correct_by_supersession" ? (
              <label className="mt-5 block font-bold" htmlFor="corrected-value">
                Corrected observation value
                <input
                  aria-describedby="corrected-value-help"
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#b9b2d0] bg-white px-3 font-normal"
                  id="corrected-value"
                  maxLength={500}
                  onChange={(event) => setCorrection(event.target.value)}
                  value={correction}
                />
                <span
                  className="mt-1 block text-xs font-normal text-[#5f5f87]"
                  id="corrected-value-help"
                >
                  {correctionDescriptor?.label ?? "Typed value"}; use the governed field format.{" "}
                  {correction.length}/500
                </span>
              </label>
            ) : null}
            {conflictReviewRequired ? (
              <label className="mt-5 block font-bold" htmlFor="conflict-disposition">
                Conflict disposition
                <select
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#b9b2d0] bg-white px-3 font-normal"
                  id="conflict-disposition"
                  onChange={(event) =>
                    setConflictDisposition(
                      event.target.value as "resolved" | "intentional_repetition" | "unresolved",
                    )
                  }
                  value={conflictDisposition}
                >
                  <option value="unresolved">Unresolved — keep export blocked</option>
                  <option value="resolved">Resolved conflict</option>
                  <option value="intentional_repetition">Intentional repetition</option>
                </select>
              </label>
            ) : null}
            <button
              className="mt-6 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white disabled:opacity-50"
              disabled={!canSubmit || saving}
              onClick={saveDecision}
              type="button"
            >
              {saving ? "Saving…" : "Record append-only decision"}
            </button>
            {message ? (
              <p className="mt-3 text-sm" role="status">
                {message}
              </p>
            ) : null}
            <section aria-live="polite" className="mt-7 border-t border-[#ddd8ef] pt-5">
              <h3 className="font-bold">Review history</h3>
              {props.work.reviews.length === 0 ? (
                <p className="mt-2 text-sm text-[#5f5f87]">No human decision has been recorded.</p>
              ) : (
                <ol className="mt-2 divide-y divide-[#ddd8ef]">
                  {props.work.reviews.map((entry) => (
                    <li className="py-3 text-sm" key={entry.id}>
                      <strong>{entry.decision}</strong> · {entry.recordId}
                      <span className="mt-1 block text-[#5f5f87]">
                        {entry.reason ?? "No reason supplied"} · {entry.reviewedAt}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <button
              className="mt-5 text-sm font-bold text-[#5d3ed1] underline"
              onClick={() => void props.onReload()}
              type="button"
            >
              Reload encrypted custody
            </button>
          </section>
        </div>
      </div>
    </FieldMain>
  );
}

export function RecordSummary(props: {
  prior?: FieldDeskWork["reviews"][number];
  record?: RecorderRecord;
  work?: FieldDeskWork;
}) {
  const { prior, record, work } = props;
  if (!record) return null;
  const value = record.value as unknown as Record<string, unknown>;
  const coverage = work?.recorderWork.objectiveCoverage
    .flatMap((objective) => objective.requirements)
    .find((requirement) => requirement.coverageRequirementId === value.coverageRequirementId);
  const visit = value.visitId
    ? work?.recorderWork.records.find(
        (candidate) => candidate.kind === "fieldVisit" && candidate.value.id === value.visitId,
      )
    : undefined;
  const assignment = value.assignmentId
    ? work?.recorderWork.assignments?.find(
        (candidate) => candidate.assignmentId === value.assignmentId,
      )
    : undefined;
  const assignmentOutcome = assignment?.outcomeId
    ? work?.recorderWork.assignmentOutcomes.find(
        (candidate) => candidate.id === assignment.outcomeId,
      )
    : undefined;
  const objective = value.objectiveId
    ? work?.recorderWork.objectiveCoverage.find(
        (candidate) => candidate.objectiveId === value.objectiveId,
      )
    : undefined;
  const fields: Array<[string, unknown]> = [
    ["Record type", record.kind],
    ["Record ID", value.id],
    ["Assignment", value.assignmentId],
    ["Visit", value.visitId],
    ["Recorded", value.recordedAt],
    ["Capture state", value.captureState],
  ];
  if (record.kind === "fieldObservation") {
    fields.push(
      ["Observation kind", record.value.observationKind],
      ["Directness", record.value.directness],
      ["Observed", record.value.observedAt],
      ["Confidence", record.value.captureConfidence],
      ["Subject", record.value.subject.kind],
      ["Reviewable observation value", reviewSafeObservationValue(record.value.value)],
    );
  } else if (record.kind === "fieldVisit") {
    fields.push(
      ["Started", record.value.startedAt],
      ["Ended", record.value.endedAt],
      ["Location permission", record.value.locationPermissionState],
      ["Target", record.value.target.kind],
    );
  } else if (record.kind === "routeRun") {
    fields.push(
      ["Transport", record.value.transportMode],
      ["Requested", record.value.requestedAt],
      ["Departed", record.value.departedAt],
      ["Arrived", record.value.arrivedAt],
    );
  }
  fields.push(
    ["Protocol", `${String(value.protocolPackageId)}@${String(value.protocolPackageVersion)}`],
    ["Campaign", value.campaignId],
    ["Researcher", value.researcherId],
    ["Device", value.deviceId],
    ["Source statement", value.sourceStatementId],
    ["Source asset", value.sourceAssetId],
    ["Translations", Array.isArray(value.translationIds) ? value.translationIds.length : 0],
    ["Redacted derivative", value.redactedDerivativeId],
    ["Coverage requirement", value.coverageRequirementId],
    ["Objective", value.objectiveId],
    ["Capture windows", Array.isArray(value.captureWindowIds) ? value.captureWindowIds.length : 0],
    ["Linked assets", Array.isArray(value.assetIds) ? value.assetIds.length : 0],
    ["Supersedes", value.supersedesId],
    [
      "Conflict links",
      Array.isArray(value.contradictsObservationIds) ? value.contradictsObservationIds.length : 0,
    ],
    ["Review conflict disposition", prior?.conflictDisposition],
  );
  if (coverage) {
    fields.push(
      ["Coverage status", coverage.status],
      ["Captured / required", `${coverage.capturedRecords} / ${coverage.requiredRecords}`],
      ["Windows / required", `${coverage.distinctWindows} / ${coverage.requiredDistinctWindows}`],
      ["Supporting assets", coverage.supportingAssets],
      ["Coverage reason codes", coverage.reasonCodes.join(", ") || "None"],
    );
  }
  if (assignment) {
    fields.push(
      ["Assignment status", assignment.status],
      [
        "Assignment unresolved requirements",
        assignment.unresolvedRequirementIds.join(", ") || "None",
      ],
      ["Assignment linked Visits", assignment.visitIds.join(", ") || "None"],
    );
  }
  if (assignmentOutcome) {
    fields.push(
      ["Assignment outcome", assignmentOutcome.status],
      [
        "Outcome unresolved requirements",
        assignmentOutcome.unresolvedRequirementIds.join(", ") || "None",
      ],
      ["Outcome follow-ups", assignmentOutcome.followUpAssignmentIds.join(", ") || "None"],
    );
  }
  if (objective) {
    fields.push(
      ["Objective status", objective.status],
      ["Objective source records", objective.sourceRecordIds.join(", ") || "None"],
      ["Objective requirements", objective.requirements.length],
    );
  }
  if (visit?.kind === "fieldVisit") {
    fields.push(
      ["Visit started", visit.value.startedAt],
      ["Visit ended", visit.value.endedAt],
      ["Visit location permission", visit.value.locationPermissionState],
      ["Visit public location precision", visit.value.publicLocationPrecision],
    );
  }
  if (record.kind === "fieldObservation") {
    fields.push([
      "Rights",
      Object.entries(record.value.permissions)
        .filter(([, granted]) => granted)
        .map(([name]) => name)
        .join(", ") || "None",
    ]);
    fields.push(
      ["Observation caveat", record.value.caveat],
      ["Review due", record.value.reviewDueAt],
      ["Conflicts", record.value.contradictsObservationIds?.length ?? 0],
      ["Conflict record IDs", record.value.contradictsObservationIds?.join(", ") || "None"],
    );
  } else if (record.kind === "evidenceAsset") {
    fields.push(
      ["Asset bytes", record.value.byteSize],
      ["Asset hash", record.value.contentSha256],
      ["Asset purpose", record.value.purpose],
      ["Asset media type", record.value.mediaType],
      ["Rights", record.value.rights],
      ["Consent", record.value.consentState],
      ["Redaction", record.value.redactionState],
      ["Retention", record.value.retentionState],
    );
  } else if (record.kind === "sourceStatement") {
    fields.push(
      ["Question asked", record.value.questionAsked],
      ["Protected source statement", record.value.originalStatement],
      ["Basis of knowledge", record.value.basisOfKnowledge],
      ["Capture context", record.value.captureContext],
      ["Source language", record.value.originalLanguage],
      ["Source form", record.value.statementForm],
      ["Source role", record.value.sourceRole],
      ["Attribution", record.value.attribution],
      ["Participation consent", record.value.consents.participation.decision],
      ["LLM-use consent", record.value.consents.llmUse.decision],
      ["Quotation consent", record.value.consents.quotationUse.decision],
      ["Public-use consent", record.value.consents.publicUse.decision],
    );
  } else if (record.kind === "captureException") {
    fields.push(
      ["Exception reason", record.value.reason],
      ["Exception context", record.value.context],
      ["Exception details", record.value.reasonDetails],
    );
  } else if (record.kind === "schemaGap") {
    fields.push(
      ["Schema gap", record.value.description],
      ["Schema gap resolution", record.value.resolutionState],
      ["Schema gap location", record.value.permittedLocation],
      ["Schema gap asset", record.value.assetId],
    );
  }
  return (
    <dl className="mt-5 grid gap-3 rounded-lg bg-[#fbf6e8] p-4 text-sm sm:grid-cols-2">
      {fields.map(([label, field]) => (
        <div key={label}>
          <dt className="font-bold">{label}</dt>
          <dd className="break-words text-[#5f5f87]">{displayField(field)}</dd>
        </div>
      ))}
    </dl>
  );
}

function displayField(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not recorded";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "Structured protected field";
}

const reviewSafeObservationKeys = [
  "amount",
  "basis",
  "currency",
  "distanceMeters",
  "durationMinutes",
  "negotiated",
  "partySize",
  "paymentMethodAttempted",
  "pricingUnit",
  "taxesAndFees",
  "unit",
  "value",
] as const;

function reviewSafeObservationValue(value: Readonly<Record<string, unknown>>): string {
  const fields = reviewSafeObservationKeys.flatMap((key) => {
    const candidate = value[key];
    if (
      typeof candidate !== "string" &&
      typeof candidate !== "number" &&
      typeof candidate !== "boolean"
    ) {
      return [];
    }
    const text = String(candidate);
    return [[key, text.length > 120 ? `${text.slice(0, 117)}…` : text] as const];
  });
  return fields.length > 0
    ? fields.map(([key, candidate]) => `${key}: ${candidate}`).join(" · ")
    : "No non-sensitive value fields available";
}

function LockedDeskState(props: { embedded?: boolean }) {
  return (
    <FieldMain landmark={!props.embedded} className="min-h-screen bg-[#f5eddc] p-6 text-[#0d104a]">
      <section className="mx-auto max-w-2xl rounded-xl bg-[#fffdf7] p-8">
        <h1 className="text-2xl font-semibold">Field review locked</h1>
        <p className="mt-2 text-[#5f5f87]">
          Encrypted Recorder and Desk custody is unavailable until this Authorized Field Device is
          unlocked.
        </p>
      </section>
    </FieldMain>
  );
}
function EmptyDeskState(props: {
  embedded?: boolean;
  loading: boolean;
  message: string;
  onReload: () => Promise<void>;
}) {
  return (
    <FieldMain landmark={!props.embedded} className="min-h-screen bg-[#f5eddc] p-6 text-[#0d104a]">
      <section className="mx-auto max-w-2xl rounded-xl bg-[#fffdf7] p-8">
        <h1 className="text-2xl font-semibold">
          {props.loading ? "Loading Desk custody…" : "No closed outing is waiting"}
        </h1>
        <p className="mt-2 text-[#5f5f87]">{props.message}</p>
        <button
          className="mt-5 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white"
          onClick={() => void props.onReload()}
          type="button"
        >
          Reload encrypted custody
        </button>
      </section>
    </FieldMain>
  );
}
function HarnessFieldDesk() {
  const [decision, setDecision] = useState<(typeof decisions)[number][0]>("include");
  const [reason, setReason] = useState("");
  const [correction, setCorrection] = useState("");
  const [history, setHistory] = useState<Array<{ detail: string; id: string; label: string }>>([]);
  const canSubmit =
    (decision !== "exclude" &&
      decision !== "needs_more_evidence" &&
      decision !== "correct_by_supersession") ||
    (decision === "correct_by_supersession"
      ? correction.trim().length > 0
      : reason.trim().length > 0);

  return (
    <FieldMain className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#review-record"
      >
        Skip to record review
      </a>
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="border-b border-[#ddd8ef] bg-[#05082a] px-5 py-4 text-[#fff9e9]">
          <h1 className="text-2xl font-semibold">Field review</h1>
          <p className="mt-1 text-sm text-[#d8d5f4]">
            Assignment-centred, append-only Desk custody
          </p>
        </header>
        <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label="Assignment queue"
            className="border-b border-[#ddd8ef] bg-[#fbf6e8] p-5 lg:border-b-0 lg:border-r"
          >
            <h2 className="text-base font-bold">Assignment queue</h2>
            <button
              className="mt-4 min-h-11 w-full rounded-lg bg-[#ddfbf4] px-3 text-left font-bold text-[#062f35]"
              type="button"
            >
              Del Carmen essentials
              <span className="mt-1 block text-xs font-normal">
                1 Visit · 1 record awaiting review
              </span>
            </button>
            <dl className="mt-5 space-y-3 border-t border-[#ddd8ef] pt-4 text-sm">
              <div>
                <dt className="font-bold">Objective coverage</dt>
                <dd className="text-[#5f5f87]">Opening signal · satisfied</dd>
              </div>
              <div>
                <dt className="font-bold">Reviewer</dt>
                <dd className="text-[#5f5f87]">Same-person status shown explicitly</dd>
              </div>
              <div>
                <dt className="font-bold">Custody</dt>
                <dd className="text-[#5f5f87]">Encrypted · saved durably</dd>
              </div>
            </dl>
          </aside>

          <section className="p-5 sm:p-7" id="review-record">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ddd8ef] pb-5">
              <div>
                <h2 className="text-xl font-semibold">Visit evidence</h2>
                <p className="mt-1 text-sm text-[#5f5f87]">
                  Opening state · direct observation · immutable original
                </p>
              </div>
              <span className="rounded-full bg-[#f5f3ff] px-3 py-2 text-xs font-bold text-[#271776]">
                Ready for Desk
              </span>
            </div>

            <dl className="grid gap-3 border-b border-[#ddd8ef] py-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="font-bold">Rights</dt>
                <dd className="text-[#5f5f87]">Research internal</dd>
              </div>
              <div>
                <dt className="font-bold">Provenance</dt>
                <dd className="text-[#5f5f87]">Pinned Capture Protocol 1.0.1</dd>
              </div>
              <div>
                <dt className="font-bold">Conflict</dt>
                <dd className="text-[#5f5f87]">No unresolved contradiction</dd>
              </div>
            </dl>

            <fieldset className="mt-6">
              <legend className="text-base font-bold">Record a Field Review decision</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {decisions.map(([value, label, description]) => (
                  <label
                    className="flex min-h-16 cursor-pointer gap-3 rounded-lg border border-[#ddd8ef] p-3 has-[:checked]:border-[#0a6f67] has-[:checked]:bg-[#ddfbf4]"
                    key={value}
                  >
                    <input
                      checked={decision === value}
                      className="mt-1"
                      name="field-review-decision"
                      onChange={() => setDecision(value)}
                      type="radio"
                      value={value}
                    />
                    <span>
                      <span className="block font-bold">{label}</span>
                      <span className="text-sm text-[#5f5f87]">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {decision === "exclude" || decision === "needs_more_evidence" ? (
              <label className="mt-5 block font-bold" htmlFor="review-reason">
                Review reason
                <textarea
                  className="mt-2 min-h-24 w-full rounded-lg border border-[#b9b2d0] bg-white p-3 font-normal focus:outline-none focus:ring-3 focus:ring-[#14b8a6]/40"
                  id="review-reason"
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
              </label>
            ) : null}
            {decision === "correct_by_supersession" ? (
              <label className="mt-5 block font-bold" htmlFor="corrected-value">
                Corrected observation value
                <input
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#b9b2d0] bg-white px-3 font-normal focus:outline-none focus:ring-3 focus:ring-[#14b8a6]/40"
                  id="corrected-value"
                  onChange={(event) => setCorrection(event.target.value)}
                  value={correction}
                />
                <span className="mt-1 block text-sm font-normal text-[#5f5f87]">
                  A typed captured successor will point to this frozen original.
                </span>
              </label>
            ) : null}
            <button
              className="mt-6 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white focus:outline-none focus:ring-3 focus:ring-[#5d3ed1] disabled:opacity-50"
              disabled={!canSubmit}
              onClick={() => {
                const immutableId = crypto.randomUUID();
                const detail =
                  decision === "exclude"
                    ? `Reason: ${reason.trim()}`
                    : decision === "needs_more_evidence"
                      ? `Reason: ${reason.trim()} · Linked Follow-up Assignment follow_up_${immutableId.slice(0, 8)}`
                      : decision === "correct_by_supersession"
                        ? `Typed successor successor_${immutableId.slice(0, 8)}: ${correction.trim()}`
                        : "Included in the reviewed selection";
                setHistory((current) => [
                  ...current,
                  {
                    detail,
                    id: immutableId,
                    label: decisions.find(([value]) => value === decision)?.[1] ?? decision,
                  },
                ]);
              }}
              type="button"
            >
              Record append-only decision
            </button>

            <section aria-live="polite" className="mt-7 border-t border-[#ddd8ef] pt-5">
              <h3 className="font-bold">Review history</h3>
              {history.length === 0 ? (
                <p className="mt-2 text-sm text-[#5f5f87]">No human decision has been recorded.</p>
              ) : (
                <ol className="mt-2 divide-y divide-[#ddd8ef]">
                  {history.map((entry) => (
                    <li className="py-3 text-sm" key={entry.id}>
                      <strong>{entry.label}</strong> · {entry.detail}
                      <span className="mt-1 block text-[#5f5f87]">
                        Reviewer and researcher are the same person
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </section>
        </div>
      </div>
    </FieldMain>
  );
}
