import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";

import { type CheckoutRouteDependencies, checkoutResponse } from "@/app/api/audit/checkout/route";
import type { AuditJobState } from "@/server/audit/enums";
import { type AuditLifecycleRecord, createAuditLifecycleRecord } from "@/server/audit/lifecycle";

const now = new Date("2026-06-23T08:00:00.000Z");

describe("audit checkout route", () => {
  test("rejects malformed JSON request bodies", async () => {
    const response = await checkoutResponse(rawRequest("{"), checkoutDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_checkout_request");
  });

  test("rejects checkout when the audit request is not found", async () => {
    const response = await checkoutResponse(jsonRequest({ auditRequestId: "audit_missing" }), {
      ...checkoutDependencies(),
      getCheckoutAuditState: async () => null,
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("audit_not_found");
  });

  test("rejects checkout when persisted state needs user input", async () => {
    const dependencies = checkoutDependencies({
      audit: auditState("audit_incomplete", "needs_user_input", false),
    });
    const response = await checkoutResponse(
      jsonRequest({ auditRequestId: "audit_incomplete" }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("checkout_not_available");
    expect(dependencies.checkoutCalls).toHaveLength(0);
  });

  test("ignores spoofed client status when persisted state is incomplete", async () => {
    const dependencies = checkoutDependencies({
      audit: auditState("audit_spoofed", "needs_user_input", false),
    });
    const response = await checkoutResponse(
      jsonRequest({
        auditRequestId: "audit_spoofed",
        status: "complete_for_payment",
        checkoutEligible: true,
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("checkout_not_available");
    expect(dependencies.checkoutCalls).toHaveLength(0);
  });

  test("creates Checkout only for persisted complete and eligible audits", async () => {
    const dependencies = checkoutDependencies({
      audit: auditState("audit_ready", "complete_for_payment", true),
    });
    const response = await checkoutResponse(
      jsonRequest({
        auditRequestId: "audit_ready",
        customerEmail: "traveler@example.com",
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.auditRequestId).toBe("audit_ready");
    expect(body.state).toBe("awaiting_payment");
    expect(body.checkoutUrl).toBe("https://checkout.stripe.test/session");
    expect(dependencies.checkoutCalls).toHaveLength(1);
    expect(dependencies.checkoutCalls[0]?.audit.state).toBe("complete_for_payment");
    expect(dependencies.checkoutCalls[0]?.customerEmail).toBe("traveler@example.com");
    expect(dependencies.events).toEqual(["preview_to_payment_started"]);
  });
});

function checkoutDependencies(input: { audit?: AuditLifecycleRecord | null } = {}) {
  const checkoutCalls: Parameters<CheckoutRouteDependencies["createCheckoutSessionForAudit"]>[0][] =
    [];
  const events: string[] = [];
  const dependencies: CheckoutRouteDependencies & {
    checkoutCalls: typeof checkoutCalls;
    events: typeof events;
  } = {
    getCheckoutAuditState: async () => input.audit ?? null,
    createCheckoutSessionForAudit: async (checkoutInput) => {
      checkoutCalls.push(checkoutInput);
      return {
        id: "cs_test_123",
        url: "https://checkout.stripe.test/session",
        params: {} as Stripe.Checkout.SessionCreateParams,
      };
    },
    trackServerEvent: (event) => {
      events.push(event.name);
      return {
        name: event.name,
        at: now.toISOString(),
        payload: event.payload,
        sinks: {
          posthogConfigured: false,
          sentryConfigured: false,
        },
      };
    },
    checkoutCalls,
    events,
  };

  return dependencies;
}

function auditState(
  id: string,
  state: AuditJobState,
  checkoutEligible: boolean,
): AuditLifecycleRecord {
  return createAuditLifecycleRecord({
    id,
    state,
    checkoutEligible,
    now,
  });
}

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string) {
  return new Request("https://siargao.test/api/audit/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
