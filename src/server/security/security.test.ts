import { describe, expect, test } from "bun:test";

import { trackServerEvent } from "@/server/observability/events";
import { evaluatePublicEligibility } from "@/server/public-pages/public-content";
import { getServerSecret, sanitizeIntakeForMetrics } from "@/server/security/privacy";
import { checkRateLimit, resetRateLimitStoreForTests } from "@/server/security/rate-limit";

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
      "src/features/intake/IntakeForm.tsx",
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
