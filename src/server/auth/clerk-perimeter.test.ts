import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { clerkWebhookResponse } from "@/app/api/clerk/webhooks/clerk-webhook-route";
import { stripeWebhookResponse } from "@/app/api/stripe/webhook/webhook-route";
import {
  applyDisabledClerkRoutePolicy,
  applyEnabledClerkRoutePolicy,
  getClerkPerimeterDecision,
} from "@/proxy";

const vercelSignalEnvFields = [
  "VERCEL",
  "VERCEL_BRANCH_URL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_PROJECT_ID",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
] as const;

describe("Clerk proxy perimeter", () => {
  test("allows public routes without Clerk protection", async () => {
    const auth = protectRecorder();
    const response = await applyEnabledClerkRoutePolicy(auth, "/chat");

    expect(response.status).toBe(200);
    expect(auth.protectCalls).toBe(0);
  });

  test("protects representative authenticated pages and APIs before handlers", async () => {
    for (const pathname of [
      "/settings",
      "/profile",
      "/admin/diagnostics",
      "/admin/field-ingestion",
      "/api/admin/repairs",
      "/api/admin/trip-pass/refunds",
      "/api/me/profile",
      "/operator/field/security-workspace",
      "/api/operator/field/devices",
      "/field-service-worker",
    ]) {
      const auth = protectRecorder();
      const response = await applyEnabledClerkRoutePolicy(auth, pathname);

      expect(response.status, pathname).toBe(200);
      expect(auth.protectCalls, pathname).toBe(1);
    }
  });

  test("allows anonymous chat API requests without Clerk protection", async () => {
    const auth = protectRecorder();
    const response = await applyEnabledClerkRoutePolicy(auth, "/api/chat");

    expect(response.status).toBe(200);
    expect(auth.protectCalls).toBe(0);
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
    const originalHarnessToken = process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN;
    const originalMode = process.env.CLERK_AUTH_MODE;
    const originalContext = process.env.CLERK_DEPLOYMENT_CONTEXT;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVercelSignals = snapshotEnvValues(vercelSignalEnvFields);
    try {
      clearEnvValues(vercelSignalEnvFields);
      process.env.CLERK_AUTH_MODE = "disabled";
      process.env.CLERK_DEPLOYMENT_CONTEXT = "local";
      setEnvValue("NODE_ENV", "development");
      process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS = "1";
      process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN = "local-test-harness-token-1234567890";

      const response = applyDisabledClerkRoutePolicy(
        new NextRequest("https://asksiargao.test/settings", {
          headers: {
            "x-ask-siargao-protected-ui-harness": "1",
            "x-ask-siargao-protected-ui-harness-token": "local-test-harness-token-1234567890",
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(applyDisabledClerkRoutePolicy("/settings").status).toBe(404);
      expect(
        applyDisabledClerkRoutePolicy(
          new NextRequest("https://asksiargao.test/settings", {
            headers: { "x-ask-siargao-protected-ui-harness": "1" },
          }),
        ).status,
      ).toBe(404);
    } finally {
      restoreEnvValue("PLAYWRIGHT_PROTECTED_UI_HARNESS", originalHarness);
      restoreEnvValue("PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN", originalHarnessToken);
      restoreEnvValue("CLERK_AUTH_MODE", originalMode);
      restoreEnvValue("CLERK_DEPLOYMENT_CONTEXT", originalContext);
      restoreEnvValue("NODE_ENV", originalNodeEnv);
      restoreEnvValues(originalVercelSignals);
    }
  });

  test("denies protected UI harness when Vercel deployment signals exist", async () => {
    const originalHarness = process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS;
    const originalHarnessToken = process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN;
    const originalMode = process.env.CLERK_AUTH_MODE;
    const originalContext = process.env.CLERK_DEPLOYMENT_CONTEXT;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalProjectId = process.env.VERCEL_PROJECT_ID;
    const originalProjectProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const originalVercelUrl = process.env.VERCEL_URL;
    try {
      process.env.CLERK_AUTH_MODE = "disabled";
      process.env.CLERK_DEPLOYMENT_CONTEXT = "local";
      setEnvValue("NODE_ENV", "development");
      process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS = "1";
      process.env.PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN = "local-test-harness-token-1234567890";
      process.env.VERCEL_PROJECT_ID = "prj_askSiargaoStableProject";
      process.env.VERCEL_PROJECT_PRODUCTION_URL = "asksiargao.com";
      process.env.VERCEL_URL = "ask-siargao-production-a1b2c3.vercel.app";

      const response = applyDisabledClerkRoutePolicy(
        new NextRequest("https://asksiargao.test/settings", {
          headers: {
            "x-ask-siargao-protected-ui-harness": "1",
            "x-ask-siargao-protected-ui-harness-token": "local-test-harness-token-1234567890",
          },
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ reason: "clerk_disabled_protected_route" });
    } finally {
      restoreEnvValue("PLAYWRIGHT_PROTECTED_UI_HARNESS", originalHarness);
      restoreEnvValue("PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN", originalHarnessToken);
      restoreEnvValue("CLERK_AUTH_MODE", originalMode);
      restoreEnvValue("CLERK_DEPLOYMENT_CONTEXT", originalContext);
      restoreEnvValue("NODE_ENV", originalNodeEnv);
      restoreEnvValue("VERCEL_PROJECT_ID", originalProjectId);
      restoreEnvValue("VERCEL_PROJECT_PRODUCTION_URL", originalProjectProductionUrl);
      restoreEnvValue("VERCEL_URL", originalVercelUrl);
    }
  });

  test("limits the production-mode Field Security harness to local field routes", () => {
    const original = {
      flag: process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS,
      mode: process.env.CLERK_AUTH_MODE,
      context: process.env.CLERK_DEPLOYMENT_CONTEXT,
      token: process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN,
    };
    try {
      process.env.CLERK_AUTH_MODE = "disabled";
      process.env.CLERK_DEPLOYMENT_CONTEXT = "local";
      process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS = "1";
      process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN =
        "ask-siargao-field-security-production-harness-2026";
      const headers = {
        "x-ask-siargao-field-security-harness": "1",
        "x-ask-siargao-field-security-harness-token":
          "ask-siargao-field-security-production-harness-2026",
      };
      expect(
        applyDisabledClerkRoutePolicy(
          new NextRequest("https://asksiargao.test/operator/field/offline-shell", { headers }),
        ).status,
      ).toBe(200);
      expect(
        applyDisabledClerkRoutePolicy(
          new NextRequest("https://asksiargao.test/settings", { headers }),
        ).status,
      ).toBe(404);
    } finally {
      restoreEnvValue("PLAYWRIGHT_FIELD_SECURITY_HARNESS", original.flag);
      restoreEnvValue("CLERK_AUTH_MODE", original.mode);
      restoreEnvValue("CLERK_DEPLOYMENT_CONTEXT", original.context);
      restoreEnvValue("PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN", original.token);
    }
  });

  test("accepts the local harness cookie on a service-worker shell fetch", () => {
    const original = {
      flag: process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS,
      mode: process.env.CLERK_AUTH_MODE,
      context: process.env.CLERK_DEPLOYMENT_CONTEXT,
      token: process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN,
    };
    try {
      process.env.CLERK_AUTH_MODE = "disabled";
      process.env.CLERK_DEPLOYMENT_CONTEXT = "local";
      process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS = "1";
      process.env.PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN =
        "ask-siargao-field-security-production-harness-2026";
      expect(
        applyDisabledClerkRoutePolicy(
          new NextRequest("https://asksiargao.test/operator/field/offline-shell", {
            headers: {
              cookie:
                "ask_siargao_field_security_harness=ask-siargao-field-security-production-harness-2026",
            },
          }),
        ).status,
      ).toBe(200);
    } finally {
      restoreEnvValue("PLAYWRIGHT_FIELD_SECURITY_HARNESS", original.flag);
      restoreEnvValue("CLERK_AUTH_MODE", original.mode);
      restoreEnvValue("CLERK_DEPLOYMENT_CONTEXT", original.context);
      restoreEnvValue("PLAYWRIGHT_FIELD_SECURITY_HARNESS_TOKEN", original.token);
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
        receiveStripeWebhookEvent: async () => {
          throw new Error("unsigned Stripe requests must not reach durable receipt");
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

function setEnvValue(name: string, value: string) {
  process.env[name] = value;
}

function snapshotEnvValues(names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<
    string,
    string | undefined
  >;
}

function restoreEnvValues(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    restoreEnvValue(name, value);
  }
}

function clearEnvValues(names: readonly string[]) {
  for (const name of names) {
    delete process.env[name];
  }
}
