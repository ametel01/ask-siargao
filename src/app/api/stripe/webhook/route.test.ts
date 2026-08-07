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
import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";
import {
  applyVerifiedCheckoutPayment,
  type PaymentApplicationStore,
  type VerifiedPaymentEventRecord,
} from "@/server/payments/webhook-application";

const now = new Date("2026-06-23T08:00:00.000Z");
const webhookSecret = "whsec_test_fixture_secret";
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.REDIS_URL;
const originalStripeRestrictedKey = process.env.STRIPE_RESTRICTED_KEY;
const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

describe("Stripe webhook route", () => {
  beforeEach(() => {
    process.env.STRIPE_RESTRICTED_KEY = "rk_test_fixture";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    restoreEnvValue("DATABASE_URL", originalDatabaseUrl);
    restoreEnvValue("NODE_ENV", originalNodeEnv);
    restoreEnvValue("REDIS_URL", originalRedisUrl);
    restoreEnvValue("STRIPE_RESTRICTED_KEY", originalStripeRestrictedKey);
    restoreEnvValue("STRIPE_WEBHOOK_SECRET", originalStripeWebhookSecret);
  });

  test("rejects unsigned requests before durable receipt", async () => {
    for (let index = 0; index < 41; index += 1) {
      const response = await POST(unsignedRequest());

      expect(response.status).toBe(400);
      expect(response.headers.get("x-ratelimit-limit")).toBeNull();
    }
  });

  test("does not rate limit verified webhook events before durable receipt", async () => {
    const dependencies = routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store);
    let response = await stripeWebhookResponse(await signedRequest(ignoredEventPayload()), {
      ...dependencies,
      receiveStripeWebhookEvent: async (event, options) => ({
        status: "applied",
        inboxId: `stripe_event_${event.id}`,
        stripeEventId: event.id,
        applicationResult: await options?.applyEvent?.(event, {
          db: undefined as never,
          now,
        }),
      }),
    });

    for (let index = 1; index < 45; index += 1) {
      response = await stripeWebhookResponse(
        await signedRequest(ignoredEventPayload({ eventId: `evt_ignored_${index}` })),
        {
          ...dependencies,
          receiveStripeWebhookEvent: async (event, options) => ({
            status: "applied",
            inboxId: `stripe_event_${event.id}`,
            stripeEventId: event.id,
            applicationResult: await options?.applyEvent?.(event, {
              db: undefined as never,
              now,
            }),
          }),
        },
      );
    }

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
  });

  test("does not require Redis-backed throttling after webhook verification", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.REDIS_URL = "redis://127.0.0.1:1/0";
    const store = createMemoryPaymentStore(pendingPaymentAudit());

    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ eventId: "evt_checkout_redis_down" })),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("applied");
    expect(body.stripeEventId).toBe("evt_checkout_redis_down");
    expect(store.paymentEvents).toHaveLength(1);
    expect(response.headers.get("x-ratelimit-limit")).toBeNull();
  });

  test("verified events acknowledge only after the inbox dependency reports durable receipt", async () => {
    delete process.env.DATABASE_URL;

    const response = await stripeWebhookResponse(
      await signedRequest(ignoredEventPayload({ eventId: "evt_durable_pending" })),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        receiveStripeWebhookEvent: async (event) => ({
          status: "blocked",
          inboxId: `stripe_event_${event.id}`,
          stripeEventId: event.id,
          reason: "unsupported_stripe_event_type",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      inboxStatus: "blocked",
      stripeEventId: "evt_durable_pending",
      inboxId: "stripe_event_evt_durable_pending",
      reason: "unsupported_stripe_event_type",
    });
  });

  test("does not start durable receipt until signature verification succeeds", async () => {
    const events: string[] = [];
    const verification = deferred<Stripe.Event>();
    const verificationStarted = deferred<void>();
    const responsePromise = stripeWebhookResponse(
      await signedRequest(ignoredEventPayload({ eventId: "evt_ordered_signature" })),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        verifyStripeWebhookPayload: async () => {
          events.push("verify:start");
          verificationStarted.resolve();
          return verification.promise;
        },
        receiveStripeWebhookEvent: async (event) => {
          events.push(`receive:${event.id}`);
          return {
            status: "blocked",
            inboxId: `stripe_event_${event.id}`,
            stripeEventId: event.id,
            reason: "unsupported_stripe_event_type",
          };
        },
      },
    );

    await verificationStarted.promise;
    expect(events).toEqual(["verify:start"]);

    verification.resolve(JSON.parse(ignoredEventPayload({ eventId: "evt_ordered_signature" })));
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(events).toEqual(["verify:start", "receive:evt_ordered_signature"]);
  });

  test("rejects oversized bodies before signature verification or durable receipt", async () => {
    const events: string[] = [];
    const response = await stripeWebhookResponse(
      new Request("https://siargao.test/api/stripe/webhook", {
        method: "POST",
        headers: {
          "content-length": "262145",
          "stripe-signature": "t=1,v1=not-real",
        },
        body: "{}",
      }),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        verifyStripeWebhookPayload: async () => {
          events.push("verify");
          throw new Error("verification should not start for oversized payloads");
        },
        receiveStripeWebhookEvent: async (event) => {
          events.push(`receive:${event.id}`);
          return {
            status: "received",
            inboxId: `stripe_event_${event.id}`,
            stripeEventId: event.id,
            normalized: JSON.parse("{}"),
          };
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({
      error: "stripe_webhook_body_too_large",
      message: "Webhook payload exceeds the configured size limit.",
    });
    expect(events).toEqual([]);
  });

  test("dispatches handled Trip Pass events before audit payment application", async () => {
    const events: string[] = [];
    const response = await stripeWebhookResponse(
      await signedRequest(ignoredEventPayload({ eventId: "evt_trip_pass_dispatch" })),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        applyTripPassStripeEvent: async () => ({
          status: "applied",
          action: "activated",
          orderId: "order_trip_pass_dispatch",
          stripeEventId: "evt_trip_pass_dispatch",
        }),
        applyVerifiedCheckoutPayment: async () => {
          throw new Error("audit path should not handle applied Trip Pass events");
        },
        trackServerEvent: (event) => {
          events.push(event.name);
          return {
            name: event.name,
            at: now.toISOString(),
            payload: event.payload,
            sinks: {
              posthogConfigured: false,
              sentryConfigured: false,
            },
          };
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      product: "trip_pass",
      applicationStatus: "applied",
      action: "activated",
      orderId: "order_trip_pass_dispatch",
      stripeEventId: "evt_trip_pass_dispatch",
    });
    expect(events).toEqual([
      "trip_pass_stripe_event_applied",
      "trip_pass_activated",
      "trip_pass_checkout_completed",
    ]);
  });

  test("does not inflate Trip Pass activation telemetry for duplicate webhook delivery", async () => {
    const events: string[] = [];
    const response = await stripeWebhookResponse(
      await signedRequest(ignoredEventPayload({ eventId: "evt_trip_pass_duplicate" })),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        applyTripPassStripeEvent: async () => ({
          status: "duplicate",
          orderId: "order_trip_pass_duplicate",
          stripeEventId: "evt_trip_pass_duplicate",
        }),
        trackServerEvent: (event) => {
          events.push(event.name);
          return {
            name: event.name,
            at: now.toISOString(),
            payload: event.payload,
            sinks: {
              posthogConfigured: false,
              sentryConfigured: false,
            },
          };
        },
      },
    );

    expect(response.status).toBe(200);
    expect(events).toEqual(["trip_pass_stripe_event_applied"]);
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
    expect(store.paymentEvents[0]?.rawEvent).toEqual({
      stripeEventId: "evt_test_checkout_completed",
      eventType: "checkout.session.completed",
      stripeApiVersion: STRIPE_API_VERSION,
      objectType: "checkout.session",
    });
    expect(JSON.stringify(store.paymentEvents[0]?.rawEvent)).not.toContain("data");
    expect(JSON.stringify(store.paymentEvents[0]?.rawEvent)).not.toContain("metadata");
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

  test("treats duplicate event persistence races as idempotent", async () => {
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload()),
      routeDependencies({
        hasProcessedStripeEvent: async () => false,
        loadCheckoutAudit: async () => pendingPaymentAudit(),
        saveAppliedPayment: async () => "duplicate",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("duplicate");
    expect(body.generationJobId).toBeUndefined();
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

  test("rejects checkout audit id mismatches", async () => {
    const store = createMemoryPaymentStore({
      ...pendingPaymentAudit(),
      id: "audit_other",
    });
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload()),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_stripe_webhook");
    expect(store.jobs).toHaveLength(0);
    expect(store.paymentEvents).toHaveLength(0);
  });

  test("rejects paid events without pending checkout state", async () => {
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload()),
      routeDependencies({
        hasProcessedStripeEvent: async () => false,
        loadCheckoutAudit: async () => null,
        saveAppliedPayment: async () => {
          throw new Error("save should not run without pending checkout state.");
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_stripe_webhook");
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

  test("does not expose Stripe verification exception text", async () => {
    const internalPhrase = "fixture_should_not_render_stripe_verification";
    const response = await stripeWebhookResponse(
      new Request("https://siargao.test/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=not-real" },
        body: ignoredEventPayload(),
      }),
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        verifyStripeWebhookPayload: async () => {
          throw new Error(`signature parser failed ${internalPhrase}`);
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_stripe_webhook",
      message: "Webhook verification failed.",
    });
    expect(JSON.stringify(body)).not.toContain(internalPhrase);
  });

  test("does not expose Stripe application exception text", async () => {
    const internalPhrase = "fixture_should_not_render_stripe_application";
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ eventId: "evt_application_error" })),
      routeDependencies({
        hasProcessedStripeEvent: async () => false,
        loadCheckoutAudit: async () => pendingPaymentAudit(),
        saveAppliedPayment: async () => {
          throw new Error(`payment persistence failed ${internalPhrase}`);
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_stripe_webhook",
      message: "Webhook verification failed.",
    });
    expect(JSON.stringify(body)).not.toContain(internalPhrase);
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
    applyTripPassStripeEvent: async () => ({ status: "ignored", reason: "not_trip_pass_event" }),
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
    receiveStripeWebhookEvent: async (event, options) => ({
      status: "applied",
      inboxId: `stripe_event_${event.id}`,
      stripeEventId: event.id,
      applicationResult: await options?.applyEvent?.(event, {
        db: undefined as never,
        now,
      }),
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
      return "saved";
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
    api_version: STRIPE_API_VERSION,
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
    api_version: STRIPE_API_VERSION,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
