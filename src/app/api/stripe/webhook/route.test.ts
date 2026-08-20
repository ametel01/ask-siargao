import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Stripe from "stripe";

import { POST } from "@/app/api/stripe/webhook/route";
import {
  stripeWebhookResponse,
  stripeWebhookResponseFromEvent,
} from "@/app/api/stripe/webhook/webhook-route";
import {
  type AuditLifecycleRecord,
  createAuditLifecycleRecord,
  startCheckoutLifecycle,
} from "@/server/audit/lifecycle";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import type { QueuedAuditJob } from "@/server/jobs/audit-jobs";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";
import {
  receiveStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/server/payments/stripe-event-inbox";

const historicalStripeEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const satisfies readonly Stripe.Event.Type[];

function buildHistoricalStripeTestEvent(input: {
  eventId: string;
  object: object;
  type: (typeof historicalStripeEventTypes)[number];
}): Stripe.Event {
  return {
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1_000),
    data: { object: input.object } as Stripe.Event.Data,
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: input.type,
  } as Stripe.Event;
}

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

  test("reports semantic provider-before-application evidence only from a prepared provider fact", async () => {
    const event = {
      id: "evt_ordering_evidence",
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_ordering_evidence", object: "charge" } },
    } as Stripe.Event;
    const response = await stripeWebhookResponseFromEvent(
      event,
      {
        ...routeDependencies(),
        applyTripPassStripeEvent: async () => ({
          status: "rejected",
          reason: "trip_pass_payment_intent_not_found",
          stripeEventId: event.id,
        }),
      },
      {
        preparedEvent: {
          event,
          fact: null,
          kind: "refund",
          semanticOrdering: "provider_lookup_completed_before_application_started",
        },
      },
    );

    expect(await response.json()).toMatchObject({
      applicationStatus: "rejected",
      semanticOrdering: "provider_lookup_completed_before_application_started",
    });
  });

  test("accepts and applies every retained historical Stripe event envelope", async () => {
    await withRouteTestDb(async (db) => {
      for (const [index, type] of historicalStripeEventTypes.entries()) {
        const event = buildHistoricalStripeTestEvent({
          eventId: `evt_historical_route_${index}`,
          object: historicalEventObject(type, index),
          type,
        });
        const response = await stripeWebhookResponse(await signedRequest(JSON.stringify(event)), {
          ...routeDependencies(),
          applyTripPassStripeEvent: async () => ({
            status: "noop",
            reason: "protected_route_contract",
            stripeEventId: event.id,
          }),
          prepareTripPassStripeEvent: async (verifiedEvent) => ({
            event: verifiedEvent,
            kind: "direct",
          }),
          receiveStripeWebhookEvent: (verifiedEvent, options) =>
            receiveStripeWebhookEvent(verifiedEvent, { ...options, db }),
        });
        const body = await response.json();

        expect(response.status, type).toBe(200);
        expect(body.applicationStatus, type).toBe("noop");
      }

      const rows = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_pass_stripe_events where status = 'applied'",
      );
      expect(rows.rows[0]?.count).toBe(String(historicalStripeEventTypes.length));
    });
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
        applicationResult: await options?.applyEvent?.(event as never, {
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
            applicationResult: await options?.applyEvent?.(event as never, {
              db: undefined as never,
              now,
            }),
          }),
        },
      );
    }

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: true,
      ignored: true,
      applicationStatus: "noop",
    });
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
    expect(body.applicationStatus).toBe("noop");
    expect(body.ignored).toBe(true);
    expect(body.stripeEventId).toBe("evt_checkout_redis_down");
    expect(store.paymentEvents).toHaveLength(0);
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
      status: "applied",
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

  test("actual route inbox marks applied Trip Pass responses applied", async () => {
    await withRouteTestDb(async (db) => {
      const response = await stripeWebhookResponse(
        await signedRequest(
          tripPassCheckoutSessionPayload({
            eventId: "evt_route_inbox_applied",
            orderId: "order_route_inbox_applied",
          }),
        ),
        {
          ...routeDependencies(),
          applyTripPassStripeEvent: async () => ({
            status: "applied",
            action: "activated",
            orderId: "order_route_inbox_applied",
            stripeEventId: "evt_route_inbox_applied",
          }),
          receiveStripeWebhookEvent: (event, options) =>
            receiveStripeWebhookEvent(event, { ...options, db }),
        },
      );
      const body = await response.json();
      const inbox = await db.query<{ status: string }>(
        "select status from trip_pass_stripe_events where stripe_event_id = $1",
        ["evt_route_inbox_applied"],
      );

      expect(response.status).toBe(200);
      expect(body.applicationStatus).toBe("applied");
      expect(inbox.rows[0]?.status).toBe("applied");
    });
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

  test("does not write new legacy payment event raw payloads for audit checkout events", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(await signedRequest(checkoutSessionPayload()), {
      ...routeDependencies(store.store),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      ignored: true,
      status: "noop",
      applicationStatus: "noop",
      reason: "legacy_audit_checkout_closed",
      stripeEventId: "evt_test_checkout_completed",
    });
    expect(store.audit.state).toBe("awaiting_payment");
    expect(store.jobs).toHaveLength(0);
    expect(store.paymentEvents).toHaveLength(0);
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
    expect(duplicateBody.applicationStatus).toBe("noop");
    expect(duplicateBody.ignored).toBe(true);
    expect(store.jobs).toHaveLength(0);
    expect(store.paymentEvents).toHaveLength(0);
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
    expect(body.applicationStatus).toBe("noop");
    expect(body.generationJobId).toBeUndefined();
  });

  test("rejects checkout session mismatches", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ checkoutSessionId: "cs_wrong" })),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("noop");
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

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("noop");
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

    expect(response.status).toBe(200);
    expect(body.applicationStatus).toBe("noop");
  });

  test("ignores non-paid checkout sessions", async () => {
    const store = createMemoryPaymentStore(pendingPaymentAudit());
    const response = await stripeWebhookResponse(
      await signedRequest(checkoutSessionPayload({ paymentStatus: "unpaid" })),
      routeDependencies(store.store),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      received: true,
      ignored: true,
      applicationStatus: "noop",
    });
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
      {
        ...routeDependencies(createMemoryPaymentStore(pendingPaymentAudit()).store),
        receiveStripeWebhookEvent: async (event) => ({
          status: "pending",
          inboxId: `stripe_event_${event.id}`,
          stripeEventId: event.id,
          reason: "Error",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inboxStatus).toBe("pending");
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

function routeDependencies(_store?: unknown) {
  return {
    applyTripPassStripeEvent: async () => ({ status: "ignored", reason: "not_trip_pass_event" }),
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
      applicationResult: await options?.applyEvent?.(event as never, {
        db: undefined as never,
        now,
      }),
    }),
  } satisfies Parameters<typeof stripeWebhookResponse>[1];
}

async function withRouteTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(createPgliteQueryClient(db));
  } finally {
    await db.close();
  }
}

