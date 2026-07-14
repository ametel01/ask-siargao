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
