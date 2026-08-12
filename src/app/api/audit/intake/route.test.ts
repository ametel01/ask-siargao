import { beforeEach, describe, expect, test } from "bun:test";

import { POST } from "@/app/api/audit/intake/route";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

describe("audit intake route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  test("returns the retirement tombstone for malformed requests", async () => {
    const response = await POST(rawRequest("{"));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "audit_intake_retired",
      message: "Legacy Trip Risk Audit intake is no longer available.",
    });
    expect(response.headers.get("x-ratelimit-limit")).toBe("8");
  });

  test("returns the retirement tombstone for schema-invalid requests", async () => {
    const response = await POST(jsonRequest({ arrivalOrigin: "Manila" }));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toBe("audit_intake_retired");
  });

  test("cannot advertise payment readiness for valid legacy intake", async () => {
    const response = await POST(
      jsonRequest({
        travelMonth: "2026-08",
        arrivalRouteSlug: "surigao-city-to-dapa-ferry",
        stayAreaSlug: "general-luna",
        topConstraint: "quiet sleep",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "audit_intake_retired",
      message: "Legacy Trip Risk Audit intake is no longer available.",
    });
    expect(JSON.stringify(body)).not.toContain("ready_for_payment");
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
