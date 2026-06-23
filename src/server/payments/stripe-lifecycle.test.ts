import { describe, expect, test } from "bun:test";
import Stripe from "stripe";

import {
  createAuditLifecycleRecord,
  handleCheckoutReturn,
  handleVerifiedPayment,
  markAuditReviewed,
  publishAuditReport,
  startCheckoutLifecycle,
  transitionAuditLifecycle,
} from "@/server/audit/lifecycle";
import { recordAuditJobFailure, runAuditJob } from "@/server/jobs/audit-jobs";
import {
  AUDIT_PRICE_CENTS,
  buildAuditCheckoutSessionParams,
  buildVerifiedPaymentEventRecord,
  extractVerifiedCheckoutPayment,
  verifyStripeWebhookPayload,
} from "@/server/payments/stripe";

const now = new Date("2026-06-23T08:00:00.000Z");
const webhookSecret = "whsec_test_fixture_secret";

function completeAudit() {
  return createAuditLifecycleRecord({
    id: "audit_123",
    state: "complete_for_payment",
    checkoutEligible: true,
    now,
  });
}

function pendingPaymentAudit() {
  return startCheckoutLifecycle(
    completeAudit(),
    { id: "cs_test_123", url: "https://checkout.stripe.test/session" },
    now,
  );
}

function checkoutSessionCompletedPayload() {
  return JSON.stringify({
    id: "evt_test_checkout_completed",
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: 1_782_194_400,
    data: {
      object: {
        id: "cs_test_123",
        object: "checkout.session",
        client_reference_id: "audit_123",
        metadata: { auditRequestId: "audit_123" },
        mode: "payment",
        payment_intent: "pi_test_123",
        payment_status: "paid",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  });
}

describe("Stripe checkout gating", () => {
  test("builds a USD 9.99 Checkout Session only for complete audits", () => {
    const params = buildAuditCheckoutSessionParams({
      audit: completeAudit(),
      appUrl: "https://siargao.test/",
      customerEmail: "traveler@example.com",
    });

    expect(params.mode).toBe("payment");
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(AUDIT_PRICE_CENTS);
    expect(params.line_items?.[0]?.price_data?.currency).toBe("usd");
    expect(params.success_url).toBe("https://siargao.test/audits/audit_123/status?checkout=return");
    expect("payment_method_types" in params).toBe(false);
  });

  test("blocks checkout for incomplete, blocked, or below-threshold audits", () => {
    const incomplete = createAuditLifecycleRecord({
      id: "audit_incomplete",
      state: "needs_user_input",
      checkoutEligible: false,
      now,
    });
    const blocked = createAuditLifecycleRecord({
      id: "audit_blocked",
      state: "blocked",
      checkoutEligible: true,
      now,
    });
    const belowThreshold = createAuditLifecycleRecord({
      id: "audit_low_confidence",
      state: "complete_for_payment",
      checkoutEligible: false,
      now,
    });

    for (const audit of [incomplete, blocked, belowThreshold]) {
      expect(() =>
        buildAuditCheckoutSessionParams({
          audit,
          appUrl: "https://siargao.test",
        }),
      ).toThrow("Checkout can only start");
    }
  });

  test("does not unlock reports from the checkout return URL alone", () => {
    const audit = pendingPaymentAudit();
    const status = handleCheckoutReturn(audit);

    expect(status.reportUnlocked).toBe(false);
    expect(status.state).toBe("awaiting_payment");
    expect(status.message).toContain("verified webhook");
  });
});

describe("Stripe webhook unlock", () => {
  test("verifies fixture payload signatures and enqueues generation after payment", async () => {
    const payload = checkoutSessionCompletedPayload();
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: webhookSecret,
    });
    const event = await verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret,
      stripe: new Stripe("rk_test_fixture"),
    });
    const payment = extractVerifiedCheckoutPayment(event);

    expect(payment).not.toBeNull();
    if (!payment) {
      throw new Error("Expected verified payment fixture.");
    }

    const result = handleVerifiedPayment(pendingPaymentAudit(), payment, now);
    const eventRecord = buildVerifiedPaymentEventRecord({
      payment,
      rawEvent: event,
      verifiedAt: now,
    });

    expect(result.audit.state).toBe("generating");
    expect(result.audit.payment?.status).toBe("paid");
    expect(result.audit.payment?.stripeEventId).toBe("evt_test_checkout_completed");
    expect(result.job.kind).toBe("generate_audit");
    expect(eventRecord.auditRequestId).toBe("audit_123");
    expect(eventRecord.stripeCheckoutSessionId).toBe("cs_test_123");
  });

  test("rejects invalid webhook signatures", async () => {
    await expect(
      verifyStripeWebhookPayload({
        payload: checkoutSessionCompletedPayload(),
        signature: "t=1,v1=not-real",
        webhookSecret,
        stripe: new Stripe("rk_test_fixture"),
      }),
    ).rejects.toThrow();
  });
});

describe("audit job states", () => {
  test("prevents impossible publication states", () => {
    const unpaidReviewing = createAuditLifecycleRecord({
      id: "audit_unpaid",
      state: "reviewing",
      checkoutEligible: true,
      now,
    });

    expect(() => publishAuditReport(unpaidReviewing, now)).toThrow("verified payment");

    const paidGenerating = handleVerifiedPayment(
      pendingPaymentAudit(),
      verifiedPayment(),
      now,
    ).audit;
    const reviewing = transitionAuditLifecycle(paidGenerating, "reviewing", now, "generated");

    expect(() => publishAuditReport(reviewing, now)).toThrow("reviewer approval");
    expect(publishAuditReport(markAuditReviewed(reviewing, now), now).state).toBe("published");
  });

  test("runs generation, reviewer, and publication jobs in order", async () => {
    const paid = handleVerifiedPayment(pendingPaymentAudit(), verifiedPayment(), now);
    const generated = await runAuditJob(
      paid.job,
      {
        generateAudit: async () => {},
        reviewAudit: async () => {},
        publishReport: async () => {},
      },
      now,
    );
    const reviewed = await runAuditJob(
      generated.nextJob ?? missingJob(),
      {
        generateAudit: async () => {},
        reviewAudit: async () => {},
        publishReport: async () => {},
      },
      now,
    );

    expect(generated.job.state).toBe("succeeded");
    expect(generated.nextJob?.kind).toBe("review_audit");
    expect(reviewed.nextJob?.kind).toBe("publish_report");
  });

  test("preserves diagnostic context when a background job fails", () => {
    const job = recordAuditJobFailure(
      {
        id: "job_generate",
        auditRequestId: "audit_123",
        kind: "generate_audit",
        state: "running",
        attempts: 2,
        maxAttempts: 3,
        queuedAt: now.toISOString(),
        diagnostics: [],
      },
      new Error("provider timeout"),
      now,
    );

    expect(job.state).toBe("failed");
    expect(job.lastError).toBe("provider timeout");
    expect(job.diagnostics[0]?.context?.retryable).toBe(true);
    expect(job.diagnostics[0]?.context?.attempts).toBe(2);
  });
});

function verifiedPayment() {
  return {
    auditRequestId: "audit_123",
    stripeEventId: "evt_test_checkout_completed",
    stripeCheckoutSessionId: "cs_test_123",
    stripePaymentIntentId: "pi_test_123",
    eventType: "checkout.session.completed",
  };
}

function missingJob(): never {
  throw new Error("Expected next job.");
}
