import {
  type CheckoutAuditStateReader,
  getCheckoutAuditState,
  recordCheckoutStarted,
} from "@/server/audit/checkout-state";
import {
  type AuditLifecycleRecord,
  assertCanStartCheckout,
  startCheckoutLifecycle,
  type VerifiedCheckoutPayment,
} from "@/server/audit/lifecycle";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { trackServerEvent } from "@/server/observability/events";
import {
  type buildVerifiedPaymentEventRecord,
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

function createDatabaseCheckoutPaymentLifecycleStore(): CheckoutPaymentLifecycleStore {
  return {
    loadCheckoutAudit: getCheckoutAuditState,
    saveCheckoutStarted: recordCheckoutStarted,
  };
}
