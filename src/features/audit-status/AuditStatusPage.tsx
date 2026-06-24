import { CheckCircle2, Clock3, FileSearch, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type AuditJobState, auditJobStates } from "@/server/audit/enums";

const backdropClass =
  "min-h-screen bg-[radial-gradient(circle_at_18%_8%,rgba(135,92,246,0.2),transparent_32rem),linear-gradient(135deg,#05082a_0%,#090d3a_48%,#17105a_100%)] text-text-on-dark";

const statusCopy: Record<
  AuditJobState,
  { title: string; body: string; icon: typeof Clock3; tone: "neutral" | "success" | "warning" }
> = {
  created: {
    title: "Audit created",
    body: "Your intake has been received and is waiting for source resolution.",
    icon: Clock3,
    tone: "neutral",
  },
  resolving: {
    title: "Resolving sources",
    body: "We are matching the stay, route, and required evidence before payment.",
    icon: FileSearch,
    tone: "neutral",
  },
  needs_user_input: {
    title: "More details needed",
    body: "Checkout remains locked until the blockers shown in your preview are resolved.",
    icon: TriangleAlert,
    tone: "warning",
  },
  complete_for_payment: {
    title: "Ready for payment",
    body: "The completeness gate passed. Checkout can start for this audit.",
    icon: CheckCircle2,
    tone: "success",
  },
  awaiting_payment: {
    title: "Waiting for Stripe confirmation",
    body: "Returning from checkout does not unlock the report. We are waiting for Stripe's verified webhook.",
    icon: Clock3,
    tone: "neutral",
  },
  paid: {
    title: "Payment verified",
    body: "Stripe confirmed payment. Audit generation is being queued.",
    icon: CheckCircle2,
    tone: "success",
  },
  generating: {
    title: "Generating audit",
    body: "The report is being generated from permitted evidence and source-quality checks.",
    icon: FileSearch,
    tone: "neutral",
  },
  reviewing: {
    title: "Reviewer pass",
    body: "A reviewer pass is checking evidence, limitations, and publication blockers.",
    icon: FileSearch,
    tone: "neutral",
  },
  published: {
    title: "Report ready",
    body: "The paid and reviewed report has been published for the secure delivery flow.",
    icon: CheckCircle2,
    tone: "success",
  },
  blocked: {
    title: "Audit blocked",
    body: "The audit needs operator review or corrected user details before it can continue.",
    icon: TriangleAlert,
    tone: "warning",
  },
  failed: {
    title: "Audit failed",
    body: "The failure context has been retained for admin and operator review.",
    icon: TriangleAlert,
    tone: "warning",
  },
};

export function AuditStatusPage({
  auditRequestId,
  state = "awaiting_payment",
}: {
  auditRequestId: string;
  state?: AuditJobState;
}) {
  const copy = statusCopy[state];
  const Icon = copy.icon;
  const progressValue = auditProgressValue(state);

  return (
    <main className={backdropClass}>
      <section className="mx-auto grid min-h-screen max-w-[860px] items-center px-5 py-10 md:px-8 md:py-16">
        <Card className="grid gap-5 rounded-lg border border-border-default bg-surface-default p-5 shadow-card md:p-8">
          <CardContent className="grid gap-5 p-0">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex size-11 items-center justify-center rounded-md ${statusIconClass(
                  copy.tone,
                )}`}
              >
                <Icon aria-hidden="true" size={23} />
              </span>
              <p className="m-0 text-xs font-extrabold text-text-muted uppercase">
                Audit {auditRequestId}
              </p>
            </div>
            <h1 className="m-0 text-2xl leading-[1.15] font-extrabold text-text-strong md:text-3xl">
              {copy.title}
            </h1>
            <Alert variant={copy.tone === "warning" ? "destructive" : "default"}>
              <Icon aria-hidden="true" />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.body}</AlertDescription>
            </Alert>
            <div className="grid gap-2">
              <Progress aria-label="Audit progress" value={progressValue} />
              <p className="m-0 text-xs font-extrabold text-text-muted">
                {Math.round(progressValue)}% through the audit lifecycle
              </p>
            </div>
            <ol className="m-0 grid gap-2 pl-5 text-sm leading-[1.7] text-text-muted">
              <li>Verified Stripe webhook marks the audit paid.</li>
              <li>Generation starts after payment is verified server-side.</li>
              <li>Publication requires both payment and reviewer approval.</li>
            </ol>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export function parseAuditStatusState(value: string | undefined): AuditJobState {
  return auditJobStates.includes(value as AuditJobState)
    ? (value as AuditJobState)
    : "awaiting_payment";
}

function auditProgressValue(state: AuditJobState) {
  const progressByState: Record<AuditJobState, number> = {
    created: 8,
    resolving: 18,
    needs_user_input: 24,
    complete_for_payment: 36,
    awaiting_payment: 48,
    paid: 60,
    generating: 72,
    reviewing: 86,
    published: 100,
    blocked: 24,
    failed: 24,
  };

  return progressByState[state];
}

function statusIconClass(tone: "neutral" | "success" | "warning") {
  if (tone === "success") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (tone === "warning") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-surface-tint text-brand-violet-650";
}
