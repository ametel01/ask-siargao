import { randomUUID } from "node:crypto";

import { type AuditJobState, canTransitionAuditJob } from "@/server/audit/enums";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { enqueueAuditGenerationJob } from "@/server/jobs/audit-jobs";

export type PaymentStatus = "not_started" | "checkout_started" | "paid" | "failed";

export type PaymentRecord = {
  id: string;
  auditRequestId: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  stripeEventId?: string;
  amountUsd: 9.99;
  status: PaymentStatus;
  webhookVerifiedAt?: string;
  diagnosticContext: Record<string, unknown>;
  createdAt: string;
};

export type AuditDiagnostic = {
  at: string;
  phase: "checkout" | "webhook" | "generate" | "review" | "publish";
  message: string;
  context?: Record<string, unknown>;
};

export type AuditLifecycleRecord = {
  id: string;
  state: AuditJobState;
  checkoutEligible: boolean;
  priceUsd: number;
  payment?: PaymentRecord;
  reviewedAt?: string;
  publishedAt?: string;
  diagnostics: AuditDiagnostic[];
  stateHistory: Array<{ state: AuditJobState; at: string; reason?: string }>;
};

export type CheckoutSessionSummary = {
  id: string;
  url: string;
};

export type VerifiedCheckoutPayment = {
  auditRequestId: string;
  stripeEventId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  eventType: string;
};

export function createAuditLifecycleRecord(input: {
  id: string;
  state: AuditJobState;
  checkoutEligible?: boolean;
  priceUsd?: number;
  now?: Date;
}): AuditLifecycleRecord {
  const at = iso(input.now);

  return {
    id: input.id,
    state: input.state,
    checkoutEligible: input.checkoutEligible ?? input.state === "complete_for_payment",
    priceUsd: input.priceUsd ?? 9.99,
    diagnostics: [],
    stateHistory: [{ state: input.state, at, reason: "created" }],
  };
}

function canStartCheckoutForAudit(audit: AuditLifecycleRecord) {
  return (
    audit.state === "complete_for_payment" &&
    audit.checkoutEligible &&
    audit.priceUsd === 9.99 &&
    !audit.payment
  );
}

export function assertCanStartCheckout(audit: AuditLifecycleRecord) {
  if (!canStartCheckoutForAudit(audit)) {
    throw new Error("Checkout can only start for complete_for_payment audits.");
  }
}

export function startCheckoutLifecycle(
  audit: AuditLifecycleRecord,
  checkoutSession: CheckoutSessionSummary,
  now = new Date(),
): AuditLifecycleRecord {
  assertCanStartCheckout(audit);
  const awaitingPayment = transitionAuditLifecycle(
    audit,
    "awaiting_payment",
    now,
    "checkout_started",
  );

  return {
    ...awaitingPayment,
    payment: {
      id: `payment_${randomUUID()}`,
      auditRequestId: audit.id,
      stripeCheckoutSessionId: checkoutSession.id,
      amountUsd: 9.99,
      status: "checkout_started",
      diagnosticContext: { checkoutUrlIssued: Boolean(checkoutSession.url) },
      createdAt: iso(now),
    },
  };
}

export function handleCheckoutReturn(audit: AuditLifecycleRecord) {
  return {
    auditRequestId: audit.id,
    state: audit.state,
    reportUnlocked: false,
    message:
      audit.state === "awaiting_payment"
        ? "Payment is being verified. The report unlocks only after Stripe sends a verified webhook."
        : "Audit status is unchanged by the checkout return URL.",
  };
}

export function handleVerifiedPayment(
  audit: AuditLifecycleRecord,
  payment: VerifiedCheckoutPayment,
  now = new Date(),
): { audit: AuditLifecycleRecord; job: QueuedAuditJob } {
  if (audit.id !== payment.auditRequestId) {
    throw new Error("Verified payment event does not match this audit request.");
  }
  if (audit.state !== "awaiting_payment") {
    throw new Error("Verified payment can only unlock an awaiting_payment audit.");
  }
  if (audit.payment?.status !== "checkout_started") {
    throw new Error("Verified payment requires a pending checkout payment.");
  }
  if (audit.payment.stripeCheckoutSessionId !== payment.stripeCheckoutSessionId) {
    throw new Error("Verified payment checkout session does not match the pending payment.");
  }

  const paid = transitionAuditLifecycle(audit, "paid", now, "stripe_webhook_verified");
  const generating = transitionAuditLifecycle(paid, "generating", now, "generation_enqueued");
  const paidAt = iso(now);

  const nextAudit = {
    ...generating,
    payment: {
      ...(audit.payment ?? {
        id: `payment_${randomUUID()}`,
        auditRequestId: audit.id,
        amountUsd: 9.99 as const,
        status: "checkout_started" as const,
        diagnosticContext: {},
        createdAt: paidAt,
      }),
      status: "paid" as const,
      stripeEventId: payment.stripeEventId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      webhookVerifiedAt: paidAt,
      diagnosticContext: {
        ...(audit.payment?.diagnosticContext ?? {}),
        sourceOfTruth: "stripe_webhook",
        eventType: payment.eventType,
      },
    },
  };

  return {
    audit: nextAudit,
    job: enqueueAuditGenerationJob(audit.id, now),
  };
}

export function markAuditReviewed(audit: AuditLifecycleRecord, now = new Date()) {
  if (audit.state !== "reviewing") {
    throw new Error("Only reviewing audits can be marked reviewed.");
  }

  return { ...audit, reviewedAt: iso(now) };
}

export function publishAuditReport(audit: AuditLifecycleRecord, now = new Date()) {
  return {
    ...transitionAuditLifecycle(audit, "published", now, "reviewed_report_published"),
    publishedAt: iso(now),
  };
}

export function transitionAuditLifecycle(
  audit: AuditLifecycleRecord,
  nextState: AuditJobState,
  now = new Date(),
  reason?: string,
): AuditLifecycleRecord {
  if (!canTransitionAuditJob(audit.state, nextState)) {
    throw new Error(`Invalid audit state transition from ${audit.state} to ${nextState}.`);
  }
  if (nextState === "published") {
    assertPublishable(audit);
  }

  return {
    ...audit,
    state: nextState,
    stateHistory: [...audit.stateHistory, { state: nextState, at: iso(now), reason }],
  };
}

function assertPublishable(audit: AuditLifecycleRecord) {
  if (audit.payment?.status !== "paid") {
    throw new Error("Audit reports cannot publish before verified payment.");
  }
  if (!audit.reviewedAt) {
    throw new Error("Audit reports cannot publish before reviewer approval.");
  }
}

function iso(now = new Date()) {
  return now.toISOString();
}
