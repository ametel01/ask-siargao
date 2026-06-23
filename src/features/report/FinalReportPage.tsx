import { AlertTriangle, CheckCircle2, ClipboardList, FileText, HelpCircle } from "lucide-react";

import type { ReportOutput, RiskItem } from "@/server/audit/schemas";
import { css } from "../../../styled-system/css";
import { pageShell } from "../../../styled-system/recipes";

const categoryLabels: Record<RiskItem["category"], string> = {
  arrival_departure_logistics: "Arrival logistics",
  weather_seasonality: "Weather",
  area_fit: "Area fit",
  internet_power: "Internet and power",
  on_island_transport: "On-island transport",
  cash_sim_basic_services: "Cash, SIM, services",
  health_safety_admin: "Health and admin",
};

export function FinalReportPage({
  auditRequestId,
  report,
}: {
  auditRequestId: string;
  report: ReportOutput;
}) {
  return (
    <main className={pageShell()}>
      <section
        className={css({
          display: "grid",
          gap: "6",
          maxW: "1180px",
          mx: "auto",
          px: { base: "5", md: "8" },
          py: { base: "8", md: "12" },
        })}
      >
        <header
          className={css({
            color: "text.onDark",
            display: "grid",
            gap: "4",
            maxW: "820px",
          })}
        >
          <p
            className={css({
              color: "text.onDarkMuted",
              fontSize: "xs",
              fontWeight: "800",
              m: 0,
              textTransform: "uppercase",
            })}
          >
            Paid report {auditRequestId}
          </p>
          <h1
            className={css({
              fontSize: { base: "3xl", md: "4xl" },
              fontWeight: "800",
              lineHeight: "1.1",
              m: 0,
            })}
          >
            Siargao trip risk audit
          </h1>
          <p
            className={css({ color: "text.onDarkMuted", fontSize: "md", lineHeight: "1.7", m: 0 })}
          >
            Overall rating: <strong>{report.overallRisk.toUpperCase()}</strong>.{" "}
            {report.confidenceSummary}
          </p>
        </header>

        <div
          className={css({
            display: "grid",
            gap: "5",
            gridTemplateColumns: { base: "1fr", lg: "1.05fr 0.95fr" },
          })}
        >
          <section className={panel()}>
            <PanelHeading icon={AlertTriangle} title="Top risks" />
            <div className={css({ display: "grid", gap: "4" })}>
              {report.topRisks.map((risk) => (
                <RiskBlock key={risk.id} risk={risk} />
              ))}
            </div>
          </section>

          <section className={panel()}>
            <PanelHeading icon={ClipboardList} title="Recommendations" />
            <ul className={listClass()}>
              {report.recommendedFixes.map((fix) => (
                <li key={fix}>{fix}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className={panel()}>
          <PanelHeading icon={FileText} title="Category breakdown" />
          <div
            className={css({
              display: "grid",
              gap: "3",
              gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)" },
            })}
          >
            {report.fullRiskTable.map((risk) => (
              <article className={compactCard()} key={risk.id}>
                <p className={labelClass()}>{categoryLabels[risk.category]}</p>
                <h3 className={smallTitle()}>{risk.title}</h3>
                <p className={bodyClass()}>{risk.recommendedFix}</p>
                <p className={metaClass()}>
                  {risk.level.toUpperCase()} risk · {risk.confidence} confidence · Evidence{" "}
                  {risk.evidence.map((item) => item.evidenceId).join(", ")}
                </p>
              </article>
            ))}
          </div>
        </section>

        <div
          className={css({
            display: "grid",
            gap: "5",
            gridTemplateColumns: { base: "1fr", lg: "repeat(2, 1fr)" },
          })}
        >
          <section className={panel()}>
            <PanelHeading icon={HelpCircle} title="Host questions" />
            <ul className={listClass()}>
              {report.hostQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>

          <section className={panel()}>
            <PanelHeading icon={CheckCircle2} title="Evidence snapshot" />
            <div className={css({ display: "grid", gap: "3" })}>
              {report.evidence.map((evidence) => (
                <article className={compactCard()} key={evidence.evidenceId}>
                  <p className={labelClass()}>{evidence.evidenceId}</p>
                  <h3 className={smallTitle()}>{evidence.label}</h3>
                  <p className={bodyClass()}>
                    {evidence.sourceName} · {evidence.confidence} confidence · {evidence.freshness}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className={panel()}>
          <PanelHeading icon={FileText} title="Notes and limitations" />
          <div
            className={css({
              display: "grid",
              gap: "4",
              gridTemplateColumns: { base: "1fr", lg: "repeat(3, 1fr)" },
            })}
          >
            <Note title="Source quality" value={report.sourceQualitySummary} />
            <Note title="Freshness" value={report.evidenceFreshnessNotes.join(" ")} />
            <Note title="Limitations" value={report.limitations.join(" ")} />
          </div>
        </section>
      </section>
    </main>
  );
}

function RiskBlock({ risk }: { risk: RiskItem }) {
  return (
    <article className={compactCard()}>
      <p className={labelClass()}>{categoryLabels[risk.category]}</p>
      <h3 className={smallTitle()}>{risk.title}</h3>
      <p className={bodyClass()}>{risk.whatMightBreak}</p>
      <p className={bodyClass()}>{risk.whyItMatters}</p>
      <p className={metaClass()}>
        Fix: {risk.recommendedFix} · Evidence{" "}
        {risk.evidence.map((item) => item.evidenceId).join(", ")}
      </p>
    </article>
  );
}

function Note({ title, value }: { title: string; value: string }) {
  return (
    <article className={compactCard()}>
      <p className={labelClass()}>{title}</p>
      <p className={bodyClass()}>{value}</p>
    </article>
  );
}

function PanelHeading({ icon: Icon, title }: { icon: typeof FileText; title: string }) {
  return (
    <div className={css({ alignItems: "center", display: "flex", gap: "3", mb: "4" })}>
      <span
        className={css({
          alignItems: "center",
          bg: "surface.tint",
          borderRadius: "md",
          color: "violet.650",
          display: "inline-flex",
          h: "10",
          justifyContent: "center",
          width: "10",
        })}
      >
        <Icon aria-hidden="true" size={21} />
      </span>
      <h2 className={css({ color: "text.strong", fontSize: "xl", fontWeight: "800", m: 0 })}>
        {title}
      </h2>
    </div>
  );
}

function panel() {
  return css({
    bg: "surface",
    borderColor: "border",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    p: { base: "5", md: "6" },
  });
}

function compactCard() {
  return css({
    bg: "surface.tint",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    p: "4",
  });
}

function listClass() {
  return css({
    color: "text",
    display: "grid",
    fontSize: "sm",
    gap: "3",
    lineHeight: "1.65",
    m: 0,
    pl: "5",
  });
}

function labelClass() {
  return css({
    color: "violet.650",
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    textTransform: "uppercase",
  });
}

function smallTitle() {
  return css({ color: "text.strong", fontSize: "md", fontWeight: "800", lineHeight: "1.3", m: 0 });
}

function bodyClass() {
  return css({ color: "text.muted", fontSize: "sm", lineHeight: "1.65", m: 0 });
}

function metaClass() {
  return css({ color: "text", fontSize: "xs", fontWeight: "800", lineHeight: "1.55", m: 0 });
}
