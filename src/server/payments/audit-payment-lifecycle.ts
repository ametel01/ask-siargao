import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import {
  type CheckoutAuditStateReader,
  getCheckoutAuditState,
  recordCheckoutStarted,
} from "@/server/audit/checkout-state";
import {
  type AuditLifecycleRecord,
  assertCanStartCheckout,
  handleVerifiedPayment,
  startCheckoutLifecycle,
  type VerifiedCheckoutPayment,
} from "@/server/audit/lifecycle";
import { createDatabaseClient, type Database } from "@/server/db";
import { auditRequests, paymentEvents, payments } from "@/server/db/schema";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { trackServerEvent } from "@/server/observability/events";
import {
  buildVerifiedPaymentEventRecord,
  createCheckoutSessionForAudit,
} from "@/server/payments/stripe";

export type VerifiedPaymentEventRecord = ReturnType<typeof buildVerifiedPaymentEventRecord>;

export type StartedAuditCheckoutPayment = {
  status: "started";
  audit: AuditLifecycleRecord;
  checkout: Awaited<ReturnType<typeof createCheckoutSessionForAudit>>;
};

export type MissingAuditCheckoutPayment = {
  status: "not_found";
  auditRequestId: string;
};

export type StartAuditCheckoutPaymentResult =
  | StartedAuditCheckoutPayment
  | MissingAuditCheckoutPayment;

export type CheckoutPaymentLifecycleStore = {
  loadCheckoutAudit: CheckoutAuditStateReader;
  saveCheckoutStarted: typeof recordCheckoutStarted;
};

export type AppliedVerifiedPayment = {
  status: "applied";
  audit: AuditLifecycleRecord;
  job: QueuedAuditJob;
  paymentEvent: VerifiedPaymentEventRecord;
};

export type DuplicateVerifiedPayment = {
  status: "duplicate";
  auditRequestId: string;
  stripeEventId: string;
};

export type ApplyVerifiedCheckoutPaymentResult = AppliedVerifiedPayment | DuplicateVerifiedPayment;

export type PaymentApplicationSaveResult = "saved" | "duplicate";

export type PaymentApplicationStore = {
  hasProcessedStripeEvent: (stripeEventId: string) => Promise<boolean>;
  loadCheckoutAudit: (payment: VerifiedCheckoutPayment) => Promise<AuditLifecycleRecord | null>;
  saveAppliedPayment: (input: {
    audit: AuditLifecycleRecord;
    job: QueuedAuditJob;
    payment: VerifiedCheckoutPayment;
    paymentEvent: VerifiedPaymentEventRecord;
    verifiedAt: Date;
  }) => Promise<PaymentApplicationSaveResult>;
};

export async function startAuditCheckoutPaymentLifecycle(
  input: {
    auditRequestId: string;
    appUrl: string;
    customerEmail?: string;
  },
  options: {
    store?: CheckoutPaymentLifecycleStore;
    createCheckoutSessionForAudit?: typeof createCheckoutSessionForAudit;
    trackServerEvent?: typeof trackServerEvent;
    now?: Date;
  } = {},
): Promise<StartAuditCheckoutPaymentResult> {
  const store = options.store ?? createDatabaseCheckoutPaymentLifecycleStore();
  const audit = await store.loadCheckoutAudit(input.auditRequestId);

  if (!audit) {
    return {
      status: "not_found",
      auditRequestId: input.auditRequestId,
    };
  }

  assertCanStartCheckout(audit);

  const checkout = await (options.createCheckoutSessionForAudit ?? createCheckoutSessionForAudit)({
    audit,
    appUrl: input.appUrl,
    customerEmail: input.customerEmail,
  });
  const nextAudit = startCheckoutLifecycle(audit, checkout, options.now);

  await store.saveCheckoutStarted(nextAudit);
  (options.trackServerEvent ?? trackServerEvent)({
    name: "preview_to_payment_started",
    payload: {
      auditRequestId: nextAudit.id,
      state: nextAudit.state,
    },
  });

  return {
    status: "started",
    audit: nextAudit,
    checkout,
  };
}

