import { beforeEach, describe, expect, test } from "bun:test";

import { POST } from "@/app/api/audit/intake/route";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

describe("audit intake route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  test("rejects malformed JSON request bodies with a stable error", async () => {
    const response = await POST(rawRequest("{"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
    expect(body.message).toBe("Request body must be valid JSON.");
    expect(response.headers.get("x-ratelimit-limit")).toBe("8");
  });

  test("rejects schema-invalid JSON with intake issues", async () => {
    const response = await POST(jsonRequest({ arrivalOrigin: "Manila" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_intake");
    expect(body.issues.some((issue: { path: string }) => issue.path === "topConstraint")).toBe(
      true,
    );
  });

  test("accepts valid minimal intake JSON", async () => {
    const response = await POST(
      jsonRequest({
        travelMonth: "2026-08",
        arrivalRouteSlug: "surigao-city-to-dapa-ferry",
        stayAreaSlug: "general-luna",
        topConstraint: "quiet sleep",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.auditRequest.status).toBe("complete_for_payment");
    expect(body.checkoutReadiness.status).toBe("ready_for_payment");
    expect(body.checkoutReadiness.checkoutEligible).toBe(true);
    expect(body.accommodationResolution).toBeUndefined();
    expect(body.completeness).toBeUndefined();
    expect(body.auditInput.arrivalRouteSlug).toBe("surigao-city-to-dapa-ferry");
  });
});

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string) {
  return new Request("https://siargao.test/api/audit/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
