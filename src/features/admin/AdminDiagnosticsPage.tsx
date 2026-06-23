import {
  AlertTriangle,
  ClipboardList,
  FileSearch,
  Gauge,
  Lock,
  ServerCrash,
  ShieldCheck,
} from "lucide-react";

import type { AdminAccessResult } from "@/server/admin/access";
import type { AdminDiagnosticsSnapshot } from "@/server/admin/diagnostics";
import { css } from "../../../styled-system/css/css";
import { pageShell } from "../../../styled-system/recipes/page-shell";

export function AdminDiagnosticsPage({
  access,
  snapshot,
}: {
  access: AdminAccessResult;
  snapshot: AdminDiagnosticsSnapshot;
}) {
  if (!access.allowed) {
    return (
      <main className={pageShell()}>
        <section className={shellClass()}>
          <div className={panelClass()}>
            <PanelHeading icon={Lock} title="Admin access required" />
            <p className={bodyClass()}>
              Diagnostics are environment gated. Configure `ADMIN_ACCESS_TOKEN` and send it as an
              `x-admin-token` header to inspect operational data.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={pageShell()}>
      <section className={shellClass()}>
        <header className={css({ color: "text.onDark", display: "grid", gap: "3" })}>
          <p className={eyebrowClass()}>Operator console · {access.mode} access</p>
          <h1 className={titleClass()}>Audit diagnostics</h1>
          <p
            className={css({ color: "text.onDarkMuted", fontSize: "md", lineHeight: "1.7", m: 0 })}
          >
            Inspect blocked audits, stale facts, reviewer rejections, provider failures, job errors,
            and LLM cost drivers without exposing raw provider payloads or secrets.
          </p>
        </header>

        <div className={summaryGridClass()}>
          <Metric label="Blocked audits" value={snapshot.blockedAudits.length} />
          <Metric label="Provider errors" value={snapshot.providerErrors.length} />
          <Metric label="Stale facts" value={snapshot.sourceFreshnessIssues.length} />
          <Metric label="Job failures" value={snapshot.jobFailures.length} />
        </div>

        <div className={gridClass()}>
          <section className={panelClass()}>
            <PanelHeading icon={AlertTriangle} title="Blocked audits" />
            {snapshot.blockedAudits.map((audit) => (
              <DiagnosticCard
                key={audit.auditRequestId}
                title={audit.auditRequestId}
                meta={audit.state}
                body={JSON.stringify(audit.diagnostics)}
              />
            ))}
          </section>

          <section className={panelClass()}>
            <PanelHeading icon={FileSearch} title="Completeness failures" />
            {snapshot.completenessFailures.map((failure) => (
              <DiagnosticCard
                key={failure.auditRequestId}
                title={failure.auditRequestId}
                meta="Checkout blocked"
                body={failure.blockingReasons.join(" ")}
              />
            ))}
          </section>

          <section className={panelClass()}>
            <PanelHeading icon={ServerCrash} title="Provider and job failures" />
            {snapshot.providerErrors.map((provider) => (
              <DiagnosticCard
                key={provider.providerId}
                title={provider.providerName}
                meta={provider.status}
                body={provider.lastError ?? "No provider error message recorded."}
              />
            ))}
            {snapshot.jobFailures.map((job) => (
              <DiagnosticCard
                key={job.jobId}
                title={job.jobId}
                meta={`${job.kind} · ${job.attempts} attempts`}
                body={job.lastError ?? "No job error message recorded."}
              />
            ))}
          </section>

          <section className={panelClass()}>
            <PanelHeading icon={ShieldCheck} title="Reviewer rejections" />
            {snapshot.reviewerRejections.map((review) => (
              <DiagnosticCard
                key={review.auditRequestId}
                title={review.auditRequestId}
                meta={review.verdict}
                body={[...review.blockedReasons, ...review.corrections].join(" ")}
              />
            ))}
          </section>
        </div>

        <section className={panelClass()}>
          <PanelHeading icon={Gauge} title="LLM cost drivers" />
          <div className={gridClass()}>
            {snapshot.llmCostEstimates.map((run) => (
              <DiagnosticCard
                key={run.runId}
                title={run.runId}
                meta={`${run.model} · estimated USD ${run.estimatedUsd.toFixed(4)}`}
                body={`${run.tokenDrivers.inputTokens} input tokens, ${run.tokenDrivers.outputTokens} output tokens`}
              />
            ))}
          </div>
        </section>

        <section className={panelClass()}>
          <PanelHeading icon={ClipboardList} title="Drill-down views" />
          <div className={gridClass()}>
            <DiagnosticCard
              title="Evidence summary"
              meta={`${snapshot.drilldowns.evidenceSummary.length} evidence labels`}
              body={snapshot.drilldowns.evidenceSummary.join(", ")}
            />
            <DiagnosticCard
              title="Source profiles"
              meta={`${snapshot.drilldowns.sourceProfiles.length} profiles`}
              body={snapshot.drilldowns.sourceProfiles.map((source) => source.name).join(", ")}
            />
            <DiagnosticCard
              title="Fact confidence"
              meta={`${snapshot.drilldowns.factConfidence.length} facts`}
              body={snapshot.drilldowns.factConfidence
                .map((fact) => `${fact.factId}: ${fact.confidence}`)
                .join(", ")}
            />
            <DiagnosticCard
              title="Tool-call logs"
              meta={`${snapshot.drilldowns.toolCallLogs.length} calls`}
              body={JSON.stringify(snapshot.drilldowns.toolCallLogs)}
            />
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={panelClass()}>
      <p className={eyebrowLightClass()}>{label}</p>
      <p className={css({ color: "text.strong", fontSize: "3xl", fontWeight: "800", m: 0 })}>
        {value}
      </p>
    </div>
  );
}

function DiagnosticCard({ body, meta, title }: { title: string; meta: string; body: string }) {
  return (
    <article className={cardClass()}>
      <p className={eyebrowLightClass()}>{meta}</p>
      <h3 className={css({ color: "text.strong", fontSize: "md", fontWeight: "800", m: 0 })}>
        {title}
      </h3>
      <p className={bodyClass()}>{body || "No details recorded."}</p>
    </article>
  );
}

function PanelHeading({ icon: Icon, title }: { icon: typeof AlertTriangle; title: string }) {
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

function shellClass() {
  return css({
    display: "grid",
    gap: "6",
    maxW: "1180px",
    mx: "auto",
    px: { base: "5", md: "8" },
    py: { base: "8", md: "12" },
  });
}

function titleClass() {
  return css({
    color: "text.onDark",
    fontSize: { base: "3xl", md: "4xl" },
    fontWeight: "800",
    lineHeight: "1.1",
    m: 0,
  });
}

function summaryGridClass() {
  return css({
    display: "grid",
    gap: "4",
    gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
  });
}

function gridClass() {
  return css({
    display: "grid",
    gap: "4",
    gridTemplateColumns: { base: "1fr", lg: "repeat(2, 1fr)" },
  });
}

function panelClass() {
  return css({
    bg: "surface",
    borderColor: "border",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    p: { base: "5", md: "6" },
  });
}

function cardClass() {
  return css({
    bg: "surface.tint",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    mb: "3",
    p: "4",
  });
}

function eyebrowClass() {
  return css({
    color: "text.onDarkMuted",
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    textTransform: "uppercase",
  });
}

function eyebrowLightClass() {
  return css({
    color: "violet.650",
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    textTransform: "uppercase",
  });
}

function bodyClass() {
  return css({ color: "text.muted", fontSize: "sm", lineHeight: "1.65", m: 0 });
}
