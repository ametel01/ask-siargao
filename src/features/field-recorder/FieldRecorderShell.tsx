"use client";

import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  RecorderRuntimeStatus,
  RecorderWork,
} from "@/features/field-recorder/field-recorder-types";
import type { RecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

import { FieldRecorder, type FieldRecorderActions } from "./FieldRecorder";
import { FieldRecorderController } from "./FieldRecorderController";

export function FieldRecorderShell(props: {
  actions?: FieldRecorderActions;
  harness?: boolean;
  initialWork?: RecorderWork;
  protocol: RecorderProtocol;
  runtime?: RecorderRuntimeStatus;
}) {
  if (!props.harness && !props.initialWork && !props.actions) {
    return <FieldRecorderController protocol={props.protocol} />;
  }
  return <ControlledFieldRecorderShell {...props} />;
}

function ControlledFieldRecorderShell(props: {
  actions?: FieldRecorderActions;
  harness?: boolean;
  initialWork?: RecorderWork;
  protocol: RecorderProtocol;
  runtime?: RecorderRuntimeStatus;
}) {
  const displayProtocol = useMemo(
    () => (props.harness ? protocolForHarness(props.protocol) : props.protocol),
    [props.harness, props.protocol],
  );
  const harnessWork = useMemo(
    () => (props.harness ? createHarnessWork(displayProtocol) : undefined),
    [displayProtocol, props.harness],
  );
  const [localWork, setLocalWork] = useState<RecorderWork | undefined>(
    props.initialWork ?? harnessWork,
  );
  const [localRuntime, setLocalRuntime] = useState<RecorderRuntimeStatus>(
    props.runtime ?? defaultRuntime(props.harness === true),
  );

  if (!localWork) {
    return (
      <main className="min-h-dvh bg-[var(--surface-soft)] px-4 py-10 text-[var(--text-default)] sm:px-8">
        <Card className="mx-auto max-w-2xl bg-[var(--surface-default)] shadow-[var(--shadow-panel)]">
          <CardHeader>
            <CardDescription>Island Field Desk · Protected local workspace</CardDescription>
            <CardTitle>
              <h1 className="text-3xl font-semibold">Recorder locked</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Alert>
              <AlertTitle>No confirmed work is available</AlertTitle>
              <AlertDescription>
                Unlock this device and confirm a Field Day Plan. Protected Assignment values are
                loaded only from the encrypted local vault.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="min-h-11">
                <a href="/operator/field/offline-shell">Unlock local vault</a>
              </Button>
              <Button
                asChild
                className="min-h-11 bg-[var(--surface-default)] text-[var(--text-strong)]"
                variant="outline"
              >
                <a href="/operator/field/plan">Open Field Day Planner</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const actions =
    props.actions ??
    createHarnessActions({
      protocol: displayProtocol,
      setRuntime: setLocalRuntime,
      setWork: setLocalWork,
      work: localWork,
    });

  return (
    <FieldRecorder
      actions={actions}
      protocol={displayProtocol}
      runtime={props.runtime ?? localRuntime}
      work={props.initialWork ?? localWork}
    />
  );
}

function createHarnessActions(input: {
  protocol: RecorderProtocol;
  setRuntime: React.Dispatch<React.SetStateAction<RecorderRuntimeStatus>>;
  setWork: React.Dispatch<React.SetStateAction<RecorderWork | undefined>>;
  work: RecorderWork;
}): FieldRecorderActions {
  const save = (mutate: (work: RecorderWork) => RecorderWork) => {
    const revision = input.work.revision + 1;
    input.setRuntime((runtime) => ({ ...runtime, save: { revision, status: "saving" } }));
    input.setWork((work) => (work ? mutate(work) : work));
    queueMicrotask(() =>
      input.setRuntime((runtime) => ({
        ...runtime,
        save: { revision, savedAt: new Date().toISOString(), status: "saved" },
      })),
    );
  };
  const changeStep = (step: RecorderWork["step"]) =>
    save((work) => ({
      ...work,
      revision: work.revision + 1,
      step,
      updatedAt: new Date().toISOString(),
    }));
  return {
    advance: ({ safetyEligible = true } = {}) => {
      const step = input.work.step;
      const next = {
        briefing: "safety",
        safety: safetyEligible ? "start_visit" : "outcome",
        start_visit: "objectives",
        objectives: "gaps",
        gaps: "close_visit",
        close_visit: "outcome",
        outcome: "outcome",
      }[step.name] as RecorderWork["step"]["name"];
      changeStep({ ...step, name: next });
    },
    capture: () =>
      save((work) => ({
        ...work,
        revision: work.revision + 1,
        updatedAt: new Date().toISOString(),
      })),
    closeFieldDay: () =>
      save((work) => ({
        ...work,
        fieldDayClose: {
          assetIssueRecordIds: [],
          assignmentOutcomeIds: work.assignmentOutcomes.map((entry) => entry.id),
          campaignId: work.planSnapshot.protocol.campaignId,
          closedAt: new Date().toISOString(),
          followUpAssignmentIds: work.followUps.map((entry) => entry.id),
          id: crypto.randomUUID(),
          permissionIssueRecordIds: [],
          planSnapshotId: work.planSnapshot.snapshotId,
          protocolPackageId: work.protocolPackageId,
          protocolPackageVersion: work.protocolPackageVersion,
          recoveryStatus: "recovery_required",
          schemaVersion: "field-day-close.v1",
          unresolvedRecordIds: [],
        },
        revision: work.revision + 1,
        updatedAt: new Date().toISOString(),
      })),
    closeVisit: () => changeStep({ ...input.work.step, name: "outcome" }),
    lock: () => input.setWork(undefined),
    retrySave: () =>
      input.setRuntime((runtime) => ({
        ...runtime,
        save: {
          revision: input.work.revision,
          savedAt: new Date().toISOString(),
          status: "saved",
        },
      })),
    returnToObjectives: () => changeStep({ ...input.work.step, name: "objectives" }),
    startVisit: () =>
      changeStep({
        ...input.work.step,
        name: "objectives",
        objectiveId: input.work.objectiveCoverage[0]?.objectiveId,
        coverageRequirementId:
          input.work.objectiveCoverage[0]?.requirements[0]?.coverageRequirementId,
        visitId: crypto.randomUUID(),
      }),
  };
}

export function createHarnessWork(protocol: RecorderProtocol): RecorderWork {
  const assignment = protocol.campaign.assignments[0];
  if (!assignment) throw new Error("The Recorder harness requires one protocol Assignment.");
  const now = "2026-08-23T08:00:00.000Z";
  const areaId =
    "areaId" in assignment.geography
      ? assignment.geography.areaId
      : protocol.geography.areas[0]?.id;
  const consequences = assignment.coverageRequirements.map((requirement) => ({
    coverageRequirementId: requirement.id,
    remainingDistinctWindows: requirement.repetition.minimumDistinctWindows,
    remainingRecords: requirement.minimumRecords,
  }));
  return {
    assignmentOutcomes: [],
    assignments: [
      {
        assignmentId: assignment.id,
        status: "planned",
        unresolvedRequirementIds: consequences.map((entry) => entry.coverageRequirementId),
        visitIds: [],
      },
    ],
    createdAt: now,
    deviceId: "device_playwright",
    followUps: [],
    id: "recorder_playwright",
    mediaReceipts: [],
    objectiveCoverageRecords: [],
    objectiveCoverage: assignment.objectives.map((objective) => ({
      objectiveId: objective.id,
      requirements: assignment.coverageRequirements
        .filter((requirement) => requirement.objectiveId === objective.id)
        .map((requirement) => ({
          capturedRecords: 0,
          capturedRecordIds: [],
          coverageRequirementId: requirement.id,
          distinctWindows: 0,
          distinctWindowIds: [],
          objectiveId: objective.id,
          reasonCodes: ["record_threshold"],
          requiredDistinctWindows: requirement.repetition.minimumDistinctWindows,
          requiredRecords: requirement.minimumRecords,
          status: "unstarted",
          supportingAssets: 0,
          supportingAssetIds: [],
        })),
      status: "unstarted",
      sourceRecordIds: [],
    })),
    planContentHash: "playwright-only-no-protected-data",
    planSnapshot: {
      adjustments: [],
      confirmedAt: now,
      contentHash: "playwright-only-no-protected-data",
      coverageSnapshot: {
        capturedAt: now,
        id: "coverage_playwright",
        protocolPackageId: protocol.manifest.packageId,
        protocolPackageVersion: protocol.manifest.packageVersion,
        requirementStates: [],
        resolvedAssignmentAreaIds: areaId ? { [assignment.id]: areaId } : {},
        version: "1",
      },
      deviceId: "device_playwright",
      inputs: {
        assignmentGates: [],
        availableMinutes: 240,
        eligibilityEvidence: [],
        planningAt: now,
        reserveMinutes: { daylight: 20, documentation: 20, rest: 15, safety: 20 },
        startingAreaId: areaId ?? "area_del_carmen",
        transportMode: "motorbike",
      },
      invalidatedEvidenceIds: [],
      proposal: {
        availableMinutes: 240,
        consumedMinutes: assignment.estimatedMinutes,
        coverageSnapshotId: "coverage_playwright",
        exclusions: [],
        plannedReturnMinutes: 30,
        protocolPackageId: protocol.manifest.packageId,
        protocolPackageVersion: protocol.manifest.packageVersion,
        remainingMinutes: 0,
        reserveMinutes: 75,
        selected: [
          {
            areaId: areaId ?? "area_del_carmen",
            assignmentId: assignment.id,
            consequences,
            outstandingRequiredCoverage: consequences.length,
            reasons: [],
            returnToStartMinutes: 30,
            title: assignment.title,
            travelFromPreviousMinutes: 0,
            workMinutes: assignment.estimatedMinutes,
          },
        ],
        usableMinutes: 165,
      },
      protocol: {
        campaignId: protocol.campaign.campaignId,
        campaignVersion: protocol.campaign.componentVersion,
        geographyVersion: protocol.geography.componentVersion,
        packageId: protocol.manifest.packageId,
        packageVersion: protocol.manifest.packageVersion,
      },
      researcherId: "researcher_playwright",
      revision: 1,
      revisionReason: "Protected UI harness only",
      schemaVersion: "field-plan-snapshot.v1",
      snapshotId: "snapshot_playwright",
    },
    protocolPackageId: protocol.manifest.packageId,
    protocolPackageVersion: protocol.manifest.packageVersion,
    records: [],
    researcherId: "researcher_playwright",
    revision: 1,
    schemaVersion: "field-recorder-work.v1",
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: assignment.id, name: "briefing" },
    updatedAt: now,
  };
}

function protocolForHarness(protocol: RecorderProtocol): RecorderProtocol {
  const assignment = protocol.campaign.assignments[0];
  const requirement = assignment?.coverageRequirements[0];
  if (!assignment || !requirement) return protocol;
  const allKinds = protocol.observationKinds.kinds.map((entry) => entry.kind);
  return {
    ...protocol,
    campaign: {
      ...protocol.campaign,
      assignments: [
        {
          ...assignment,
          coverageRequirements: assignment.coverageRequirements.map((entry) => ({
            ...entry,
            admissibleObservationKinds: allKinds,
          })),
          objectives: [
            {
              ...assignment.objectives[0],
              observationKinds: allKinds,
            },
            ...assignment.objectives.slice(1),
          ],
        },
        ...protocol.campaign.assignments.slice(1),
      ],
    },
  } as unknown as RecorderProtocol;
}

function defaultRuntime(harness: boolean): RecorderRuntimeStatus {
  return {
    grantExpiresAt: harness ? "2026-08-23T18:00:00.000Z" : undefined,
    location: "coarse",
    online: true,
    save: { revision: 1, savedAt: "2026-08-23T08:00:00.000Z", status: "saved" },
    storageAvailableBytes: 1_610_612_736,
    vault: harness ? "unlocked" : "locked",
    waitingUpdate: false,
    writer: harness ? "active" : "none",
  };
}
