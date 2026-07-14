import { describe, expect, test } from "bun:test";

import { trackServerEvent } from "@/server/observability/events";
import { evaluatePublicEligibility } from "@/server/public-pages/public-content";
import { getServerSecret, sanitizeIntakeForMetrics } from "@/server/security/privacy";
import {
  checkRateLimit,
  configureRateLimitStore,
  createMemoryRateLimitStore,
  createRateLimiter,
  type QuotaStore,
  resetRateLimitStoreForTests,
} from "@/server/security/rate-limit";

describe("rate limiting", () => {
  test("blocks requests after the policy threshold", async () => {
    resetRateLimitStoreForTests();
    const now = new Date("2026-06-23T08:00:00.000Z");
    let last = await checkRateLimit({ key: "traveler", policy: "checkout", now });

    for (let index = 0; index < 4; index += 1) {
      last = await checkRateLimit({ key: "traveler", policy: "checkout", now });
    }

    expect(last.allowed).toBe(false);
    expect(last.headers).toHaveProperty("x-ratelimit-reset");
  });

  test("shares counts across injected limiter instances", async () => {
    const store = createMemoryRateLimitStore();
    const firstInstance = createRateLimiter({ store });
    const secondInstance = createRateLimiter({ store });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect(
        (await firstInstance.checkRateLimit({ key: "traveler", policy: "checkout", now })).allowed,
      ).toBe(true);
    }

    const blocked = await secondInstance.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now,
    });

    expect(blocked.allowed).toBe(false);
  });

  test("resets expired buckets and cleans stale entries", async () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store });
    const firstWindow = new Date("2026-06-23T08:00:00.000Z");
    const nextWindow = new Date("2026-06-23T08:01:01.000Z");

    for (let index = 0; index < 4; index += 1) {
      await limiter.checkRateLimit({ key: "traveler", policy: "checkout", now: firstWindow });
    }
    expect(store.size()).toBe(1);

    const reset = await limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: nextWindow,
    });

    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(3);
    expect(store.size()).toBe(1);
  });

  test("keeps process-local memory available outside production", async () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store, env: "test" });
    const result = await limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(store.size()).toBe(1);
  });

  test("fails closed before using process-local memory in production", async () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store, env: "production" });

    const result = await limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("production_store_required");
    expect(store.size()).toBe(0);
  });

  test("default process-local limiter fails closed in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    setEnvValue("NODE_ENV", "production");
    resetRateLimitStoreForTests();

    try {
      const result = await checkRateLimit({
        key: "traveler",
        policy: "checkout",
        now: new Date("2026-06-23T08:00:00.000Z"),
      });
      expect(result.allowed).toBe(false);
      expect(result.blockedReason).toBe("production_store_required");
    } finally {
      setEnvValue("NODE_ENV", originalNodeEnv);
      resetRateLimitStoreForTests();
    }
  });

  test("allows an injected shared store in production", async () => {
    const sharedStore = createFakeSharedRateLimitStore();
    const limiter = createRateLimiter({ store: sharedStore, env: "production" });

    const result = await limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(sharedStore.size()).toBe(1);
  });

  test("does not trust spoofed forwarding headers by default", async () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: false,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");
    let last = await limiter.rateLimitRequest(
      new Request("https://example.test/checkout", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      }),
      "checkout",
      { now },
    );

    for (let index = 0; index < 4; index += 1) {
      last = await limiter.rateLimitRequest(
        new Request("https://example.test/checkout", {
          headers: { "x-forwarded-for": `198.51.100.${index + 20}` },
        }),
        "checkout",
        { now },
      );
    }

    expect(last.allowed).toBe(false);
  });

  test("uses forwarding headers only when trusted proxy mode is enabled", async () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: true,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect(
        (
          await limiter.rateLimitRequest(
            new Request("https://example.test/checkout", {
              headers: { "x-forwarded-for": "198.51.100.10" },
            }),
            "checkout",
            { now },
          )
        ).allowed,
      ).toBe(true);
    }

    const differentForwardedClient = await limiter.rateLimitRequest(
      new Request("https://example.test/checkout", {
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
      "checkout",
      { now },
    );

    expect(differentForwardedClient.allowed).toBe(true);
  });

  test("scopes public API request buckets by path", async () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: false,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 120; index += 1) {
      expect(
        (
          await limiter.rateLimitRequest(
            new Request("https://example.test/api/public/weather/siargao"),
            "public_api",
            { now },
          )
        ).allowed,
      ).toBe(true);
    }

    expect(
      (
        await limiter.rateLimitRequest(
          new Request("https://example.test/api/public/accommodations/example-surf-stay.json"),
          "public_api",
          { now },
        )
      ).allowed,
    ).toBe(true);
    expect(
      (
        await limiter.rateLimitRequest(
          new Request("https://example.test/api/public/weather/siargao"),
          "public_api",
          { now },
        )
      ).allowed,
    ).toBe(false);
  });

  test("can install an injected shared store for the default limiter", async () => {
    const sharedStore = createMemoryRateLimitStore();
    configureRateLimitStore({ ...sharedStore, scope: "shared" });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect((await checkRateLimit({ key: "traveler", policy: "checkout", now })).allowed).toBe(
        true,
      );
    }

    expect((await checkRateLimit({ key: "traveler", policy: "checkout", now })).allowed).toBe(
      false,
    );
    resetRateLimitStoreForTests();
  });

  test("returns a typed fail-closed result when the quota store is unavailable", async () => {
    const limiter = createRateLimiter({
      store: createUnavailableQuotaStore(),
    });

    const result = await limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("quota_store_unavailable");
    expect(result.remaining).toBe(0);
  });

  test("provides atomic memory quota primitives for leases, reservations, idempotency, and budgets", async () => {
    const store = createMemoryRateLimitStore();
    const nowMs = Date.parse("2026-06-23T08:00:00.000Z");

    const [firstLease, duplicateLease, secondLease, thirdLease] = await Promise.all([
      store.reserveConcurrency({
        key: "lease:chat",
        leaseId: "lease_a",
        limit: 2,
        nowMs,
        ttlMs: 30_000,
      }),
      store.reserveConcurrency({
        key: "lease:chat",
        leaseId: "lease_a",
        limit: 2,
        nowMs,
        ttlMs: 30_000,
      }),
      store.reserveConcurrency({
        key: "lease:chat",
        leaseId: "lease_b",
        limit: 2,
        nowMs,
        ttlMs: 30_000,
      }),
      store.reserveConcurrency({
        key: "lease:chat",
        leaseId: "lease_c",
        limit: 2,
        nowMs,
        ttlMs: 30_000,
      }),
    ]);

    expect(firstLease.status).toBe("acquired");
    expect(duplicateLease.status).toBe("duplicate");
    expect([secondLease.status, thirdLease.status].toSorted()).toEqual(["acquired", "rejected"]);

    await store.releaseConcurrency({ key: "lease:chat", leaseId: "lease_a" });
    expect(
      (
        await store.reserveConcurrency({
          key: "lease:chat",
          leaseId: "lease_d",
          limit: 2,
          nowMs,
          ttlMs: 30_000,
        })
      ).status,
    ).toBe("acquired");

    const expiredLease = await store.reserveConcurrency({
      key: "lease:chat",
      leaseId: "lease_e",
      limit: 2,
      nowMs: nowMs + 31_000,
      ttlMs: 30_000,
    });
    expect(expiredLease.status).toBe("acquired");
    expect(expiredLease.count).toBe(1);

    const [firstReservation, duplicateReservation, rejectedReservation] = await Promise.all([
      store.reserveRollingWindow({
        key: "identity:velocity",
        reservationId: "request_a",
        limit: 2,
        nowMs,
        windowMs: 60_000,
      }),
      store.reserveRollingWindow({
        key: "identity:velocity",
        reservationId: "request_a",
        limit: 2,
        nowMs,
        windowMs: 60_000,
      }),
      store.reserveRollingWindow({
        key: "identity:velocity",
        reservationId: "request_b",
        limit: 2,
        nowMs,
        windowMs: 60_000,
      }),
    ]);
    expect(firstReservation.status).toBe("reserved");
    expect(duplicateReservation.status).toBe("duplicate");
    expect(rejectedReservation.status).toBe("reserved");
    expect(
      (
        await store.reserveRollingWindow({
          key: "identity:velocity",
          reservationId: "request_c",
          limit: 2,
          nowMs,
          windowMs: 60_000,
        })
      ).status,
    ).toBe("rejected");
    expect(
      (
        await store.reserveRollingWindow({
          key: "identity:velocity",
          reservationId: "request_d",
          limit: 2,
          nowMs: nowMs + 61_000,
          windowMs: 60_000,
        })
      ).status,
    ).toBe("reserved");

    await expect(
      Promise.all([
        store.recordIdempotency({
          key: "idempotency:request",
          value: "stored",
          nowMs,
          ttlMs: 60_000,
        }),
        store.recordIdempotency({
          key: "idempotency:request",
          value: "duplicate",
          nowMs,
          ttlMs: 60_000,
        }),
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "stored" }),
        expect.objectContaining({ status: "duplicate", value: "stored" }),
      ]),
    );

    await expect(
      Promise.all([
        store.consumeBudget({
          key: "budget:provider",
          amount: 70,
          limit: 100,
          nowMs,
          windowMs: 60_000,
        }),
        store.consumeBudget({
          key: "budget:provider",
          amount: 40,
          limit: 100,
          nowMs,
          windowMs: 60_000,
        }),
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "consumed", used: 70 }),
        expect.objectContaining({ status: "exceeded" }),
      ]),
    );
  });
});

