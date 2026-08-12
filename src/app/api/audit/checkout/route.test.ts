import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";

import {
  type CheckoutRouteDependencies,
  checkoutResponse,
} from "@/app/api/audit/checkout/checkout-route";
import type { AuditJobState } from "@/server/audit/enums";
import { type AuditLifecycleRecord, createAuditLifecycleRecord } from "@/server/audit/lifecycle";
import { startAuditCheckoutPaymentLifecycle } from "@/server/payments/audit-payment-lifecycle";
import type { createCheckoutSessionForAudit } from "@/server/payments/stripe";

const now = new Date("2026-06-23T08:00:00.000Z");

describe("audit checkout route", () => {
  test("returns the retirement tombstone for malformed requests", async () => {
    const response = await checkoutResponse(rawRequest("{"), checkoutDependencies());
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    });
  });

  test("keeps legacy audit checkout closed even when the audit request is not found", async () => {
    const response = await checkoutResponse(
      jsonRequest({ auditRequestId: "audit_missing" }),
      checkoutDependencies({ audit: null }),
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    });
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

    expect(response.status).toBe(410);
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

    expect(response.status).toBe(410);
    expect(body.error).toBe("checkout_not_available");
    expect(dependencies.checkoutCalls).toHaveLength(0);
  });

  test("does not create Checkout for persisted complete and eligible audits", async () => {
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

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    });
    expect(dependencies.checkoutCalls).toHaveLength(0);
    expect(dependencies.persistedAudits).toHaveLength(0);
    expect(dependencies.events).toEqual([]);
  });

  test("does not call checkout lifecycle and cannot expose provider exception text", async () => {
    const internalPhrase = "fixture_should_not_render_checkout_lifecycle";
    const response = await checkoutResponse(jsonRequest({ auditRequestId: "audit_throws" }), {
      startAuditCheckoutPaymentLifecycle: async () => {
        throw new Error(`checkout lifecycle failed ${internalPhrase}`);
      },
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    });
    expect(JSON.stringify(body)).not.toContain(internalPhrase);
  });
});

function checkoutDependencies(input: { audit?: AuditLifecycleRecord | null } = {}) {
  const checkoutCalls: Parameters<typeof createCheckoutSessionForAudit>[0][] = [];
  const persistedAudits: AuditLifecycleRecord[] = [];
  const events: string[] = [];
  const dependencies: CheckoutRouteDependencies & {
    checkoutCalls: typeof checkoutCalls;
    persistedAudits: typeof persistedAudits;
    events: typeof events;
  } = {
    startAuditCheckoutPaymentLifecycle: (checkoutInput) =>
      startAuditCheckoutPaymentLifecycle(checkoutInput, {
        store: {
          loadCheckoutAudit: async () => input.audit ?? null,
          saveCheckoutStarted: async (audit) => {
            persistedAudits.push(audit);
          },
        },
        createCheckoutSessionForAudit: async (sessionInput) => {
          checkoutCalls.push(sessionInput);
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
        now,
      }),
    checkoutCalls,
    persistedAudits,
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
