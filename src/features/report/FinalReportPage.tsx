import { AlertTriangle, CheckCircle2, ClipboardList, FileText, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ReportOutput, RiskItem } from "@/server/audit/schemas";

const categoryLabels: Record<RiskItem["category"], string> = {
  arrival_departure_logistics: "Arrival logistics",
  weather_seasonality: "Weather",
  area_fit: "Area fit",
  internet_power: "Internet and power",
  on_island_transport: "On-island transport",
  cash_sim_basic_services: "Cash, SIM, services",
  health_safety_admin: "Health and admin",
};

const pageShell =
  "min-h-screen bg-[radial-gradient(circle_at_18%_8%,rgba(135,92,246,0.2),transparent_32rem),linear-gradient(135deg,#05082a_0%,#090d3a_48%,#17105a_100%)] text-text-on-dark";
const contentShell = "mx-auto grid max-w-[1180px] gap-6 px-5 py-8 md:px-8 md:py-12";
const panelClass =
  "rounded-lg border border-border-default bg-surface-default p-5 shadow-card md:p-6";
const compactCardClass = "grid gap-2 rounded-md border-border-default bg-surface-tint p-4";
const compactCardContentClass = "grid gap-2 p-0";
const listClass = "m-0 grid gap-3 pl-5 text-sm leading-[1.65] text-text-default";
const labelClass = "m-0 text-xs font-extrabold text-brand-violet-650 uppercase";
const smallTitleClass = "m-0 text-base leading-[1.3] font-extrabold text-text-strong";
const bodyClass = "m-0 text-sm leading-[1.65] text-text-muted";
const metaClass = "m-0 text-xs leading-[1.55] font-extrabold text-text-default";

export function FinalReportPage({
  auditRequestId,
  report,
}: {
  auditRequestId: string;
  report: ReportOutput;
}) {
  return (
    <main className={pageShell}>
      <section className={contentShell}>
        <header className="grid max-w-[820px] gap-4 text-text-on-dark">
          <p className="m-0 text-xs font-extrabold text-text-on-dark-muted uppercase">
            Paid report {auditRequestId}
          </p>
          <h1 className="m-0 text-[2.5rem] leading-[1.1] font-extrabold md:text-5xl">
            Siargao trip risk audit
          </h1>
          <p className="m-0 text-base leading-[1.7] text-text-on-dark-muted">
            Overall rating: <strong>{report.overallRisk.toUpperCase()}</strong>.{" "}
            {report.confidenceSummary}
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className={panelClass}>
            <PanelHeading icon={AlertTriangle} title="Top risks" />
            <div className="grid gap-4">
              {report.topRisks.map((risk) => (
                <RiskBlock key={risk.id} risk={risk} />
              ))}
            </div>
          </section>

          <section className={panelClass}>
            <PanelHeading icon={ClipboardList} title="Recommendations" />
            <ul className={listClass}>
              {report.recommendedFixes.map((fix) => (
                <li key={fix}>{fix}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className={panelClass}>
          <PanelHeading icon={FileText} title="Category breakdown" />
          <div className="grid gap-3 md:grid-cols-2">
            {report.fullRiskTable.map((risk) => (
              <RiskSummary key={risk.id} risk={risk} />
            ))}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className={panelClass}>
            <PanelHeading icon={HelpCircle} title="Host questions" />
            <ul className={listClass}>
              {report.hostQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>

          <section className={panelClass}>
            <PanelHeading icon={CheckCircle2} title="Evidence snapshot" />
            <div className="grid gap-3">
              {report.evidence.map((evidence) => (
                <Card className={compactCardClass} key={evidence.evidenceId} size="sm">
                  <CardContent className={compactCardContentClass}>
                    <p className={labelClass}>{evidence.evidenceId}</p>
                    <h3 className={smallTitleClass}>{evidence.label}</h3>
                    <p className={bodyClass}>
                      {evidence.sourceName} · {evidence.confidence} confidence ·{" "}
                      {evidence.freshness}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <section className={panelClass}>
          <PanelHeading icon={FileText} title="Notes and limitations" />
          <div className="grid gap-4 lg:grid-cols-3">
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
    <Card className={compactCardClass} size="sm">
      <CardContent className={compactCardContentClass}>
        <RiskHeading risk={risk} />
        <p className={bodyClass}>{risk.whatMightBreak}</p>
        <p className={bodyClass}>{risk.whyItMatters}</p>
        <p className={metaClass}>
          Fix: {risk.recommendedFix} · Evidence{" "}
          {risk.evidence.map((item) => item.evidenceId).join(", ")}
        </p>
      </CardContent>
    </Card>
  );
}

function RiskSummary({ risk }: { risk: RiskItem }) {
  return (
    <Card className={compactCardClass} size="sm">
      <CardContent className={compactCardContentClass}>
        <RiskHeading risk={risk} />
        <p className={bodyClass}>{risk.recommendedFix}</p>
        <p className={metaClass}>
          {risk.confidence} confidence · Evidence{" "}
          {risk.evidence.map((item) => item.evidenceId).join(", ")}
        </p>
      </CardContent>
    </Card>
  );
}

function RiskHeading({ risk }: { risk: RiskItem }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className={labelClass}>{categoryLabels[risk.category]}</p>
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
    <Card className={compactCardClass} size="sm">
      <CardContent className={compactCardContentClass}>
        <p className={labelClass}>{title}</p>
        <p className={bodyClass}>{value}</p>
      </CardContent>
    </Card>
  );
}

function PanelHeading({ icon: Icon, title }: { icon: typeof FileText; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="inline-flex size-10 items-center justify-center rounded-md bg-surface-tint text-brand-violet-650">
        <Icon aria-hidden="true" size={21} />
      </span>
      <h2 className="m-0 text-xl font-extrabold text-text-strong">{title}</h2>
    </div>
  );
}
