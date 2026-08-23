"use client";

import { useRef, useState } from "react";
import type { FieldDeskArchiveHeader } from "@/features/field-desk/desk-schemas";
import { FieldDeskRepository } from "@/features/field-desk/field-desk-repository";
import { allRecords, effectiveReview } from "@/features/field-desk/field-desk-state";
import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  fieldTextDecoder,
  fieldTextEncoder,
  randomFieldBytes,
  sha256Hex,
} from "@/features/field-security/encoding";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
import {
  IndexedDbFieldVault,
  type LegacyCaptureVaultHeader,
} from "@/features/field-security/vault";
import type {
  ArtifactPreamble,
  AuthenticatedRegistrySnapshot,
  RestorePreview,
} from "./artifact-schemas";
import { createFieldBatchExport, deriveFieldBatchGraph } from "./field-batch";
import { openCanonicalArtifact } from "./package-format";
import { OpfsStagedArtifactSink } from "./package-sink";
import { openRecipientContentKey } from "./recipient-envelope";
import { createFieldRecoveryExport } from "./recovery-export";
import { commitConfirmedRestore, createRestorePreview, type RestoreImmutableItem } from "./restore";

type PendingRestore = {
  incoming: readonly RestoreImmutableItem[];
  preview: RestorePreview;
  headers: readonly FieldDeskArchiveHeader[];
  legacyHeaders: readonly LegacyCaptureVaultHeader[];
};

type PendingHandoff = {
  artifactKind: "field_batch" | "field_recovery";
  ciphertextSha256: string;
  createdAt: string;
  filename: string;
  kind: "field_batch" | "field_recovery";
  nonce: string;
  recipientDeviceId: string;
  sink: OpfsStagedArtifactSink;
  transferId: string;
};

import { FieldMain } from "@/features/field-workspace/FieldMain";

export function FieldExports(props: { embedded?: boolean; harness?: boolean }) {
  return props.harness ? <HarnessExports /> : <ProductionExports embedded={props.embedded} />;
}

