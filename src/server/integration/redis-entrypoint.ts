import Stripe from "stripe";

import { POST } from "@/app/api/stripe/webhook/route";
import {
  type stripeWebhookResponse,
  withStripeWebhookRouteDependenciesForTest,
} from "@/app/api/stripe/webhook/webhook-route";
import { withRealRedisHarness } from "@/server/integration/redis-harness";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";
import { STRIPE_API_VERSION } from "@/server/payments/stripe-event-inbox";
import { createRedisQuotaStore, type QuotaStore } from "@/server/security/rate-limit";
import { openChatUsageSession } from "@/server/trip-pass/usage";

await runConcurrentHarnessIsolationRegression();

await withRealRedisHarness(async (harness) => {
  const clients = [harness.createCommandClient(), harness.createCommandClient()];
  const stores = clients.map((client) =>
    createRedisQuotaStore({ client, keyPrefix: harness.keyPrefix }),
  );
  try {
    await runFixedWindowRegression(stores);
    await runBudgetRegression(stores);
    await runIdempotencyRegression(stores);
    await runConcurrencyLeaseRegression(stores);
    await runRollingWindowRegression(stores);
    await runProductionPaidFailClosedRegression();
    await runVerifiedStripeWebhookRedisIndependenceRegression();

    console.log(
      JSON.stringify(
        {
          checked: "redis-integration-semantic-suite",
          namespace: harness.namespace,
          redisUrl: harness.redisUrl,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
});

async function runConcurrentHarnessIsolationRegression() {
  const firstReady = deferred<{ key: string; prefix: string }>();
  const secondCleaned = deferred<{ key: string; prefix: string }>();

  const first = withRealRedisHarness(async (harness) => {
    const client = harness.createCommandClient();
    const firstKey = `${harness.keyPrefix}:owner-probe`;
    try {
      await client.set(firstKey, "first");
      firstReady.resolve({ key: firstKey, prefix: harness.keyPrefix });
      const secondProbe = await secondCleaned.promise;
      assertNotEqual(
        harness.keyPrefix,
        secondProbe.prefix,
        "concurrent Redis harnesses must use distinct key prefixes",
      );
      assertEqual(
        await client.get(firstKey),
        "first",
        "cleanup for a concurrent Redis harness must not delete another owned prefix",
      );
      assertEqual(
        await client.get(secondProbe.key),
        null,
        "concurrent Redis harness cleanup must delete only its own prefix",
      );
      return harness.keyPrefix;
    } finally {
      await client.close();
    }
  }).catch((error) => {
    firstReady.reject(error);
    secondCleaned.reject(error);
    throw error;
  });

  const second = (async () => {
    try {
      const firstProbe = await firstReady.promise;
      const secondProbe = await withRealRedisHarness(async (harness) => {
        assertNotEqual(
          harness.keyPrefix,
          firstProbe.prefix,
          "concurrent Redis harnesses must not collide on key-prefix ownership",
        );
        const client = harness.createCommandClient();
        try {
          const key = `${harness.keyPrefix}:owner-probe`;
          await client.set(key, "second");
          return { key, prefix: harness.keyPrefix };
        } finally {
          await client.close();
        }
      });
      secondCleaned.resolve(secondProbe);
      return secondProbe.prefix;
    } catch (error) {
      secondCleaned.reject(error);
      throw error;
    }
  })();

  const [firstPrefix, secondPrefix] = await Promise.all([first, second]);
  assertNotEqual(
    firstPrefix,
    secondPrefix,
    "concurrent Redis harnesses must not reuse cleanup prefixes",
  );
}

async function runFixedWindowRegression(stores: readonly QuotaStore[]) {
  const nowMs = Date.parse("2026-08-07T00:00:00.000Z");
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      stores[index % stores.length]?.incrementFixedWindow({
        key: "fixed-window:last-unit",
        nowMs,
        windowMs: 60_000,
      }),
    ),
  );
  assertDeepEqual(
    results.map((result) => result?.count).toSorted((left, right) => Number(left) - Number(right)),
    [1, 2, 3, 4, 5, 6, 7, 8],
    "fixed-window increments must be shared and atomic across clients",
  );
}

async function runBudgetRegression(stores: readonly QuotaStore[]) {
  const nowMs = Date.parse("2026-08-07T00:01:00.000Z");
  const [first, second] = await Promise.all([
    stores[0]?.consumeBudget({
      amount: 1,
      key: "budget:last-unit",
      limit: 1,
      nowMs,
      windowMs: 60_000,
    }),
    stores[1]?.consumeBudget({
      amount: 1,
      key: "budget:last-unit",
      limit: 1,
      nowMs,
      windowMs: 60_000,
    }),
  ]);
  const statuses = [first?.status, second?.status].toSorted();
  assertDeepEqual(statuses, ["consumed", "exceeded"], "parallel final budget unit must admit once");

  await stores[0]?.releaseBudget({ amount: 1, key: "budget:last-unit" });
  const afterRelease = await stores[1]?.consumeBudget({
    amount: 1,
    key: "budget:last-unit",
    limit: 1,
    nowMs,
    windowMs: 60_000,
  });
  assertEqual(afterRelease?.status, "consumed", "released budget must be reusable");
}

async function runIdempotencyRegression(stores: readonly QuotaStore[]) {
  const nowMs = Date.parse("2026-08-07T00:02:00.000Z");
  const [first, second] = await Promise.all([
    stores[0]?.recordIdempotency({
      key: "idempotency:shared",
      nowMs,
      ttlMs: 60_000,
      value: "first",
    }),
    stores[1]?.recordIdempotency({
      key: "idempotency:shared",
      nowMs,
      ttlMs: 60_000,
      value: "second",
    }),
  ]);
  const statuses = [first?.status, second?.status].toSorted();
  assertDeepEqual(
    statuses,
    ["duplicate", "stored"],
    "idempotency records must replay across clients",
  );
  const duplicate = [first, second].find((result) => result?.status === "duplicate");
  assertEqual(
    duplicate?.status === "duplicate" ? Boolean(duplicate.value) : false,
    true,
    "duplicate idempotency result must expose the originally stored value",
  );
}

async function runConcurrencyLeaseRegression(stores: readonly QuotaStore[]) {
  const nowMs = Date.parse("2026-08-07T00:03:00.000Z");
  const [first, second] = await Promise.all([
    stores[0]?.reserveConcurrency({
      key: "lease:last-unit",
      leaseId: "lease-a",
      limit: 1,
      nowMs,
      ttlMs: 60_000,
    }),
    stores[1]?.reserveConcurrency({
      key: "lease:last-unit",
      leaseId: "lease-b",
      limit: 1,
      nowMs,
      ttlMs: 60_000,
    }),
  ]);
  assertDeepEqual(
    [first?.status, second?.status].toSorted(),
    ["acquired", "rejected"],
    "parallel final lease must admit once",
  );
  const acquiredLeaseId =
    first?.status === "acquired"
      ? first.leaseId
      : second?.status === "acquired"
        ? second.leaseId
        : null;
  if (!acquiredLeaseId) {
    throw new Error("parallel lease regression did not record the acquired lease id.");
  }

  const duplicate = await stores[1]?.reserveConcurrency({
    key: "lease:last-unit",
    leaseId: acquiredLeaseId,
    limit: 1,
    nowMs,
    ttlMs: 60_000,
  });
  assertEqual(duplicate?.status, "duplicate", "same lease id must replay idempotently");

  await stores[0]?.releaseConcurrency({ key: "lease:last-unit", leaseId: acquiredLeaseId });
  const afterRelease = await stores[1]?.reserveConcurrency({
    key: "lease:last-unit",
    leaseId: "lease-c",
    limit: 1,
    nowMs,
    ttlMs: 60_000,
  });
  assertEqual(afterRelease?.status, "acquired", "released lease must admit a new holder");

  const expiringLease = await stores[0]?.reserveConcurrency({
    key: "lease:expiry",
    leaseId: "lease-expired-old",
    limit: 1,
    nowMs,
    ttlMs: 60_000,
  });
  assertEqual(expiringLease?.status, "acquired", "expiry fixture lease must acquire");
  const afterExpiry = await stores[0]?.reserveConcurrency({
    key: "lease:expiry",
    leaseId: "lease-expired-new",
    limit: 1,
    nowMs: nowMs + 60_001,
    ttlMs: 60_000,
  });
  assertEqual(afterExpiry?.status, "acquired", "expired leases must not block recovery");
}

async function runRollingWindowRegression(stores: readonly QuotaStore[]) {
  const nowMs = Date.parse("2026-08-07T00:04:00.000Z");
  const [first, second] = await Promise.all([
    stores[0]?.reserveRollingWindow({
      key: "rolling:last-unit",
      limit: 1,
      nowMs,
      reservationId: "reservation-a",
      windowMs: 60_000,
    }),
    stores[1]?.reserveRollingWindow({
      key: "rolling:last-unit",
      limit: 1,
      nowMs,
      reservationId: "reservation-b",
      windowMs: 60_000,
    }),
  ]);
  assertDeepEqual(
    [first?.status, second?.status].toSorted(),
    ["rejected", "reserved"],
    "parallel final rolling-window reservation must admit once",
  );
  const reservedId =
    first?.status === "reserved"
      ? first.reservationId
      : second?.status === "reserved"
        ? second.reservationId
        : null;
  if (!reservedId) {
    throw new Error("parallel rolling-window regression did not record the reserved id.");
  }

  const duplicate = await stores[1]?.reserveRollingWindow({
    key: "rolling:last-unit",
    limit: 1,
    nowMs,
    reservationId: reservedId,
    windowMs: 60_000,
  });
  assertEqual(duplicate?.status, "duplicate", "same rolling reservation must replay idempotently");

  await stores[0]?.releaseRollingWindow({
    key: "rolling:last-unit",
    reservationId: reservedId,
  });
  const afterRelease = await stores[1]?.reserveRollingWindow({
    key: "rolling:last-unit",
    limit: 1,
    nowMs,
    reservationId: "reservation-c",
    windowMs: 60_000,
  });
  assertEqual(afterRelease?.status, "reserved", "released rolling reservation must free capacity");

  const expiringReservation = await stores[0]?.reserveRollingWindow({
    key: "rolling:expiry",
    limit: 1,
    nowMs,
    reservationId: "reservation-expired-old",
    windowMs: 60_000,
  });
  assertEqual(expiringReservation?.status, "reserved", "expiry fixture reservation must reserve");
  const afterExpiry = await stores[0]?.reserveRollingWindow({
    key: "rolling:expiry",
    limit: 1,
    nowMs: nowMs + 60_001,
    reservationId: "reservation-expired-new",
    windowMs: 60_000,
  });
  assertEqual(afterExpiry?.status, "reserved", "expired rolling reservations must free capacity");
}

async function runProductionPaidFailClosedRegression() {
  const missingUrlResult = await openChatUsageSession({
    db: {
      async query() {
        throw new Error("database must not be touched when shared quota storage is unavailable");
      },
    },
    env: {
      NODE_ENV: "production",
      REDIS_URL: "",
    },
    requestId: "paid_fail_closed_without_redis",
    userId: "user_paid_fail_closed",
  });

  assertEqual(
    missingUrlResult.status,
    "unavailable",
    "paid paths must fail closed without shared Redis",
  );
  if (missingUrlResult.status === "unavailable") {
    assertEqual(
      missingUrlResult.reason,
      "paid_usage_store_unavailable",
      "paid fail-closed reason must be typed and redacted",
    );
  }

  const outageResult = await openChatUsageSession({
    db: createActivePaidEntitlementDb(),
    env: {
      NODE_ENV: "production",
      REDIS_URL: "redis://127.0.0.1:1/0",
    },
    now: new Date("2026-08-07T00:05:00.000Z"),
    requestId: "paid_fail_closed_redis_unreachable",
    userId: "user_paid_redis_unreachable",
  });

  assertDeepEqual(
    outageResult,
    { status: "unavailable", reason: "paid_usage_store_unavailable" },
    "configured but unreachable Redis must return a typed redacted paid-path outage",
  );
}

async function runVerifiedStripeWebhookRedisIndependenceRegression() {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalStripeRestrictedKey = process.env.STRIPE_RESTRICTED_KEY;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.STRIPE_RESTRICTED_KEY = "rk_test_issue150_fixture";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_issue150_fixture";
    process.env.REDIS_URL = "redis://127.0.0.1:1/0";
    Object.assign(process.env, { NODE_ENV: "production" });

    const response = await withStripeWebhookRouteDependenciesForTest(
      redisOutageWebhookDependencies("applied"),
      async () =>
        POST(await signedStripeRequest(checkoutSessionEvent("evt_issue150_redis_independent"))),
    );
    const body = await response.json();

    assertEqual(
      response.status,
      200,
      "verified Stripe webhooks must not require Redis after signature verification",
    );
    assertDeepEqual(
      body,
      {
        received: true,
        product: "trip_pass",
        status: "applied",
        applicationStatus: "applied",
        action: "activated",
        orderId: "order_issue150_redis_independent",
        stripeEventId: "evt_issue150_redis_independent",
      },
      "handled verified event must reach durable payment application with Redis unavailable",
    );
    assertEqual(
      response.headers.get("x-ratelimit-limit"),
      null,
      "verified Stripe webhook response must not carry Redis/IP throttle headers",
    );

    const invalidSignatureResponse = await withStripeWebhookRouteDependenciesForTest(
      redisOutageWebhookDependencies("applied"),
      async () =>
        POST(
          new Request("https://siargao.test/api/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": "t=1,v1=not-real" },
            body: JSON.stringify(checkoutSessionEvent("evt_issue150_invalid_signature")),
          }),
        ),
    );
    assertEqual(
      invalidSignatureResponse.status,
      400,
      "Stripe webhook signature failures must still fail while Redis is unavailable",
    );

    const persistenceFailureResponse = await withStripeWebhookRouteDependenciesForTest(
      redisOutageWebhookDependencies("persistence_failure"),
      async () =>
        POST(await signedStripeRequest(checkoutSessionEvent("evt_issue150_persistence_failure"))),
    );
    assertEqual(
      persistenceFailureResponse.status,
      400,
      "Stripe webhook persistence failures must still fail while Redis is unavailable",
    );
  } finally {
    restoreEnv("STRIPE_RESTRICTED_KEY", originalStripeRestrictedKey);
    restoreEnv("STRIPE_WEBHOOK_SECRET", originalSecret);
    restoreEnv("REDIS_URL", originalRedisUrl);
    restoreEnv("NODE_ENV", originalNodeEnv);
  }
}

