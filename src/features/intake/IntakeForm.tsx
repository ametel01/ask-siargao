"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import type { OptionalRiskModule } from "@/server/audit/enums";
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

const examplePrompt =
  "I'm going in August for 5 nights. Arriving from Manila via Cebu. Planning to stay in Cloud 9 area, looking for a quiet place good for remote work and surfing. Budget mid-range.";

const focusOptions: Array<{
  label: string;
  module: OptionalRiskModule;
}> = [
  { label: "Remote work", module: "remote_work" },
  { label: "Quiet sleep", module: "quiet_sleep" },
  { label: "Surfing", module: "surfing" },
  { label: "Family trip", module: "family_kids" },
  { label: "Transport comfort", module: "transport_comfort" },
];

export function IntakeForm() {
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [prompt, setPrompt] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    const form = new FormData(event.currentTarget);
    const tripPrompt = form.get("tripPrompt")?.toString().trim() || "";
    const payload = buildPromptPayload({
      datesHint: form.get("datesHint")?.toString(),
      focusHint: form.get("focusHint")?.toString(),
      prompt: tripPrompt,
      travelersHint: form.get("travelersHint")?.toString(),
    });

    const response = await fetch("/api/audit/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setState({
        status: "error",
        message: "Add a month or arrival clue so we can run the free preview.",
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
        className={css({
          display: "grid",
          gap: "6",
          position: "relative",
        })}
      >
        <div
          className={css({
            alignItems: { base: "start", lg: "end" },
            display: "flex",
            flexDirection: { base: "column", lg: "row" },
            gap: "5",
            justifyContent: "space-between",
          })}
        >
          <div>
            <p className={eyebrow()}>Start the audit</p>
            <h2 className={heading()}>Describe your trip in your own words.</h2>
          </div>
          <div className={css({ display: "grid", gap: "2", maxW: "520px" })}>
            {[
              "One free preview risk",
              "No charge until audit is complete",
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
        </div>

        <form className={formShell()} onSubmit={onSubmit}>
          <label className={promptLabel()} htmlFor="tripPrompt">
            <Sparkles aria-hidden="true" className={css({ color: "violet.600" })} size={20} />
            Trip prompt
          </label>
          <textarea
            className={promptInput()}
            id="tripPrompt"
            name="tripPrompt"
            onChange={(event) => setPrompt(event.currentTarget.value)}
            placeholder={examplePrompt}
            required
            value={prompt}
          />

          <div
            className={css({
              alignItems: { base: "stretch", md: "center" },
              display: "flex",
              flexDirection: { base: "column", md: "row" },
              gap: "3",
              justifyContent: "space-between",
            })}
          >
            <div
              className={css({
                display: "flex",
                flexWrap: "wrap",
                gap: "3",
              })}
            >
              <PromptSelect icon={CalendarDays} label="Dates" name="datesHint">
                <option value="any">Any dates</option>
                <option value="2026-08">August</option>
                <option value="2026-09">September</option>
                <option value="2026-10">October</option>
              </PromptSelect>
              <PromptSelect icon={Users} label="Travelers" name="travelersHint">
                <option value="2">Any travelers</option>
                <option value="1">Solo</option>
                <option value="2">Couple</option>
                <option value="4">Family</option>
              </PromptSelect>
              <PromptSelect icon={SlidersHorizontal} label="Focus" name="focusHint">
                <option value="balanced">Any focus</option>
                {focusOptions.map((option) => (
                  <option key={option.module} value={option.module}>
                    {option.label}
                  </option>
                ))}
              </PromptSelect>
            </div>
            <button
              className={button({ variant: "primary" })}
              disabled={state.status === "submitting"}
              type="submit"
            >
              {state.status === "submitting" ? "Checking..." : "Get my risk preview"}
              <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
        </form>

        <ResultPanel state={state} />
      </div>
    </section>
  );
}

function PromptSelect({
  children,
  icon: Icon,
  label,
  name,
}: {
  children: ReactNode;
  icon: typeof CalendarDays;
  label: string;
  name: string;
}) {
  return (
    <label className={selectShell()}>
      <Icon aria-hidden="true" size={16} />
      <span
        className={css({
          h: "1px",
          overflow: "hidden",
          position: "absolute",
          width: "1px",
        })}
      >
        {label}
      </span>
      <select aria-label={label} className={selectInput()} name={name}>
        {children}
      </select>
    </label>
  );
}

function ResultPanel({ state }: { state: SubmitState }) {
  if (state.status === "idle" || state.status === "submitting") {
    return null;
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

function buildPromptPayload({
  datesHint,
  focusHint,
  prompt,
  travelersHint,
}: {
  datesHint?: string;
  focusHint?: string;
  prompt: string;
  travelersHint?: string;
}) {
  const normalized = prompt.toLowerCase();
  const optionalModules = inferOptionalModules(normalized, focusHint);
  const groupSize = Number(travelersHint);

  return {
    travelMonth: inferTravelMonth(normalized, datesHint),
    arrivalOrigin: inferArrivalOrigin(prompt),
    arrivalRouteSlug: inferRoute(normalized),
    accommodationName: inferAccommodationName(prompt),
    stayAreaSlug: inferStayArea(normalized),
    topConstraint: prompt,
    optionalModules,
    travelerContext: {
      travelerType: inferTravelerType(normalized, groupSize),
      groupSize: Number.isFinite(groupSize) && groupSize > 0 ? groupSize : undefined,
      hasChildren: optionalModules.includes("family_kids"),
      riskTolerance: "balanced" as const,
    },
  };
}

function inferTravelMonth(normalized: string, datesHint?: string) {
  const isoMonth = normalized.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/u)?.[0];
  if (isoMonth) {
    return isoMonth;
  }
  if (datesHint && datesHint !== "any") {
    return datesHint;
  }

  const month = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].findIndex((name) => normalized.includes(name));

  return month >= 0 ? `2026-${String(month + 1).padStart(2, "0")}` : "2026-08";
}

function inferArrivalOrigin(prompt: string) {
  const match = prompt.match(/\bfrom\s+([A-Za-z\s]+?)(?:\s+via|\s+to|\.|,|$)/u);
  return match?.[1]?.trim() || "Manila";
}

function inferRoute(normalized: string) {
  if (normalized.includes("surigao") || normalized.includes("ferry")) {
    return "surigao-city-to-dapa-ferry";
  }
  if (normalized.includes("dapa")) {
    return "dapa-port-to-general-luna";
  }
  return "sayak-airport-to-general-luna";
}

function inferAccommodationName(prompt: string) {
  const quoted = prompt.match(/"([^"]{2,80})"/u)?.[1];
  if (quoted && !quoted.toLowerCase().includes("general luna")) {
    return quoted;
  }
  if (/example surf stay/iu.test(prompt)) {
    return "Example Surf Stay";
  }
  return undefined;
}

function inferStayArea(normalized: string) {
  if (normalized.includes("cloud 9")) {
    return "cloud-9";
  }
  if (normalized.includes("malinao")) {
    return "malinao";
  }
  if (normalized.includes("dapa")) {
    return "dapa";
  }
  if (normalized.includes("del carmen")) {
    return "del-carmen";
  }
  return "general-luna";
}

function inferOptionalModules(normalized: string, focusHint?: string) {
  const modules = new Set<OptionalRiskModule>();
  if (focusHint && focusHint !== "balanced") {
    modules.add(focusHint as OptionalRiskModule);
  }
  if (normalized.includes("remote work") || normalized.includes("wifi")) {
    modules.add("remote_work");
  }
  if (normalized.includes("quiet") || normalized.includes("sleep")) {
    modules.add("quiet_sleep");
  }
  if (normalized.includes("surf")) {
    modules.add("surfing");
  }
  if (normalized.includes("kid") || normalized.includes("family")) {
    modules.add("family_kids");
  }
  if (normalized.includes("budget")) {
    modules.add("budget_sensitivity");
  }
  return Array.from(modules);
}

function inferTravelerType(normalized: string, groupSize: number) {
  if (normalized.includes("solo") || groupSize === 1) {
    return "solo";
  }
  if (normalized.includes("family") || groupSize >= 3) {
    return "family";
  }
  if (normalized.includes("couple") || groupSize === 2) {
    return "couple";
  }
  return undefined;
}

function formShell() {
  return css({
    bg: "rgba(255,255,255,0.94)",
    borderColor: "rgba(124, 92, 246, 0.42)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "0 24px 70px rgba(23, 24, 79, 0.14)",
    display: "grid",
    gap: "4",
    p: { base: "4", md: "5" },
  });
}

function promptLabel() {
  return css({
    alignItems: "center",
    color: "text.strong",
    display: "flex",
    fontSize: "sm",
    fontWeight: "900",
    gap: "2",
  });
}

function promptInput() {
  return css({
    bg: "transparent",
    borderWidth: 0,
    color: "text",
    fontSize: { base: "sm", md: "md" },
    lineHeight: "1.75",
    minH: { base: "150px", md: "132px" },
    outline: "none",
    resize: "vertical",
    width: "100%",
    _placeholder: { color: "text.soft" },
  });
}

function selectShell() {
  return css({
    alignItems: "center",
    bg: "surface.tint",
    borderRadius: "md",
    color: "text",
    display: "inline-flex",
    gap: "2",
    minH: "38px",
    px: "3",
    position: "relative",
  });
}

function selectInput() {
  return css({
    appearance: "none",
    bg: "transparent",
    borderWidth: 0,
    color: "text",
    cursor: "pointer",
    fontSize: "xs",
    fontWeight: "900",
    outline: "none",
    pr: "2",
  });
}

function resultBox() {
  return css({
    bg: "rgba(255,255,255,0.8)",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
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
  });
}

function bodyText() {
  return css({ color: "text.muted", fontSize: "sm", lineHeight: "1.65", m: 0 });
}
