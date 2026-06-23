import { z } from "zod";

import { auditJobStates } from "@/server/audit/enums";
import { createAuditLifecycleRecord, startCheckoutLifecycle } from "@/server/audit/lifecycle";
import { trackServerEvent } from "@/server/observability/events";
import { createCheckoutSessionForAudit } from "@/server/payments/stripe";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

const checkoutRequestSchema = z.object({
  auditRequestId: z.string().min(1),
  status: z.enum(auditJobStates),
  checkoutEligible: z.boolean().optional(),
  customerEmail: z.string().email().optional(),
});

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const body: unknown = await request.json();
  const parsed = checkoutRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_checkout_request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const audit = createAuditLifecycleRecord({
    id: parsed.data.auditRequestId,
    state: parsed.data.status,
    checkoutEligible: parsed.data.checkoutEligible,
  });

  try {
    const checkout = await createCheckoutSessionForAudit({
      audit,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
      customerEmail: parsed.data.customerEmail,
    });
    const nextAudit = startCheckoutLifecycle(audit, checkout);
    trackServerEvent({
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
      { headers: rateLimit.headers },
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
