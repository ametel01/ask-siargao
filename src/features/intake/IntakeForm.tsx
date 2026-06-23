"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import { optionalRiskModules } from "@/server/audit/enums";
import type { AuditIntakeResult } from "@/server/audit/intake-service";
import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";
import { button } from "../../../styled-system/recipes/button";
import { sectionPanel } from "../../../styled-system/recipes/section-panel";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "complete"; result: AuditIntakeResult }
  | { status: "error"; message: string };

export function IntakeForm() {
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    const form = new FormData(event.currentTarget);
    const optionalModules = optionalRiskModules.filter((module) => form.get(module) === "on");
    const groupSizeValue = form.get("groupSize")?.toString();
    const payload = {
      travelMonth: form.get("travelMonth")?.toString() || undefined,
      arrivalOrigin: form.get("arrivalOrigin")?.toString() || undefined,
      arrivalRouteSlug: form.get("arrivalRouteSlug")?.toString() || undefined,
      accommodationName: form.get("accommodationName")?.toString() || undefined,
      accommodationPlatformUrl: form.get("accommodationPlatformUrl")?.toString() || undefined,
      stayAreaSlug: form.get("stayAreaSlug")?.toString() || undefined,
      topConstraint: form.get("topConstraint")?.toString() || "",
      optionalModules,
      travelerContext: {
        travelerType: form.get("travelerType")?.toString() || undefined,
        groupSize: groupSizeValue ? Number(groupSizeValue) : undefined,
        hasChildren: form.get("hasChildren") === "on",
        riskTolerance: form.get("riskTolerance")?.toString() || "balanced",
      },
    };

    const response = await fetch("/api/audit/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setState({
        status: "error",
        message: "The intake needs a few required fields before preview.",
      });
      return;
    }

    setState({ status: "complete", result: (await response.json()) as AuditIntakeResult });
  }

  return (
    <section
      className={cx(
        sectionPanel(),
        css({
          mt: 0,
          overflow: "hidden",
          p: { base: "5", md: "8" },
          position: "relative",
        }),
      )}
      id="audit-start"
    >
      <div
        aria-hidden="true"
        className={css({
          background: "url('/images/siargao-sunset.png') left bottom / 440px auto no-repeat",
          bottom: 0,
          h: "210px",
          left: 0,
          opacity: { base: 0.12, lg: 0.3 },
          position: "absolute",
          width: "420px",
        })}
      />
      <div
        className={css({
          alignItems: "start",
          display: "grid",
          gap: { base: "7", lg: "9" },
          gridTemplateColumns: { base: "1fr", lg: "0.72fr 1.28fr" },
          position: "relative",
        })}
      >
        <div>
          <p className={eyebrow()}>Start the audit</p>
          <h2 className={heading()}>Check eligibility in seconds.</h2>
          <p className={bodyText()}>
            Tell us your plan and we will run a free risk preview. You only pay if we can complete
            the full audit.
          </p>
          <div className={css({ display: "grid", gap: "2", mt: "5" })}>
            {[
              "Free risk preview first",
              "No charge until audit is completed",
              "Evidence, confidence, and freshness included",
            ].map((item) => (
              <span
                className={css({
                  alignItems: "center",
                  color: "text",
                  display: "flex",
                  fontSize: "sm",
                  fontWeight: "800",
                  gap: "2",
                })}
                key={item}
              >
                <CheckCircle2
                  aria-hidden="true"
                  className={css({ color: "violet.600" })}
                  size={17}
                />
                {item}
              </span>
            ))}
          </div>
          <ResultPanel state={state} />
        </div>

        <form className={formShell()} onSubmit={onSubmit}>
          <div className={fieldGrid()}>
            <Field label="Travel month" name="travelMonth" placeholder="2026-08" />
            <Field
              label="Arrival origin"
              name="arrivalOrigin"
              placeholder="Manila or Surigao City, if route is not selected"
            />
          </div>
          <div className={fieldGrid()}>
            <label className={labelClass()}>
              Arrival route
              <select className={inputClass()} name="arrivalRouteSlug">
                <option value="">Select route if known</option>
                {siargaoTaxonomy.routes.map((route) => (
                  <option key={route.slug} value={route.slug}>
                    {route.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Accommodation name"
              name="accommodationName"
              placeholder="Example Surf Stay"
            />
            <label className={labelClass()}>
              Planned stay area
              <select className={inputClass()} name="stayAreaSlug">
                <option value="">Select area</option>
                {siargaoTaxonomy.areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field
            label="Accommodation link or platform"
            name="accommodationPlatformUrl"
            placeholder="https://example.com/listing"
            type="url"
          />
          <Field
            label="Top constraint"
            name="topConstraint"
            placeholder="quiet sleep, remote work, no scooter"
            required
          />
          <div className={fieldGrid()}>
            <Field label="Traveler type" name="travelerType" placeholder="solo, couple, family" />
            <Field label="Group size" min="1" name="groupSize" placeholder="2" type="number" />
          </div>
          <label className={labelClass()}>
            Risk tolerance
            <select className={inputClass()} defaultValue="balanced" name="riskTolerance">
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="low_risk">Low risk</option>
            </select>
          </label>
          <fieldset
            className={css({
              borderWidth: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "2",
              m: 0,
              p: 0,
            })}
          >
            <legend
              className={css({
                color: "text.strong",
                display: "block",
                flexBasis: "100%",
                fontSize: "xs",
                fontWeight: "900",
                mb: "1",
              })}
            >
              Optional modules
            </legend>
            {optionalRiskModules.slice(0, 8).map((module) => (
              <label
                className={css({
                  alignItems: "center",
                  bg: "surface.tint",
                  borderColor: "border",
                  borderRadius: "md",
                  borderWidth: "1px",
                  color: "text.muted",
                  display: "flex",
                  fontSize: "xs",
                  fontWeight: "800",
                  gap: "2",
                  minH: "32px",
                  px: "3",
                })}
                key={module}
              >
                <input name={module} type="checkbox" /> {module.replaceAll("_", " ")}
              </label>
            ))}
            <label
              className={css({
                alignItems: "center",
                bg: "surface.tint",
                borderColor: "border",
                borderRadius: "md",
                borderWidth: "1px",
                color: "text.muted",
                display: "flex",
                fontSize: "xs",
                fontWeight: "800",
                gap: "2",
                minH: "32px",
                px: "3",
              })}
            >
              <input name="hasChildren" type="checkbox" /> family or children
            </label>
          </fieldset>
          <button
            className={button({ variant: "primary" })}
            disabled={state.status === "submitting"}
            type="submit"
          >
            {state.status === "submitting" ? "Checking..." : "Get preview risk"}
          </button>
        </form>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  type = "text",
  min,
}: {
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  type?: string;
  min?: string;
}) {
  return (
    <label className={labelClass()}>
      {label}
      <input
        className={inputClass()}
        min={min}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function ResultPanel({ state }: { state: SubmitState }) {
  if (state.status === "idle" || state.status === "submitting") {
    return (
      <div className={resultBox()}>
        <p className={bodyText()}>
          Try the seeded happy path with "Example Surf Stay" and area "General Luna".
        </p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={resultBox()}>
        <AlertTriangle aria-hidden="true" className={css({ color: "risk.high" })} size={18} />
        <p className={bodyText()}>{state.message}</p>
      </div>
    );
  }

  const { completeness } = state.result;
  return (
    <div className={resultBox()}>
      {completeness.checkoutEligible ? (
        <CheckCircle2 aria-hidden="true" className={css({ color: "risk.lowDark" })} size={20} />
      ) : (
        <AlertTriangle aria-hidden="true" className={css({ color: "risk.medium" })} size={20} />
      )}
      <h3 className={css({ color: "text.strong", fontSize: "md", fontWeight: "800", m: 0 })}>
        {completeness.checkoutEligible ? "Preview risk ready" : "Checkout blocked"}
      </h3>
      {completeness.previewRisk ? (
        <p className={bodyText()}>
          {completeness.previewRisk.title}: {completeness.previewRisk.recommendedFix}
        </p>
      ) : null}
      {completeness.blockingReasons.map((reason) => (
        <p className={bodyText()} key={reason}>
          {reason}
        </p>
      ))}
      {completeness.requiredUserFollowups.map((followup) => (
        <p className={bodyText()} key={followup}>
          {followup}
        </p>
      ))}
    </div>
  );
}

function fieldGrid() {
  return css({
    display: "grid",
    gap: "3",
    gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)" },
  });
}

function formShell() {
  return css({
    bg: "rgba(255,255,255,0.88)",
    borderColor: "rgba(204, 198, 229, 0.8)",
    borderRadius: "xl",
    borderWidth: "1px",
    boxShadow: "0 24px 70px rgba(23, 24, 79, 0.16)",
    display: "grid",
    gap: "4",
    p: { base: "4", md: "5" },
  });
}

function labelClass() {
  return css({
    color: "text.strong",
    display: "grid",
    fontSize: "xs",
    fontWeight: "800",
    gap: "2",
  });
}

function inputClass() {
  return css({
    bg: "rgba(255,255,255,0.88)",
    borderColor: "#d9d5ea",
    borderRadius: "md",
    borderWidth: "1px",
    color: "text",
    minH: "44px",
    minW: 0,
    px: "3",
    width: "100%",
    _focusVisible: { outline: "3px solid token(colors.violet.400)", outlineOffset: "2px" },
  });
}

function resultBox() {
  return css({
    bg: "rgba(255,255,255,0.68)",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    mt: "5",
    p: "4",
  });
}

function eyebrow() {
  return css({
    color: "violet.650",
    fontSize: "xs",
    fontWeight: "900",
    mb: "3",
    textTransform: "uppercase",
  });
}

function heading() {
  return css({
    color: "text.strong",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: { base: "2xl", md: "3xl" },
    fontWeight: "800",
    lineHeight: "1.05",
    m: 0,
    maxW: "360px",
  });
}

function bodyText() {
  return css({ color: "text.muted", fontSize: "sm", lineHeight: "1.65", m: 0 });
}
