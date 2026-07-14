import { describe, expect, test } from "bun:test";

import { trackServerEvent } from "@/server/observability/events";
import { evaluatePublicEligibility } from "@/server/public-pages/public-content";
import { getServerSecret, sanitizeIntakeForMetrics } from "@/server/security/privacy";
import {
  checkRateLimit,
  configureRateLimitStore,
  createMemoryRateLimitStore,
  createRateLimiter,
  type RateLimitStore,
  resetRateLimitStoreForTests,
} from "@/server/security/rate-limit";

describe("rate limiting", () => {
  test("blocks requests after the policy threshold", () => {
    resetRateLimitStoreForTests();
    const now = new Date("2026-06-23T08:00:00.000Z");
    let last = checkRateLimit({ key: "traveler", policy: "checkout", now });

    for (let index = 0; index < 4; index += 1) {
      last = checkRateLimit({ key: "traveler", policy: "checkout", now });
    }

    expect(last.allowed).toBe(false);
    expect(last.headers).toHaveProperty("x-ratelimit-reset");
  });

  test("shares counts across injected limiter instances", () => {
    const store = createMemoryRateLimitStore();
    const firstInstance = createRateLimiter({ store });
    const secondInstance = createRateLimiter({ store });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect(
        firstInstance.checkRateLimit({ key: "traveler", policy: "checkout", now }).allowed,
      ).toBe(true);
    }

    const blocked = secondInstance.checkRateLimit({ key: "traveler", policy: "checkout", now });

    expect(blocked.allowed).toBe(false);
  });

  test("resets expired buckets and cleans stale entries", () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store });
    const firstWindow = new Date("2026-06-23T08:00:00.000Z");
    const nextWindow = new Date("2026-06-23T08:01:01.000Z");

    for (let index = 0; index < 4; index += 1) {
      limiter.checkRateLimit({ key: "traveler", policy: "checkout", now: firstWindow });
    }
    expect(store.size()).toBe(1);

    const reset = limiter.checkRateLimit({ key: "traveler", policy: "checkout", now: nextWindow });

    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(3);
    expect(store.size()).toBe(1);
  });

  test("keeps process-local memory available outside production", () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store, env: "test" });
    const result = limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(store.size()).toBe(1);
  });

  test("fails closed before using process-local memory in production", () => {
    const store = createMemoryRateLimitStore();
    const limiter = createRateLimiter({ store, env: "production" });

    expect(() =>
      limiter.checkRateLimit({
        key: "traveler",
        policy: "checkout",
        now: new Date("2026-06-23T08:00:00.000Z"),
      }),
    ).toThrow(/Configure a shared rate-limit store/);
    expect(store.size()).toBe(0);
  });

  test("default process-local limiter fails closed in production", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    setEnvValue("NODE_ENV", "production");
    resetRateLimitStoreForTests();

    try {
      expect(() =>
        checkRateLimit({
          key: "traveler",
          policy: "checkout",
          now: new Date("2026-06-23T08:00:00.000Z"),
        }),
      ).toThrow(/shared RateLimitStore/);
    } finally {
      setEnvValue("NODE_ENV", originalNodeEnv);
      resetRateLimitStoreForTests();
    }
  });

  test("allows an injected shared store in production", () => {
    const sharedStore = createFakeSharedRateLimitStore();
    const limiter = createRateLimiter({ store: sharedStore, env: "production" });

    const result = limiter.checkRateLimit({
      key: "traveler",
      policy: "checkout",
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(sharedStore.size()).toBe(1);
  });

  test("does not trust spoofed forwarding headers by default", () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: false,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");
    let last = limiter.rateLimitRequest(
      new Request("https://example.test/checkout", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      }),
      "checkout",
      { now },
    );

    for (let index = 0; index < 4; index += 1) {
      last = limiter.rateLimitRequest(
        new Request("https://example.test/checkout", {
          headers: { "x-forwarded-for": `198.51.100.${index + 20}` },
        }),
        "checkout",
        { now },
      );
    }

    expect(last.allowed).toBe(false);
  });

  test("uses forwarding headers only when trusted proxy mode is enabled", () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: true,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect(
        limiter.rateLimitRequest(
          new Request("https://example.test/checkout", {
            headers: { "x-forwarded-for": "198.51.100.10" },
          }),
          "checkout",
          { now },
        ).allowed,
      ).toBe(true);
    }

    const differentForwardedClient = limiter.rateLimitRequest(
      new Request("https://example.test/checkout", {
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
      "checkout",
      { now },
    );

    expect(differentForwardedClient.allowed).toBe(true);
  });

  test("scopes public API request buckets by path", () => {
    const limiter = createRateLimiter({
      store: createMemoryRateLimitStore(),
      trustProxyHeaders: false,
    });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 120; index += 1) {
      expect(
        limiter.rateLimitRequest(
          new Request("https://example.test/api/public/weather/siargao"),
          "public_api",
          { now },
        ).allowed,
      ).toBe(true);
    }

    expect(
      limiter.rateLimitRequest(
        new Request("https://example.test/api/public/accommodations/example-surf-stay.json"),
        "public_api",
        { now },
      ).allowed,
    ).toBe(true);
    expect(
      limiter.rateLimitRequest(
        new Request("https://example.test/api/public/weather/siargao"),
        "public_api",
        { now },
      ).allowed,
    ).toBe(false);
  });

  test("can install an injected shared store for the default limiter", () => {
    const sharedStore = createMemoryRateLimitStore();
    configureRateLimitStore({ ...sharedStore, scope: "shared" });
    const now = new Date("2026-06-23T08:00:00.000Z");

    for (let index = 0; index < 4; index += 1) {
      expect(checkRateLimit({ key: "traveler", policy: "checkout", now }).allowed).toBe(true);
    }

    expect(checkRateLimit({ key: "traveler", policy: "checkout", now }).allowed).toBe(false);
    resetRateLimitStoreForTests();
  });
});

function createFakeSharedRateLimitStore() {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    scope: "shared",
    increment(bucketKey, windowMs, nowMs) {
      const bucket = buckets.get(bucketKey) ?? { count: 0, resetAt: nowMs + windowMs };

      bucket.count += 1;
      buckets.set(bucketKey, bucket);

      return bucket;
    },
    size() {
      return buckets.size;
    },
  } satisfies RateLimitStore & { size(): number };
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
  test("captures viability metrics without private trip details", () => {
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

  test("redacts telemetry payloads before Sentry or PostHog sinks", () => {
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

  test("server-only secret helper refuses public env names", () => {
    const webhookToken = underscoreCredential("whsec", "test");

    expect(getServerSecret("STRIPE_WEBHOOK_SECRET", { STRIPE_WEBHOOK_SECRET: webhookToken })).toBe(
      webhookToken,
    );
    expect(() => getServerSecret("NEXT_PUBLIC_POSTHOG_KEY")).toThrow("Refusing to read public");
  });
});

describe("public and private data boundaries", () => {
  test("public eligibility blocks private paid audit facts and restricted provider payloads", () => {
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
