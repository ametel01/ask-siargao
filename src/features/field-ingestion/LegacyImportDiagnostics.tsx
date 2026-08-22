"use client";

import { AlertTriangle, Archive, FileLock2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { fieldSecurityErrorCode } from "@/features/field-security/errors";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { LegacyCaptureRepository } from "./legacy-capture-repository";
import { type LegacyCapturePreview, LegacyCaptureRecognitionError } from "./legacy-field-capture";

type Notice = { kind: "error" | "success"; message: string };
const harnessKey = new Uint8Array(32).fill(23);

export function LegacyImportDiagnostics(props: { harness?: boolean; rollbackAlias?: boolean }) {
  const security = useFieldSecuritySession();
  const [preview, setPreview] = useState<LegacyCapturePreview>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const unlocked = security.status === "unlocked" || props.harness === true;

  async function withKey<T>(callback: (key: Uint8Array) => Promise<T>): Promise<T> {
    if (props.harness) return callback(harnessKey);
    return security.withVaultKey(callback);
  }

  async function preserve(file: File | undefined) {
    if (!file || !unlocked) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await withKey((key) =>
        new LegacyCaptureRepository().preserveSource({
          bytes,
          importedAt: new Date().toISOString(),
          key,
          sourceName: file.name,
        }),
      );
      setPreview(result.preview);
      setNotice({
        kind: "success",
        message:
          result.result === "exact_replay"
            ? "Exact replay found. Existing encrypted custody and preview were reused."
            : "Original bytes and the non-mutating preview were preserved in encrypted custody.",
      });
    } catch (error) {
      setPreview(undefined);
      setNotice({
        kind: "error",
        message:
          error instanceof LegacyCaptureRecognitionError
            ? error.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" ")
            : `Legacy Capture remains quarantined (${fieldSecurityErrorCode(error)}).`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function recordDecision(disposition: "defer_resolution" | "preserve_quarantined") {
    if (!preview || !unlocked) return;
    setBusy(true);
    try {
      await withKey((key) =>
        new LegacyCaptureRepository().recordDecision({
          decidedAt: new Date().toISOString(),
          disposition,
          expectedDestinationStateSha256: preview.destinationStateSha256,
          expectedPreviewSha256: preview.previewSha256,
          key,
          rationale:
            disposition === "preserve_quarantined"
              ? "Preserve immutable Legacy Capture outside Recorder and Desk custody."
              : "Defer mapping until every rights, reference, and Schema Gap is resolved.",
          sourceId: `legacy_source_${preview.source.sha256}`,
        }),
      );
      setNotice({
        kind: "success",
        message: "Append-only decision recorded. No record was promoted to Desk or Export.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: `Decision rejected because the preview is stale or unavailable (${fieldSecurityErrorCode(error)}).`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function discoverOldBrowserData() {
    if (!unlocked) return;
    setBusy(true);
    try {
      const records = await withKey((key) =>
        new LegacyCaptureRepository().discoverOldBrowserCustody({
          importedAt: new Date().toISOString(),
          key,
        }),
      );
      setNotice({
        kind: "success",
        message:
          records.length === 0
            ? "No historical PR #226 browser rows were found."
            : `${records.length} historical row${records.length === 1 ? "" : "s"} copied into encrypted custody. Original source bytes remain unavailable because the old store never retained them.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: `Historical browser discovery remained read-only (${fieldSecurityErrorCode(error)}).`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6"
      data-legacy-import-diagnostics
    >
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="border-b border-[#ddd8ef] bg-[#05082a] px-6 py-7 text-[#fff9e9]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8cebdd]">
            Field Workspace · exceptional compatibility
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Legacy import — Diagnostics and Recovery</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#d8d5f4]">
            Use only to preserve, diagnose, and preview PR #226 Legacy Capture. This is not Field
            Recorder capture, Field Desk review, or Field Ingestion.
          </p>
          {props.rollbackAlias ? (
            <p className="mt-3 rounded-lg border border-[#8cebdd]/40 px-3 py-2 text-sm">
              Recovery fallback is active at the temporary old URL. Authorization and behavior are
              identical to the canonical compatibility route.
            </p>
          ) : null}
        </header>

        <section className="grid gap-4 border-b border-[#ddd8ef] p-6 md:grid-cols-3">
          <BoundaryCard
            icon={FileLock2}
            title="Exact historical versions"
            text="field-record.v1, arrays or JSONL containing only that schema, and internally consistent embedded field-batch.v1. Current field-batch.v2 is rejected."
          />
          <BoundaryCard
            icon={Archive}
            title="Encrypted originals"
            text="New source bytes, lineage, previews, variants, and decisions remain in the protected Field Vault. Old browser rows disclose when original bytes are unavailable."
          />
          <BoundaryCard
            icon={ShieldCheck}
            title="No promotion"
            text="Preview is non-mutating. Nothing becomes Ready for Desk or Export. No server upload, PostgreSQL write, Fact Admission, or publication occurs."
          />
        </section>

        <section className="p-6" aria-labelledby="legacy-source-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold" id="legacy-source-heading">
                Preserve a Legacy Capture source
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5f5f87]">
                An Authorized Field Device unlock is required before source values or custody
                actions appear. Filename never supplies a missing version or record type.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-2 text-xs font-bold ${unlocked ? "bg-[#ddfbf4] text-[#062f35]" : "bg-[#fff1d8] text-[#704314]"}`}
              role="status"
            >
              {unlocked ? "Authorized Field Device unlocked" : "Protected data locked"}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <label
              className={`inline-flex min-h-11 items-center rounded-lg bg-[#0a6f67] px-5 font-bold text-white ${!unlocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              Preserve and preview source
              <input
                accept=".json,.jsonl,application/json"
                className="sr-only"
                data-testid="legacy-capture-file-input"
                disabled={!unlocked || busy}
                onChange={(event) => void preserve(event.target.files?.[0])}
                type="file"
              />
            </label>
            <button
              className="min-h-11 rounded-lg border border-[#0a6f67] px-5 font-bold text-[#0a6f67] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!unlocked || busy}
              onClick={() => void discoverOldBrowserData()}
              type="button"
            >
              Discover old browser custody
            </button>
          </div>
          {notice ? (
            <p
              className={`mt-5 rounded-lg border p-4 text-sm ${notice.kind === "error" ? "border-[#be3b3b] bg-[#fff0ef] text-[#711d1d]" : "border-[#0a6f67] bg-[#ddfbf4] text-[#062f35]"}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.message}
            </p>
          ) : null}
        </section>

        {preview ? (
          <PreviewReport busy={busy} onDecision={recordDecision} preview={preview} />
        ) : null}
      </div>
    </div>
  );
}

function BoundaryCard(props: {
  icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  text: string;
  title: string;
}) {
  const Icon = props.icon;
  return (
    <article className="rounded-lg border border-[#ddd8ef] bg-[#fbf6e8] p-4">
      <Icon aria-hidden className="size-5 text-[#0a6f67]" />
      <h2 className="mt-3 font-bold">{props.title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#5f5f87]">{props.text}</p>
    </article>
  );
}

function PreviewReport(props: {
  busy: boolean;
  onDecision: (decision: "defer_resolution" | "preserve_quarantined") => Promise<void>;
  preview: LegacyCapturePreview;
}) {
  return (
    <section className="border-t border-[#ddd8ef] p-6" aria-labelledby="legacy-preview-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#5d3ed1]">
            Non-mutating Protocol Migration preview
          </p>
          <h2 className="mt-1 text-xl font-semibold" id="legacy-preview-heading">
            Quarantined corpus report
          </h2>
        </div>
        <span className="rounded-full bg-[#fff1d8] px-3 py-2 text-xs font-bold text-[#704314]">
          {formatLabel(props.preview.state)} · never Ready
        </span>
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <Stat label="Recognized" value={`${props.preview.source.artifactKind} · field-record.v1`} />
        <Stat label="Signed migration" value={props.preview.migrationId} />
        <Stat label="Target" value={props.preview.targetPackage} />
      </dl>
      <div className="mt-6 space-y-4">
        {props.preview.records.map((record, index) => (
          <article
            className="rounded-lg border border-[#ddd8ef] p-4"
            key={`${record.recordId}:${record.originalSha256}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">
                Legacy {record.recordType} #{index + 1}
              </h3>
              <span className="text-xs font-bold text-[#704314]">{formatLabel(record.status)}</span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ReportList
                empty="No signed automatic mapping."
                items={record.mappings.map(
                  (entry) =>
                    `${entry.sourcePath}: ${entry.sourceValue} → ${entry.targetPath}: ${entry.targetValue}`,
                )}
                title="Explicit mappings"
              />
              <ReportList
                empty="No omitted legacy properties."
                items={record.omissions}
                title="Explicit omissions"
              />
              <ReportList
                empty="No rights gaps reported."
                items={record.gaps
                  .filter((gap) =>
                    ["permission_escalation", "rights_gap", "redaction_blocker"].includes(gap.code),
                  )
                  .map((gap) => gap.message)}
                title="Rights gaps"
              />
              <ReportList
                empty="No Schema Gap candidate reported."
                items={record.gaps
                  .filter((gap) => gap.code === "schema_gap_candidate")
                  .map((gap) => gap.message)}
                title="Schema Gap candidates"
              />
              <ReportList
                empty="No other blockers reported."
                items={record.gaps
                  .filter(
                    (gap) =>
                      ![
                        "permission_escalation",
                        "rights_gap",
                        "redaction_blocker",
                        "schema_gap_candidate",
                      ].includes(gap.code),
                  )
                  .map((gap) => `${gap.code}: ${gap.message}`)}
                title="References, conflicts, and validation blockers"
              />
            </div>
          </article>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#ddd8ef] pt-5">
        <AlertTriangle aria-hidden className="size-5 text-[#8a4d08]" />
        <p className="mr-auto max-w-xl text-sm text-[#5f5f87]">
          A decision preserves quarantine or defers resolution. It cannot admit, publish, or make a
          Legacy Capture exportable.
        </p>
        <button
          className="min-h-11 rounded-lg border border-[#5d3ed1] px-4 font-bold text-[#271776] disabled:opacity-50"
          disabled={props.busy}
          onClick={() => void props.onDecision("defer_resolution")}
          type="button"
        >
          Defer resolution
        </button>
        <button
          className="min-h-11 rounded-lg bg-[#5d3ed1] px-4 font-bold text-white disabled:opacity-50"
          disabled={props.busy}
          onClick={() => void props.onDecision("preserve_quarantined")}
          type="button"
        >
          Preserve quarantined decision
        </button>
      </div>
    </section>
  );
}

function ReportList(props: { empty: string; items: readonly string[]; title: string }) {
  return (
    <section>
      <h4 className="text-sm font-bold">{props.title}</h4>
      {props.items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#5f5f87]">
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[#5f5f87]">{props.empty}</p>
      )}
    </section>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f5f3ff] p-3">
      <dt className="font-bold">{props.label}</dt>
      <dd className="mt-1 break-words text-[#5f5f87]">{props.value}</dd>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}
