"use client";

import Link from "next/link";
import { useState } from "react";

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
          <nav aria-label="Field Workspace areas" className="flex gap-2 text-sm font-bold">
            <span aria-current="page" className="rounded-lg bg-[#ddfbf4] px-4 py-3 text-[#062f35]">
              Review
            </span>
            <Link
              className="rounded-lg border border-white/30 px-4 py-3"
              href="/operator/field/exports"
            >
              Exports
            </Link>
          </nav>
        </header>

        {!props.harness ? (
          <section className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">No closed outing is waiting</h2>
            <p className="mt-2 max-w-2xl text-[#5f5f87]">
              Close a Recorder outing, then move it into Desk custody. Previous outings and review
              history remain available after a new Plan starts.
            </p>
          </section>
        ) : (
          <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside
              className="border-b border-[#ddd8ef] bg-[#fbf6e8] p-5 lg:border-b-0 lg:border-r"
              aria-label="Assignment queue"
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
                  <p className="mt-2 text-sm text-[#5f5f87]">
                    No human decision has been recorded.
                  </p>
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
        )}
      </div>
    </main>
  );
}
