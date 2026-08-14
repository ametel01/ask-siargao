import { describe, expect, test } from "bun:test";

import { POST } from "@/app/api/observability/events/route";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

describe("client observability event route", () => {
  test("accepts only the consent-aware Trip Pass pricing view event", async () => {
    resetRateLimitStoreForTests();
    const response = await POST(
      new Request("https://siargao.test/api/observability/events", {
        body: JSON.stringify({
          name: "trip_pass_pricing_viewed",
          surface: "landing",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
  });

  test("accepts privacy-safe planning guide views and Reality Check clicks", async () => {
    resetRateLimitStoreForTests();
    const journeyId = "019fff77-a797-7470-98ca-9ad3e5e5195b";
    const events = [
      {
        guideSlug: "siargao-5-day-itinerary",
        journeyId,
        name: "planning_guide_viewed",
        surface: "planning_guide",
      },
      {
        action: "weather",
        guideSlug: "siargao-5-day-itinerary",
        journeyId,
        name: "planning_guide_reality_check_clicked",
        surface: "panel",
      },
    ];

    for (const event of events) {
      const response = await POST(
        new Request("https://siargao.test/api/observability/events", {
          body: JSON.stringify(event),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "accepted" });
    }
  });

  test("rejects unknown guides and arbitrary Reality Check action labels", async () => {
    resetRateLimitStoreForTests();
    const response = await POST(
      new Request("https://siargao.test/api/observability/events", {
        body: JSON.stringify({
          action: "raw traveler prompt",
          guideSlug: "made-up-guide",
          journeyId: "019fff77-a797-7470-98ca-9ad3e5e5195b",
          name: "planning_guide_reality_check_clicked",
          surface: "panel",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_analytics_event" });
  });

  test("rejects arbitrary client analytics names and sensitive payloads", async () => {
    resetRateLimitStoreForTests();
    const response = await POST(
      new Request("https://siargao.test/api/observability/events", {
        body: JSON.stringify({
          email: "traveler@example.com",
          name: "llm_cost_recorded",
          prompt: "private trip question",
          surface: "landing",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_analytics_event" });
  });
});
