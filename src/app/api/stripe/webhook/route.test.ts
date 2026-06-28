import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Stripe from "stripe";

import { POST } from "@/app/api/stripe/webhook/route";
import { stripeWebhookResponse } from "@/app/api/stripe/webhook/webhook-route";
import {
  type AuditLifecycleRecord,
  createAuditLifecycleRecord,
  startCheckoutLifecycle,
} from "@/server/audit/lifecycle";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";
import {
  applyVerifiedCheckoutPayment,
  type PaymentApplicationStore,
  type VerifiedPaymentEventRecord,
} from "@/server/payments/webhook-application";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

const now = new Date("2026-06-23T08:00:00.000Z");
const webhookSecret = "whsec_test_fixture_secret";
const originalStripeRestrictedKey = process.env.STRIPE_RESTRICTED_KEY;
const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

describe("Stripe webhook route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
    process.env.STRIPE_RESTRICTED_KEY = "rk_test_fixture";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    resetRateLimitStoreForTests();
    restoreEnvValue("STRIPE_RESTRICTED_KEY", originalStripeRestrictedKey);
    restoreEnvValue("STRIPE_WEBHOOK_SECRET", originalStripeWebhookSecret);
  });

  test("does not let unsigned requests exhaust the verified webhook rate limit", async () => {
    for (let index = 0; index < 41; index += 1) {
      const response = await POST(unsignedRequest());

      expect(response.status).toBe(400);
      expect(response.headers.get("x-ratelimit-limit")).toBeNull();
    }

    const signedResponse = await POST(await signedRequest(ignoredEventPayload()));
    const signedBody = await signedResponse.json();

    expect(signedResponse.status).toBe(200);
    expect(signedBody).toEqual({ received: true, ignored: true });
  });

  test("rate limits verified webhook events", async () => {
    let response = await POST(await signedRequest(ignoredEventPayload()));

    for (let index = 1; index < 41; index += 1) {
      response = await POST(
        await signedRequest(ignoredEventPayload({ eventId: `evt_ignored_${index}` })),
      );
    }

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });

  test("applies valid paid checkout events and enqueues generation", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(await signedRequest(checkoutSessionPayload()), {
      ...routeDependencies(store.store),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("applied");
    expect(store.audit.state).toBe("generating");
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]?.kind).toBe("generate_audit");
    expect(store.paymentEvents).toHaveLength(1);
  });

  test("treats duplicate Stripe events as idempotent", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const dependencies = routeDependencies(store.store);

    await stripeWebhookResponse(await signedRequest(checkoutSessionPayload()), dependencies);
    const duplicateResponse = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload()),
      dependencies,
    );
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody.applicationStatus).toBe("duplicate");
    expect(store.jobs).toHaveLength(1);
    expect(store.paymentEvents).toHaveLength(1);
  });

  test("rejects checkout session mismatches", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ checkoutSessionId: "cs_wrong" })),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_stripe_webhook");
    expect(store.jobs).toHaveLength(0);
    expect(store.paymentEvents).toHaveLength(0);
  });

  test("ignores non-paid checkout sessions", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ paymentStatus: "unpaid" })),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, ignored: true });
    expect(store.jobs).toHaveLength(0);
  });

  test("rejects invalid signatures", async () => {
    const response = await stripeWebhookResponse(
      new Request("https://siargao.test/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=not-real" },
        body: checkoutSessionPayload(),
      }),
      routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_stripe_webhook");
  });

  test("rejects missing signatures", async () => {
    const response = await stripeWebhookResponse(
      new Request("https://siargao.test/api/stripe/webhook", {
        method: "POST",
        body: checkoutSessionPayload(),
      }),
      routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("missing_stripe_signature");
  });
});

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function routeDependencies(store: PaymentApplicationStore) {
  return {
    applyVerifiedCheckoutPayment: (payment, rawEvent) =>
      applyVerifiedCheckoutPayment(payment, rawEvent, { store, now }),
    stripeWebhookSecretFromEnv: () => webhookSecret,
    trackServerEvent: (event) => ({
      name: event.name,
      at: now.toISOString(),
      payload: event.payload,
      sinks: {
        posthogConfigured: false,
        sentryConfigured: false,
      },
    }),
    verifyStripeWebhookPayload: (input) =>
      verifyStripeWebhookPayload({
        ...input,
        stripe: new Stripe("rk_test_fixture"),
      }),
  } satisfies Parameters<typeof stripeWebhookResponse>[1];
}

function createMemoryPaymentStore(initialAudit: AuditLifecycleRecord) {
  const processedStripeEventIds = new Set<string>();
  const paymentEvents: VerifiedPaymentEventRecord[] = [];
  const jobs: QueuedAuditJob[] = [];
  let audit = initialAudit;
  const store: PaymentApplicationStore = {
    hasProcessedStripeEvent: async (stripeEventId) => processedStripeEventIds.has(stripeEventId),
    loadCheckoutAudit: async () => audit,
    saveAppliedPayment: async (input) => {
      processedStripeEventIds.add(input.payment.stripeEventId);
      audit = input.audit;
      jobs.push(input.job);
      paymentEvents.push(input.paymentEvent);
    },
  };

  return {
    get audit() {
      return audit;
    },
    jobs,
    paymentEvents,
    store,
  };
}

function pendingPaymentAudit() {
  return startCheckoutLifecycle(
    createAuditLifecycleRecord({
      id: "audit_123",
      state: "complete_for_payment",
      checkoutEligible: true,
      now,
    }),
    { id: "cs_test_123", url: "https://checkout.stripe.test/session" },
    now,
  );
}

async function signedRequest(payload: string) {
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: webhookSecret,
  });

  return new Request("https://siargao.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

function unsignedRequest() {
  return new Request("https://siargao.test/api/stripe/webhook", {
    method: "POST",
    body: ignoredEventPayload(),
  });
}

function checkoutSessionPayload(
  input: { checkoutSessionId?: string; eventId?: string; paymentStatus?: "paid" | "unpaid" } = {},
) {
  return JSON.stringify({
    id: input.eventId ?? "evt_test_checkout_completed",
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: 1_782_194_400,
    data: {
      object: {
        id: input.checkoutSessionId ?? "cs_test_123",
        object: "checkout.session",
        client_reference_id: "audit_123",
        metadata: { auditRequestId: "audit_123" },
        mode: "payment",
        payment_intent: "pi_test_123",
        payment_status: input.paymentStatus ?? "paid",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  });
}

function ignoredEventPayload(input: { eventId?: string } = {}) {
  return JSON.stringify({
    id: input.eventId ?? "evt_test_ignored",
    object: "event",
    api_version: "2026-05-27.dahlia",
    created: 1_782_194_400,
    data: {
      object: {
        id: "cus_test_123",
        object: "customer",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.created",
  });
}
