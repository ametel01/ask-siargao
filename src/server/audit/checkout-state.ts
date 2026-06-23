import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auditJobStates } from "@/server/audit/enums";
import {
  type AuditLifecycleRecord,
  type PaymentStatus,
  createAuditLifecycleRecord,
} from "@/server/audit/lifecycle";
import { type Database, createDatabaseClient } from "@/server/db";
import { auditCompletenessChecks, auditRequests, payments } from "@/server/db/schema";

const paymentStatusSchema = z.enum(["not_started", "checkout_started", "paid", "failed"]);
const auditJobStateSchema = z.enum(auditJobStates);

export type CheckoutAuditStateReader = (
  auditRequestId: string,
) => Promise<AuditLifecycleRecord | null>;

export async function recordCheckoutStarted(
  audit: AuditLifecycleRecord,
  db: Database = createDatabaseClient(),
) {
  if (!audit.payment) {
    throw new Error("A checkout payment record is required before persisting checkout state.");
  }

  await db.insert(payments).values({
    id: audit.payment.id,
    auditRequestId: audit.payment.auditRequestId,
    stripeCheckoutSessionId: audit.payment.stripeCheckoutSessionId,
    amountUsd: "9.99",
    status: audit.payment.status,
    diagnosticContext: audit.payment.diagnosticContext,
    createdAt: new Date(audit.payment.createdAt),
  });
  await db
    .update(auditRequests)
    .set({
      status: audit.state,
      updatedAt: new Date(),
    })
    .where(eq(auditRequests.id, audit.id));
}

export async function getCheckoutAuditState(
  auditRequestId: string,
  db: Database = createDatabaseClient(),
): Promise<AuditLifecycleRecord | null> {
  const auditRows = await db
    .select({
      id: auditRequests.id,
      status: auditRequests.status,
      priceUsd: auditRequests.priceUsd,
    })
    .from(auditRequests)
    .where(eq(auditRequests.id, auditRequestId))
    .limit(1);
  const auditRow = auditRows[0];

  if (!auditRow) {
    return null;
  }

  const completenessRows = await db
    .select({
      canComplete: auditCompletenessChecks.canComplete,
    })
    .from(auditCompletenessChecks)
    .where(eq(auditCompletenessChecks.auditRequestId, auditRequestId))
    .orderBy(desc(auditCompletenessChecks.checkedAt))
    .limit(1);
  const paymentRows = await db
    .select({
      id: payments.id,
      auditRequestId: payments.auditRequestId,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeEventId: payments.stripeEventId,
      status: payments.status,
      webhookVerifiedAt: payments.webhookVerifiedAt,
      diagnosticContext: payments.diagnosticContext,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.auditRequestId, auditRequestId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const paymentRow = paymentRows[0];
  const paymentStatus = paymentRow ? paymentStatusSchema.parse(paymentRow.status) : undefined;
  const audit = createAuditLifecycleRecord({
    id: auditRow.id,
    state: deriveCheckoutState(auditJobStateSchema.parse(auditRow.status), paymentStatus),
    checkoutEligible: completenessRows[0]?.canComplete ?? false,
  });

  return {
    ...audit,
    payment: paymentRow
      ? {
          id: paymentRow.id,
          auditRequestId: paymentRow.auditRequestId,
          stripeCheckoutSessionId: paymentRow.stripeCheckoutSessionId ?? undefined,
          stripePaymentIntentId: paymentRow.stripePaymentIntentId ?? undefined,
          stripeEventId: paymentRow.stripeEventId ?? undefined,
          amountUsd: 9.99,
          status: paymentStatusSchema.parse(paymentRow.status),
          webhookVerifiedAt: paymentRow.webhookVerifiedAt?.toISOString(),
          diagnosticContext: paymentRow.diagnosticContext,
          createdAt: paymentRow.createdAt.toISOString(),
        }
      : undefined,
  };
}

function deriveCheckoutState(
  storedState: AuditLifecycleRecord["state"],
  paymentStatus?: PaymentStatus,
): AuditLifecycleRecord["state"] {
  if (paymentStatus === "checkout_started") {
    return "awaiting_payment";
  }
  if (paymentStatus === "paid") {
    return "paid";
  }

  return storedState;
}