function redisOutageWebhookDependencies(mode: "applied" | "persistence_failure") {
  return {
    applyTripPassStripeEvent: async () => ({
      status: "applied" as const,
      action: "activated" as const,
      orderId: "order_issue150_redis_independent",
      stripeEventId: "evt_issue150_redis_independent",
    }),
    stripeWebhookSecretFromEnv: () => "whsec_issue150_fixture",
    trackServerEvent: (event) => ({
      name: event.name,
      at: "2026-08-07T00:06:00.000Z",
      payload: event.payload,
      sinks: {
        posthogConfigured: false,
        sentryConfigured: false,
      },
    }),
    verifyStripeWebhookPayload: (input: {
      payload: string | Buffer;
      signature: string;
      webhookSecret: string;
    }) =>
      verifyStripeWebhookPayload({
        ...input,
        stripe: new Stripe("rk_test_issue150_fixture"),
      }),
    receiveStripeWebhookEvent: async (event, options) => {
      if (mode === "persistence_failure") {
        throw new Error("issue149 simulated durable inbox persistence failure");
      }
      return {
        status: "applied" as const,
        inboxId: `stripe_event_${event.id}`,
        stripeEventId: event.id,
        applicationResult: await options?.applyEvent?.(event, {
          db: redisOutageDurableBoundaryDb(),
          now: new Date("2026-08-07T00:06:00.000Z"),
        }),
      };
    },
  } satisfies Parameters<typeof stripeWebhookResponse>[1];
}

