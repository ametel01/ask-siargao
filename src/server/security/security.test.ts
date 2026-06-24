import { describe, expect, test } from "bun:test";

import { trackServerEvent } from "@/server/observability/events";
import { evaluatePublicEligibility } from "@/server/public-pages/public-content";
import { getServerSecret, sanitizeIntakeForMetrics } from "@/server/security/privacy";
import {
  checkRateLimit,
  configureRateLimitStore,
  createMemoryRateLimitStore,
  createRateLimiter,
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
    const event = trackServerEvent({
      name: "provider_error_recorded",
      payload: {
        email: "traveler@example.com",
        apiKey: "sk_test_should_not_render",
        reason: "provider timeout",
      },
      env: { SENTRY_DSN: "https://sentry.example/1", NEXT_PUBLIC_POSTHOG_KEY: "phc_test" },
      now: new Date("2026-06-23T08:00:00.000Z"),
    });

    expect(event.sinks.sentryConfigured).toBe(true);
    expect(event.sinks.posthogConfigured).toBe(true);
    expect(JSON.stringify(event.payload)).not.toContain("traveler@example.com");
    expect(JSON.stringify(event.payload)).not.toContain("sk_test");
  });

  test("server-only secret helper refuses public env names", () => {
    expect(getServerSecret("STRIPE_WEBHOOK_SECRET", { STRIPE_WEBHOOK_SECRET: "whsec_test" })).toBe(
      "whsec_test",
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
