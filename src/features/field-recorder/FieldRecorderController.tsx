"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { encryptFieldValue } from "@/features/field-security/crypto";
import { fieldSecurityErrorCode } from "@/features/field-security/errors";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import { OfflineFieldUnlock } from "@/features/field-security/OfflineFieldUnlock";
import {
  activateSafeFieldUpdate,
  notifyFieldVisitState,
} from "@/features/field-security/service-worker-client";
import { estimateFieldStorage, IndexedDbFieldVault } from "@/features/field-security/vault";

import { FieldRecorder, type FieldRecorderActions } from "./FieldRecorder";
import { prepareRecorderMedia } from "./field-media-store";
import { FieldRecorderRepository, type RecorderWriterFence } from "./field-recorder-repository";
import {
  advanceRecorderStep,
  captureRecorderRecord,
  closeFieldDay,
  closeRecorderVisit,
  deferRecorderAssignment,
  startRecorderVisit,
} from "./field-recorder-state";
import type { RecorderRecord, RecorderRuntimeStatus, RecorderWork } from "./field-recorder-types";
import type { CaptureFormSubmission, FieldVisitDraftInput } from "./forms/form-types";
import type { RecorderProtocol } from "./load-recorder-protocol";
import {
  buildCaptureException,
  buildEvidenceAsset,
  buildFieldVisit,
  buildObservation,
  buildRouteRun,
  buildSchemaGap,
  buildSourceStatement,
  buildStatementTranslation,
} from "./record-builders";
import { validateRecorderWorkspace } from "./workspace-validation";

const applicationVersion = "0.1.0";
const buildId = process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ?? "unconfigured";
const writerLeaseMs = 2 * 60_000;

type PendingCommit = () => Promise<void>;

export function FieldRecorderController(props: { protocol: RecorderProtocol }) {
  const security = useFieldSecuritySession();
  if (security.status !== "unlocked") {
    return <OfflineFieldUnlock />;
  }
  return <UnlockedFieldRecorderController protocol={props.protocol} />;
}

