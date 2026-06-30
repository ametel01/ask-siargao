import { AlertTriangle, CheckCircle2, ClipboardList, FileText, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ReportOutput, RiskItem } from "@/server/audit/schemas";
import {
  AppBackdrop,
  appBodyClass,
  appCardClass,
  appLabelClass,
  appMetaClass,
  appPanelClass,
  appShellClass,
  PageHeader,
  SectionHeading,
} from "@/ui/components/ask-siargao";

const categoryLabels: Record<RiskItem["category"], string> = {
  arrival_departure_logistics: "Arrival logistics",
  weather_seasonality: "Weather",
  area_fit: "Area fit",
  internet_power: "Internet and power",
  on_island_transport: "On-island transport",
  cash_sim_basic_services: "Cash, SIM, services",
  health_safety_admin: "Health and admin",
};

const listClass = "m-0 grid gap-3 pl-5 text-sm leading-[1.65] text-text-default";
const smallTitleClass = "m-0 text-base leading-[1.3] font-extrabold text-text-strong";
const metricClass =
  "grid gap-2 rounded-none border border-border-on-dark bg-surface-night-card p-4 shadow-night-card backdrop-blur-md";
const metricValueClass = "m-0 font-heading text-3xl leading-none font-semibold text-text-on-dark";

export function FinalReportPage({
  auditRequestId,
  report,
}: {
  auditRequestId: string;
  report: ReportOutput;
}) {
  return (
    <AppBackdrop>
      <section className={appShellClass}>
        <PageHeader
          description={
            <>
              Overall rating: <strong>{report.overallRisk.toUpperCase()}</strong>.{" "}
              {report.confidenceSummary}
            </>
          }
          title="Siargao trip risk audit"
        >
          <span className="inline-flex w-fit rounded-md border border-border-on-dark bg-surface-night-card px-3 py-2 text-xs font-extrabold text-text-on-dark-muted">
            Paid report {auditRequestId}
          </span>
        </PageHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className={metricClass}>
            <p className="m-0 text-xs font-extrabold tracking-[0.1em] text-brand-lagoon-300 uppercase">
              Overall risk
            </p>
            <p className={metricValueClass}>{report.overallRisk.toUpperCase()}</p>
          </div>
          <div className={metricClass}>
            <p className="m-0 text-xs font-extrabold tracking-[0.1em] text-brand-lagoon-300 uppercase">
              Top risks
            </p>
            <p className={metricValueClass}>{report.topRisks.length}</p>
          </div>
          <div className={metricClass}>
            <p className="m-0 text-xs font-extrabold tracking-[0.1em] text-brand-lagoon-300 uppercase">
              Evidence items
            </p>
            <p className={metricValueClass}>{report.evidence.length}</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className={appPanelClass}>
            <SectionHeading icon={AlertTriangle} title="Top risks" />
            <div className="grid gap-4">
              {report.topRisks.map((risk) => (
                <RiskBlock key={risk.id} risk={risk} />
              ))}
            </div>
          </section>

          <section className={appPanelClass}>
            <SectionHeading icon={ClipboardList} title="Recommendations" />
            <ul className={listClass}>
              {report.recommendedFixes.map((fix) => (
                <li key={fix}>{fix}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className={appPanelClass}>
          <SectionHeading icon={FileText} title="Category breakdown" />
          <div className="grid gap-3 md:grid-cols-2">
            {report.fullRiskTable.map((risk) => (
              <RiskSummary key={risk.id} risk={risk} />
            ))}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className={appPanelClass}>
            <SectionHeading icon={HelpCircle} title="Host questions" />
            <ul className={listClass}>
              {report.hostQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>

          <section className={appPanelClass}>
            <SectionHeading icon={CheckCircle2} title="Evidence snapshot" />
            <div className="grid gap-3">
              {report.evidence.map((evidence) => (
                <article className={appCardClass} key={evidence.evidenceId}>
                  <p className={appLabelClass}>{evidence.evidenceId}</p>
                  <h3 className={smallTitleClass}>{evidence.label}</h3>
                  <p className={appBodyClass}>
                    {evidence.sourceName} · {evidence.confidence} confidence · {evidence.freshness}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className={appPanelClass}>
          <SectionHeading icon={FileText} title="Notes and limitations" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Note title="Source quality" value={report.sourceQualitySummary} />
            <Note title="Freshness" value={report.evidenceFreshnessNotes.join(" ")} />
            <Note title="Limitations" value={report.limitations.join(" ")} />
          </div>
        </section>
      </section>
    </AppBackdrop>
  );
}

function RiskBlock({ risk }: { risk: RiskItem }) {
  return (
    <article className={appCardClass}>
      <RiskHeading risk={risk} />
      <p className={appBodyClass}>{risk.whatMightBreak}</p>
      <p className={appBodyClass}>{risk.whyItMatters}</p>
      <p className={appMetaClass}>
        Fix: {risk.recommendedFix} · Evidence{" "}
        {risk.evidence.map((item) => item.evidenceId).join(", ")}
      </p>
    </article>
  );
}

function RiskSummary({ risk }: { risk: RiskItem }) {
  return (
    <article className={appCardClass}>
      <RiskHeading risk={risk} />
      <p className={appBodyClass}>{risk.recommendedFix}</p>
      <p className={appMetaClass}>
        {risk.confidence} confidence · Evidence{" "}
        {risk.evidence.map((item) => item.evidenceId).join(", ")}
      </p>
    </article>
  );
}

function RiskHeading({ risk }: { risk: RiskItem }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className={appLabelClass}>{categoryLabels[risk.category]}</p>
        <Badge variant={risk.level === "red" ? "destructive" : "secondary"}>
          {risk.level.toUpperCase()} risk
        </Badge>
      </div>
      <h3 className={smallTitleClass}>{risk.title}</h3>
    </div>
  );
}

function Note({ title, value }: { title: string; value: string }) {
  return (
    <article className={appCardClass}>
      <p className={appLabelClass}>{title}</p>
      <p className={appBodyClass}>{value}</p>
    </article>
  );
}
