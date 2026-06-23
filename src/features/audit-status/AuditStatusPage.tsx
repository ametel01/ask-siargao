import { CheckCircle2, Clock3, FileSearch, TriangleAlert } from "lucide-react";

import { type AuditJobState, auditJobStates } from "@/server/audit/enums";
import { css } from "../../../styled-system/css";
import { pageShell } from "../../../styled-system/recipes";

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

  return (
    <main className={pageShell()}>
      <section
        className={css({
          alignItems: "center",
          display: "grid",
          maxW: "860px",
          minH: "100vh",
          mx: "auto",
          px: { base: "5", md: "8" },
          py: { base: "10", md: "16" },
        })}
      >
        <div
          className={css({
            bg: "surface",
            borderColor: "border",
            borderRadius: "lg",
            borderWidth: "1px",
            boxShadow: "card",
            display: "grid",
            gap: "5",
            p: { base: "5", md: "8" },
          })}
        >
          <div
            className={css({
              alignItems: "center",
              display: "flex",
              gap: "3",
            })}
          >
            <span
              className={css({
                alignItems: "center",
                bg:
                  copy.tone === "success"
                    ? "risk.lowBg"
                    : copy.tone === "warning"
                      ? "risk.mediumBg"
                      : "surface.tint",
                borderRadius: "md",
                color:
                  copy.tone === "success"
                    ? "risk.lowDark"
                    : copy.tone === "warning"
                      ? "risk.medium"
                      : "violet.650",
                display: "inline-flex",
                h: "11",
                justifyContent: "center",
                width: "11",
              })}
            >
              <Icon aria-hidden="true" size={23} />
            </span>
            <p
              className={css({
                color: "text.muted",
                fontSize: "xs",
                fontWeight: "800",
                m: 0,
                textTransform: "uppercase",
              })}
            >
              Audit {auditRequestId}
            </p>
          </div>
          <h1
            className={css({
              color: "text.strong",
              fontSize: { base: "2xl", md: "3xl" },
              fontWeight: "800",
              lineHeight: "1.15",
              m: 0,
            })}
          >
            {copy.title}
          </h1>
          <p className={css({ color: "text.muted", fontSize: "md", lineHeight: "1.7", m: 0 })}>
            {copy.body}
          </p>
          <ol
            className={css({
              color: "text.muted",
              display: "grid",
              fontSize: "sm",
              gap: "2",
              lineHeight: "1.7",
              m: 0,
              pl: "5",
            })}
          >
            <li>Verified Stripe webhook marks the audit paid.</li>
            <li>Generation starts after payment is verified server-side.</li>
            <li>Publication requires both payment and reviewer approval.</li>
          </ol>
        </div>
      </section>
    </main>
  );
}

export function parseAuditStatusState(value: string | undefined): AuditJobState {
  return auditJobStates.includes(value as AuditJobState)
    ? (value as AuditJobState)
    : "awaiting_payment";
}
