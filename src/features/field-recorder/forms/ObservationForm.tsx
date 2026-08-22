"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  FieldObservation,
  ObservationKind,
  ObservationValueByKind,
} from "@/features/field-protocol/generated";
import {
  CheckboxField,
  checked,
  Field,
  fieldControlClass,
  humanize,
  number,
  options,
  SelectField,
  string,
  strings,
  TextAreaField,
  TextField,
} from "./form-controls";
import type { ObservationCaptureSubmission } from "./form-types";

export const observationKinds = [
  "identity",
  "opening_signal",
  "price",
  "route_duration",
  "route_wait",
  "road_condition",
  "facility",
  "accessibility",
  "payment_method",
  "connectivity",
  "power",
  "crowd_snapshot",
  "noise_snapshot",
  "weather_condition",
  "tide_context",
  "menu_item",
  "service_status",
  "contact_channel",
  "local_caveat",
] as const satisfies readonly ObservationKind[];

const conditionOptions = [
  "weather_clear",
  "weather_cloudy",
  "weather_rain",
  "tide_low",
  "tide_mid",
  "tide_high",
  "road_dry",
  "road_wet",
  "crowd_quiet",
  "crowd_moderate",
  "crowd_busy",
  "noise_quiet",
  "noise_moderate",
  "noise_loud",
  "power_available",
  "power_outage",
  "access_open",
  "access_restricted",
  "disruption_none",
  "disruption_active",
] as const satisfies FieldObservation["conditions"];

const directnessOptions = [
  "direct_observation",
  "instrument_measurement",
  "transaction_record",
  "posted_notice",
  "source_stated",
  "derived",
] as const;

