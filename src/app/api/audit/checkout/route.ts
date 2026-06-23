import { z } from "zod";

import { getCheckoutAuditState } from "@/server/audit/checkout-state";
import { assertCanStartCheckout, startCheckoutLifecycle } from "@/server/audit/lifecycle";
import { trackServerEvent } from "@/server/observability/events";
import { createCheckoutSessionForAudit } from "@/server/payments/stripe";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

const checkoutRequestSchema = z
  .object({
    auditRequestId: z.string().min(1),
    customerEmail: z.string().email().optional(),
  })
  .strip();

export type CheckoutRouteDependencies = {
  getCheckoutAuditState: typeof getCheckoutAuditState;
  createCheckoutSessionForAudit: typeof createCheckoutSessionForAudit;
  trackServerEvent: typeof trackServerEvent;
};

const defaultDependencies: CheckoutRouteDependencies = {
  getCheckoutAuditState,
  createCheckoutSessionForAudit,
  trackServerEvent,
};

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return checkoutResponse(request, defaultDependencies, rateLimit.headers);
}

export async function checkoutResponse(
  request: Request,
  dependencies: CheckoutRouteDependencies = defaultDependencies,
  headers?: HeadersInit,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidCheckoutRequest([{ path: "", message: "Expected a valid JSON request body." }]);
  }

  const parsed = checkoutRequestSchema.safeParse(body);

  if (!parsed.success) {
    return invalidCheckoutRequest(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const audit = await dependencies.getCheckoutAuditState(parsed.data.auditRequestId);

  if (!audit) {
    return Response.json({ error: "audit_not_found" }, { status: 404 });
  }

  try {
    assertCanStartCheckout(audit);
    const checkout = await dependencies.createCheckoutSessionForAudit({
      audit,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
      customerEmail: parsed.data.customerEmail,
    });
    const nextAudit = startCheckoutLifecycle(audit, checkout);
    dependencies.trackServerEvent({
      name: "preview_to_payment_started",
      payload: {
        auditRequestId: nextAudit.id,
        state: nextAudit.state,
      },
    });

    return Response.json(
      {
        auditRequestId: nextAudit.id,
        state: nextAudit.state,
        checkoutUrl: checkout.url,
        stripeCheckoutSessionId: checkout.id,
      },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error: "checkout_not_available",
        message: error instanceof Error ? error.message : "Checkout could not be started.",
      },
      { status: 409 },
    );
  }
}

function invalidCheckoutRequest(issues: Array<{ path: string; message: string }>) {
  return Response.json(
    {
      error: "invalid_checkout_request",
      issues,
    },
    { status: 400 },
  );
}
