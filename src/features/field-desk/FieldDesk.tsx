"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecorderRecord } from "@/features/field-recorder/field-recorder-types";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
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

export function FieldDesk(props: { harness?: boolean }) {
  return props.harness ? <HarnessFieldDesk /> : <ProductionFieldDesk />;
}

function ProductionFieldDesk() {
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
        <LockedDeskState />
      </>
    );
  }
  if (!selected)
    return <EmptyDeskState loading={loading} message={status} onReload={loadCustody} />;
  return (
    <DeskReviewSurface
      key={selected.archiveId}
      status={status}
      work={selected}
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const records = allRecords(props.work);
  const record = records[recordIndex] ?? records[0];
  const prior = record ? effectiveReview(props.work, record.value.id) : undefined;
  const canSubmit =
    decision === "include" ||
    (decision === "correct_by_supersession"
      ? correction.trim().length > 0
      : reason.trim().length > 0);

  async function saveDecision() {
    if (!record || !canSubmit || saving) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      let supersedingRecord: RecorderRecord | undefined;
      if (decision === "correct_by_supersession") {
        const corrected = JSON.parse(correction) as typeof record.value;
        if (!corrected || corrected.id === record.value.id) {
          throw new Error("A superseding record must have a new immutable ID.");
        }
        supersedingRecord = { ...record, value: corrected } as RecorderRecord;
      }
      const review = await appendFieldReview({
        review: {
          decision,
          id,
          recordId: record.value.id,
          reviewerId: security.claims?.accountId ?? "unknown",
          reviewerMatchesResearcher: security.claims?.accountId === record.value.researcherId,
          reviewedAt: new Date().toISOString(),
          ...(decision === "exclude" || decision === "needs_more_evidence" ? { reason } : {}),
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

  return (
    <main className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6" id="main-content">
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
            <pre className="mt-5 max-h-56 overflow-auto rounded-lg bg-[#fbf6e8] p-4 text-xs">
              {JSON.stringify(record?.value, null, 2)}
            </pre>
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
                  className="mt-2 min-h-24 w-full rounded-lg border border-[#b9b2d0] bg-white p-3 font-normal"
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
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#b9b2d0] bg-white px-3 font-normal"
                  id="corrected-value"
                  onChange={(event) => setCorrection(event.target.value)}
                  value={correction}
                />
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
    </main>
  );
}

function LockedDeskState() {
  return (
    <main className="min-h-screen bg-[#f5eddc] p-6 text-[#0d104a]" id="main-content">
      <section className="mx-auto max-w-2xl rounded-xl bg-[#fffdf7] p-8">
        <h1 className="text-2xl font-semibold">Field review locked</h1>
        <p className="mt-2 text-[#5f5f87]">
          Encrypted Recorder and Desk custody is unavailable until this Authorized Field Device is
          unlocked.
        </p>
      </section>
    </main>
  );
}
function EmptyDeskState(props: {
  loading: boolean;
  message: string;
  onReload: () => Promise<void>;
}) {
  return (
    <main className="min-h-screen bg-[#f5eddc] p-6 text-[#0d104a]" id="main-content">
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
    </main>
  );
}
function HarnessFieldDesk() {
  const [history, setHistory] = useState<Array<{ detail: string; id: string; label: string }>>([]);
  const [decision, setDecision] = useState<(typeof decisions)[number][0]>("include");
  const [reason, setReason] = useState("");
  return (
    <main className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a]" id="main-content">
      <section className="mx-auto max-w-3xl rounded-xl bg-[#fffdf7] p-8">
        <h1 className="text-2xl font-semibold">Field review</h1>
        <p className="mt-2">Harness fixture · protected UI only</p>
        <fieldset className="mt-6">
          <legend className="font-bold">Record a Field Review decision</legend>
          {decisions.map(([value, label]) => (
            <label className="mr-4 inline-flex gap-2" key={value}>
              <input
                checked={decision === value}
                name="harness-decision"
                onChange={() => setDecision(value)}
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <textarea
          className="mt-4 w-full rounded border p-3"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
        <button
          className="mt-4 rounded bg-[#0a6f67] px-4 py-3 font-bold text-white"
          onClick={() =>
            setHistory((current) => [
              ...current,
              { detail: reason, id: crypto.randomUUID(), label: decision },
            ])
          }
          type="button"
        >
          Record fixture decision
        </button>
        <ol className="mt-5">
          {history.map((entry) => (
            <li key={entry.id}>
              {entry.label} · {entry.detail}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
