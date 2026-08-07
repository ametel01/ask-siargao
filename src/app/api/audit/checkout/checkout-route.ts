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
  _dependencies: CheckoutRouteDependencies = defaultDependencies,
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

  return Response.json(
    {
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    },
    { status: 410, headers },
  );
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
