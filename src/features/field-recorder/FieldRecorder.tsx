"use client";

import {
  AlertTriangle,
  Check,
  CloudOff,
  Database,
  HardDrive,
  LocateFixed,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { FieldObservation, ObservationKind } from "@/features/field-protocol/generated";
import type {
  RecorderRuntimeStatus,
  RecorderStepName,
  RecorderWork,
} from "@/features/field-recorder/field-recorder-types";
import type { RecorderProtocol } from "@/features/field-recorder/load-recorder-protocol";

import { CaptureForms } from "./forms/CaptureForms";
import {
  CheckboxField,
  fieldControlClass,
  humanize,
  options,
  SelectField,
  string,
  strings,
  TextAreaField,
  TextField,
} from "./forms/form-controls";
import type { CaptureFormSubmission, FieldVisitDraftInput } from "./forms/form-types";

const sequence: readonly Readonly<{ name: RecorderStepName; label: string }>[] = [
  { name: "briefing", label: "Briefing" },
  { name: "safety", label: "Safety" },
  { name: "start_visit", label: "Start Visit" },
  { name: "objectives", label: "Objectives" },
  { name: "gaps", label: "Gaps" },
  { name: "close_visit", label: "Close Visit" },
  { name: "outcome", label: "Outcome" },
];

export type FieldRecorderActions = Readonly<{
  advance: (input?: { safetyEligible?: boolean }) => void | Promise<void>;
  capture: (submission: CaptureFormSubmission) => void | Promise<void>;
  closeFieldDay: () => void | Promise<void>;
  closeVisit: () => void | Promise<void>;
  lock?: () => void;
  returnToObjectives?: () => void | Promise<void>;
  retrySave?: () => void | Promise<void>;
  startVisit: (input: FieldVisitDraftInput) => void | Promise<void>;
  takeOverWriter?: () => void | Promise<void>;
}>;

export function FieldRecorder(props: {
  actions: FieldRecorderActions;
  protocol: RecorderProtocol;
  runtime: RecorderRuntimeStatus;
  work: RecorderWork;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [captureOpen, setCaptureOpen] = useState(false);
  const taskHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const assignment = props.protocol.campaign.assignments.find(
    (candidate) => candidate.id === props.work.step.assignmentId,
  );
  const objective = assignment?.objectives.find(
    (candidate) => candidate.id === props.work.step.objectiveId,
  );
  const requirement = assignment?.coverageRequirements.find(
    (candidate) => candidate.id === props.work.step.coverageRequirementId,
  );
  const coverage = props.work.objectiveCoverage.flatMap((entry) => entry.requirements);
  const satisfied = coverage.filter((entry) =>
    ["satisfied", "not_applicable"].includes(entry.status),
  ).length;
  const coveragePercent = coverage.length > 0 ? Math.round((satisfied / coverage.length) * 100) : 0;
  const governedSubjects = props.protocol.subjects.subjects.map((subject) => ({
    id: subject.id,
    label: subject.name,
  }));
  const provisionalSubjectIds = props.work.records.flatMap((record) =>
    record.kind === "fieldVisit" && record.value.target.kind === "provisional_subject"
      ? [record.value.target.provisionalSubject.id]
      : [],
  );
  const sourceStatementIds = props.work.records.flatMap((record) =>
    record.kind === "sourceStatement" ? [record.value.id] : [],
  );
  const recordIds = props.work.records
    .filter((record) => record.kind !== "fieldVisit" && record.kind !== "evidenceAsset")
    .map((record) => record.value.id);

  async function run(action: () => void | Promise<void>, successFocus = true) {
    if (busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      if (successFocus) requestAnimationFrame(() => taskHeadingRef.current?.focus());
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "The current task could not be saved.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="h-dvh overflow-hidden bg-[var(--surface-soft)] text-[var(--text-default)]"
      data-field-recorder
    >
      <header className="border-b border-white/10 bg-[var(--brand-navy-950)] px-4 py-3 text-[var(--text-on-dark)] sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-lagoon-300)]">
              Island Field Desk
            </p>
            <h1 className="mt-0.5 text-xl font-semibold sm:text-2xl">Evidence station</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className="border-white/20 bg-white/10 text-[var(--text-on-dark)]"
              variant="outline"
            >
              Protocol {props.work.protocolPackageVersion}
            </Badge>
            {props.actions.lock ? (
              <Button
                className="min-h-11 border-white/30 bg-transparent text-[var(--text-on-dark)]"
                type="button"
                variant="outline"
                onClick={props.actions.lock}
              >
                <LockKeyhole aria-hidden="true" /> Lock
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main
        className="h-[calc(100dvh-69px)] overflow-y-auto px-4 py-5 sm:px-6"
        id="field-recorder-scroll-owner"
      >
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            className="space-y-4 md:sticky md:top-0 md:self-start"
            aria-label="Assignment status and sequence"
          >
            <Card className="bg-[var(--brand-navy-950)] text-[var(--text-on-dark)] ring-white/10">
              <CardHeader>
                <CardDescription className="text-[var(--brand-lagoon-300)]">
                  Current Assignment
                </CardDescription>
                <CardTitle className="text-lg text-[var(--text-on-dark)]">
                  {assignment?.title ?? props.work.step.assignmentId}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress
                  aria-label={`${coveragePercent}% of current Assignment coverage resolved`}
                  value={coveragePercent}
                />
                <p className="text-sm text-[var(--text-on-dark-muted)]">
                  {satisfied} of {coverage.length || "—"} requirements resolved
                </p>
                <ol className="space-y-1" aria-label="Recorder sequence">
                  {sequence.map((step, index) => {
                    const currentIndex = sequence.findIndex(
                      (entry) => entry.name === props.work.step.name,
                    );
                    const isCurrent = step.name === props.work.step.name;
                    const completed = index < currentIndex;
                    return (
                      <li
                        key={step.name}
                        aria-current={isCurrent ? "step" : undefined}
                        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${isCurrent ? "bg-[var(--brand-lagoon-700)] font-semibold text-white" : "text-[var(--text-on-dark-muted)]"}`}
                      >
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-full border ${completed ? "border-[var(--brand-lagoon-300)] bg-[var(--brand-lagoon-300)] text-[var(--brand-navy-950)]" : "border-current"}`}
                        >
                          {completed ? (
                            <Check aria-label="Complete" className="size-4" />
                          ) : (
                            index + 1
                          )}
                        </span>
                        {step.label}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
            <RuntimeRail
              runtime={props.runtime}
              onTakeOverWriter={
                props.actions.takeOverWriter
                  ? () => run(props.actions.takeOverWriter as () => void | Promise<void>, false)
                  : undefined
              }
              onRetrySave={
                props.actions.retrySave
                  ? () => run(props.actions.retrySave as () => void | Promise<void>, false)
                  : undefined
              }
            />
          </aside>

          <section className="min-w-0 space-y-4" aria-labelledby="current-task-title">
            {actionError ? (
              <Alert ref={errorRef} tabIndex={-1} variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Current task not saved</AlertTitle>
                <AlertDescription>
                  {actionError} The last durable revision remains available.
                </AlertDescription>
              </Alert>
            ) : null}
            <Card className="bg-[var(--surface-default)] shadow-[var(--shadow-panel)]">
              <CardHeader className="border-b border-[var(--brand-lavender-200)]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-lagoon-700)]">
                    One task now
                  </p>
                  <CardTitle>
                    <h2
                      ref={taskHeadingRef}
                      id="current-task-title"
                      tabIndex={-1}
                      className="text-3xl font-semibold outline-none"
                    >
                      {taskTitle(props.work.step.name)}
                    </h2>
                  </CardTitle>
                  <CardDescription>
                    {taskDescription(props.work.step.name, objective?.id, requirement?.labelKey)}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                {props.work.step.name === "briefing" ? (
                  <Briefing
                    assignment={assignment}
                    onContinue={() => run(() => props.actions.advance())}
                    busy={busy}
                  />
                ) : null}
                {props.work.step.name === "safety" ? (
                  <SafetyCheck
                    busy={busy}
                    onContinue={(eligible) =>
                      run(() => props.actions.advance({ safetyEligible: eligible }))
                    }
                  />
                ) : null}
                {props.work.step.name === "start_visit" ? (
                  <StartVisitForm
                    assignment={assignment}
                    areas={props.protocol.geography.areas}
                    routes={props.protocol.geography.routes}
                    subjects={props.protocol.subjects.subjects}
                    busy={busy}
                    onSubmit={(input) => run(() => props.actions.startVisit(input))}
                  />
                ) : null}
                {props.work.step.name === "objectives" ? (
                  <ObjectiveTask
                    allowedKinds={
                      (requirement?.admissibleObservationKinds ??
                        objectiveKinds(objective)) as readonly ObservationKind[]
                    }
                    captureOpen={captureOpen}
                    coverage={coverage}
                    governedSubjects={governedSubjects}
                    methodProfiles={props.protocol.methodProfiles.profiles}
                    onAdvance={() => run(() => props.actions.advance())}
                    onCapture={() => setCaptureOpen(true)}
                    onCaptured={() => {
                      setCaptureOpen(false);
                      requestAnimationFrame(() => taskHeadingRef.current?.focus());
                    }}
                    onSubmit={props.actions.capture}
                    provisionalSubjectIds={provisionalSubjectIds}
                    recordIds={recordIds}
                    requirement={requirement}
                    sourceStatementIds={sourceStatementIds}
                  />
                ) : null}
                {props.work.step.name === "gaps" ? (
                  <GapReview
                    coverage={coverage}
                    busy={busy}
                    onContinue={() => run(() => props.actions.advance())}
                    onReturn={
                      props.actions.returnToObjectives
                        ? () => run(props.actions.returnToObjectives as () => void | Promise<void>)
                        : undefined
                    }
                  />
                ) : null}
                {props.work.step.name === "close_visit" ? (
                  <CloseVisit
                    busy={busy}
                    coverage={coverage}
                    onClose={() => run(props.actions.closeVisit)}
                  />
                ) : null}
                {props.work.step.name === "outcome" ? (
                  <Outcome
                    busy={busy}
                    work={props.work}
                    onCloseDay={() => run(props.actions.closeFieldDay)}
                  />
                ) : null}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}

function RuntimeRail(props: {
  runtime: RecorderRuntimeStatus;
  onRetrySave?: () => void;
  onTakeOverWriter?: () => void;
}) {
  const saveText =
    props.runtime.save.status === "saving"
      ? `Saving revision ${props.runtime.save.revision}…`
      : props.runtime.save.status === "saved"
        ? `Saved durably ${formatTime(props.runtime.save.savedAt)}`
        : props.runtime.save.status === "save_failed"
          ? `Save failed: ${props.runtime.save.reason}`
          : "No unsaved edits";
  return (
    <Card className="bg-[var(--surface-default)]">
      <CardHeader>
        <CardTitle>Station status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <StatusLine
          icon={<Database />}
          label="Save"
          value={saveText}
          role="status"
          bad={props.runtime.save.status === "save_failed"}
        />
        <StatusLine
          icon={<LockKeyhole />}
          label="Active writer"
          value={
            props.runtime.writer === "active"
              ? "This station holds the writer lease"
              : props.runtime.writer === "conflict"
                ? "Another station holds the writer lease"
                : "No active Visit writer"
          }
          bad={props.runtime.writer === "conflict"}
        />
        {props.runtime.writer === "conflict" && props.onTakeOverWriter ? (
          <Button
            className="min-h-11 w-full bg-[var(--surface-default)] text-[var(--text-strong)]"
            style={{
              backgroundColor: "var(--brand-paper-50)",
              color: "var(--brand-navy-950)",
            }}
            variant="outline"
            onClick={props.onTakeOverWriter}
          >
            Take over expired writer
          </Button>
        ) : null}
        {props.runtime.save.status === "save_failed" && props.onRetrySave ? (
          <Button
            className="min-h-11 w-full bg-[var(--surface-default)] text-[var(--text-strong)]"
            style={{
              backgroundColor: "var(--brand-paper-50)",
              color: "var(--brand-navy-950)",
            }}
            variant="outline"
            onClick={props.onRetrySave}
          >
            <RefreshCw aria-hidden="true" /> Retry save
          </Button>
        ) : null}
        <StatusLine
          icon={<CloudOff />}
          label="Network"
          value={props.runtime.online ? "Online" : "Offline — capture continues"}
          role="status"
        />
        <StatusLine
          icon={<LocateFixed />}
          label="Location"
          value={humanize(props.runtime.location)}
        />
        <StatusLine
          icon={<ShieldCheck />}
          label="Vault"
          value={humanize(props.runtime.vault)}
          bad={props.runtime.vault === "locked"}
        />
        <StatusLine
          icon={<LockKeyhole />}
          label="Grant"
          value={
            props.runtime.grantExpiresAt
              ? `Expires ${formatTime(props.runtime.grantExpiresAt)}`
              : "No active grant"
          }
          bad={!props.runtime.grantExpiresAt}
        />
        <StatusLine
          icon={<RefreshCw />}
          label="Update"
          value={
            props.runtime.waitingUpdate ? "Waiting until Visit closes" : "Current build pinned"
          }
        />
        <StatusLine
          icon={<HardDrive />}
          label="Storage"
          value={`${formatBytes(props.runtime.storageAvailableBytes)} available`}
        />
      </CardContent>
    </Card>
  );
}

function StatusLine(props: {
  bad?: boolean;
  icon: React.ReactNode;
  label: string;
  role?: "status";
  value: string;
}) {
  return (
    <div className="flex items-start gap-3" role={props.role}>
      <span
        className={
          props.bad ? "text-[var(--risk-high-foreground)]" : "text-[var(--brand-lagoon-700)]"
        }
      >
        {props.icon}
      </span>
      <div>
        <p className="font-semibold text-[var(--text-strong)]">{props.label}</p>
        <p
          className={props.bad ? "text-[var(--risk-high-foreground)]" : "text-[var(--text-muted)]"}
        >
          {props.value}
        </p>
      </div>
    </div>
  );
}

function Briefing(props: {
  assignment: RecorderProtocol["campaign"]["assignments"][number] | undefined;
  busy: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-lg font-semibold">Assignment brief</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <BriefFact label="Area" value={assignmentArea(props.assignment)} />
          <BriefFact
            label="Planned field time"
            value={`${props.assignment?.estimatedMinutes ?? 0} minutes`}
          />
          <BriefFact label="Objectives" value={String(props.assignment?.objectives.length ?? 0)} />
          <BriefFact
            label="Required evidence"
            value={String(
              props.assignment?.coverageRequirements.filter((entry) => entry.required).length ?? 0,
            )}
          />
        </dl>
      </section>
      <section>
        <h3 className="text-lg font-semibold">Objectives in protocol order</h3>
        <ol className="mt-3 space-y-2">
          {props.assignment?.objectives.map((objective, index) => (
            <li className="rounded-lg bg-[var(--surface-soft)] p-3" key={objective.id}>
              <strong>
                {index + 1}. {humanize(objective.action)}
              </strong>
              <span className="mt-1 block text-sm text-[var(--text-muted)]">
                {humanize(objective.id)}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>Evidence boundaries</AlertTitle>
        <AlertDescription>
          Capture only the assigned area and protocol kinds. Do not infer facts you did not observe.
          Stop if access, consent, or safety changes.
        </AlertDescription>
      </Alert>
      <Button className="min-h-11" disabled={props.busy} onClick={props.onContinue}>
        Review safety and eligibility
      </Button>
    </div>
  );
}

function SafetyCheck(props: { busy: boolean; onContinue: (eligible: boolean) => void }) {
  const [checks, setChecks] = useState({ access: false, eligibility: false, safety: false });
  const eligible = Object.values(checks).every(Boolean);
  return (
    <div className="space-y-5">
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>Stop-work authority</AlertTitle>
        <AlertDescription>
          Do not proceed through unsafe conditions, denied access, expired eligibility, or withdrawn
          permission. Record the exact Capture Exception instead.
        </AlertDescription>
      </Alert>
      <fieldset className="space-y-3">
        <legend className="font-semibold">Confirm current conditions</legend>
        {(
          [
            ["safety", "The route and site are safe now"],
            ["access", "Access is currently allowed"],
            ["eligibility", "Required eligibility evidence is still valid"],
          ] as const
        ).map(([key, label]) => (
          <label
            className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--brand-lavender-200)] p-3"
            key={key}
          >
            <input
              className="size-5"
              type="checkbox"
              checked={checks[key]}
              onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button
          className="min-h-11"
          disabled={!eligible || props.busy}
          onClick={() => props.onContinue(true)}
        >
          Safety confirmed — start Visit
        </Button>
        <Button
          className="min-h-11 bg-[var(--surface-default)] text-[var(--text-strong)]"
          disabled={props.busy}
          style={{
            backgroundColor: "var(--brand-paper-50)",
            color: "var(--brand-navy-950)",
          }}
          variant="outline"
          onClick={() => props.onContinue(false)}
        >
          Cannot proceed safely
        </Button>
      </div>
    </div>
  );
}

function StartVisitForm(props: {
  areas: RecorderProtocol["geography"]["areas"];
  assignment: RecorderProtocol["campaign"]["assignments"][number] | undefined;
  busy: boolean;
  onSubmit: (input: FieldVisitDraftInput) => void;
  routes: RecorderProtocol["geography"]["routes"];
  subjects: RecorderProtocol["subjects"]["subjects"];
}) {
  const [targetKind, setTargetKind] = useState<
    "governed_subject" | "governed_area" | "governed_route" | "provisional_subject"
  >("governed_subject");
  async function submit(data: FormData) {
    const target =
      targetKind === "governed_subject"
        ? ({ kind: targetKind, subjectId: string(data, "targetId") } as const)
        : targetKind === "governed_area"
          ? ({ kind: targetKind, areaId: string(data, "targetId") } as const)
          : targetKind === "governed_route"
            ? ({ kind: targetKind, routeId: string(data, "targetId") } as const)
            : ({
                kind: targetKind,
                provisionalSubject: {
                  category: string(data, "provisionalCategory") as "place",
                  displayedName: string(data, "provisionalName"),
                  distinguishingDetails: string(data, "distinguishingDetails"),
                  governedAreaId: string(data, "provisionalArea"),
                  id: `provisional_${crypto.randomUUID()}`,
                },
              } as const);
    props.onSubmit({
      conditions: { tags: strings(data, "visitConditions") as FieldObservation["conditions"] },
      locationPermissionState: string(data, "locationPermissionState") as "denied",
      publicLocationPrecision: string(data, "publicLocationPrecision") as "withheld",
      target,
    });
  }
  const targetOptions =
    targetKind === "governed_subject"
      ? props.subjects.map((entry) => [entry.id, entry.name] as const)
      : targetKind === "governed_area"
        ? props.areas.map((entry) => [entry.id, humanize(entry.id)] as const)
        : targetKind === "governed_route"
          ? props.routes.map((entry) => [entry.id, humanize(entry.id)] as const)
          : [];
  return (
    <form action={submit} className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-semibold">Visit target</legend>
        <label className="block text-sm font-medium">
          Target type
          <select
            className={fieldControlClass}
            value={targetKind}
            onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}
          >
            <option value="governed_subject">Governed Subject</option>
            <option value="governed_area">Governed area</option>
            <option value="governed_route">Governed route</option>
            <option value="provisional_subject">Structured Provisional Subject</option>
          </select>
        </label>
        {targetKind !== "provisional_subject" ? (
          <SelectField
            label="Target"
            name="targetId"
            options={targetOptions.length ? targetOptions : [["", "No governed target"]]}
            required
          />
        ) : (
          <>
            <TextField label="Displayed name" name="provisionalName" required />
            <SelectField
              label="Category"
              name="provisionalCategory"
              options={options(["place", "service", "route", "organisation"])}
            />
            <SelectField
              label="Governed area"
              name="provisionalArea"
              options={props.areas.map((entry) => [entry.id, humanize(entry.id)] as const)}
            />
            <TextAreaField label="Distinguishing details" name="distinguishingDetails" required />
          </>
        )}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-semibold">Location and public precision</legend>
        <SelectField
          label="Location permission"
          name="locationPermissionState"
          options={options(["denied", "coarse", "precise_active_visit"])}
        />
        <SelectField
          label="Public location precision"
          name="publicLocationPrecision"
          options={options(["withheld", "governed_area", "route_corridor", "approximate_100m"])}
        />
      </fieldset>
      <fieldset>
        <legend className="font-semibold">Visit conditions</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            "weather_clear",
            "weather_cloudy",
            "weather_rain",
            "road_dry",
            "road_wet",
            "access_open",
            "access_restricted",
            "disruption_none",
            "disruption_active",
          ].map((value) => (
            <CheckboxField
              key={value}
              label={humanize(value)}
              name="visitConditions"
              value={value}
            />
          ))}
        </div>
      </fieldset>
      <Button className="min-h-11" disabled={props.busy} type="submit">
        Start Visit and pin this build
      </Button>
    </form>
  );
}

function ObjectiveTask(props: {
  allowedKinds: readonly ObservationKind[];
  captureOpen: boolean;
  coverage: readonly RecorderWork["objectiveCoverage"][number]["requirements"][number][];
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  methodProfiles: readonly Readonly<{
    id: string;
    procedure: string;
    supportedKinds: readonly string[];
  }>[];
  onAdvance: () => void;
  onCapture: () => void;
  onCaptured: () => void;
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
  provisionalSubjectIds: readonly string[];
  recordIds: readonly string[];
  requirement:
    | RecorderProtocol["campaign"]["assignments"][number]["coverageRequirements"][number]
    | undefined;
  sourceStatementIds: readonly string[];
}) {
  if (props.captureOpen)
    return (
      <CaptureForms
        allowedObservationKinds={props.allowedKinds}
        governedSubjects={props.governedSubjects}
        methodProfiles={props.methodProfiles}
        onCaptured={props.onCaptured}
        onSubmit={props.onSubmit}
        provisionalSubjectIds={props.provisionalSubjectIds}
        recordIds={props.recordIds}
        sourceStatementIds={props.sourceStatementIds}
      />
    );
  const current = props.coverage.find(
    (entry) => entry.coverageRequirementId === props.requirement?.id,
  );
  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-[var(--surface-soft)] p-4">
        <p className="text-sm font-semibold text-[var(--brand-lagoon-700)]">
          Current coverage requirement
        </p>
        <h3 className="mt-1 text-2xl font-semibold">
          {humanize(props.requirement?.labelKey ?? "Next required evidence")}
        </h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {current
            ? `${current.capturedRecords} of ${current.requiredRecords} records · ${current.distinctWindows} of ${current.requiredDistinctWindows} windows · ${current.supportingAssets} assets`
            : "No admissible attempt recorded yet."}
        </p>
        <Badge className="mt-3" variant="outline">
          {humanize(current?.status ?? "unstarted")}
        </Badge>
      </section>
      <p className="text-sm text-[var(--text-muted)]">
        Eligible Observation Kinds:{" "}
        {props.allowedKinds.map(humanize).join(", ") ||
          "Use another typed record or controlled exception."}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" onClick={props.onCapture}>
          Capture evidence
        </Button>
        <Button
          className="min-h-11 bg-[var(--surface-default)] text-[var(--text-strong)]"
          style={{
            backgroundColor: "var(--brand-paper-50)",
            color: "var(--brand-navy-950)",
          }}
          variant="outline"
          onClick={props.onAdvance}
        >
          Review all gaps
        </Button>
      </div>
    </div>
  );
}

function GapReview(props: {
  busy: boolean;
  coverage: readonly RecorderWork["objectiveCoverage"][number]["requirements"][number][];
  onContinue: () => void;
  onReturn?: () => void;
}) {
  const open = props.coverage.filter(
    (entry) => !["satisfied", "not_applicable"].includes(entry.status),
  );
  return (
    <div className="space-y-5">
      <p>
        {open.length === 0
          ? "Every selected requirement is resolved."
          : `${open.length} requirement${open.length === 1 ? " remains" : "s remain"}. Closing now creates a linked follow-up without reopening this Visit.`}
      </p>
      <ul className="space-y-2">
        {open.map((entry) => (
          <li
            className="rounded-lg border border-[var(--brand-lavender-200)] p-3"
            key={entry.coverageRequirementId}
          >
            <strong>{humanize(entry.coverageRequirementId)}</strong>
            <span className="block text-sm text-[var(--text-muted)]">
              {humanize(entry.status)} · {entry.reasonCodes.map(humanize).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        {open.length && props.onReturn ? (
          <Button className="min-h-11" disabled={props.busy} onClick={props.onReturn}>
            Return to next objective
          </Button>
        ) : null}
        <Button
          className="min-h-11"
          disabled={props.busy}
          variant={open.length ? "outline" : "default"}
          onClick={props.onContinue}
        >
          Continue to Visit close
        </Button>
      </div>
    </div>
  );
}

function CloseVisit(props: {
  busy: boolean;
  coverage: readonly RecorderWork["objectiveCoverage"][number]["requirements"][number][];
  onClose: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const gaps = props.coverage.filter(
    (entry) => !["satisfied", "not_applicable"].includes(entry.status),
  );
  return (
    <div className="space-y-5">
      <Alert>
        <LockKeyhole aria-hidden="true" />
        <AlertTitle>Captured records freeze at close</AlertTitle>
        <AlertDescription>
          Later corrections append a superseding record. The original Visit history is not reopened.
        </AlertDescription>
      </Alert>
      <p>
        {gaps.length
          ? `${gaps.length} unresolved requirements will create follow-up coverage and a Closed with gaps outcome.`
          : "Coverage supports a Complete Assignment outcome."}
      </p>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--brand-lavender-200)] p-3">
        <input
          className="size-5"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I reviewed assets, permissions, unknowns, conflicts, and not-tested items.
      </label>
      <Button className="min-h-11" disabled={!confirmed || props.busy} onClick={props.onClose}>
        Close Visit
      </Button>
    </div>
  );
}

function Outcome(props: { busy: boolean; onCloseDay: () => void; work: RecorderWork }) {
  const latest = props.work.assignmentOutcomes.at(-1);
  if (props.work.fieldDayClose)
    return (
      <div className="space-y-5">
        <Badge variant="outline">{humanize(props.work.fieldDayClose.recoveryStatus)}</Badge>
        <h3 className="text-2xl font-semibold">Field Day closed</h3>
        <Alert>
          <HardDrive aria-hidden="true" />
          <AlertTitle>Recovery Export required</AlertTitle>
          <AlertDescription>
            The immutable close is saved. A verified Recovery Export is the next fail-closed
            handoff; it is not claimed by this Recorder.
          </AlertDescription>
        </Alert>
      </div>
    );
  return (
    <div className="space-y-5">
      <Badge variant="outline">{humanize(latest?.status ?? "needs_attention")}</Badge>
      <h3 className="text-2xl font-semibold">
        Assignment {latest?.status === "complete" ? "complete" : "closed with gaps"}
      </h3>
      <p className="text-[var(--text-muted)]">
        {latest?.unresolvedRequirementIds.length ?? 0} unresolved requirements ·{" "}
        {props.work.followUps.length} linked follow-up Assignments.
      </p>
      {props.work.assignments.some((entry) => entry.status === "planned") ? (
        <p>The sequence will continue with the next eligible Assignment.</p>
      ) : (
        <Button className="min-h-11" disabled={props.busy} onClick={props.onCloseDay}>
          Reconcile and close Field Day
        </Button>
      )}
    </div>
  );
}

function BriefFact(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-soft)] p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {props.label}
      </dt>
      <dd className="mt-1 font-semibold">{props.value}</dd>
    </div>
  );
}
function objectiveKinds(
  objective: RecorderProtocol["campaign"]["assignments"][number]["objectives"][number] | undefined,
): readonly ObservationKind[] {
  return objective && "observationKinds" in objective
    ? (objective.observationKinds as readonly ObservationKind[])
    : [];
}
function assignmentArea(
  assignment: RecorderProtocol["campaign"]["assignments"][number] | undefined,
): string {
  if (!assignment) return "Unknown";
  const geography = assignment.geography;
  if ("areaId" in geography) return humanize(geography.areaId);
  if ("routeId" in geography) return humanize(geography.routeId);
  return "Governed subject set";
}
function taskTitle(step: RecorderStepName): string {
  return {
    briefing: "Read the Assignment briefing",
    safety: "Confirm safety and eligibility",
    start_visit: "Start the Field Visit",
    objectives: "Capture the current objective",
    gaps: "Resolve or carry forward gaps",
    close_visit: "Close and freeze this Visit",
    outcome: "Review the derived outcome",
  }[step];
}
function taskDescription(
  step: RecorderStepName,
  objectiveId?: string,
  requirementLabel?: string,
): string {
  if (step === "objectives")
    return `${objectiveId ? humanize(objectiveId) : "Current objective"} · ${requirementLabel ? humanize(requirementLabel) : "next deterministic requirement"}`;
  return (
    {
      briefing: "Understand the exact work and boundaries before beginning.",
      safety: "Current evidence must support every hard gate.",
      start_visit: "Choose exactly one governed or structured provisional target.",
      gaps: "Unresolved evidence stays visible and creates linked follow-up work.",
      close_visit: "Review the immutable close boundary before continuing.",
      outcome: "Complete, Closed with gaps, and recovery state are derived from evidence.",
    }[step] ?? ""
  );
}
function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}
function formatTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.valueOf())
    ? "unknown time"
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
