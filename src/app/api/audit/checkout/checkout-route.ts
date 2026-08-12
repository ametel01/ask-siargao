import { startAuditCheckoutPaymentLifecycle } from "@/server/payments/audit-payment-lifecycle";

export type CheckoutRouteDependencies = {
  startAuditCheckoutPaymentLifecycle: typeof startAuditCheckoutPaymentLifecycle;
};

const defaultDependencies: CheckoutRouteDependencies = {
  startAuditCheckoutPaymentLifecycle,
};

export async function checkoutResponse(
  _request: Request,
  _dependencies: CheckoutRouteDependencies = defaultDependencies,
  headers?: HeadersInit,
) {
  return Response.json(
    {
      error: "checkout_not_available",
      message: "Legacy Trip Risk Audit checkout is not available.",
    },
    { status: 410, headers },
  );
}
