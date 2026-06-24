import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { getCheckoutAuditState } from "@/server/audit/checkout-state";
import {
  type AuditLifecycleRecord,
  handleVerifiedPayment,
  type VerifiedCheckoutPayment,
} from "@/server/audit/lifecycle";
import { createDatabaseClient, type Database } from "@/server/db";
import { auditRequests, paymentEvents, payments } from "@/server/db/schema";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { buildVerifiedPaymentEventRecord } from "@/server/payments/stripe";

export type VerifiedPaymentEventRecord = ReturnType<typeof buildVerifiedPaymentEventRecord>;

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

export type PaymentApplicationStore = {
  hasProcessedStripeEvent: (stripeEventId: string) => Promise<boolean>;
  loadCheckoutAudit: (payment: VerifiedCheckoutPayment) => Promise<AuditLifecycleRecord | null>;
  saveAppliedPayment: (input: {
    audit: AuditLifecycleRecord;
    job: QueuedAuditJob;
    payment: VerifiedCheckoutPayment;
    paymentEvent: VerifiedPaymentEventRecord;
    verifiedAt: Date;
  }) => Promise<void>;
};

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

  await store.saveAppliedPayment({
    audit: applied.audit,
    job: applied.job,
    payment,
    paymentEvent,
    verifiedAt,
  });

  return {
    status: "applied",
    audit: applied.audit,
    job: applied.job,
    paymentEvent,
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
      await db.insert(paymentEvents).values({
        id: input.paymentEvent.id,
        auditRequestId: input.paymentEvent.auditRequestId,
        stripeEventId: input.paymentEvent.stripeEventId,
        stripeCheckoutSessionId: input.paymentEvent.stripeCheckoutSessionId,
        stripePaymentIntentId: input.paymentEvent.stripePaymentIntentId,
        eventType: input.paymentEvent.eventType,
        verifiedAt: input.verifiedAt,
        rawEvent: input.paymentEvent.rawEvent,
      });
      const updatePayment = db
        .update(payments)
        .set({
          stripePaymentIntentId: input.payment.stripePaymentIntentId,
          stripeEventId: input.payment.stripeEventId,
          status: "paid",
          webhookVerifiedAt: input.verifiedAt,
          diagnosticContext: input.audit.payment?.diagnosticContext ?? {},
        })
        .where(eq(payments.stripeCheckoutSessionId, input.payment.stripeCheckoutSessionId));
      const updateAuditRequest = db
        .update(auditRequests)
        .set({
          status: input.audit.state,
          updatedAt: input.verifiedAt,
        })
        .where(eq(auditRequests.id, input.audit.id));

      await Promise.all([updatePayment, updateAuditRequest]);
    },
  };
}