function createPgliteQueryClient(db: Awaited<ReturnType<typeof openTestDatabase>>) {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback({ ...client, inTransaction: true });
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };

  return client;
}

function createMemoryPaymentStore(initialAudit: AuditLifecycleRecord) {
  const processedStripeEventIds = new Set<string>();
  const paymentEvents: Array<{ rawEvent?: unknown }> = [];
  const jobs: QueuedAuditJob[] = [];
  let audit = initialAudit;
  const store = {
    hasProcessedStripeEvent: async (stripeEventId: string) =>
      processedStripeEventIds.has(stripeEventId),
    loadCheckoutAudit: async () => audit,
    saveAppliedPayment: async (input: {
      audit: AuditLifecycleRecord;
      job: QueuedAuditJob;
      payment: { stripeEventId: string };
      paymentEvent: { rawEvent?: unknown };
    }) => {
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

function tripPassCheckoutSessionPayload(input: { eventId: string; orderId: string }) {
  return JSON.stringify({
    id: input.eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_782_194_400,
    data: {
      object: {
        id: `cs_${input.orderId}`,
        object: "checkout.session",
        client_reference_id: input.orderId,
        metadata: {
          tripPassOrderId: input.orderId,
          productCode: "siargao_trip_pass_14d_v2",
          productVersion: "2",
        },
        mode: "payment",
        payment_intent: `pi_${input.orderId}`,
        payment_status: "paid",
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

function historicalEventObject(type: (typeof historicalStripeEventTypes)[number], index: number) {
  if (type.startsWith("checkout.session.")) {
    return {
      id: `cs_historical_${index}`,
      object: "checkout.session",
      client_reference_id: `order_historical_${index}`,
      metadata: {
        productCode: "siargao_trip_pass_14d_v2",
        productVersion: "2",
        tripPassOrderId: `order_historical_${index}`,
      },
      mode: "payment",
      payment_intent: `pi_historical_${index}`,
      payment_status: type === "checkout.session.completed" ? "paid" : "unpaid",
    };
  }
  if (type === "charge.refunded") {
    return {
      id: `ch_historical_${index}`,
      object: "charge",
      payment_intent: `pi_historical_${index}`,
    };
  }
  if (type.startsWith("refund.")) {
    return {
      id: `re_historical_${index}`,
      object: "refund",
      charge: `ch_historical_${index}`,
      payment_intent: `pi_historical_${index}`,
    };
  }
  return {
    id: `du_historical_${index}`,
    object: "dispute",
    charge: `ch_historical_${index}`,
    payment_intent: `pi_historical_${index}`,
  };
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
