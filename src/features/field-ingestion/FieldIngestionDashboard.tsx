"use client";

import {
  AlertCircle,
  CheckCircle2,
  DatabaseZap,
  Download,
  FileJson2,
  FileWarning,
  HardDrive,
  Import,
  Lock,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type AnalyzedFieldRecord,
  analyzeFieldRecords,
  createFieldBatchEnvelope,
  createFieldTemplate,
  mergeFieldRecords,
  parseFieldFile,
  type StoredFieldRecord,
  toStoredFieldRecord,
  type ValidationIssue,
} from "@/features/field-ingestion/field-capture";
import {
  clearStoredFieldRecords,
  deleteStoredFieldRecord,
  loadStoredFieldRecords,
  saveStoredFieldRecords,
} from "@/features/field-ingestion/field-ingestion-store";
import { cn } from "@/lib/utils";
import {
  AppBackdrop,
  appBodyClass,
  appPanelClass,
  appShellClass,
  PageHeader,
  SectionHeading,
} from "@/ui/components/ask-siargao";

type QueueFilter = "all" | "ready" | "attention" | "conflict";
type Notice = { kind: "success" | "error"; title: string; detail: string };

const filterLabels: Record<QueueFilter, string> = {
  all: "All records",
  ready: "Ready",
  attention: "Needs attention",
  conflict: "Conflicts",
};

const lightPanelOutlineButtonClass =
  "border-border-strong bg-surface-default text-text-strong hover:bg-surface-subtle hover:text-text-strong";