export async function applyVerifiedCheckoutPayment(
  payment: VerifiedCheckoutPayment,
  rawEvent: Stripe.Event,
  options: {
    store?: PaymentApplicationStore;
    now?: Date;
  } = {},
): Promise<ApplyVerifiedCheckoutPaymentResult> {
  const store = options.store ?? createDatabasePaymentApplicationStore();
  const verifiedAt = options.now ?? new Date();

  if (await store.hasProcessedStripeEvent(payment.stripeEventId)) {
    return {
      status: "duplicate",
      auditRequestId: payment.auditRequestId,
      stripeEventId: payment.stripeEventId,
    };
  }

  const audit = await store.loadCheckoutAudit(payment);
  if (!audit) {
    throw new Error("No pending checkout payment was found for this Stripe event.");
  }

  const applied = handleVerifiedPayment(audit, payment, verifiedAt);
  const paymentEvent = buildVerifiedPaymentEventRecord({
    payment,
    rawEvent,
    verifiedAt,
  });

  const saveResult = await store.saveAppliedPayment({
    audit: applied.audit,
    job: applied.job,
    payment,
    paymentEvent,
    verifiedAt,
  });

  if (saveResult === "duplicate") {
    return {
      status: "duplicate",
      auditRequestId: payment.auditRequestId,
      stripeEventId: payment.stripeEventId,
    };
  }

  return {
    status: "applied",
    audit: applied.audit,
    job: applied.job,
    paymentEvent,
  };
}

function createDatabaseCheckoutPaymentLifecycleStore(): CheckoutPaymentLifecycleStore {
  return {
    loadCheckoutAudit: getCheckoutAuditState,
    saveCheckoutStarted: recordCheckoutStarted,
  };
}

function createDatabasePaymentApplicationStore(
  db: Database = createDatabaseClient(),
): PaymentApplicationStore {
  return {
    async hasProcessedStripeEvent(stripeEventId) {
      const rows = await db
        .select({ id: paymentEvents.id })
        .from(paymentEvents)
        .where(eq(paymentEvents.stripeEventId, stripeEventId))
        .limit(1);

      return rows.length > 0;
    },
    async loadCheckoutAudit(payment) {
      const audit = await getCheckoutAuditState(payment.auditRequestId, db);
      if (!audit) {
        return null;
      }
      if (audit.payment?.stripeCheckoutSessionId !== payment.stripeCheckoutSessionId) {
        throw new Error("Verified payment checkout session does not match the pending payment.");
      }

      return audit;
    },
    async saveAppliedPayment(input) {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(paymentEvents).values({
            id: input.paymentEvent.id,
            auditRequestId: input.paymentEvent.auditRequestId,
            stripeEventId: input.paymentEvent.stripeEventId,
            stripeCheckoutSessionId: input.paymentEvent.stripeCheckoutSessionId,
            stripePaymentIntentId: input.paymentEvent.stripePaymentIntentId,
            eventType: input.paymentEvent.eventType,
            verifiedAt: input.verifiedAt,
            rawEvent: input.paymentEvent.rawEvent,
          });
          await tx
            .update(payments)
            .set({
              stripePaymentIntentId: input.payment.stripePaymentIntentId,
              stripeEventId: input.payment.stripeEventId,
              status: "paid",
              webhookVerifiedAt: input.verifiedAt,
              diagnosticContext: input.audit.payment?.diagnosticContext ?? {},
            })
            .where(eq(payments.stripeCheckoutSessionId, input.payment.stripeCheckoutSessionId));
          await tx
            .update(auditRequests)
            .set({
              status: input.audit.state,
              updatedAt: input.verifiedAt,
            })
            .where(eq(auditRequests.id, input.audit.id));
        });
      } catch (error) {
        if (isDuplicateStripeEventPersistenceError(error)) {
          return "duplicate";
        }

        throw error;
      }

      return "saved";
    },
  };
}

function isDuplicateStripeEventPersistenceError(error: unknown) {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const constraint = typeof candidate.constraint === "string" ? candidate.constraint : "";

  return (
    candidate.code === "23505" &&
    (constraint.includes("payment_events") ||
      constraint.includes("stripe_event") ||
      (message.includes("payment_events") && message.includes("stripe_event")))
  );
}