function ProductionExports(props: { embedded?: boolean }) {
  const security = useFieldSecuritySession();
  const [recoveryState, setRecoveryState] = useState("No Recovery Export created.");
  const [batchState, setBatchState] = useState("No reviewed Field Batch created.");
  const [restoreState, setRestoreState] = useState(
    "Select an .asfrecovery file to preview restore.",
  );
  const [pendingRestore, setPendingRestore] = useState<PendingRestore>();
  const [transferId, setTransferId] = useState<string>();
  const [pendingHandoff, setPendingHandoff] = useState<PendingHandoff | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingHandoffRef = useRef<PendingHandoff | undefined>(undefined);
  const locked = security.status !== "unlocked";
  const physicalHandoffAvailable =
    typeof window !== "undefined" &&
    ("showSaveFilePicker" in window || typeof navigator.share === "function");

  async function registry(): Promise<AuthenticatedRegistrySnapshot> {
    const response = await fetch("/api/operator/field/devices", { cache: "no-store" });
    if (!response.ok) throw new Error("field_artifact_recipient_invalid");
    const body = (await response.json()) as { devices: AuthenticatedRegistrySnapshot["devices"] };
    const authenticatedAt = new Date();
    return {
      accountId: security.claims?.accountId ?? "unknown",
      authenticatedAt: authenticatedAt.toISOString(),
      devices: body.devices,
      expiresAt: new Date(authenticatedAt.getTime() + 10 * 60_000).toISOString(),
      source: "authenticated_live_registry",
      version: "field-device-registry-snapshot.v1",
    };
  }

  async function deskRecipient(snapshot: AuthenticatedRegistrySnapshot) {
    const recipient = snapshot.devices.find((device) => device.role === "desk");
    if (!recipient) throw new Error("field_artifact_recipient_invalid");
    return recipient;
  }

  async function publishPendingHandoff() {
    const pending = pendingHandoffRef.current;
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Invoke publish immediately from this click handler so navigator.share retains activation.
      const publication = await pending.sink.publishVerified({
        filename: pending.filename,
        kind: pending.kind,
      });
      if (publication !== "published") throw new Error("field_physical_handoff_required");
      await new IndexedDbFieldVault().putOutstandingTransfer({
        artifactKind: pending.artifactKind,
        ciphertextSha256: pending.ciphertextSha256,
        createdAt: pending.createdAt,
        nonce: pending.nonce,
        recipientDeviceId: pending.recipientDeviceId,
        state: "outstanding",
        transferId: pending.transferId,
      });
      pendingHandoffRef.current = undefined;
      setPendingHandoff(undefined);
      setTransferId(pending.transferId);
      const message = `${pending.filename} shared. Transfer receipt is still required.`;
      if (pending.artifactKind === "field_recovery") setRecoveryState(message);
      else setBatchState(message);
    } catch (error) {
      await pending.sink.dispose();
      pendingHandoffRef.current = undefined;
      setPendingHandoff(undefined);
      const message = `Physical handoff blocked (${error instanceof Error ? error.message : "share unavailable"}).`;
      if (pending.artifactKind === "field_recovery") setRecoveryState(message);
      else setBatchState(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function createRecovery() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRecoveryState("Creating encrypted Recovery Export from local custody…");
    try {
      const transfer = crypto.randomUUID();
      const result = await security.withVaultKey(async (key) => {
        const vault = new IndexedDbFieldVault();
        const wrap = await vault.getMetadata("recovery-wrap");
        if (!wrap) throw new Error("field_key_unavailable");
        const recipient = await deskRecipient(await registry());
        const sink = await OpfsStagedArtifactSink.create();
        try {
          const receipt = await createFieldRecoveryExport({
            artifactId: crypto.randomUUID(),
            contentKey: randomFieldBytes(32),
            createdAt: new Date(),
            recipientDeviceId: recipient.id,
            recoveryWrap: wrap.value,
            registry: await registry(),
            sink,
            transferId: transfer,
            vault,
            vaultKey: key,
          });
          const parsed = await readPreambleFromStream(sink.reopen());
          const createdAt = new Date().toISOString();
          if (typeof navigator.share === "function" && !("showSaveFilePicker" in window)) {
            await sink.prepareShareFile(receipt.filename);
            const pending: PendingHandoff = {
              artifactKind: "field_recovery",
              ciphertextSha256: receipt.ciphertextSha256,
              createdAt,
              filename: receipt.filename,
              kind: "field_recovery",
              nonce: parsed.contentKeyEnvelope.nonce,
              recipientDeviceId: recipient.id,
              sink,
              transferId: transfer,
            };
            pendingHandoffRef.current = pending;
            setPendingHandoff(pending);
            return { published: false, receipt };
          }
          const publication = await sink.publishVerified({
            filename: receipt.filename,
            kind: "field_recovery",
          });
          if (publication !== "published") throw new Error("field_physical_handoff_required");
          await vault.putOutstandingTransfer({
            artifactKind: "field_recovery",
            ciphertextSha256: receipt.ciphertextSha256,
            createdAt,
            nonce: parsed.contentKeyEnvelope.nonce,
            recipientDeviceId: recipient.id,
            state: "outstanding",
            transferId: transfer,
          });
          return { published: true, receipt };
        } catch (error) {
          await sink.dispose();
          throw error;
        }
      });
      if (result.published) {
        setTransferId(transfer);
        setRecoveryState(
          `Created ${result.receipt.filename} from encrypted custody. Transfer receipt is still required.`,
        );
      } else {
        setRecoveryState(`Prepared ${result.receipt.filename}. Tap Share now to complete handoff.`);
      }
    } catch (error) {
      setRecoveryState(
        `Recovery Export blocked (${error instanceof Error ? error.message : "authorization unavailable"}).`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function createBatch() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setBatchState("Deriving reviewed referential closure from local Desk custody…");
    try {
      const result = await security.withVaultKey(async (key) => {
        const works = await new FieldDeskRepository("0.1.0").list(key);
        const selectedRecordIds = works.flatMap((work) =>
          allRecords(work)
            .filter((record) => effectiveReview(work, record.value.id)?.decision === "include")
            .map((record) => record.value.id),
        );
        const graph = await deriveFieldBatchGraph({
          batchId: crypto.randomUUID(),
          intendedUse: "research_internal",
          selectedRecordIds,
          validateRecorderWork: async (work) =>
            work.fieldDayClose
              ? []
              : [{ code: "record_not_closed", message: "Recorder work is not closed." }],
          works,
        });
        const snapshot = await registry();
        const recipient = await deskRecipient(snapshot);
        const transfer = crypto.randomUUID();
        const sink = await OpfsStagedArtifactSink.create();
        try {
          const receipt = await createFieldBatchExport({
            artifactId: crypto.randomUUID(),
            contentKey: randomFieldBytes(32),
            createdAt: new Date(),
            graph,
            recipientDeviceId: recipient.id,
            registry: snapshot,
            sink,
            transferId: transfer,
          });
          const parsed = await readPreambleFromStream(sink.reopen());
          const createdAt = new Date().toISOString();
          if (typeof navigator.share === "function" && !("showSaveFilePicker" in window)) {
            await sink.prepareShareFile(receipt.filename);
            const pending: PendingHandoff = {
              artifactKind: "field_batch",
              ciphertextSha256: receipt.ciphertextSha256,
              createdAt,
              filename: receipt.filename,
              kind: "field_batch",
              nonce: parsed.contentKeyEnvelope.nonce,
              recipientDeviceId: recipient.id,
              sink,
              transferId: transfer,
            };
            pendingHandoffRef.current = pending;
            setPendingHandoff(pending);
            return { published: false, receipt, transfer };
          }
          const publication = await sink.publishVerified({
            filename: receipt.filename,
            kind: "field_batch",
          });
          if (publication !== "published") throw new Error("field_physical_handoff_required");
          await new IndexedDbFieldVault().putOutstandingTransfer({
            artifactKind: "field_batch",
            ciphertextSha256: receipt.ciphertextSha256,
            createdAt,
            nonce: parsed.contentKeyEnvelope.nonce,
            recipientDeviceId: recipient.id,
            state: "outstanding",
            transferId: transfer,
          });
          return { published: true, receipt, transfer };
        } catch (error) {
          await sink.dispose();
          throw error;
        }
      });
      if (result.published) {
        setTransferId(result.transfer);
        setBatchState(`Created ${result.receipt.filename}. Transfer receipt is still required.`);
      } else {
        setBatchState(`Prepared ${result.receipt.filename}. Tap Share now to complete handoff.`);
      }
    } catch (error) {
      setBatchState(
        `Field Batch blocked (${error instanceof Error ? error.message : "reviewed closure unavailable"}).`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function previewRestore(file: File) {
    setRestoreState("Authenticating and previewing the Recovery Export…");
    try {
      const result = await security.withVaultKey(async (_key) => {
        const snapshot = await registry();
        const recipient = snapshot.devices.find((device) => device.role === "desk");
        if (!recipient) throw new Error("field_artifact_recipient_invalid");
        const vault = new IndexedDbFieldVault();
        const privateKey = await vault.getDeviceKey("agreement-private");
        const incoming: RestoreImmutableItem[] = [];
        const headers: FieldDeskArchiveHeader[] = [];
        const legacyHeaders: LegacyCaptureVaultHeader[] = [];
        let artifactId = "";
        await openCanonicalArtifact({
          expectedKind: "field_recovery",
          openContentKey: async (preamble) => {
            artifactId = preamble.artifactId;
            return openRecipientContentKey({
              agreementPrivateKey: privateKey,
              artifactKind: "field_recovery",
              envelope: preamble.contentKeyEnvelope,
              expectedRecipient: recipient,
              transferId: preamble.transferId,
            });
          },
          onRecord: async ({ path, value }) => {
            if (
              path === "opaque-envelopes.jsonl" &&
              typeof value === "object" &&
              value !== null &&
              "id" in value
            ) {
              const entry = value as { id: string; [key: string]: unknown };
              const { id, ...envelope } = entry;
              incoming.push({
                immutableId: id,
                contentSha256: await sha256Hex(
                  fieldTextEncoder.encode(canonicalStringify(envelope)),
                ),
                envelope: envelope as never,
              });
            }
            if (
              path === "desk-archives.jsonl" &&
              typeof value === "object" &&
              value !== null &&
              "id" in value
            ) {
              const { id, ...header } = value as {
                id: string;
              } & Omit<FieldDeskArchiveHeader, "archiveId">;
              headers.push({ archiveId: id, ...header });
            }
            if (
              path === "legacy-capture-index.jsonl" &&
              typeof value === "object" &&
              value !== null &&
              "id" in value
            ) {
              const { id, ...header } = value as {
                id: string;
              } & Omit<LegacyCaptureVaultHeader, "sourceId">;
              legacyHeaders.push({ sourceId: id, ...header });
            }
          },
          source: file.stream() as unknown as AsyncIterable<Uint8Array>,
        });
        const destination = new Map<string, string>();
        for (const envelope of await vault.listEnvelopes())
          destination.set(
            envelope.opaqueRecordKey,
            await sha256Hex(fieldTextEncoder.encode(canonicalStringify(envelope))),
          );
        const preview = await createRestorePreview({
          artifactId,
          createdAt: new Date().toISOString(),
          destination,
          incoming,
          previewId: crypto.randomUUID(),
        });
        return { incoming, preview, headers, legacyHeaders };
      });
      setPendingRestore(result);
      setRestoreState(
        `Preview ready: ${result.preview.additions.length} additions, ${result.preview.exactReplays.length} exact replays, ${result.preview.quarantines.length} quarantines.`,
      );
    } catch (error) {
      setRestoreState(
        `Restore blocked (${error instanceof Error ? error.message : "artifact invalid"}).`,
      );
    }
  }

  async function commitRestore() {
    if (!pendingRestore) return;
    setRestoreState("Committing confirmed restore with quarantine and audit…");
    try {
      const result = await security.withVaultKey((key) =>
        commitConfirmedRestore({
          confirmedPreviewSha256: pendingRestore.preview.previewSha256,
          deskArchiveHeaders: pendingRestore.headers,
          incoming: pendingRestore.incoming,
          key,
          legacyCaptureHeaders: pendingRestore.legacyHeaders,
          now: new Date().toISOString(),
          preview: pendingRestore.preview,
          vault: new IndexedDbFieldVault(),
        }),
      );
      setPendingRestore(undefined);
      setRestoreState(
        `Restore committed: ${result.additions} additions, ${result.quarantines} quarantines.`,
      );
    } catch (error) {
      setRestoreState(
        `Restore commit blocked (${error instanceof Error ? error.message : "authorization unavailable"}).`,
      );
    }
  }

  if (locked)
    return (
      <>
        <OfflineFieldUnlock />
        <FieldMain
          landmark={!props.embedded}
          className="min-h-screen bg-[#f5eddc] p-6 text-[#0d104a]"
        >
          <section className="mx-auto max-w-2xl rounded-xl bg-[#fffdf7] p-8">
            <h1 className="text-2xl font-semibold">Protected exports locked</h1>
            <p className="mt-2 text-[#5f5f87]">
              Unlock an Authorized Desk device before reading or exporting encrypted custody.
            </p>
            <p className="mt-5 text-sm" role="status">
              Not created
            </p>
            <button
              className="mt-4 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white"
              disabled
              type="button"
            >
              Create Recovery Export
            </button>
            {pendingHandoff?.artifactKind === "field_recovery" ? (
              <button
                className="mt-4 ml-2 min-h-11 rounded-lg border border-[#0a6f67] px-5 font-bold text-[#0a6f67]"
                disabled={busy}
                onClick={() => void publishPendingHandoff()}
                type="button"
              >
                Share prepared Recovery Export
              </button>
            ) : null}
            <p className="mt-5 border-t border-[#ddd8ef] pt-5 text-sm text-[#5f5f87]">
              A copied file is not a Verified Field Transfer. Completion requires recipient decrypt,
              integrity and reference validation, a destination signature, and source receipt
              verification.
            </p>
          </section>
        </FieldMain>
      </>
    );
  return (
    <FieldMain
      landmark={!props.embedded}
      className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6"
    >
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#export-workflows"
      >
        Skip to export workflows
      </a>
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="border-b border-[#ddd8ef] bg-[#05082a] px-5 py-4 text-[#fff9e9]">
          <h1 className="text-2xl font-semibold">Protected exports</h1>
          <p className="mt-1 text-sm text-[#d8d5f4]">
            Real encrypted custody, bounded artifacts, and explicit transfer verification
          </p>
        </header>
        <div className="grid gap-0 lg:grid-cols-2" id="export-workflows">
          <section className="border-b border-[#ddd8ef] p-6 lg:border-b-0 lg:border-r sm:p-8">
            <h2 className="text-xl font-semibold">Field Recovery Export</h2>
            <p className="mt-2 text-[#5f5f87]">
              Complete encrypted local custody, including unfinished work and Desk history.
            </p>
            <p className="mt-5 rounded-lg bg-[#fbf6e8] p-3 text-sm" role="status">
              {recoveryState}
            </p>
            <button
              className="mt-4 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white"
              disabled={busy || !physicalHandoffAvailable || Boolean(pendingHandoff)}
              onClick={() => void createRecovery()}
              type="button"
            >
              Create Recovery Export
            </button>
            <label className="mt-5 block text-sm font-bold" htmlFor="restore-recovery">
              Restore Recovery Export
              <input
                accept=".asfrecovery,application/octet-stream"
                className="mt-2 block w-full rounded-lg border p-3 font-normal"
                id="restore-recovery"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void previewRestore(file);
                }}
                type="file"
              />
            </label>
            <p className="mt-3 text-sm" role="status">
              {restoreState}
            </p>
            {pendingRestore ? (
              <button
                className="mt-3 min-h-11 rounded-lg border border-[#0a6f67] px-5 font-bold text-[#0a6f67]"
                onClick={() => void commitRestore()}
                type="button"
              >
                Confirm and restore custody
              </button>
            ) : null}
          </section>
          <section className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">Field Batch</h2>
            <p className="mt-2 text-[#5f5f87]">
              An explicitly included, reviewed, referentially closed graph.
            </p>
            <p className="mt-5 rounded-lg bg-[#f5f3ff] p-3 text-sm" role="status">
              {batchState}
            </p>
            <button
              className="mt-4 min-h-11 rounded-lg bg-[#5d3ed1] px-5 font-bold text-white"
              disabled={busy || !physicalHandoffAvailable || Boolean(pendingHandoff)}
              onClick={() => void createBatch()}
              type="button"
            >
              Create reviewed Field Batch
            </button>
            {pendingHandoff?.artifactKind === "field_batch" ? (
              <button
                className="mt-4 ml-2 min-h-11 rounded-lg border border-[#5d3ed1] px-5 font-bold text-[#5d3ed1]"
                disabled={busy}
                onClick={() => void publishPendingHandoff()}
                type="button"
              >
                Share prepared Field Batch
              </button>
            ) : null}
            <p className="mt-6 text-sm font-bold">Destination receipt verification</p>
            <p className="mt-2 text-sm text-[#5f5f87]">
              The authorized recipient device must decrypt, integrity-check, reference-check, and
              sign the transfer. Source acceptance remains blocked until that external handoff is
              completed.
            </p>
            <p className="mt-3 text-sm" role="status">
              Destination receipt pending.
              {transferId ? ` Transfer ${transferId} remains outstanding until accepted.` : ""}
            </p>
            <a
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-[#5d3ed1] px-4 py-2 font-bold text-[#271776]"
              href="/operator/field/diagnostics-recovery/legacy-import"
            >
              Open Diagnostics and Recovery
            </a>
          </section>
        </div>
        <footer className="border-t border-[#ddd8ef] bg-[#fbf6e8] px-6 py-4 text-sm text-[#5f5f87]">
          A copied file is not a Verified Field Transfer. Completion requires recipient decrypt,
          integrity and reference validation, a destination signature, and source receipt
          verification.
        </footer>
      </div>
    </FieldMain>
  );
}

function HarnessExports() {
  const [recoveryState, setRecoveryState] = useState("Not created");
  const [batchState, setBatchState] = useState(
    "Eligible reviewed graph · every selected record is included and closed",
  );
  return (
    <FieldMain className="min-h-screen bg-[#f5eddc] px-4 py-8 text-[#0d104a] sm:px-6">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#export-workflows"
      >
        Skip to export workflows
      </a>
      <div className="mx-auto max-w-[73.75rem] overflow-hidden rounded-xl bg-[#fffdf7] shadow-[0_10px_28px_rgba(14,12,56,0.08)]">
        <header className="border-b border-[#ddd8ef] bg-[#05082a] px-5 py-4 text-[#fff9e9]">
          <h1 className="text-2xl font-semibold">Protected exports</h1>
          <p className="mt-1 text-sm text-[#d8d5f4]">Two formats, two eligibility contracts</p>
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
              className="mt-4 min-h-11 rounded-lg bg-[#0a6f67] px-5 font-bold text-white focus:outline-none focus:ring-3 focus:ring-[#5d3ed1]"
              onClick={() =>
                setRecoveryState("Created and locally re-opened · transfer receipt pending")
              }
              type="button"
            >
              Create Recovery Export
            </button>
            <button
              className="ml-2 mt-4 min-h-11 rounded-lg border border-[#0a6f67] px-5 font-bold text-[#0a6f67] focus:outline-none focus:ring-3 focus:ring-[#5d3ed1]"
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
              className="mt-4 min-h-11 rounded-lg bg-[#5d3ed1] px-5 font-bold text-white focus:outline-none focus:ring-3 focus:ring-[#0a6f67]"
              onClick={() =>
                setBatchState("Created from the eligible graph · destination receipt pending")
              }
              type="button"
            >
              Create reviewed Field Batch
            </button>
            <button
              className="ml-2 mt-4 min-h-11 rounded-lg border border-[#5d3ed1] px-5 font-bold text-[#271776] focus:outline-none focus:ring-3 focus:ring-[#0a6f67]"
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
    </FieldMain>
  );
}

async function readPreambleFromStream(
  source: AsyncIterable<Uint8Array>,
): Promise<ArtifactPreamble> {
  let retained = new Uint8Array(0);
  for await (const chunk of source) {
    if (retained.length + chunk.length > 64 * 1024 + 12) throw new Error("field_artifact_invalid");
    const joined = new Uint8Array(retained.length + chunk.length);
    joined.set(retained);
    joined.set(chunk, retained.length);
    retained = joined;
    if (retained.length < 12) continue;
    const length = new DataView(retained.buffer, 8, 4).getUint32(0, false);
    if (length < 1 || length > 64 * 1024) throw new Error("field_artifact_invalid");
    if (retained.length < 12 + length) continue;
    return JSON.parse(fieldTextDecoder.decode(retained.slice(12, 12 + length))) as ArtifactPreamble;
  }
  throw new Error("field_artifact_incomplete");
}