export function FieldIngestionDashboard({ accessMode }: { accessMode: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<StoredFieldRecord[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [storageState, setStorageState] = useState<"loading" | "ready" | "error">("loading");
  const [isOnline, setIsOnline] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    loadStoredFieldRecords()
      .then((stored) => {
        setRecords(stored);
        setStorageState("ready");
      })
      .catch(() => {
        setStorageState("error");
        setNotice({
          kind: "error",
          title: "Local workspace unavailable",
          detail:
            "This browser did not open its private IndexedDB store. Imports were not started.",
        });
      });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const analyzed = useMemo(() => analyzeFieldRecords(records), [records]);
  const visibleRecords = useMemo(
    () => analyzed.filter((entry) => filter === "all" || entry.state === filter),
    [analyzed, filter],
  );
  const selected = analyzed.find((entry) => entry.storageKey === selectedKey) ?? null;
  const readyCount = analyzed.filter((entry) => entry.state === "ready").length;
  const attentionCount = analyzed.filter((entry) => entry.state === "attention").length;
  const conflictCount = analyzed.filter((entry) => entry.state === "conflict").length;
  const canExport = analyzed.length > 0 && attentionCount === 0 && conflictCount === 0;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || storageState !== "ready") return;
    setIsImporting(true);
    setNotice(null);
    setImportIssues([]);
    try {
      const parsedFiles = await Promise.all(
        [...files].map(async (file) => parseFieldFile(file.name, await file.text())),
      );
      const parsedRecords = parsedFiles.flatMap((result) => result.records);
      const issues = parsedFiles.flatMap((result) => result.issues);
      const incoming = parsedRecords.map(({ record, sourceName }) =>
        toStoredFieldRecord(record, sourceName),
      );
      const merged = mergeFieldRecords(records, incoming);
      await saveStoredFieldRecords(incoming);
      setRecords(merged);
      setImportIssues(issues);
      setNotice({
        kind: issues.length > 0 ? "error" : "success",
        title: issues.length > 0 ? "Import completed with rejected rows" : "Import saved locally",
        detail: `${incoming.length} valid record${incoming.length === 1 ? "" : "s"} added or matched; ${issues.length} schema issue${issues.length === 1 ? "" : "s"}.`,
      });
    } catch {
      setNotice({
        kind: "error",
        title: "Import could not be saved",
        detail: "No server upload occurred. Keep the original iPad export and try again.",
      });
    } finally {
      setIsImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(entry: AnalyzedFieldRecord) {
    try {
      await deleteStoredFieldRecord(entry.storageKey);
      setRecords((current) =>
        current.filter((candidate) => candidate.storageKey !== entry.storageKey),
      );
      if (selectedKey === entry.storageKey) setSelectedKey(null);
      setNotice({
        kind: "success",
        title: "Local record removed",
        detail: "Only this browser copy was removed. The original iPad export was not changed.",
      });
    } catch {
      setNotice({
        kind: "error",
        title: "Record was not removed",
        detail: "The browser could not update its local workspace.",
      });
    }
  }

  async function handleClear() {
    try {
      await clearStoredFieldRecords();
      setRecords([]);
      setSelectedKey(null);
      setConfirmClear(false);
      setNotice({
        kind: "success",
        title: "Local workspace cleared",
        detail: "The original files on the iPad or Mac were not deleted.",
      });
    } catch {
      setNotice({
        kind: "error",
        title: "Workspace was not cleared",
        detail: "The browser could not update its private local store.",
      });
    }
  }

  async function handleExport() {
    if (!canExport) return;
    setIsExporting(true);
    setNotice(null);
    try {
      const envelope = await createFieldBatchEnvelope(records);
      downloadJson(`field-batch-${envelope.clientBatchId}.json`, JSON.stringify(envelope, null, 2));
      setNotice({
        kind: "success",
        title: "Validated batch exported",
        detail:
          "This file is ready for the future quarantine and staging importer. It was not sent to a database.",
      });
    } catch {
      setNotice({
        kind: "error",
        title: "Export blocked",
        detail: "Resolve every attention item and ID conflict before creating a batch.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <AppBackdrop>
      <section className={appShellClass}>
        <WorkspaceHeader accessMode={accessMode} isOnline={isOnline} storageState={storageState} />
        {notice ? <NoticeBanner notice={notice} /> : null}
        <ImportPanel
          inputRef={inputRef}
          isImporting={isImporting}
          onFiles={handleFiles}
          storageState={storageState}
        />
        <ReviewQueue
          analyzed={analyzed}
          attentionCount={attentionCount}
          canExport={canExport}
          confirmClear={confirmClear}
          conflictCount={conflictCount}
          filter={filter}
          importIssues={importIssues}
          isExporting={isExporting}
          onCancelClear={() => setConfirmClear(false)}
          onClear={handleClear}
          onDelete={handleDelete}
          onExport={handleExport}
          onFilter={setFilter}
          onRequestClear={() => setConfirmClear(true)}
          onSelect={setSelectedKey}
          readyCount={readyCount}
          recordCount={records.length}
          selected={selected}
          selectedKey={selectedKey}
          visibleRecords={visibleRecords}
        />
      </section>
    </AppBackdrop>
  );
}

function WorkspaceHeader({
  accessMode,
  isOnline,
  storageState,
}: {
  accessMode: string;
  isOnline: boolean;
  storageState: "loading" | "ready" | "error";
}) {
  return (
    <PageHeader
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/diagnostics">Open diagnostics</Link>
        </Button>
      }
      description={
        <>
          Bring structured exports across from Files, Finder, or AirDrop. Validation and queue
          storage happen in this browser; no raw note, coordinate, consent detail, or asset is sent
          to PostHog or PostgreSQL.
        </>
      }
      title="Island field desk"
    >
      <div className="flex flex-wrap gap-2" aria-label="Workspace status" role="status">
        <Badge
          className="border-border-on-dark bg-surface-night-card text-text-on-dark"
          variant="outline"
        >
          <Lock aria-hidden="true" />
          {accessMode} access
        </Badge>
        <Badge
          className="border-border-on-dark bg-surface-night-card text-text-on-dark"
          variant="outline"
        >
          <HardDrive aria-hidden="true" />
          {storageState === "ready"
            ? "Private browser storage ready"
            : storageState === "loading"
              ? "Opening local storage"
              : "Local storage unavailable"}
        </Badge>
        <Badge
          className="border-border-on-dark bg-surface-night-card text-text-on-dark"
          variant="outline"
        >
          {isOnline ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          {isOnline ? "Network available, not required" : "Offline mode"}
        </Badge>
      </div>
    </PageHeader>
  );
}

function ImportPanel({
  inputRef,
  isImporting,
  onFiles,
  storageState,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  isImporting: boolean;
  onFiles: (files: FileList | null) => Promise<void>;
  storageState: "loading" | "ready" | "error";
}) {
  return (
    <section className={appPanelClass}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] lg:items-start">
        <div>
          <SectionHeading icon={Import} title="Bring in iPad exports" />
          <p className={appBodyClass}>
            Select one or more UTF-8 `.json` or `.jsonl` files. Canonical files such as
            `visits.jsonl` and `observations.jsonl` may omit `recordType`; the filename supplies it.
            Binary photos, audio, and video remain outside this browser queue.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              disabled={storageState !== "ready" || isImporting}
              onClick={() => inputRef.current?.click()}
              size="lg"
            >
              {isImporting ? <RefreshCw className="animate-spin" /> : <FileJson2 />}
              {isImporting ? "Checking files…" : "Choose export files"}
            </Button>
            <Button
              className={lightPanelOutlineButtonClass}
              onClick={downloadFieldTemplate}
              size="lg"
              variant="outline"
            >
              <Download /> Download capture template
            </Button>
            <input
              ref={inputRef}
              accept=".json,.jsonl,application/json,application/x-ndjson"
              aria-label="Select field export files"
              className="sr-only"
              data-testid="field-file-input"
              multiple
              onChange={(event) => void onFiles(event.currentTarget.files)}
              type="file"
            />
          </div>
        </div>

        <div className="rounded-md border border-border-strong bg-brand-lagoon-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert aria-hidden="true" className="mt-0.5 text-brand-lagoon-700" />
            <div className="grid gap-2">
              <h3 className="m-0 text-base font-extrabold text-text-strong">
                Safe handoff boundary
              </h3>
              <p className={appBodyClass}>
                Keep original media and exports until a later server importer verifies hashes. A
                dashboard export is a validated staging envelope—not proof of upload, publication,
                or fact admission.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewQueue({
  analyzed,
  attentionCount,
  canExport,
  confirmClear,
  conflictCount,
  filter,
  importIssues,
  isExporting,
  onCancelClear,
  onClear,
  onDelete,
  onExport,
  onFilter,
  onRequestClear,
  onSelect,
  readyCount,
  recordCount,
  selected,
  selectedKey,
  visibleRecords,
}: {
  analyzed: AnalyzedFieldRecord[];
  attentionCount: number;
  canExport: boolean;
  confirmClear: boolean;
  conflictCount: number;
  filter: QueueFilter;
  importIssues: ValidationIssue[];
  isExporting: boolean;
  onCancelClear: () => void;
  onClear: () => Promise<void>;
  onDelete: (entry: AnalyzedFieldRecord) => Promise<void>;
  onExport: () => Promise<void>;
  onFilter: (filter: QueueFilter) => void;
  onRequestClear: () => void;
  onSelect: (storageKey: string) => void;
  readyCount: number;
  recordCount: number;
  selected: AnalyzedFieldRecord | null;
  selectedKey: string | null;
  visibleRecords: AnalyzedFieldRecord[];
}) {
  return (
    <section aria-labelledby="queue-heading" className={appPanelClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionHeading icon={DatabaseZap} title="Local review queue" />
          <p className={appBodyClass} id="queue-heading">
            Resolve exact blockers here, then export one immutable client batch for the staging
            pipeline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canExport || isExporting} onClick={() => void onExport()}>
            <Download /> {isExporting ? "Hashing batch…" : "Export validated batch"}
          </Button>
          {confirmClear ? (
            <>
              <Button onClick={() => void onClear()} variant="destructive">
                Confirm clear
              </Button>
              <Button
                className={lightPanelOutlineButtonClass}
                onClick={onCancelClear}
                variant="outline"
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              className={lightPanelOutlineButtonClass}
              disabled={recordCount === 0}
              onClick={onRequestClear}
              variant="outline"
            >
              <Trash2 /> Clear local queue
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-md border border-border-strong bg-border-strong sm:grid-cols-4">
        <QueueMetric label="Total records" value={analyzed.length} />
        <QueueMetric label="Ready" tone="ready" value={readyCount} />
        <QueueMetric label="Needs attention" tone="attention" value={attentionCount} />
        <QueueMetric label="ID conflicts" tone="conflict" value={conflictCount} />
      </div>

      <fieldset className="mt-5 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Filter review queue</legend>
        {(Object.keys(filterLabels) as QueueFilter[]).map((candidate) => (
          <Button
            aria-pressed={filter === candidate}
            className={filter === candidate ? undefined : lightPanelOutlineButtonClass}
            key={candidate}
            onClick={() => onFilter(candidate)}
            size="sm"
            variant={filter === candidate ? "secondary" : "outline"}
          >
            {filterLabels[candidate]}
          </Button>
        ))}
      </fieldset>

      {importIssues.length > 0 ? <ImportIssues issues={importIssues} /> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <div className="min-w-0 overflow-hidden rounded-md border border-border-strong">
          {visibleRecords.length > 0 ? (
            <ul className="m-0 divide-y divide-border-strong p-0" data-testid="field-record-list">
              {visibleRecords.map((entry) => (
                <RecordRow
                  entry={entry}
                  isSelected={entry.storageKey === selectedKey}
                  key={entry.storageKey}
                  onDelete={() => void onDelete(entry)}
                  onSelect={() => onSelect(entry.storageKey)}
                />
              ))}
            </ul>
          ) : (
            <QueueEmptyState hasRecords={analyzed.length > 0} />
          )}
        </div>

        <RecordInspector entry={selected} />
      </div>
    </section>
  );
}

function ImportIssues({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className="mt-5 grid gap-2" data-testid="field-import-issues">
      <h3 className="m-0 text-sm font-extrabold text-destructive">Rejected import rows</h3>
      {issues.map((issue) => (
        <p
          className="m-0 text-sm text-destructive"
          key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
        >
          {issue.path ? `${issue.path}: ` : ""}
          {issue.message}
        </p>
      ))}
    </div>
  );
}

function QueueEmptyState({ hasRecords }: { hasRecords: boolean }) {
  return (
    <div className="grid min-h-48 place-items-center p-6 text-center">
      <div className="grid max-w-md gap-2">
        <FileWarning aria-hidden="true" className="mx-auto text-text-muted" />
        <h3 className="m-0 text-base font-extrabold text-text-strong">
          {hasRecords ? "No records match this filter" : "No field records yet"}
        </h3>
        <p className={appBodyClass}>
          {hasRecords
            ? "Choose another queue state to continue review."
            : "Choose an iPad export or download the template to test the full local workflow."}
        </p>
      </div>
    </div>
  );
}

function QueueMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "ready" | "attention" | "conflict";
  value: number;
}) {
  return (
    <div className="grid gap-1 bg-surface-default p-4">
      <span className="text-xs font-extrabold tracking-wide text-text-muted uppercase">
        {label}
      </span>
      <strong
        className={cn("text-3xl font-heading", {
          "text-brand-lagoon-700": tone === "ready",
          "text-amber-700": tone === "attention",
          "text-destructive": tone === "conflict",
          "text-text-strong": tone === "default",
        })}
      >
        {value}
      </strong>
    </div>
  );
}

function RecordRow({
  entry,
  isSelected,
  onDelete,
  onSelect,
}: {
  entry: AnalyzedFieldRecord;
  isSelected: boolean;
  onDelete: () => void;
  onSelect: () => void;
}) {
  return (
    <li className={cn("grid gap-3 bg-surface-default p-4", isSelected && "bg-brand-lagoon-50")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={onSelect} type="button">
          <span className="flex flex-wrap items-center gap-2">
            <RecordStateBadge state={entry.state} />
            <span className="text-xs font-extrabold text-brand-lagoon-700">
              {formatRecordType(entry.record.recordType)}
            </span>
          </span>
          <span className="mt-2 block truncate font-mono text-xs text-text-strong">
            {entry.record.id}
          </span>
          <span className="mt-1 block truncate text-xs text-text-muted">
            {entry.sourceName} · {entry.record.campaignSlug}
          </span>
        </button>
        <Button
          aria-label={`Remove record ${entry.record.id}`}
          onClick={onDelete}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
      {entry.issues.length > 0 ? (
        <p className="m-0 text-xs font-bold text-text-caveat">{entry.issues[0].message}</p>
      ) : null}
    </li>
  );
}

function RecordStateBadge({ state }: { state: AnalyzedFieldRecord["state"] }) {
  if (state === "ready") {
    return (
      <Badge className="bg-brand-lagoon-100 text-brand-lagoon-800" variant="secondary">
        <CheckCircle2 /> Ready
      </Badge>
    );
  }
  if (state === "conflict") {
    return (
      <Badge variant="destructive">
        <AlertCircle /> Conflict
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-900" variant="secondary">
      <FileWarning /> Attention
    </Badge>
  );
}

function RecordInspector({ entry }: { entry: AnalyzedFieldRecord | null }) {
  if (!entry) {
    return (
      <aside className="grid min-h-48 place-items-center rounded-md border border-border-strong bg-surface-subtle p-6 text-center">
        <div className="grid max-w-xs gap-2">
          <Lock aria-hidden="true" className="mx-auto text-text-muted" />
          <h3 className="m-0 text-base font-extrabold text-text-strong">
            Inspect without uploading
          </h3>
          <p className={appBodyClass}>Choose a record to see exact local validation details.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="min-w-0 rounded-md border border-border-strong bg-surface-subtle p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-extrabold text-text-strong">Record inspector</h3>
        <RecordStateBadge state={entry.state} />
      </div>
      {entry.issues.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {entry.issues.map((issue) => (
            <Alert
              className="border-amber-300 bg-amber-50"
              key={`${issue.code}:${issue.path ?? ""}`}
            >
              <AlertCircle />
              <AlertTitle>{issue.code}</AlertTitle>
              <AlertDescription>{issue.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm font-bold text-brand-lagoon-800">
          This record passes local schema, reference, permission, and conflict checks.
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-extrabold text-text-strong">
          Show private record JSON
        </summary>
        <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-default p-3 font-mono text-xs leading-relaxed text-text-muted">
          {JSON.stringify(entry.record, null, 2)}
        </pre>
      </details>
    </aside>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  return (
    <Alert
      className={cn(
        "border-border-on-dark bg-surface-night-panel text-text-on-dark",
        notice.kind === "error" && "border-amber-300",
      )}
    >
      {notice.kind === "success" ? <CheckCircle2 /> : <AlertCircle />}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="text-text-on-dark-muted">{notice.detail}</AlertDescription>
    </Alert>
  );
}

function formatRecordType(type: AnalyzedFieldRecord["record"]["recordType"]): string {
  return type === "routeRun" ? "Route run" : `${type[0].toUpperCase()}${type.slice(1)}`;
}

function downloadFieldTemplate() {
  downloadJson("ask-siargao-field-template.json", JSON.stringify(createFieldTemplate(), null, 2));
}

function downloadJson(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
