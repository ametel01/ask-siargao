"use client";

import Link from "next/link";
import { useState } from "react";

export function FieldExports(props: { harness?: boolean }) {
  const [recoveryState, setRecoveryState] = useState("Not created");
  const [batchState, setBatchState] = useState(
    props.harness
      ? "Eligible reviewed graph · every selected record is included and closed"
      : "Blocked until every selected record is included and closed",
  );
  const unavailableClass = " disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <main className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6" id="main-content">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#export-workflows"
      >
        Skip to export workflows
      </a>
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ddd8ef] bg-[#05082a] px-5 py-4 text-[#fff9e9]">
          <div>
            <h1 className="text-2xl font-semibold">Protected exports</h1>
            <p className="mt-1 text-sm text-[#d8d5f4]">Two formats, two eligibility contracts</p>
          </div>
          <nav aria-label="Field Workspace areas" className="flex gap-2 text-sm font-bold">
            <Link
              className="rounded-lg border border-white/30 px-4 py-3"
              href="/operator/field/review"
            >
              Review
            </Link>
            <span aria-current="page" className="rounded-lg bg-[#f5f3ff] px-4 py-3 text-[#271776]">
              Exports
            </span>
          </nav>
        </header>
        <div className="grid gap-0 lg:grid-cols-2" id="export-workflows">
          <section className="border-b border-[#ddd8ef] p-6 lg:border-b-0 lg:border-r sm:p-8">
            <h2 className="text-xl font-semibold">Field Recovery Export</h2>
            <p className="mt-2 text-[#5f5f87]">
              Complete private custody, including unfinished work, unresolved evidence, media, and
              Desk history. Never a reviewed batch.
            </p>
            <dl className="mt-6 divide-y divide-[#ddd8ef] text-sm">
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">File</dt>
                <dd>Generic .asfrecovery</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">Recipient</dt>
                <dd>Authorized Desk device</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">Restore action</dt>
                <dd>Preview and restore custody</dd>
              </div>
            </dl>
            <p className="mt-5 rounded-lg bg-[#fbf6e8] p-3 text-sm" role="status">
              {recoveryState}
            </p>
            <button
              className={`mt-4 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white focus:outline-none focus:ring-3 focus:ring-[#5d3ed1]${unavailableClass}`}
              disabled={!props.harness}
              onClick={() =>
                setRecoveryState("Created and locally re-opened · transfer receipt pending")
              }
              type="button"
            >
              Create Recovery Export
            </button>
            <button
              className={`ml-2 mt-4 min-h-11 rounded-lg border border-[#0a6f67] px-5 font-bold text-[#0a6f67] focus:outline-none focus:ring-3 focus:ring-[#5d3ed1]${unavailableClass}`}
              disabled={!props.harness}
              onClick={() =>
                setRecoveryState("Restore preview ready · explicit confirmation required")
              }
              type="button"
            >
              Restore Recovery Export
            </button>
          </section>
          <section className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">Field Batch</h2>
            <p className="mt-2 text-[#5f5f87]">
              An explicitly included, reviewed, referentially closed graph. Counts, file hashes, and
              readiness are derived here.
            </p>
            <dl className="mt-6 divide-y divide-[#ddd8ef] text-sm">
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">File</dt>
                <dd>Generic .asfbatch</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">Recipient</dt>
                <dd>Authorized ingestion Desk</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="font-bold">Import action</dt>
                <dd>Verify reviewed graph</dd>
              </div>
            </dl>
            <p className="mt-5 rounded-lg bg-[#f5f3ff] p-3 text-sm" role="status">
              {batchState}
            </p>
            <button
              className={`mt-4 min-h-11 rounded-lg bg-[#5d3ed1] px-5 font-bold text-white focus:outline-none focus:ring-3 focus:ring-[#0a6f67]${unavailableClass}`}
              disabled={!props.harness}
              onClick={() =>
                setBatchState("Created from the eligible graph · destination receipt pending")
              }
              type="button"
            >
              Create reviewed Field Batch
            </button>
            <button
              className={`ml-2 mt-4 min-h-11 rounded-lg border border-[#5d3ed1] px-5 font-bold text-[#271776] focus:outline-none focus:ring-3 focus:ring-[#0a6f67]${unavailableClass}`}
              disabled={!props.harness}
              onClick={() =>
                setBatchState("Recipient verification started · source receipt still required")
              }
              type="button"
            >
              Verify Field Batch
            </button>
          </section>
        </div>
        <footer className="border-t border-[#ddd8ef] bg-[#fbf6e8] px-6 py-4 text-sm text-[#5f5f87]">
          A copied file is not a Verified Field Transfer. Completion requires recipient decrypt,
          integrity and reference validation, a destination signature, and source receipt
          verification.
        </footer>
      </div>
    </main>
  );
}
