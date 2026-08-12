import { describe, expect, test } from "bun:test";

import { GET, POST } from "@/app/api/privacy/model-provider-consent/route";
import {
  modelProviderConsentCookieName,
  modelProviderConsentVersion,
} from "@/lib/model-provider-consent";

describe("model provider consent route", () => {
  test("reports only the exact current server cookie as consented", async () => {
    expect(
      await (
        await GET(
          new Request("https://asksiargao.com/api/privacy/model-provider-consent", {
            headers: {
              cookie: `${modelProviderConsentCookieName}=${modelProviderConsentVersion}`,
            },
          }),
        )
      ).json(),
    ).toEqual({ consented: true });
    expect(
      await (
        await GET(new Request("https://asksiargao.com/api/privacy/model-provider-consent"))
      ).json(),
    ).toEqual({ consented: false });
  });

  test("sets the exact current acknowledgement in a bounded HttpOnly cookie", async () => {
    const response = await POST(consentRequest(modelProviderConsentVersion));
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ consentVersion: modelProviderConsentVersion });
    expect(setCookie).toContain(`${modelProviderConsentCookieName}=${modelProviderConsentVersion}`);
    expect(setCookie).toContain("Max-Age=15552000");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
  });

  test("rejects stale versions, malformed bodies, and cross-origin requests", async () => {
    expect((await POST(consentRequest("stale-version"))).status).toBe(400);
    expect(
      (
        await POST(
          new Request("https://asksiargao.com/api/privacy/model-provider-consent", {
            method: "POST",
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          consentRequest(modelProviderConsentVersion, {
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site",
          }),
        )
      ).status,
    ).toBe(403);
  });
});

function consentRequest(consentVersion: string, headers: Record<string, string> = {}) {
  return new Request("https://asksiargao.com/api/privacy/model-provider-consent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://asksiargao.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify({ consentVersion }),
  });
}