export function ObservationForm(props: {
  allowedKinds: readonly ObservationKind[];
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  methodProfiles?: readonly Readonly<{
    id: string;
    procedure: string;
    supportedKinds: readonly string[];
  }>[];
  onCancel?: () => void;
  onSubmit: (submission: ObservationCaptureSubmission) => void | Promise<void>;
  provisionalSubjectIds?: readonly string[];
}) {
  const kinds = props.allowedKinds.length > 0 ? props.allowedKinds : observationKinds;
  const [kind, setKind] = useState<ObservationKind>(kinds[0] ?? "identity");
  const [subjectKind, setSubjectKind] = useState<"governed" | "provisional">("governed");
  const [error, setError] = useState<string>();
  const summaryRef = useRef<HTMLDivElement>(null);
  const subjectOptions = useMemo(
    () =>
      subjectKind === "governed"
        ? props.governedSubjects.map(({ id, label }) => [id, label] as const)
        : (props.provisionalSubjectIds ?? []).map((id) => [id, humanize(id)] as const),
    [props.governedSubjects, props.provisionalSubjectIds, subjectKind],
  );
  const compatibleMethod = props.methodProfiles?.find((profile) =>
    profile.supportedKinds.includes(kind),
  );

  async function submit(formData: FormData) {
    try {
      setError(undefined);
      const subjectId = string(formData, "subjectId");
      if (!subjectId) {
        throw new Error(
          subjectKind === "governed"
            ? "Choose one governed Subject."
            : "Create one structured Provisional Subject at Visit start before using it here.",
        );
      }
      const confidence = string(
        formData,
        "captureConfidence",
      ) as FieldObservation["captureConfidence"];
      const confidenceReason = string(formData, "captureConfidenceReason");
      if (confidence !== "high" && !confidenceReason) {
        throw new Error("Explain medium or low confidence before saving this observation.");
      }
      await props.onSubmit({
        captureConfidence: confidence,
        captureConfidenceReason: confidenceReason || undefined,
        conditions: strings(formData, "conditions") as FieldObservation["conditions"],
        directness: string(formData, "directness") as FieldObservation["directness"],
        kind,
        observedAt: new Date(string(formData, "observedAt")).toISOString(),
        permissions: {
          articleUse: checked(formData, "articleUse"),
          llmUse: checked(formData, "llmUse"),
          publicUse: checked(formData, "publicUse"),
          quotationUse: checked(formData, "quotationUse"),
        },
        subject:
          subjectKind === "governed"
            ? { kind: "governed", subjectId }
            : { kind: "provisional", provisionalSubjectId: subjectId },
        timeCorrected: checked(formData, "timeCorrected"),
        type: "observation",
        validUntil: optionalInstant(formData, "validUntil"),
        value: buildValue(kind, formData),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The observation could not be saved.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }

  return (
    <form action={submit} className="space-y-6" aria-labelledby="observation-form-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand-lagoon-700)]">
          Typed observation
        </p>
        <h3
          id="observation-form-title"
          className="mt-1 text-2xl font-semibold text-[var(--text-strong)]"
        >
          Record one bounded fact
        </h3>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Choose the exact kind. If none fits, cancel and record a Schema Gap.
        </p>
      </div>

      {error ? (
        <div
          ref={summaryRef}
          className="rounded-lg bg-[var(--risk-high-soft)] p-3 text-sm text-[var(--risk-high-foreground)]"
          role="alert"
          tabIndex={-1}
        >
          <strong>Check this observation:</strong> {error}
        </div>
      ) : null}

      <fieldset className="grid gap-4 rounded-xl border border-[var(--brand-lavender-200)] p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-[var(--text-strong)]">Evidence identity</legend>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[var(--text-strong)]">
            Protocol Observation Kind
            <select
              className={fieldControlClass}
              name="kindPicker"
              value={kind}
              onChange={(event) => setKind(event.target.value as ObservationKind)}
            >
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-[var(--text-strong)]">
            Subject source
            <select
              className={fieldControlClass}
              value={subjectKind}
              onChange={(event) => setSubjectKind(event.target.value as "governed" | "provisional")}
            >
              <option value="governed">Governed Subject</option>
              <option value="provisional">Provisional Subject from this Visit</option>
            </select>
          </label>
        </div>
        <div className="sm:col-span-2">
          <SelectField
            hint="Exactly one Subject is required; compound subjects are not accepted."
            label="Subject"
            name="subjectId"
            options={
              subjectOptions.length > 0 ? subjectOptions : [["", "No eligible Subject available"]]
            }
            required
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--brand-lavender-200)] p-4">
        <legend className="px-2 font-semibold text-[var(--text-strong)]">
          {humanize(kind)} value
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <ObservationValueFields governedSubjects={props.governedSubjects} kind={kind} />
        </div>
      </fieldset>

      <section
        className="rounded-xl bg-[var(--surface-soft)] p-4"
        aria-label="Compatible Method Profile"
      >
        <p className="text-sm font-semibold text-[var(--text-strong)]">
          Method Profile: {compatibleMethod?.id ?? "Protocol-selected compatible method"}
        </p>
        {compatibleMethod ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">{compatibleMethod.procedure}</p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Asia/Manila · UTC offset +480 minutes · IDs and capture timestamp are filled
          automatically.
        </p>
      </section>

      <fieldset className="grid gap-4 rounded-xl border border-[var(--brand-lavender-200)] p-4 sm:grid-cols-2">
        <legend className="px-2 font-semibold text-[var(--text-strong)]">Time and method</legend>
        <TextField label="Observed at" name="observedAt" required type="datetime-local" />
        <TextField label="Shorten freshness until" name="validUntil" type="datetime-local" />
        <SelectField
          label="Directness"
          name="directness"
          options={options(directnessOptions)}
          required
        />
        <SelectField
          label="Capture confidence"
          name="captureConfidence"
          options={options(["high", "medium", "low"])}
          required
        />
        <div className="sm:col-span-2">
          <TextAreaField
            hint="Required for medium or low confidence. Dictation is supported."
            label="Confidence reason"
            name="captureConfidenceReason"
          />
        </div>
        <div className="sm:col-span-2">
          <CheckboxField label="I corrected the recorded time" name="timeCorrected" />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--brand-lavender-200)] p-4">
        <legend className="px-2 font-semibold text-[var(--text-strong)]">
          Observed conditions
        </legend>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Choose only governed condition tags.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {conditionOptions.map((condition) => (
            <CheckboxField
              key={condition}
              label={humanize(condition)}
              name="conditions"
              value={condition}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--brand-lavender-200)] p-4">
        <legend className="px-2 font-semibold text-[var(--text-strong)]">Use permissions</legend>
        <p className="mb-3 text-sm text-[var(--text-muted)]">
          Each permission is independent. Unchecked means not granted.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckboxField label="Model-assisted internal use" name="llmUse" />
          <CheckboxField label="Article drafting use" name="articleUse" />
          <CheckboxField label="Quotation use" name="quotationUse" />
          <CheckboxField label="Public use" name="publicUse" />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" type="submit">
          Save observation
        </Button>
        {props.onCancel ? (
          <Button
            className="min-h-11 bg-[var(--surface-default)] text-[var(--text-strong)]"
            type="button"
            variant="outline"
            onClick={props.onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ObservationValueFields(props: {
  governedSubjects: readonly Readonly<{ id: string; label: string }>[];
  kind: ObservationKind;
}) {
  const { kind } = props;
  const subjectOptions = props.governedSubjects.map(({ id, label }) => [id, label] as const);
  switch (kind) {
    case "identity":
      return (
        <>
          <TextField label="Displayed name" name="displayedName" required />
          <TextField label="Official name" name="officialName" />
          <TextField hint="Separate aliases with commas." label="Aliases" name="aliases" />
          <SelectField
            label="Category"
            name="category"
            options={options(["place", "service", "route", "organisation"])}
          />
          <SelectField
            label="Resolution evidence"
            name="resolutionEvidence"
            options={options([
              "displayed_sign",
              "receipt",
              "source_statement",
              "official_directory",
            ])}
          />
        </>
      );
    case "opening_signal":
      return (
        <>
          <SelectField
            label="Opening state"
            name="state"
            options={options(["open", "closed", "unknown"])}
          />
          <SelectField
            label="Basis"
            name="basis"
            options={options(["observed", "posted", "attempted"])}
          />
          <CheckboxField
            label="Posted hours separately evidenced"
            name="postedHoursSeparatelyEvidenced"
          />
        </>
      );
    case "price":
      return (
        <>
          <TextField label="Amount" name="amount" required />
          <TextField label="Currency" name="currency" defaultValue="PHP" required />
          <TextField label="Item or service" name="item" required />
          <SelectField
            label="Pricing unit"
            name="pricingUnit"
            options={options(["item", "person", "party", "journey", "hour", "day"])}
          />
          <TextField label="Party size" name="partySize" type="number" defaultValue="1" required />
          <TextField hint="Separate inclusions with commas." label="Inclusions" name="inclusions" />
          <SelectField
            label="Price basis"
            name="basis"
            options={options(["posted", "quoted", "paid"])}
          />
          <SelectField
            label="Taxes and fees"
            name="taxesAndFees"
            options={options(["included", "excluded", "unknown"])}
          />
          <CheckboxField label="Negotiated price" name="negotiated" />
        </>
      );
    case "route_duration":
      return (
        <>
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
          />
          <TextField label="Duration (seconds)" name="durationSeconds" type="number" required />
        </>
      );
    case "route_wait":
      return (
        <>
          <TextField label="Wait (seconds)" name="waitSeconds" type="number" required />
          <SelectField
            label="Transport mode"
            name="transportMode"
            options={options(["tricycle", "car", "van", "boat"])}
          />
          <SelectField
            label="Queue state"
            name="queueState"
            options={options(["none", "short", "moderate", "long"])}
          />
        </>
      );
    case "road_condition":
      return (
        <>
          <TextField label="Governed segment ID" name="segmentId" required />
          <SelectField
            label="Surface"
            name="surface"
            options={options(["paved", "gravel", "sand", "mud", "mixed"])}
          />
          <SelectField
            label="Obstruction"
            name="obstruction"
            options={options(["none", "minor", "partial", "blocked", "unknown"])}
          />
          <SelectField
            label="Weather context"
            name="weatherContext"
            options={options(["dry", "recent_rain", "active_rain", "unknown"])}
          />
        </>
      );
    case "facility":
      return (
        <>
          <SelectField
            label="Facility"
            name="facilityType"
            options={options([
              "toilet",
              "shower",
              "shade",
              "seating",
              "parking",
              "cash_machine",
              "clinic",
              "pharmacy",
              "fuel",
              "drinking_water",
              "waste_disposal",
              "food",
            ])}
          />
          <SelectField
            label="Facility state"
            name="state"
            options={options([
              "present",
              "absent",
              "available",
              "unavailable",
              "inaccessible",
              "unknown",
            ])}
          />
          <div className="sm:col-span-2">
            <TextAreaField label="Access conditions" name="accessConditions" required />
          </div>
        </>
      );
    case "accessibility":
      return (
        <>
          <SelectField
            label="Accessibility feature"
            name="feature"
            options={options([
              "step",
              "ramp",
              "door_width",
              "path_surface",
              "toilet_access",
              "transfer_barrier",
              "shelter",
            ])}
          />
          <SelectField
            label="Feature state"
            name="state"
            options={options([
              "present",
              "absent",
              "usable",
              "not_usable",
              "not_tested",
              "unknown",
            ])}
          />
          <SelectField
            label="Measurement basis"
            name="measurementBasis"
            options={options(["measured", "observed", "attempted"])}
          />
          <TextField label="Measured value" name="measuredValue" type="number" />
          <SelectField
            label="Measurement unit"
            name="unit"
            options={[["", "No measurement"], ...options(["cm", "degree"])]}
          />
        </>
      );
    case "payment_method":
      return (
        <>
          <SelectField
            label="Payment method"
            name="method"
            options={options(["cash", "card", "gcash", "maya", "bank_transfer"])}
          />
          <SelectField
            label="Attempt outcome"
            name="outcome"
            options={options([
              "offered",
              "accepted",
              "rejected",
              "not_offered",
              "not_tested",
              "unknown",
            ])}
          />
          <div className="sm:col-span-2">
            <TextAreaField label="Transaction context" name="transactionContext" required />
          </div>
        </>
      );
    case "connectivity":
      return (
        <>
          <TextField label="Network" name="network" required />
          <SelectField
            label="Device class"
            name="deviceClass"
            options={options(["phone", "tablet", "laptop", "dedicated_meter"])}
          />
          <SelectField
            label="Measurement zone"
            name="zone"
            options={options(["indoors", "outdoors", "threshold", "roadside"])}
          />
          {[1, 2, 3].map((index) => (
            <fieldset
              key={index}
              className="grid gap-3 rounded-lg border border-[var(--brand-lavender-200)] p-3 sm:col-span-2 sm:grid-cols-2"
            >
              <legend className="px-1 text-sm font-semibold">Measurement {index}</legend>
              <SelectField
                label="Metric"
                name={`metric${index}`}
                options={options(["download", "upload", "latency"])}
              />
              <TextField label="Value" name={`measurement${index}`} type="number" required />
              <SelectField label="Unit" name={`unit${index}`} options={options(["Mbps", "ms"])} />
            </fieldset>
          ))}
        </>
      );
    case "power":
      return (
        <>
          <SelectField
            label="Power state"
            name="state"
            options={options(["available", "unavailable", "outage", "unknown"])}
          />
          <SelectField
            label="Socket test permission"
            name="socketPermission"
            options={options(["granted", "denied", "not_requested", "not_applicable"])}
          />
          <SelectField
            label="Basis"
            name="basis"
            options={options(["direct_observation", "attempted", "source_stated"])}
          />
          <TextField label="Backup power Statement ID" name="backupPowerStatementId" />
        </>
      );
    case "crowd_snapshot":
      return (
        <>
          <TextField label="Count boundary" name="boundary" required />
          <SelectField
            label="Count method"
            name="method"
            options={options(["counted", "estimated_band"])}
          />
          <TextField label="Count" name="count" type="number" />
          <SelectField
            label="Crowd band"
            name="band"
            options={options(["empty", "quiet", "moderate", "busy", "very_busy"])}
          />
        </>
      );
    case "noise_snapshot":
      return (
        <>
          <SelectField
            label="Noise method"
            name="method"
            options={options(["measured_dba", "subjective_band"])}
          />
          <TextField label="Measured dBA" name="dba" type="number" />
          <SelectField
            label="Noise band"
            name="band"
            options={options(["quiet", "moderate", "loud", "very_loud"])}
          />
          <TextField label="Measurement position" name="measurementPosition" required />
        </>
      );
    case "weather_condition":
      return (
        <>
          <SelectField
            label="Weather condition"
            name="condition"
            options={options([
              "clear",
              "cloudy",
              "light_rain",
              "heavy_rain",
              "thunderstorm",
              "strong_wind",
              "unknown",
            ])}
          />
          <SelectField
            label="Observation basis"
            name="observationBasis"
            options={options(["direct", "authoritative_source"])}
          />
          <TextField label="Authoritative Source ID" name="authoritativeSourceId" />
        </>
      );
    case "tide_context":
      return (
        <>
          <SelectField
            label="Shoreline state"
            name="shorelineState"
            options={options(["low", "rising", "mid", "falling", "high", "unknown"])}
          />
          <TextField label="Source ID" name="sourceId" required />
          <TextField
            label="Source retrieved at"
            name="sourceRetrievedAt"
            type="datetime-local"
            required
          />
        </>
      );
    case "menu_item":
      return (
        <>
          <TextField label="Menu item" name="itemName" required />
          <TextField label="Amount" name="amount" required />
          <TextField label="Currency" name="currency" defaultValue="PHP" required />
          <SelectField
            label="Availability"
            name="availability"
            options={options(["available", "unavailable", "unknown"])}
          />
          <SelectField
            label="Dietary disclosure basis"
            name="dietaryDisclosureBasis"
            options={options(["menu_label", "staff_statement", "not_disclosed"])}
          />
        </>
      );
    case "service_status":
      return (
        <>
          <SelectField
            label="Service state"
            name="state"
            options={options(["operating", "not_operating", "limited", "unknown"])}
          />
          <SelectField
            label="Basis"
            name="basis"
            options={options(["observed", "attempted", "posted", "source_stated"])}
          />
          <div className="sm:col-span-2">
            <TextAreaField label="Limitations" name="limitations" />
          </div>
        </>
      );
    case "contact_channel":
      return (
        <>
          <SelectField
            label="Channel type"
            name="channelType"
            options={options(["phone", "email", "website", "facebook", "instagram"])}
          />
          <TextField label="Public channel value" name="publicValue" required />
          <SelectField
            label="Verification method"
            name="verificationMethod"
            options={options(["displayed", "called", "messaged", "official_directory"])}
          />
          <SelectField
            label="Permission"
            name="permission"
            options={options(["publicly_displayed", "explicitly_granted", "internal_only"])}
          />
        </>
      );
    case "local_caveat":
      return (
        <>
          <div className="sm:col-span-2">
            <TextAreaField label="Local warning" name="warning" required />
          </div>
          <Field label="Applies when" name="appliesWhen">
            <div className="mt-2 grid gap-2">
              {[
                "weather_change",
                "tide_change",
                "after_dark",
                "crowd_peak",
                "service_disruption",
                "access_restriction",
              ].map((value) => (
                <CheckboxField
                  key={value}
                  label={humanize(value)}
                  name="appliesWhen"
                  value={value}
                />
              ))}
            </div>
          </Field>
          <SelectField
            label="Caveat directness"
            name="caveatDirectness"
            options={options(["direct_observation", "source_stated", "derived"])}
          />
          <TextField
            label="Corroboration count"
            name="corroborationCount"
            type="number"
            defaultValue="0"
            required
          />
        </>
      );
  }
}

function buildValue(
  kind: ObservationKind,
  data: FormData,
): ObservationValueByKind[ObservationKind] {
  const optionalNumber = (name: string) => (string(data, name) ? number(data, name) : undefined);
  const optionalString = (name: string) => string(data, name) || undefined;
  switch (kind) {
    case "identity":
      return {
        aliases: splitComma(data, "aliases"),
        category: string(data, "category") as "place",
        displayedName: string(data, "displayedName"),
        officialName: optionalString("officialName"),
        resolutionEvidence: string(data, "resolutionEvidence") as "displayed_sign",
      };
    case "opening_signal":
      return {
        basis: string(data, "basis") as "observed",
        postedHoursSeparatelyEvidenced: checked(data, "postedHoursSeparatelyEvidenced"),
        state: string(data, "state") as "open",
      };
    case "price":
      return {
        amount: string(data, "amount"),
        basis: string(data, "basis") as "posted",
        currency: "PHP",
        inclusions: splitComma(data, "inclusions"),
        item: string(data, "item"),
        negotiated: checked(data, "negotiated"),
        partySize: number(data, "partySize"),
        pricingUnit: string(data, "pricingUnit") as "item",
        taxesAndFees: string(data, "taxesAndFees") as "included",
      };
    case "route_duration":
      return {
        destinationSubjectId: string(data, "destinationSubjectId"),
        durationSeconds: number(data, "durationSeconds"),
        originSubjectId: string(data, "originSubjectId"),
        transportMode: string(data, "transportMode") as "walk",
      };
    case "route_wait":
      return {
        queueState: string(data, "queueState") as "none",
        transportMode: string(data, "transportMode") as "tricycle",
        waitSeconds: number(data, "waitSeconds"),
      };
    case "road_condition":
      return {
        obstruction: string(data, "obstruction") as "none",
        segmentId: string(data, "segmentId"),
        surface: string(data, "surface") as "paved",
        weatherContext: string(data, "weatherContext") as "dry",
      };
    case "facility":
      return {
        accessConditions: string(data, "accessConditions"),
        facilityType: string(data, "facilityType") as "toilet",
        state: string(data, "state") as "present",
      };
    case "accessibility":
      return {
        feature: string(data, "feature") as "step",
        measuredValue: optionalNumber("measuredValue"),
        measurementBasis: string(data, "measurementBasis") as "measured",
        state: string(data, "state") as "present",
        unit: optionalString("unit") as "cm" | undefined,
      };
    case "payment_method":
      return {
        method: string(data, "method") as "cash",
        outcome: string(data, "outcome") as "offered",
        transactionContext: string(data, "transactionContext"),
      };
    case "connectivity":
      return {
        deviceClass: string(data, "deviceClass") as "phone",
        measurements: [1, 2, 3].map((index) => ({
          metric: string(data, `metric${index}`) as "download",
          unit: string(data, `unit${index}`) as "Mbps",
          value: number(data, `measurement${index}`),
        })) as ObservationValueByKind["connectivity"]["measurements"],
        network: string(data, "network"),
        zone: string(data, "zone") as "indoors",
      };
    case "power":
      return {
        backupPowerStatementId: optionalString("backupPowerStatementId"),
        basis: string(data, "basis") as "direct_observation",
        socketPermission: string(data, "socketPermission") as "granted",
        state: string(data, "state") as "available",
      };
    case "crowd_snapshot":
      return {
        band: string(data, "band") as "empty",
        boundary: string(data, "boundary"),
        count: optionalNumber("count"),
        method: string(data, "method") as "counted",
      };
    case "noise_snapshot":
      return {
        band: string(data, "band") as "quiet",
        dba: optionalNumber("dba"),
        measurementPosition: string(data, "measurementPosition"),
        method: string(data, "method") as "measured_dba",
      };
    case "weather_condition":
      return {
        authoritativeSourceId: optionalString("authoritativeSourceId"),
        condition: string(data, "condition") as "clear",
        observationBasis: string(data, "observationBasis") as "direct",
      };
    case "tide_context":
      return {
        shorelineState: string(data, "shorelineState") as "low",
        sourceId: string(data, "sourceId"),
        sourceRetrievedAt: new Date(string(data, "sourceRetrievedAt")).toISOString(),
      };
    case "menu_item":
      return {
        amount: string(data, "amount"),
        availability: string(data, "availability") as "available",
        currency: "PHP",
        dietaryDisclosureBasis: string(data, "dietaryDisclosureBasis") as "menu_label",
        itemName: string(data, "itemName"),
      };
    case "service_status":
      return {
        basis: string(data, "basis") as "observed",
        limitations: optionalString("limitations"),
        state: string(data, "state") as "operating",
      };
    case "contact_channel":
      return {
        channelType: string(data, "channelType") as "phone",
        permission: string(data, "permission") as "publicly_displayed",
        publicValue: string(data, "publicValue"),
        verificationMethod: string(data, "verificationMethod") as "displayed",
      };
    case "local_caveat": {
      const appliesWhen = strings(
        data,
        "appliesWhen",
      ) as ObservationValueByKind["local_caveat"]["appliesWhen"];
      if (appliesWhen.length === 0)
        throw new Error("Choose at least one governed condition for the local caveat.");
      return {
        appliesWhen,
        corroborationCount: number(data, "corroborationCount"),
        directness: string(data, "caveatDirectness") as "direct_observation",
        warning: string(data, "warning"),
      };
    }
  }
}

function splitComma(data: FormData, name: string): string[] {
  return string(data, name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function optionalInstant(data: FormData, name: string): string | undefined {
  const value = string(data, name);
  return value ? new Date(value).toISOString() : undefined;
}