function UnlockedFieldRecorderController(props: { protocol: RecorderProtocol }) {
  const security = useFieldSecuritySession();
  const repository = useMemo(() => new FieldRecorderRepository({ applicationVersion }), []);
  const vault = useMemo(() => new IndexedDbFieldVault(), []);
  const writerInstanceId = useRef(crypto.randomUUID());
  const pendingCommit = useRef<PendingCommit | undefined>(undefined);
  const [work, setWork] = useState<RecorderWork>();
  const [loadError, setLoadError] = useState<string>();
  const [runtime, setRuntime] = useState<RecorderRuntimeStatus>({
    grantExpiresAt: security.claims?.expiresAt,
    location: "not_requested",
    online: navigator.onLine,
    save: { status: "idle" },
    storageAvailableBytes: 0,
    vault: "unlocked",
    waitingUpdate: false,
    writer: "none",
  });

  const claimWriter = useCallback(
    async (visitId: string, explicitTakeover: boolean) => {
      const nowMs = Date.now();
      const visitReference = writerReference(visitId);
      try {
        await security.withVaultKey(async (key) => {
          const auditEnvelope = explicitTakeover
            ? encryptFieldValue({
                applicationVersion,
                key,
                value: {
                  action: "explicit_writer_takeover",
                  at: new Date(nowMs).toISOString(),
                  visitReference,
                  writerInstanceId: writerInstanceId.current,
                },
              })
            : undefined;
          await vault.claimWriter({
            auditEnvelope,
            expiresAt: nowMs + writerLeaseMs,
            explicitTakeover,
            nowMs,
            visitReference,
            writerInstanceId: writerInstanceId.current,
          });
        });
        setRuntime((current) => ({ ...current, writer: "active" }));
      } catch (error) {
        setRuntime((current) => ({ ...current, writer: "conflict" }));
        throw error;
      }
    },
    [security, vault],
  );

  useEffect(() => {
    let mounted = true;
    security
      .withVaultKey((key) => repository.load(key))
      .then(async (loaded) => {
        if (!mounted) return;
        if (!loaded) {
          setLoadError("No confirmed encrypted Field Day Plan is available on this device.");
          return;
        }
        setWork(loaded);
        const visitId = activeVisitId(loaded);
        if (visitId) {
          await claimWriter(visitId, false).catch(() => undefined);
          await notifyFieldVisitState({ activeVisit: true, buildId }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (mounted) setLoadError(fieldSecurityErrorCode(error));
      });
    estimateFieldStorage().then((storage) => {
      if (mounted) {
        setRuntime((current) => ({ ...current, storageAvailableBytes: storage.availableBytes }));
      }
    });
    const online = () => setRuntime((current) => ({ ...current, online: navigator.onLine }));
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      mounted = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, [claimWriter, repository, security]);

  const commit = useCallback(
    async (
      prepare: (
        current: RecorderWork,
        key: Uint8Array,
      ) =>
        | Promise<{
            next: RecorderWork;
            media?: Parameters<FieldRecorderRepository["save"]>[0]["media"];
          }>
        | {
            next: RecorderWork;
            media?: Parameters<FieldRecorderRepository["save"]>[0]["media"];
          },
      options: { fenceVisitId?: string; visitStateAfter?: boolean } = {},
    ) => {
      if (!work) throw new Error("Encrypted Recorder work is not loaded.");
      const execute = async () => {
        setRuntime((current) => ({
          ...current,
          save: { revision: work.revision + 1, status: "saving" },
        }));
        try {
          const result = await security.withVaultKey(async (key) => {
            const prepared = await prepare(work, key);
            const fenceVisitId = options.fenceVisitId ?? activeVisitId(prepared.next);
            let writerFence: RecorderWriterFence | undefined;
            if (fenceVisitId) {
              await claimWriter(fenceVisitId, false);
              writerFence = {
                nowMs: Date.now(),
                visitReference: writerReference(fenceVisitId),
                writerInstanceId: writerInstanceId.current,
              };
            }
            const validation = await validateRecorderWorkspace({
              applicationVersion,
              committedAssets: prepared.next.mediaReceipts.map((receipt) => ({
                assetId: receipt.assetId,
                byteSize: receipt.byteSize,
                sha256: receipt.sha256,
              })),
              installedBundles: [props.protocol],
              protocol: props.protocol,
              protocolPackageId: prepared.next.protocolPackageId,
              protocolPackageVersion: prepared.next.protocolPackageVersion,
              records: prepared.next.records,
            });
            if (!validation.success) {
              throw new Error(validation.issues.map((issue) => issue.message).join(" "));
            }
            const saved = await repository.save({
              expectedPreviousRevision: work.revision,
              key,
              media: prepared.media,
              work: prepared.next,
              writerFence,
            });
            return { next: prepared.next, saved };
          });
          pendingCommit.current = undefined;
          setWork(result.next);
          setRuntime((current) => ({
            ...current,
            save: {
              revision: result.next.revision,
              savedAt: result.saved.savedAt,
              status: "saved",
            },
            storageAvailableBytes: result.saved.availableBytes,
          }));
          if (options.visitStateAfter !== undefined) {
            const worker = await notifyFieldVisitState({
              activeVisit: options.visitStateAfter,
              buildId,
            }).catch(() => ({ updateWaiting: false }));
            setRuntime((current) => ({
              ...current,
              waitingUpdate: worker.updateWaiting,
              writer: options.visitStateAfter ? current.writer : "none",
            }));
            if (!options.visitStateAfter) await activateSafeFieldUpdate(false).catch(() => false);
          }
        } catch (error) {
          pendingCommit.current = execute;
          setRuntime((current) => ({
            ...current,
            save: {
              reason: fieldSecurityErrorCode(error),
              revision: work.revision + 1,
              status: "save_failed",
            },
          }));
          throw error;
        }
      };
      await execute();
    },
    [claimWriter, props.protocol, repository, security, work],
  );

  const actions = useMemo<FieldRecorderActions>(
    () => ({
      advance: async ({ safetyEligible = true } = {}) => {
        if (!work) return;
        if (work.step.name === "safety" && !safetyEligible) {
          const requirementId = work.assignments.find(
            (entry) => entry.assignmentId === work.step.assignmentId,
          )?.unresolvedRequirementIds[0];
          const assignment = props.protocol.campaign.assignments.find(
            (entry) => entry.id === work.step.assignmentId,
          );
          const requirement =
            assignment?.coverageRequirements.find((entry) => entry.id === requirementId) ??
            assignment?.coverageRequirements[0];
          if (!requirement) throw new Error("No governed safety exception lineage is available.");
          await commit((current) => ({
            next: deferRecorderAssignment({
              exception: buildCaptureException({
                captureContext: "planning",
                context: {
                  ...captureContextBase(
                    current,
                    props.protocol,
                    requirement.objectiveId,
                    requirement.id,
                  ),
                  visitId: undefined,
                },
                id: crypto.randomUUID(),
                reason: "unsafe_conditions",
                reasonDetails:
                  "The researcher stopped because current safety or eligibility could not be confirmed.",
              }),
              now: new Date().toISOString(),
              outcomeId: crypto.randomUUID(),
              protocol: props.protocol,
              work: current,
            }),
          }));
          return;
        }
        await commit((current) => ({
          next: advanceRecorderStep({
            now: new Date().toISOString(),
            safetyEligible,
            work: current,
          }),
        }));
      },
      capture: async (submission) => {
        await commit(async (current, key) =>
          prepareCapture(current, props.protocol, submission, key),
        );
      },
      closeFieldDay: async () => {
        await commit((current) => ({
          next: closeFieldDay({
            closeId: crypto.randomUUID(),
            now: new Date().toISOString(),
            protocol: props.protocol,
            work: current,
          }),
        }));
      },
      closeVisit: async () => {
        if (!work) return;
        const visitId = activeVisitId(work);
        if (!visitId) throw new Error("There is no active Visit to close.");
        await commit(
          (current) => ({
            next: closeRecorderVisit({
              followUpId: crypto.randomUUID(),
              now: new Date().toISOString(),
              outcomeId: crypto.randomUUID(),
              protocol: props.protocol,
              work: current,
            }),
          }),
          { fenceVisitId: visitId, visitStateAfter: false },
        );
      },
      lock: () => security.lock("manual"),
      retrySave: async () => {
        if (!pendingCommit.current) throw new Error("There is no failed save to retry.");
        await pendingCommit.current();
      },
      returnToObjectives: async () => {
        await commit((current) => ({
          next: {
            ...current,
            revision: current.revision + 1,
            step: { ...current.step, name: "objectives" },
            updatedAt: new Date().toISOString(),
          },
        }));
      },
      startVisit: async (input) => {
        const visitId = crypto.randomUUID();
        await commit(
          (current) => {
            const now = new Date();
            const assignment = props.protocol.campaign.assignments.find(
              (entry) => entry.id === current.step.assignmentId,
            );
            if (!assignment)
              throw new Error("The current Assignment is unavailable in the pinned protocol.");
            const window = createCaptureWindow(now);
            const objectiveIds = assignment.objectives.map((objective) => objective.id);
            if (!objectiveIds[0])
              throw new Error("The current Assignment has no governed objective.");
            const visit = buildFieldVisit({
              captureWindows: [window],
              conditions: input.conditions,
              context: captureVisitContext(current, props.protocol),
              id: visitId,
              locationPermissionState: input.locationPermissionState,
              objectiveIds: objectiveIds as [string, ...string[]],
              publicLocationPrecision: input.publicLocationPrecision,
              startedAt: now.toISOString(),
              target: input.target,
            });
            return {
              next: startRecorderVisit({
                now: now.toISOString(),
                protocol: props.protocol,
                visit,
                work: current,
              }),
            };
          },
          { fenceVisitId: visitId, visitStateAfter: true },
        );
        await updateLocationStatus(input, setRuntime);
      },
      takeOverWriter: async () => {
        const visitId = work ? activeVisitId(work) : undefined;
        if (!visitId) throw new Error("There is no active Visit writer to take over.");
        await claimWriter(visitId, true);
      },
    }),
    [claimWriter, commit, props.protocol, security, work],
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Alert variant="destructive">
          <AlertTitle>Recorder resume blocked</AlertTitle>
          <AlertDescription>{loadError} Encrypted local data was not changed.</AlertDescription>
        </Alert>
        <Button asChild className="mt-5 min-h-11" variant="outline">
          <a href="/operator/field/plan">Return to Field Day Planner</a>
        </Button>
      </main>
    );
  }
  if (!work)
    return (
      <main className="p-8" role="status">
        Loading encrypted Recorder work…
      </main>
    );
  return (
    <FieldRecorder actions={actions} protocol={props.protocol} runtime={runtime} work={work} />
  );
}

async function prepareCapture(
  initial: RecorderWork,
  protocol: RecorderProtocol,
  submission: CaptureFormSubmission,
  key: Uint8Array,
): Promise<{
  next: RecorderWork;
  media?: Parameters<FieldRecorderRepository["save"]>[0]["media"];
}> {
  const now = new Date();
  const { context, work } = withCurrentCaptureWindow(initial, protocol, now);
  const id = crypto.randomUUID();
  let record: RecorderRecord;
  let preparedMedia: Awaited<ReturnType<typeof prepareRecorderMedia>> | undefined;
  if (submission.type === "observation") {
    record = {
      kind: "fieldObservation" as const,
      value: buildObservation({
        ...submission,
        context,
        id,
        kind: submission.kind,
        utcOffsetMinutes: -now.getTimezoneOffset(),
      } as Parameters<typeof buildObservation>[0]),
    };
  } else if (submission.type === "routeRun") {
    record = {
      kind: "routeRun" as const,
      value: buildRouteRun({ ...submission.value, context, id }),
    };
  } else if (submission.type === "sourceStatement") {
    record = {
      kind: "sourceStatement" as const,
      value: buildSourceStatement({ ...submission.value, context, id }),
    };
  } else if (submission.type === "statementTranslation") {
    record = {
      kind: "statementTranslation" as const,
      value: buildStatementTranslation({ ...submission.value, context, id }),
    };
  } else if (submission.type === "captureException") {
    record = {
      kind: "captureException" as const,
      value: buildCaptureException({
        captureContext: submission.value.context,
        context,
        id,
        reason: submission.value.reason,
        reasonDetails: submission.value.reasonDetails,
      }),
    };
  } else if (submission.type === "schemaGap") {
    record = {
      kind: "schemaGap" as const,
      value: buildSchemaGap({ ...submission.value, context, id }),
    };
  } else {
    const bytes = new Uint8Array(await submission.file.arrayBuffer());
    preparedMedia = await prepareRecorderMedia({ bytes, key, mediaType: submission.file.type });
    record = {
      kind: "evidenceAsset" as const,
      value: buildEvidenceAsset({
        ...submission.value,
        byteSize: preparedMedia.byteSize,
        capturedAt: now.toISOString(),
        contentSha256: preparedMedia.contentSha256,
        context,
        coverageRequirementIds: [context.coverageRequirementId],
        id,
        mediaType: preparedMedia.mediaType,
        objectiveIds: [context.objectiveId],
      }),
    };
  }
  let next = captureRecorderRecord({ now: now.toISOString(), protocol, record, work });
  if (preparedMedia) {
    next = {
      ...next,
      mediaReceipts: [
        ...next.mediaReceipts,
        {
          assetId: record.value.id,
          byteSize: preparedMedia.byteSize,
          mediaType: preparedMedia.mediaType,
          opaqueMediaKey: preparedMedia.opaqueMediaKey,
          sha256: preparedMedia.contentSha256,
        },
      ],
    };
  }
  return { media: preparedMedia ? [preparedMedia.bundle] : undefined, next };
}

function withCurrentCaptureWindow(work: RecorderWork, protocol: RecorderProtocol, now: Date) {
  const visitId = activeVisitId(work);
  if (!visitId || !work.step.objectiveId || !work.step.coverageRequirementId) {
    throw new Error("The current objective and active Visit must be selected before capture.");
  }
  const window = createCaptureWindow(now);
  let windowId = window.id;
  const updated = replaceRecord(work, visitId, (entry) => {
    if (entry.kind !== "fieldVisit") return entry;
    const existing = entry.value.captureWindows.find(
      (candidate) => candidate.localHourStartedAt === window.localHourStartedAt,
    );
    if (existing) {
      windowId = existing.id;
      return entry;
    }
    return {
      ...entry,
      value: { ...entry.value, captureWindows: [...entry.value.captureWindows, window] },
    };
  });
  return {
    context: {
      ...captureContextBase(
        updated,
        protocol,
        work.step.objectiveId,
        work.step.coverageRequirementId,
      ),
      captureWindowIds: [windowId] as [string],
      visitId,
    },
    work: updated,
  };
}

function captureContextBase(
  work: RecorderWork,
  protocol: RecorderProtocol,
  objectiveId: string,
  coverageRequirementId: string,
) {
  return {
    assignmentId: work.step.assignmentId,
    campaignId: work.planSnapshot.protocol.campaignId,
    captureWindowIds: [crypto.randomUUID()] as [string],
    coverageRequirementId,
    deviceId: work.deviceId,
    localTimezone: "Asia/Manila" as const,
    objectiveId,
    protocol,
    protocolPackageId: work.protocolPackageId,
    protocolPackageVersion: work.protocolPackageVersion,
    recordedAt: new Date().toISOString(),
    researcherId: work.researcherId,
  };
}

function captureVisitContext(work: RecorderWork, protocol: RecorderProtocol) {
  const base = captureContextBase(work, protocol, "unused", "unused");
  const { captureWindowIds: _, coverageRequirementId: __, objectiveId: ___, ...context } = base;
  return context;
}

function replaceRecord(
  work: RecorderWork,
  recordId: string,
  replace: (entry: RecorderWork["records"][number]) => RecorderWork["records"][number],
): RecorderWork {
  return {
    ...work,
    records: work.records.map((entry) => (entry.value.id === recordId ? replace(entry) : entry)),
  };
}

function activeVisitId(work: RecorderWork): string | undefined {
  const visitId = work.step.visitId;
  if (!visitId) return undefined;
  const visit = work.records.find(
    (entry) => entry.kind === "fieldVisit" && entry.value.id === visitId,
  );
  return visit?.kind === "fieldVisit" && visit.value.captureState === "draft" ? visitId : undefined;
}

function writerReference(visitId: string): string {
  return `visit_ref_${visitId.replaceAll("-", "")}`;
}

function createCaptureWindow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    month: "2-digit",
    timeZone: "Asia/Manila",
    year: "numeric",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return {
    id: crypto.randomUUID(),
    localHourStartedAt: `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:00:00+08:00`,
    utcOffsetMinutes: 480,
    windowIdentity: "local_hour" as const,
  };
}

async function updateLocationStatus(
  input: FieldVisitDraftInput,
  setRuntime: React.Dispatch<React.SetStateAction<RecorderRuntimeStatus>>,
) {
  if (input.locationPermissionState !== "precise_active_visit" || !navigator.geolocation) {
    setRuntime((current) => ({
      ...current,
      location: input.locationPermissionState === "coarse" ? "coarse" : "denied",
    }));
    return;
  }
  await new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => {
        setRuntime((current) => ({ ...current, location: "precise_active_visit" }));
        resolve();
      },
      () => {
        setRuntime((current) => ({ ...current, location: "denied" }));
        resolve();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}
