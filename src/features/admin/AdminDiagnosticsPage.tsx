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
import {
  AppBackdrop,
  appBodyClass,
  appCardClass,
  appCardContentClass,
  appOutlineBadgeClass,
  appPanelClass,
  appShellClass,
  PageHeader,
  SectionHeading,
} from "@/ui/components/ask-siargao";

const gridClass = "grid gap-4 lg:grid-cols-2";

export function AdminDiagnosticsPage({
  access,
  snapshot,
}: {
  access: AdminAccessResult;
  snapshot: AdminDiagnosticsSnapshot;
}) {
  if (!access.allowed) {
    return (
      <AppBackdrop>
        <section className={appShellClass}>
          <div className={appPanelClass}>
            <SectionHeading icon={Lock} title="Admin access required" />
            <p className={appBodyClass}>
              Diagnostics are environment gated. Configure `ADMIN_ACCESS_TOKEN` and send it as an
              `x-admin-token` header to inspect operational data.
            </p>
          </div>
        </section>
      </AppBackdrop>
    );
  }

  const providerAndJobFailuresCount = snapshot.providerErrors.length + snapshot.jobFailures.length;

  return (
    <AppBackdrop>
      <section className={appShellClass}>
        <PageHeader
          description={
            <>
              Inspect blocked audits, stale facts, reviewer rejections, provider failures, job
              errors, and LLM cost drivers without exposing raw provider payloads or secrets.
            </>
          }
          eyebrow={`Operator console · ${access.mode} access`}
          title="Audit diagnostics"
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Blocked audits" value={snapshot.blockedAudits.length} />
          <Metric label="Provider errors" value={snapshot.providerErrors.length} />
          <Metric label="Stale facts" value={snapshot.sourceFreshnessIssues.length} />
          <Metric label="Job failures" value={snapshot.jobFailures.length} />
        </div>

        <div className={gridClass}>
          <section className={appPanelClass}>
            <SectionHeading icon={AlertTriangle} title="Blocked audits" />
            {snapshot.blockedAudits.length > 0 ? (
              snapshot.blockedAudits.map((audit) => (
                <DiagnosticCard
                  body={JSON.stringify(audit.diagnostics)}
                  key={audit.auditRequestId}
                  meta={audit.state}
                  title={audit.auditRequestId}
                />
              ))
            ) : (
              <EmptyState
                description="All tracked audits are outside blocked, failed, or needs-user-input states."
                icon={AlertTriangle}
                title="No blocked audits"
              />
            )}
          </section>

          <section className={appPanelClass}>
            <SectionHeading icon={FileSearch} title="Completeness failures" />
            {snapshot.completenessFailures.length > 0 ? (
              snapshot.completenessFailures.map((failure) => (
                <DiagnosticCard
                  body={formatList(failure.blockingReasons)}
                  key={failure.auditRequestId}
                  meta="Checkout blocked"
                  title={failure.auditRequestId}
                />
              ))
            ) : (
              <EmptyState
                description="Every sampled completeness check currently passes the checkout gate."
                icon={FileSearch}
                title="No completeness failures"
              />
            )}
          </section>

          <section className={appPanelClass}>
            <SectionHeading icon={ServerCrash} title="Provider and job failures" />
            {providerAndJobFailuresCount > 0 ? (
              <>
                {snapshot.providerErrors.map((provider) => (
                  <DiagnosticCard
                    body={provider.lastError ?? "No provider error message recorded."}
                    key={provider.providerId}
                    meta={provider.status}
                    title={provider.providerName}
                  />
                ))}
                {snapshot.jobFailures.map((job) => (
                  <DiagnosticCard
                    body={job.lastError ?? "No job error message recorded."}
                    key={job.jobId}
                    meta={`${job.kind} · ${job.attempts} attempts`}
                    title={job.jobId}
                  />
                ))}
              </>
            ) : (
              <EmptyState
                description="No degraded providers or failed background jobs are present in the snapshot."
                icon={ServerCrash}
                title="No provider or job failures"
              />
            )}
          </section>

          <section className={appPanelClass}>
            <SectionHeading icon={ShieldCheck} title="Reviewer rejections" />
            {snapshot.reviewerRejections.length > 0 ? (
              snapshot.reviewerRejections.map((review) => (
                <DiagnosticCard
                  body={formatList([...review.blockedReasons, ...review.corrections])}
                  key={review.auditRequestId}
                  meta={review.verdict}
                  title={review.auditRequestId}
                />
              ))
            ) : (
              <EmptyState
                description="Reviewer output has not blocked or requested revisions for the sampled audits."
                icon={ShieldCheck}
                title="No reviewer rejections"
              />
            )}
          </section>
        </div>

        <section className={appPanelClass}>
          <SectionHeading icon={Gauge} title="LLM cost drivers" />
          <div className={gridClass}>
            {snapshot.llmCostEstimates.length > 0 ? (
              snapshot.llmCostEstimates.map((run) => (
                <DiagnosticCard
                  body={`${run.tokenDrivers.inputTokens} input tokens, ${run.tokenDrivers.outputTokens} output tokens`}
                  key={run.runId}
                  meta={`${run.model} · estimated USD ${run.estimatedUsd.toFixed(4)}`}
                  title={run.runId}
                />
              ))
            ) : (
              <EmptyState
                description="No model runs with token usage are present in this diagnostics snapshot."
                icon={Gauge}
                title="No LLM cost estimates"
              />
            )}
          </div>
        </section>

        <section className={appPanelClass}>
          <SectionHeading icon={ClipboardList} title="Drill-down views" />
          <div className={gridClass}>
            <DiagnosticCard
              body={formatList(snapshot.drilldowns.evidenceSummary, "No evidence labels recorded.")}
              meta={`${snapshot.drilldowns.evidenceSummary.length} evidence labels`}
              title="Evidence summary"
            />
            <DiagnosticCard
              body={formatList(
                snapshot.drilldowns.sourceProfiles.map((source) => source.name),
                "No source profiles recorded.",
              )}
              meta={`${snapshot.drilldowns.sourceProfiles.length} profiles`}
              title="Source profiles"
            />
            <DiagnosticCard
              body={formatList(
                snapshot.drilldowns.factConfidence.map(
                  (fact) => `${fact.factId}: ${fact.confidence}`,
                ),
                "No fact confidence rows recorded.",
              )}
              meta={`${snapshot.drilldowns.factConfidence.length} facts`}
              title="Fact confidence"
            />
            <DiagnosticCard
              body={
                snapshot.drilldowns.toolCallLogs.length > 0
                  ? JSON.stringify(snapshot.drilldowns.toolCallLogs)
                  : "No tool-call logs recorded."
              }
              meta={`${snapshot.drilldowns.toolCallLogs.length} calls`}
              title="Tool-call logs"
            />
          </div>
        </section>
      </section>
    </AppBackdrop>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-md border border-white/14 bg-white/12 p-4 text-text-on-dark shadow-[0_18px_48px_rgba(0,0,0,0.16)] backdrop-blur-md">
      <CardContent className={appCardContentClass}>
        <p className="m-0 text-xs font-extrabold tracking-[0.1em] text-brand-lagoon-300 uppercase">
          {label}
        </p>
        <p className="m-0 text-3xl font-extrabold text-[#fff9e9]">{value}</p>
      </CardContent>
    </Card>
  );
}

function DiagnosticCard({ body, meta, title }: { title: string; meta: string; body: string }) {
  return (
    <Card className={`mb-3 ${appCardClass}`} size="sm">
      <CardContent className={appCardContentClass}>
        <Badge
          className={`w-fit ${metaTone(meta) === "outline" ? appOutlineBadgeClass : ""}`}
          variant={metaTone(meta)}
        >
          {meta}
        </Badge>
        <h3 className="m-0 text-base font-extrabold text-text-strong">{title}</h3>
        <p className={appBodyClass}>{body || "No details recorded."}</p>
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
        <EmptyMedia className="bg-surface-default text-brand-lagoon-700" variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-text-strong">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
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
