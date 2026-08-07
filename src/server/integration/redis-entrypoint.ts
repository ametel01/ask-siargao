import Stripe from "stripe";

import { POST as stripeWebhookPost } from "@/app/api/stripe/webhook/route";
import { withRealRedisHarness } from "@/server/integration/redis-harness";
import { createRedisQuotaStore, type QuotaStore } from "@/server/security/rate-limit";
import { openChatUsageSession } from "@/server/trip-pass/usage";

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
  const result = await openChatUsageSession({
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

  assertEqual(result.status, "unavailable", "paid paths must fail closed without shared Redis");
  if (result.status === "unavailable") {
    assertEqual(
      result.reason,
      "paid_usage_store_unavailable",
      "paid fail-closed reason must be typed and redacted",
    );
  }
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

    const response = await stripeWebhookPost(
      await signedStripeRequest({
        id: "evt_issue150_redis_independent",
        type: "customer.created",
        data: {
          object: {
            id: "cus_issue150_ignored",
            object: "customer",
          },
        },
      }),
    );
    const body = await response.json();

    assertEqual(
      response.status,
      200,
      "verified Stripe webhooks must not require Redis after signature verification",
    );
    assertDeepEqual(
      body,
      { received: true, ignored: true },
      "irrelevant verified event must reach the application boundary",
    );
    assertEqual(
      response.headers.get("x-ratelimit-limit"),
      null,
      "verified Stripe webhook response must not carry Redis/IP throttle headers",
    );
  } finally {
    restoreEnv("STRIPE_RESTRICTED_KEY", originalStripeRestrictedKey);
    restoreEnv("STRIPE_WEBHOOK_SECRET", originalSecret);
    restoreEnv("REDIS_URL", originalRedisUrl);
    restoreEnv("NODE_ENV", originalNodeEnv);
  }
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}