function createFakeSharedRateLimitStore() {
  const store = createMemoryRateLimitStore();

  return {
    ...store,
    scope: "shared",
  } satisfies QuotaStore & { size(): number };
}

function createUnavailableQuotaStore() {
  const fail = async () => {
    throw new Error("quota store unavailable");
  };

  return {
    scope: "shared",
    consumeBudget: fail,
    incrementFixedWindow: fail,
    recordIdempotency: fail,
    releaseConcurrency: fail,
    releaseRollingWindow: fail,
    reserveConcurrency: fail,
    reserveRollingWindow: fail,
  } satisfies QuotaStore;
}

function setEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function credentialFragment(...parts: string[]) {
  return parts.join("-");
}

function underscoreCredential(...parts: string[]) {
  return parts.join("_");
}

function bearerFragment(scope: string, suffix: string) {
  return ["Bearer", credentialFragment("provider", "sample", scope, suffix)].join(" ");
}

function keyValueCredential(key: string, separator: "=" | ": ", scope: string, suffix: string) {
  return `${key}${separator}${credentialFragment("provider", "sample", scope, suffix)}`;
}

describe("privacy and observability", () => {
  test("captures viability metrics without private trip details", async () => {
    const metrics = sanitizeIntakeForMetrics({
      travelMonth: "2026-08",
      arrivalOrigin: "Manila",
      accommodationName: "Private Villa Name",
      accommodationPlatformUrl: "https://booking.example/private",
      stayAreaSlug: "general-luna",
      topConstraint: "quiet sleep near a specific person",
      optionalModules: ["quiet_sleep"],
      travelerContext: {
        travelerType: "solo",
        groupSize: 1,
        riskTolerance: "low_risk",
      },
    });

    expect(JSON.stringify(metrics)).not.toContain("Private Villa Name");
    expect(JSON.stringify(metrics)).not.toContain("booking.example");
    expect(metrics.groupSizeBucket).toBe("solo");
  });

  test("redacts telemetry payloads before Sentry or PostHog sinks", async () => {
    const apiToken = underscoreCredential("sk", "test", "should", "not", "render");
    const hyphenatedToken = credentialFragment("sk", "provider", "sample", "security", "alpha");
    const bearerToken = bearerFragment("security", "beta");
    const event = trackServerEvent({
      name: "provider_error_recorded",
      payload: {
        email: "traveler@example.com",
        apiKey: apiToken,
        reason: `provider timeout with ${hyphenatedToken} and ${bearerToken}`,
        diagnostics: [
          keyValueCredential("token", "=", "security", "gamma"),
          keyValueCredential("secret", ": ", "security", "delta"),
          keyValueCredential("api_key", "=", "security", "epsilon"),
          keyValueCredential("apikey", ": ", "security", "zeta"),
          keyValueCredential("api-key", "=", "security", "eta"),
        ],
      },
      env: {
        SENTRY_DSN: "https://sentry.example/1",
        NEXT_PUBLIC_POSTHOG_KEY: underscoreCredential("phc", "test"),
      },
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(event.sinks.sentryConfigured).toBe(true);
    expect(event.sinks.posthogConfigured).toBe(true);
    expect(JSON.stringify(event.payload)).not.toContain("traveler@example.com");
    expect(JSON.stringify(event.payload)).not.toContain("sk_test");
    expect(JSON.stringify(event.payload)).not.toContain("security-alpha");
    expect(JSON.stringify(event.payload)).not.toContain("security-beta");
    expect(JSON.stringify(event.payload)).not.toContain("security-gamma");
    expect(JSON.stringify(event.payload)).not.toContain("security-delta");
    expect(JSON.stringify(event.payload)).not.toContain("security-epsilon");
    expect(JSON.stringify(event.payload)).not.toContain("security-zeta");
    expect(JSON.stringify(event.payload)).not.toContain("security-eta");
    expect(JSON.stringify(event.payload)).toContain("[redacted-secret]");
  });

  test("server-only secret helper refuses public env names", async () => {
    const webhookToken = underscoreCredential("whsec", "test");

    expect(getServerSecret("STRIPE_WEBHOOK_SECRET", { STRIPE_WEBHOOK_SECRET: webhookToken })).toBe(
      webhookToken,
    );
    expect(() => getServerSecret("NEXT_PUBLIC_POSTHOG_KEY")).toThrow("Refusing to read public");
  });
});

describe("public and private data boundaries", () => {
  test("public eligibility blocks private paid audit facts and restricted provider payloads", async () => {
    const result = evaluatePublicEligibility({
      facts: [
        {
          id: "fact_private_paid_report",
          claim: "Private paid report says the guest arrives late.",
          factType: "private_paid_report",
          sourceProfileId: "source_user_submitted",
          sourceType: "user_submitted",
          sourceName: "Private paid audit",
          evidenceId: "ev_private",
          fetchedAt: "2026-06-23T00:00:00.000Z",
          confidence: "high",
          freshness: "fresh",
          publicRepublishAllowed: true,
          criticalPublicEvidence: true,
          containsPrivateUserData: true,
          includesRawProviderPayload: true,
          canonicalEntityMatch: "confident",
        },
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("fact:fact_private_paid_report:private_user_data");
    expect(result.reasons).toContain("fact:fact_private_paid_report:raw_provider_payload");
  });

  test("client-facing feature files do not reference server-only secret names", async () => {
    const files = [
      "src/features/report/FinalReportPage.tsx",
      "src/features/public-pages/PublicKnowledgePage.tsx",
      "src/features/admin/AdminDiagnosticsPage.tsx",
    ];
    const contents = await Promise.all(files.map((file) => Bun.file(file).text()));
    const combined = contents.join("\n");

    expect(combined).not.toContain("STRIPE_SECRET_KEY");
    expect(combined).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(combined).not.toContain("OPENAI_API_KEY");
    expect(combined).not.toContain("DATABASE_URL");
  });
});
