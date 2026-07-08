import { z } from "zod";

import { startAuditCheckoutPaymentLifecycle } from "@/server/payments/audit-payment-lifecycle";

const checkoutRequestSchema = z.object({
  auditRequestId: z.string().min(1),
  customerEmail: z.email().optional(),
});

export type CheckoutRouteDependencies = {
  startAuditCheckoutPaymentLifecycle: typeof startAuditCheckoutPaymentLifecycle;
};

const defaultDependencies: CheckoutRouteDependencies = {
  startAuditCheckoutPaymentLifecycle,
};

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

  try {
    const result = await dependencies.startAuditCheckoutPaymentLifecycle({
      auditRequestId: parsed.data.auditRequestId,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
      customerEmail: parsed.data.customerEmail,
    });

    if (result.status === "not_found") {
      return Response.json({ error: "audit_not_found" }, { status: 404 });
    }

    return Response.json(
      {
        auditRequestId: result.audit.id,
        state: result.audit.state,
        checkoutUrl: result.checkout.url,
        stripeCheckoutSessionId: result.checkout.id,
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        error: "checkout_not_available",
        message: "Checkout could not be started.",
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
