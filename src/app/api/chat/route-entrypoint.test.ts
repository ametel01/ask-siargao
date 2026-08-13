import { describe, expect, test } from "bun:test";

import { postChatRouteResponse } from "@/app/api/chat/route-entrypoint";
import {
  modelProviderConsentCookieName,
  modelProviderConsentVersion,
} from "@/lib/model-provider-consent";

const productionDeepSeek = {
  APP_ENV: "production",
  CHAT_MODEL_PROVIDER: "deepseek",
};

describe("chat route entrypoint", () => {
  test("rejects production DeepSeek requests without current provider consent before rate limiting", async () => {
    let rateLimitCalls = 0;
    let responseCalls = 0;
    const response = await postChatRouteResponse(new Request("https://asksiargao.com/api/chat"), {
      authenticate: async () => "user_consent_boundary",
      env: productionDeepSeek,
      rateLimit: async () => {
        rateLimitCalls += 1;
        return allowedRateLimit();
      },
      respond: async () => {
        responseCalls += 1;
        return Response.json({ ok: true });
      },
    });

    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({
      error: "model_provider_consent_required",
      consentVersion: modelProviderConsentVersion,
      privacyUrl: "/legal/privacy",
    });
    expect(rateLimitCalls).toBe(0);
    expect(responseCalls).toBe(0);
  });

  test("rejects signed-out requests before rate limiting or the chat implementation", async () => {
    let rateLimitCalls = 0;
    let responseCalls = 0;
    const request = new Request("https://asksiargao.com/api/chat", {
      headers: {
        cookie: `${modelProviderConsentCookieName}=${modelProviderConsentVersion}`,
      },
    });
    const response = await postChatRouteResponse(request, {
      authenticate: async () => null,
      env: productionDeepSeek,
      rateLimit: async () => {
        rateLimitCalls += 1;
        return allowedRateLimit();
      },
      respond: async () => {
        responseCalls += 1;
        return Response.json({ ok: true });
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(rateLimitCalls).toBe(0);
    expect(responseCalls).toBe(0);
  });

  test("accepts the current consent version for an authenticated request", async () => {
    const request = new Request("https://asksiargao.com/api/chat", {
      headers: {
        cookie: `${modelProviderConsentCookieName}=${modelProviderConsentVersion}`,
      },
    });
    const response = await postChatRouteResponse(request, {
      authenticate: async () => "user_chat_boundary",
      env: productionDeepSeek,
      rateLimit: async () => allowedRateLimit(),
      respond: async (_request, headers) =>
        Response.json(
          { ok: true },
          { headers: { "x-rate-limit-test": new Headers(headers).get("x-test") ?? "" } },
        ),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

function allowedRateLimit() {
  return {
    allowed: true as const,
    limit: 30,
    remaining: 29,
    resetAt: new Date("2026-08-13T00:01:00.000Z").toISOString(),
    headers: new Headers({ "x-test": "allowed" }),
  };
}
