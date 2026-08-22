"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  ConsentDecision,
  ObservationKind,
  RouteRun,
} from "@/features/field-protocol/generated";
import type { CaptureExceptionReason } from "@/features/field-recorder/field-recorder-types";
import {
  CheckboxField,
  Field,
  fieldControlClass,
  humanize,
  options,
  SelectField,
  string,
  strings,
  TextAreaField,
  TextField,
} from "./form-controls";
import type { CaptureFormSubmission } from "./form-types";
import { ObservationForm } from "./ObservationForm";

const captureModes = [
  ["observation", "Observation"],
  ["routeRun", "Route run"],
  ["sourceStatement", "Source statement"],
  ["statementTranslation", "Translation"],
  ["evidenceAsset", "Photo or scan"],
  ["captureException", "Capture exception"],
  ["schemaGap", "Schema gap"],
] as const;

type CaptureMode = (typeof captureModes)[number][0];

export function CaptureForms(props: {
  allowedObservationKinds: readonly ObservationKind[];
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  methodProfiles: readonly Readonly<{
    id: string;
    procedure: string;
    supportedKinds: readonly string[];
  }>[];
  onCaptured: () => void;
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
  provisionalSubjectIds?: readonly string[];
  recordIds: readonly string[];
  sourceStatementIds: readonly string[];
}) {
  const [mode, setMode] = useState<CaptureMode>("observation");
  const [error, setError] = useState<string>();
  const summaryRef = useRef<HTMLDivElement>(null);

  async function submit(submission: CaptureFormSubmission) {
    try {
      setError(undefined);
      await props.onSubmit(submission);
      props.onCaptured();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This evidence was not saved.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  return (
    <section aria-labelledby="capture-kind-title" className="space-y-5">
      <fieldset>
        <legend id="capture-kind-title" className="text-sm font-semibold text-[var(--text-strong)]">
          What are you recording?
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {captureModes.map(([value, label]) => (
            <Button
              aria-pressed={mode === value}
              className={`min-h-11 whitespace-normal ${mode === value ? "" : "bg-[var(--surface-default)] text-[var(--text-strong)]"}`}
              style={
                mode === value
                  ? {
                      backgroundColor: "var(--brand-lagoon-700)",
                      color: "var(--brand-paper-50)",
                    }
                  : {
                      backgroundColor: "var(--brand-paper-50)",
                      color: "var(--brand-navy-950)",
                    }
              }
              key={value}
              type="button"
              variant={mode === value ? "default" : "outline"}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </fieldset>
      {error ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg bg-[var(--risk-high-soft)] p-3 text-sm text-[var(--risk-high-foreground)]"
        >
          <strong>Evidence not saved:</strong> {error}
        </div>
      ) : null}
      {mode === "observation" ? (
        <ObservationForm
          allowedKinds={props.allowedObservationKinds}
          governedSubjects={props.governedSubjects}
          methodProfiles={props.methodProfiles}
          provisionalSubjectIds={props.provisionalSubjectIds}
          onSubmit={submit}
        />
      ) : null}
      {mode === "routeRun" ? (
        <RouteRunForm governedSubjects={props.governedSubjects} onSubmit={submit} />
      ) : null}
      {mode === "sourceStatement" ? (
        <SourceStatementForm governedSubjects={props.governedSubjects} onSubmit={submit} />
      ) : null}
      {mode === "statementTranslation" ? (
        <TranslationForm sourceStatementIds={props.sourceStatementIds} onSubmit={submit} />
      ) : null}
      {mode === "evidenceAsset" ? (
        <AssetForm recordIds={props.recordIds} onSubmit={submit} />
      ) : null}
      {mode === "captureException" ? <ExceptionForm onSubmit={submit} /> : null}
      {mode === "schemaGap" ? (
        <SchemaGapForm
          governedSubjects={props.governedSubjects}
          provisionalSubjectIds={props.provisionalSubjectIds}
          onSubmit={submit}
        />
      ) : null}
      <Button
        className="min-h-11 bg-[var(--surface-default)] text-[var(--text-strong)]"
        style={{
          backgroundColor: "var(--brand-paper-50)",
          color: "var(--brand-navy-950)",
        }}
        type="button"
        variant="outline"
        onClick={props.onCaptured}
      >
        Cancel capture
      </Button>
    </section>
  );
}

const routeConditions = [
  "weather_clear",
  "weather_cloudy",
  "weather_rain",
  "road_dry",
  "road_wet",
  "access_open",
  "access_restricted",
  "disruption_none",
  "disruption_active",
] as const;
const routeCheckpoints = [
  "origin_signal",
  "departure_signal",
  "midpoint_signal",
  "arrival_signal",
] as const;
const routeBarriers = [
  "none",
  "rough_surface",
  "flooding",
  "steep_grade",
  "transfer_required",
  "access_restricted",
] as const;
const routeNotTested = [
  "price",
  "queue",
  "mobile_signal",
  "accessibility",
  "luggage_handling",
] as const;

function RouteRunForm(props: {
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  const subjectOptions = props.governedSubjects.map(({ id, label }) => [id, label] as const);
  async function submit(data: FormData) {
    const priceAmount = string(data, "priceAmount");
    await props.onSubmit({
      type: "routeRun",
      value: {
        accessContext: string(data, "accessContext"),
        arrivedAt: instant(data, "arrivedAt"),
        barriers: strings(data, "barriers"),
        bookingMethod: string(data, "bookingMethod") as RouteRun["bookingMethod"],
        conditions: strings(data, "routeConditions") as RouteRun["conditions"],
        departedAt: instant(data, "departedAt"),
        destinationSubjectId: string(data, "destinationSubjectId"),
        luggageContext: string(data, "luggageContext"),
        notTested: strings(data, "notTested"),
        originSubjectId: string(data, "originSubjectId"),
        partyContext: string(data, "partyContext"),
        price: priceAmount
          ? { amount: priceAmount, basis: string(data, "priceBasis") as "posted", currency: "PHP" }
          : undefined,
        queueStartedAt: optionalInstant(data, "queueStartedAt"),
        requestedAt: instant(data, "requestedAt"),
        signalCheckpoints: strings(data, "signalCheckpoints"),
        stops: strings(data, "stops"),
        transportMode: string(data, "transportMode") as RouteRun["transportMode"],
      },
    });
  }
  return (
    <TypedForm eyebrow="Timed route evidence" title="Record a Route Run" onSubmit={submit}>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Route endpoints and mode</legend>
        <SelectField
          label="Origin Subject"
          name="originSubjectId"
          options={subjectOptions}
          required
        />
        <SelectField
          label="Destination Subject"
          name="destinationSubjectId"
          options={subjectOptions}
          required
        />
        <SelectField
          label="Transport mode"
          name="transportMode"
          options={options(["walk", "bicycle", "motorbike", "tricycle", "car", "van", "boat"])}
          required
        />
        <SelectField
          label="Booking method"
          name="bookingMethod"
          options={options(["walk_up", "phone", "web", "app", "prearranged", "not_applicable"])}
          required
        />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-semibold">Ordered timestamps</legend>
        <TextField label="Requested at" name="requestedAt" type="datetime-local" required />
        <TextField label="Queue started at" name="queueStartedAt" type="datetime-local" />
        <TextField label="Departed at" name="departedAt" type="datetime-local" required />
        <TextField label="Arrived at" name="arrivedAt" type="datetime-local" required />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-semibold">Travel context</legend>
        <TextAreaField label="Party context" name="partyContext" required />
        <TextAreaField label="Luggage context" name="luggageContext" required />
        <TextAreaField label="Access context" name="accessContext" required />
        <Field label="Governed stops" name="stops">
          <div className="mt-2 grid gap-2">
            {subjectOptions.map(([id, label]) => (
              <CheckboxField key={id} label={label} name="stops" value={id} />
            ))}
          </div>
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="font-semibold">Price paid or quoted</legend>
        <TextField label="Amount (PHP)" name="priceAmount" />
        <SelectField
          label="Price basis"
          name="priceBasis"
          options={options(["posted", "quoted", "paid"])}
        />
      </fieldset>
      <ControlledChecks legend="Route conditions" name="routeConditions" values={routeConditions} />
      <ControlledChecks
        legend="Signal checkpoints"
        name="signalCheckpoints"
        values={routeCheckpoints}
      />
      <ControlledChecks legend="Barriers" name="barriers" values={routeBarriers} />
      <ControlledChecks legend="Not tested" name="notTested" values={routeNotTested} />
    </TypedForm>
  );
}

const consentPurposes = [
  "participation",
  "llmUse",
  "articleUse",
  "quotationUse",
  "publicUse",
] as const;

function SourceStatementForm(props: {
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  async function submit(data: FormData) {
    const recordedAt = new Date().toISOString();
    const consents = Object.fromEntries(
      consentPurposes.map((purpose) => [
        purpose,
        {
          decision: string(data, `${purpose}Decision`),
          method: string(data, `${purpose}Method`),
          recordedAt,
        },
      ]),
    ) as unknown as Record<(typeof consentPurposes)[number], ConsentDecision>;
    await props.onSubmit({
      type: "sourceStatement",
      value: {
        assetIds: [],
        attribution: string(data, "attribution") as "named",
        basisOfKnowledge: string(data, "basisOfKnowledge") as "direct_responsibility",
        captureContext: string(data, "captureContext"),
        consents,
        originalLanguage: string(data, "originalLanguage"),
        originalStatement: string(data, "originalStatement"),
        questionAsked: string(data, "questionAsked"),
        recontactAfter: optionalInstant(data, "recontactAfter"),
        sourceRole: string(data, "sourceRole") as "owner",
        statementForm: string(data, "statementForm") as "exact_quotation",
        subjectId: string(data, "subjectId"),
        validUntil: optionalInstant(data, "validUntil"),
        withdrawalRoute: string(data, "withdrawalRoute"),
      },
    });
  }
  return (
    <TypedForm
      eyebrow="Original-language evidence"
      title="Record a Source Statement"
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Subject"
          name="subjectId"
          options={props.governedSubjects.map(({ id, label }) => [id, label] as const)}
          required
        />
        <SelectField
          label="Source role"
          name="sourceRole"
          options={options([
            "owner",
            "manager",
            "staff",
            "driver",
            "resident",
            "visitor",
            "official",
            "other_governed",
          ])}
        />
        <SelectField
          label="Basis of knowledge"
          name="basisOfKnowledge"
          options={options([
            "direct_responsibility",
            "direct_experience",
            "posted_policy",
            "second_hand",
            "unknown",
          ])}
        />
        <TextField label="Original language" name="originalLanguage" required />
      </div>
      <TextAreaField label="Question asked" name="questionAsked" required />
      <SelectField
        label="Statement form"
        name="statementForm"
        options={options(["exact_quotation", "labelled_paraphrase"])}
      />
      <TextAreaField
        hint="Keep the source’s original words here. Add any translation as a separate record."
        label="Original statement"
        name="originalStatement"
        required
        rows={5}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Attribution"
          name="attribution"
          options={options(["named", "role_only", "anonymous", "not_for_publication"])}
        />
        <TextAreaField label="Capture context" name="captureContext" required />
      </div>
      <fieldset className="space-y-4">
        <legend className="font-semibold">Five independent consent decisions</legend>
        {consentPurposes.map((purpose) => (
          <div
            className="grid gap-3 rounded-lg border border-[var(--brand-lavender-200)] p-3 sm:grid-cols-2"
            key={purpose}
          >
            <SelectField
              label={`${humanize(purpose)} decision`}
              name={`${purpose}Decision`}
              options={options(["granted", "denied", "withdrawn"])}
            />
            <SelectField
              label={`${humanize(purpose)} method`}
              name={`${purpose}Method`}
              options={options(["verbal", "written", "recorded_form"])}
            />
          </div>
        ))}
      </fieldset>
      <TextAreaField label="Withdrawal route given to source" name="withdrawalRoute" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Valid until" name="validUntil" type="datetime-local" />
        <TextField label="Recontact after" name="recontactAfter" type="datetime-local" />
      </div>
    </TypedForm>
  );
}

function TranslationForm(props: {
  sourceStatementIds: readonly string[];
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  async function submit(data: FormData) {
    if (props.sourceStatementIds.length === 0)
      throw new Error(
        "Capture the original-language Source Statement before adding a translation.",
      );
    await props.onSubmit({
      type: "statementTranslation",
      value: {
        originalLanguage: string(data, "originalLanguage"),
        recordedAt: new Date().toISOString(),
        sourceStatementId: string(data, "sourceStatementId"),
        targetLanguage: string(data, "targetLanguage"),
        translatedText: string(data, "translatedText"),
        translator: {
          identityOrMethod: string(data, "identityOrMethod"),
          kind: string(data, "translatorKind") as "human",
        },
      },
    });
  }
  return (
    <TypedForm
      eyebrow="Separate derived record"
      title="Add a Statement Translation"
      onSubmit={submit}
    >
      <p className="rounded-lg bg-[var(--surface-caveat)] p-3 text-sm text-[var(--text-caveat)]">
        The original statement stays unchanged. This translation links back to it.
      </p>
      <SelectField
        label="Original Source Statement"
        name="sourceStatementId"
        options={
          props.sourceStatementIds.length
            ? options(props.sourceStatementIds)
            : [["", "No original statement captured"]]
        }
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Original language" name="originalLanguage" required />
        <TextField label="Target language" name="targetLanguage" required />
        <SelectField
          label="Translator kind"
          name="translatorKind"
          options={options(["human", "machine"])}
        />
        <TextField label="Translator identity or method" name="identityOrMethod" required />
      </div>
      <TextAreaField label="Translated text" name="translatedText" required rows={5} />
    </TypedForm>
  );
}

function AssetForm(props: {
  recordIds: readonly string[];
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  async function submit(data: FormData) {
    const file = data.get("assetFile");
    if (!(file instanceof File) || file.size === 0)
      throw new Error("Choose one photo, receipt, or document scan before saving metadata.");
    await props.onSubmit({
      file,
      type: "evidenceAsset",
      value: {
        assetKind: string(data, "assetKind") as "photo",
        consentState: string(data, "consentState") as "not_required",
        peoplePresent: string(data, "peoplePresent") as "none",
        permittedLocation: string(data, "permittedLocation") as "withheld",
        purpose: string(data, "purpose") as "orientation",
        recordIds: strings(data, "recordIds"),
        redactionState: string(data, "redactionState") as "not_required",
        rights: string(data, "rights") as "research_internal",
      },
    });
  }
  return (
    <TypedForm
      eyebrow="Encrypted local media"
      title="Add Photo or Scan"
      onSubmit={submit}
      submitLabel="Hash and save asset"
    >
      <Field
        hint="JPEG, PNG, or PDF. The app checks storage, hashes bytes, then saves atomically."
        label="Photo or scan"
        name="assetFile"
      >
        <input
          className={`${fieldControlClass} file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand-lagoon-100)] file:px-3 file:py-1`}
          accept="image/jpeg,image/png,application/pdf"
          name="assetFile"
          type="file"
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Asset kind"
          name="assetKind"
          options={options(["photo", "receipt_scan", "document_scan"])}
        />
        <SelectField
          label="Purpose"
          name="purpose"
          options={options([
            "orientation",
            "measurement_context",
            "posted_information",
            "transaction_receipt",
            "consent_record",
          ])}
        />
        <SelectField
          label="Permitted public location"
          name="permittedLocation"
          options={options(["withheld", "governed_area", "route_corridor", "approximate_100m"])}
        />
        <SelectField
          label="People present"
          name="peoplePresent"
          options={options(["none", "researcher_only", "consenting_people", "bystanders_present"])}
        />
        <SelectField
          label="Rights"
          name="rights"
          options={options(["research_internal", "licensed_internal", "public_use_granted"])}
        />
        <SelectField
          label="Consent state"
          name="consentState"
          options={options(["not_required", "denied", "granted", "withdrawn"])}
        />
        <SelectField
          label="Redaction state"
          name="redactionState"
          options={options(["not_required", "pending", "complete", "blocked"])}
        />
      </div>
      <ControlledChecks
        legend="Link to captured records"
        name="recordIds"
        values={props.recordIds}
      />
    </TypedForm>
  );
}

const exceptionReasons = [
  "access_denied",
  "unsafe_conditions",
  "permission_declined",
  "subject_unavailable",
  "equipment_failure",
  "eligibility_changed",
  "interrupted",
  "not_applicable",
] as const satisfies readonly CaptureExceptionReason[];

function ExceptionForm(props: {
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  async function submit(data: FormData) {
    await props.onSubmit({
      type: "captureException",
      value: {
        context: string(data, "exceptionContext") as "visit",
        reason: string(data, "exceptionReason") as CaptureExceptionReason,
        reasonDetails: string(data, "reasonDetails"),
      },
    });
  }
  return (
    <TypedForm eyebrow="Controlled blocker" title="Record a Capture Exception" onSubmit={submit}>
      <p className="text-sm text-[var(--text-muted)]">
        An exception is not “not observed.” Use Not applicable only with a specific justification.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Exception context"
          name="exceptionContext"
          options={options(["planning", "visit"])}
        />
        <SelectField
          label="Exception reason"
          name="exceptionReason"
          options={options(exceptionReasons)}
        />
      </div>
      <TextAreaField
        hint="State what prevented the governed evidence attempt. Dictation is supported."
        label="Exact reason details"
        name="reasonDetails"
        required
      />
    </TypedForm>
  );
}

function SchemaGapForm(props: {
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  provisionalSubjectIds?: readonly string[];
  onSubmit: (submission: CaptureFormSubmission) => void | Promise<void>;
}) {
  const [subjectKind, setSubjectKind] = useState<"governed" | "provisional">("governed");
  const subjectOptions =
    subjectKind === "governed"
      ? props.governedSubjects.map(({ id, label }) => [id, label] as const)
      : (props.provisionalSubjectIds ?? []).map((id) => [id, humanize(id)] as const);
  async function submit(data: FormData) {
    const subjectId = string(data, "subjectId");
    if (!subjectId)
      throw new Error("Choose exactly one governed or provisional Subject for this Schema Gap.");
    await props.onSubmit({
      type: "schemaGap",
      value: {
        attemptedAt: instant(data, "attemptedAt"),
        description: string(data, "description"),
        permittedLocation: string(data, "permittedLocation") as "withheld",
        subject:
          subjectKind === "governed"
            ? { kind: "governed", subjectId }
            : { kind: "provisional", provisionalSubjectId: subjectId },
      },
    });
  }
  return (
    <TypedForm eyebrow="Protocol feedback" title="Record a Schema Gap" onSubmit={submit}>
      <p className="rounded-lg bg-[var(--surface-caveat)] p-3 text-sm text-[var(--text-caveat)]">
        Use this when no Observation Kind fits. Do not coerce the evidence into “Other” or a closest
        match.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-[var(--text-strong)]">
          Subject type
          <select
            className={fieldControlClass}
            value={subjectKind}
            onChange={(event) => setSubjectKind(event.target.value as "governed" | "provisional")}
          >
            <option value="governed">Governed Subject</option>
            <option value="provisional">Provisional Subject</option>
          </select>
        </label>
        <SelectField
          label="Subject"
          name="subjectId"
          options={subjectOptions.length ? subjectOptions : [["", "No eligible Subject available"]]}
          required
        />
        <TextField label="Attempted at" name="attemptedAt" type="datetime-local" required />
        <SelectField
          label="Permitted public location"
          name="permittedLocation"
          options={options(["withheld", "governed_area", "route_corridor", "approximate_100m"])}
        />
      </div>
      <TextAreaField
        label="What the protocol could not express"
        name="description"
        required
        rows={5}
      />
    </TypedForm>
  );
}

function ControlledChecks(props: { legend: string; name: string; values: readonly string[] }) {
  return (
    <fieldset className="rounded-xl border border-[var(--brand-lavender-200)] p-4">
      <legend className="px-2 font-semibold">{props.legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {props.values.map((value) => (
          <CheckboxField key={value} label={humanize(value)} name={props.name} value={value} />
        ))}
      </div>
    </fieldset>
  );
}

function TypedForm(props: {
  children: React.ReactNode;
  eyebrow: string;
  onSubmit: (data: FormData) => void | Promise<void>;
  submitLabel?: string;
  title: string;
}) {
  return (
    <form action={props.onSubmit} className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-lagoon-700)]">
          {props.eyebrow}
        </p>
        <h3 className="mt-1 text-2xl font-semibold text-[var(--text-strong)]">{props.title}</h3>
      </div>
      {props.children}
      <Button className="min-h-11" type="submit">
        {props.submitLabel ?? "Save evidence"}
      </Button>
    </form>
  );
}

function instant(data: FormData, name: string): string {
  return new Date(string(data, name)).toISOString();
}
function optionalInstant(data: FormData, name: string): string | undefined {
  const value = string(data, name);
  return value ? new Date(value).toISOString() : undefined;
}