function checkoutSessionEvent(eventId: string) {
  const auditRequestId =
    eventId === "evt_issue150_persistence_failure"
      ? "audit_issue150_missing"
      : "audit_issue150_redis_independent";
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_782_194_400,
    data: {
      object: {
        id: "cs_issue150_redis_independent",
        object: "checkout.session",
        client_reference_id: auditRequestId,
        metadata: { auditRequestId },
        mode: "payment",
        payment_intent: "pi_issue150_redis_independent",
        payment_status: "paid",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  };
}

async function signedStripeRequest(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: "whsec_issue150_fixture",
  });
  return new Request("https://siargao.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

function redisOutageDurableBoundaryDb() {
  return {
    async query<T>() {
      return { rows: [] as T[] };
    },
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createActivePaidEntitlementDb() {
  return {
    async query<T>(query: string) {
      if (query.includes("from trip_passes") && query.includes("status = 'active'")) {
        return {
          rows: [
            {
              id: "trip_pass_paid_redis_unreachable",
              user_id: "user_paid_redis_unreachable",
              email: "paid-redis-unreachable@example.com",
              status: "active",
              stripe_checkout_session_id: "cs_paid_redis_unreachable",
              stripe_payment_intent_id: "pi_paid_redis_unreachable",
              stripe_event_id: "evt_paid_redis_unreachable",
              starts_at: new Date("2026-08-01T00:00:00.000Z"),
              expires_at: new Date("2026-08-30T00:00:00.000Z"),
              created_at: new Date("2026-08-01T00:00:00.000Z"),
              updated_at: new Date("2026-08-01T00:00:00.000Z"),
            },
          ] as T[],
        };
      }
      if (query.includes("from trip_usage_meters")) {
        return {
          rows: [
            {
              id: "meter_paid_redis_unreachable_chat",
              trip_pass_id: "trip_pass_paid_redis_unreachable",
              meter_type: "chat_message",
              used: 0,
              limit: 150,
              reset_at: new Date("2026-08-30T00:00:00.000Z"),
              updated_at: new Date("2026-08-01T00:00:00.000Z"),
            },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    },
  };
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertNotEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    throw new Error(`${message}. Both values were ${String(actual)}.`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
