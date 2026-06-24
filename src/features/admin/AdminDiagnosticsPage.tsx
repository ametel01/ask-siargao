import {
  AlertTriangle,
  ClipboardList,
  FileSearch,
  Gauge,
  Lock,
  type LucideIcon,
  ServerCrash,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { AdminAccessResult } from "@/server/admin/access";
import type { AdminDiagnosticsSnapshot } from "@/server/admin/diagnostics";

const backdropClass =
  "min-h-screen bg-[radial-gradient(circle_at_18%_8%,rgba(135,92,246,0.2),transparent_32rem),linear-gradient(135deg,#05082a_0%,#090d3a_48%,#17105a_100%)] text-text-on-dark";
const shellClass = "mx-auto grid max-w-[1180px] gap-6 px-5 py-8 md:px-8 md:py-12";
const panelClass =
  "rounded-lg border border-border-default bg-surface-default p-5 shadow-card md:p-6";
const cardClass = "mb-3 grid gap-2 rounded-md border border-border-default bg-surface-tint p-4";
const cardContentClass = "grid gap-2 p-0";
const bodyClass = "m-0 text-sm leading-[1.65] text-text-muted";
const eyebrowClass = "m-0 text-xs font-extrabold text-text-on-dark-muted uppercase";
const eyebrowLightClass = "m-0 text-xs font-extrabold text-brand-violet-650 uppercase";
const gridClass = "grid gap-4 lg:grid-cols-2";
const outlineBadgeClass = "border-border-strong bg-surface-default text-text-default";

export function AdminDiagnosticsPage({
  access,
  snapshot,
}: {
  access: AdminAccessResult;
  snapshot: AdminDiagnosticsSnapshot;
}) {
  if (!access.allowed) {
    return (
      <main className={backdropClass}>
        <section className={shellClass}>
          <div className={panelClass}>
            <PanelHeading icon={Lock} title="Admin access required" />
            <p className={bodyClass}>
              Diagnostics are environment gated. Configure `ADMIN_ACCESS_TOKEN` and send it as an
              `x-admin-token` header to inspect operational data.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const providerAndJobFailuresCount = snapshot.providerErrors.length + snapshot.jobFailures.length;

  return (
    <main className={backdropClass}>
      <section className={shellClass}>
        <header className="grid gap-3 text-text-on-dark">
          <p className={eyebrowClass}>Operator console · {access.mode} access</p>
          <h1 className="m-0 text-3xl leading-[1.1] font-extrabold text-text-on-dark md:text-4xl">
            Audit diagnostics
          </h1>
          <p className="m-0 max-w-[820px] text-base leading-[1.7] text-text-on-dark-muted">
            Inspect blocked audits, stale facts, reviewer rejections, provider failures, job errors,
            and LLM cost drivers without exposing raw provider payloads or secrets.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Blocked audits" value={snapshot.blockedAudits.length} />
          <Metric label="Provider errors" value={snapshot.providerErrors.length} />
          <Metric label="Stale facts" value={snapshot.sourceFreshnessIssues.length} />
          <Metric label="Job failures" value={snapshot.jobFailures.length} />
        </div>

        <div className={gridClass}>
          <section className={panelClass}>
            <PanelHeading icon={AlertTriangle} title="Blocked audits" />
            {snapshot.blockedAudits.length > 0 ? (
              snapshot.blockedAudits.map((audit) => (
                <DiagnosticCard
                  key={audit.auditRequestId}
                  title={audit.auditRequestId}
                  meta={audit.state}
                  body={JSON.stringify(audit.diagnostics)}
                />
              ))
            ) : (
              <EmptyState
                icon={AlertTriangle}
                title="No blocked audits"
                description="All tracked audits are outside blocked, failed, or needs-user-input states."
              />
            )}
          </section>

          <section className={panelClass}>
            <PanelHeading icon={FileSearch} title="Completeness failures" />
            {snapshot.completenessFailures.length > 0 ? (
              snapshot.completenessFailures.map((failure) => (
                <DiagnosticCard
                  key={failure.auditRequestId}
                  title={failure.auditRequestId}
                  meta="Checkout blocked"
                  body={formatList(failure.blockingReasons)}
                />
              ))
            ) : (
              <EmptyState
                icon={FileSearch}
                title="No completeness failures"
                description="Every sampled completeness check currently passes the checkout gate."
              />
            )}
          </section>

          <section className={panelClass}>
            <PanelHeading icon={ServerCrash} title="Provider and job failures" />
            {providerAndJobFailuresCount > 0 ? (
              <>
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
              </>
            ) : (
              <EmptyState
                icon={ServerCrash}
                title="No provider or job failures"
                description="No degraded providers or failed background jobs are present in the snapshot."
              />
            )}
          </section>

          <section className={panelClass}>
            <PanelHeading icon={ShieldCheck} title="Reviewer rejections" />
            {snapshot.reviewerRejections.length > 0 ? (
              snapshot.reviewerRejections.map((review) => (
                <DiagnosticCard
                  key={review.auditRequestId}
                  title={review.auditRequestId}
                  meta={review.verdict}
                  body={formatList([...review.blockedReasons, ...review.corrections])}
                />
              ))
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title="No reviewer rejections"
                description="Reviewer output has not blocked or requested revisions for the sampled audits."
              />
            )}
          </section>
        </div>

        <section className={panelClass}>
          <PanelHeading icon={Gauge} title="LLM cost drivers" />
          <div className={gridClass}>
            {snapshot.llmCostEstimates.length > 0 ? (
              snapshot.llmCostEstimates.map((run) => (
                <DiagnosticCard
                  key={run.runId}
                  title={run.runId}
                  meta={`${run.model} · estimated USD ${run.estimatedUsd.toFixed(4)}`}
                  body={`${run.tokenDrivers.inputTokens} input tokens, ${run.tokenDrivers.outputTokens} output tokens`}
                />
              ))
            ) : (
              <EmptyState
                icon={Gauge}
                title="No LLM cost estimates"
                description="No model runs with token usage are present in this diagnostics snapshot."
              />
            )}
          </div>
        </section>

        <section className={panelClass}>
          <PanelHeading icon={ClipboardList} title="Drill-down views" />
          <div className={gridClass}>
            <DiagnosticCard
              title="Evidence summary"
              meta={`${snapshot.drilldowns.evidenceSummary.length} evidence labels`}
              body={formatList(snapshot.drilldowns.evidenceSummary, "No evidence labels recorded.")}
            />
            <DiagnosticCard
              title="Source profiles"
              meta={`${snapshot.drilldowns.sourceProfiles.length} profiles`}
              body={formatList(
                snapshot.drilldowns.sourceProfiles.map((source) => source.name),
                "No source profiles recorded.",
              )}
            />
            <DiagnosticCard
              title="Fact confidence"
              meta={`${snapshot.drilldowns.factConfidence.length} facts`}
              body={formatList(
                snapshot.drilldowns.factConfidence.map(
                  (fact) => `${fact.factId}: ${fact.confidence}`,
                ),
                "No fact confidence rows recorded.",
              )}
            />
            <DiagnosticCard
              title="Tool-call logs"
              meta={`${snapshot.drilldowns.toolCallLogs.length} calls`}
              body={
                snapshot.drilldowns.toolCallLogs.length > 0
                  ? JSON.stringify(snapshot.drilldowns.toolCallLogs)
                  : "No tool-call logs recorded."
              }
            />
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className={panelClass}>
      <CardContent className={cardContentClass}>
        <p className={eyebrowLightClass}>{label}</p>
        <p className="m-0 text-3xl font-extrabold text-text-strong">{value}</p>
      </CardContent>
    </Card>
  );
}

function DiagnosticCard({ body, meta, title }: { title: string; meta: string; body: string }) {
  return (
    <Card className={cardClass} size="sm">
      <CardContent className={cardContentClass}>
        <Badge
          className={`w-fit ${metaTone(meta) === "outline" ? outlineBadgeClass : ""}`}
          variant={metaTone(meta)}
        >
          {meta}
        </Badge>
        <h3 className="m-0 text-base font-extrabold text-text-strong">{title}</h3>
        <p className={bodyClass}>{body || "No details recorded."}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Empty className="min-h-[160px] border border-border-default bg-surface-tint text-text-muted">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-surface-default text-brand-violet-650">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-text-strong">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PanelHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="inline-flex size-10 items-center justify-center rounded-md bg-surface-tint text-brand-violet-650">
        <Icon aria-hidden="true" size={21} />
      </span>
      <h2 className="m-0 text-xl font-extrabold text-text-strong">{title}</h2>
    </div>
  );
}

function metaTone(meta: string): "secondary" | "destructive" | "outline" {
  const normalized = meta.toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("blocked")
  ) {
    return "destructive";
  }
  if (normalized.includes("complete") || normalized.includes("success")) {
    return "secondary";
  }
  return "outline";
}

function formatList(items: string[], fallback = "No details recorded.") {
  return items.length > 0 ? items.join(", ") : fallback;
}
