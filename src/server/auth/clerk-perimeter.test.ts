import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { clerkWebhookResponse } from "@/app/api/clerk/webhooks/clerk-webhook-route";
import { stripeWebhookResponse } from "@/app/api/stripe/webhook/webhook-route";
import {
  applyDisabledClerkRoutePolicy,
  applyEnabledClerkRoutePolicy,
  getClerkPerimeterDecision,
} from "@/proxy";

describe("Clerk proxy perimeter", () => {
  test("allows public routes without Clerk protection", async () => {
    const auth = protectRecorder();
    const response = await applyEnabledClerkRoutePolicy(auth, "/chat");

    expect(response.status).toBe(200);
    expect(auth.protectCalls).toBe(0);
  });

  test("protects representative authenticated pages and APIs before handlers", async () => {
    for (const pathname of ["/settings", "/profile", "/admin/diagnostics", "/api/me/profile"]) {
      const auth = protectRecorder();
      const response = await applyEnabledClerkRoutePolicy(auth, pathname);

      expect(response.status, pathname).toBe(200);
      expect(auth.protectCalls, pathname).toBe(1);
    }
  });

  test("leaves externally verified webhooks to provider signature handlers", async () => {
    for (const pathname of ["/api/clerk/webhooks", "/api/stripe/webhook"]) {
      const auth = protectRecorder();
      const response = await applyEnabledClerkRoutePolicy(auth, pathname);

      expect(response.status, pathname).toBe(200);
      expect(auth.protectCalls, pathname).toBe(0);
    }
  });

  test("denies synthetic unknown routes in enabled and disabled modes", async () => {
    const enabledResponse = await applyEnabledClerkRoutePolicy(
      protectRecorder(),
      "/api/synthetic/uninventoried",
    );
    const disabledResponse = applyDisabledClerkRoutePolicy("/api/synthetic/uninventoried");

    expect(enabledResponse.status).toBe(404);
    expect(await enabledResponse.json()).toMatchObject({ reason: "unknown_route" });
    expect(disabledResponse.status).toBe(404);
  });

  test("denies protected routes while Clerk is disabled", async () => {
    const response = applyDisabledClerkRoutePolicy("/settings");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: "clerk_disabled_protected_route" });
  });

  test("allows protected UI harness only with the local test flag and request header", async () => {
    const originalHarness = process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS;
    const originalMode = process.env.CLERK_AUTH_MODE;
    const originalContext = process.env.CLERK_DEPLOYMENT_CONTEXT;
    try {
      process.env.CLERK_AUTH_MODE = "disabled";
      process.env.CLERK_DEPLOYMENT_CONTEXT = "local";
      process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS = "1";

      const response = applyDisabledClerkRoutePolicy(
        new NextRequest("https://asksiargao.test/settings", {
          headers: { "x-ask-siargao-protected-ui-harness": "1" },
        }),
      );

      expect(response.status).toBe(200);
      expect(applyDisabledClerkRoutePolicy("/settings").status).toBe(404);
    } finally {
      restoreEnvValue("PLAYWRIGHT_PROTECTED_UI_HARNESS", originalHarness);
      restoreEnvValue("CLERK_AUTH_MODE", originalMode);
      restoreEnvValue("CLERK_DEPLOYMENT_CONTEXT", originalContext);
    }
  });

  test("keeps Clerk frontend proxy traffic outside the application-route inventory", () => {
    expect(getClerkPerimeterDecision("/__clerk/some/path")).toEqual({
      action: "allow",
      classification: "public",
    });
  });

  test("unsigned provider webhook requests reach provider verification, not Clerk auth", async () => {
    const clerkResponse = await clerkWebhookResponse(
      new Request("https://asksiargao.com/api/clerk/webhooks", {
        body: "{}",
        method: "POST",
      }),
      {
        applyClerkUserWebhookEvent: async () => ({ status: "upserted", userId: "unreached" }),
        verifyWebhook: async () => {
          throw new Error("unsigned");
        },
      },
    );
    const stripeResponse = await stripeWebhookResponse(
      new Request("https://asksiargao.com/api/stripe/webhook", {
        body: "{}",
        method: "POST",
      }),
      {
        applyTripPassStripeEvent: async () => ({
          reason: "not_trip_pass_event",
          status: "ignored",
        }),
        applyVerifiedCheckoutPayment: async () => {
          throw new Error("unreached");
        },
        stripeWebhookSecretFromEnv: () => "whsec_test",
        trackServerEvent: () => ({
          at: "2026-08-07T00:00:00.000Z",
          name: "payment_succeeded",
          payload: {},
          sinks: { posthogConfigured: false, sentryConfigured: false },
        }),
        verifyStripeWebhookPayload: async () => {
          throw new Error("unsigned");
        },
      },
    );

    expect(clerkResponse.status).toBe(400);
    expect(await clerkResponse.json()).toMatchObject({ error: "invalid_clerk_webhook" });
    expect(stripeResponse.status).toBe(400);
    expect(await stripeResponse.json()).toMatchObject({ error: "missing_stripe_signature" });
  });
});

function protectRecorder() {
  return {
    protectCalls: 0,
    async protect() {
      this.protectCalls += 1;
    },
  };
}

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
