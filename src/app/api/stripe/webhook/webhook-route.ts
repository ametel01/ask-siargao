import { trackServerEvent } from "@/server/observability/events";
import { applyVerifiedCheckoutPayment } from "@/server/payments/audit-payment-lifecycle";
import {
  extractVerifiedCheckoutPayment,
  verifyStripeWebhookPayload,
} from "@/server/payments/stripe";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

export type StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment: typeof applyVerifiedCheckoutPayment;
  applyTripPassStripeEvent: typeof applyTripPassStripeEvent;
  stripeWebhookSecretFromEnv: typeof stripeWebhookSecretFromEnv;
  trackServerEvent: typeof trackServerEvent;
  verifyStripeWebhookPayload: typeof verifyStripeWebhookPayload;
};

const defaultDependencies: StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment,
  applyTripPassStripeEvent,
  stripeWebhookSecretFromEnv,
  trackServerEvent,
  verifyStripeWebhookPayload,
};

type VerifiedWebhookEvent =
  ReturnType<typeof verifyStripeWebhookPayload> extends Promise<infer T> ? T : never;

export async function stripeWebhookResponseFromEvent(
  event: VerifiedWebhookEvent,
  dependencies: StripeWebhookRouteDependencies = defaultDependencies,
) {
  const tripPassResult = await dependencies.applyTripPassStripeEvent(event);
  if (tripPassResult.status !== "ignored") {
    dependencies.trackServerEvent({
      name: "trip_pass_stripe_event_applied",
      payload: {
        stripeEventId: "stripeEventId" in tripPassResult ? tripPassResult.stripeEventId : event.id,
        eventType: event.type,
        applicationStatus: tripPassResult.status,
        orderId: "orderId" in tripPassResult ? tripPassResult.orderId : undefined,
      },
    });

    return Response.json(
      {
        received: true,
        product: "trip_pass",
        applicationStatus: tripPassResult.status,
        action: "action" in tripPassResult ? tripPassResult.action : undefined,
        orderId: "orderId" in tripPassResult ? tripPassResult.orderId : undefined,
        stripeEventId: "stripeEventId" in tripPassResult ? tripPassResult.stripeEventId : event.id,
        reason: "reason" in tripPassResult ? tripPassResult.reason : undefined,
      },
      { status: tripPassResult.status === "rejected" ? 400 : 200 },
    );
  }

  const payment = extractVerifiedCheckoutPayment(event);

  if (!payment) {
    return Response.json({ received: true, ignored: true });
  }

  const result = await dependencies.applyVerifiedCheckoutPayment(payment, event);

  dependencies.trackServerEvent({
    name: "payment_succeeded",
    payload: {
      auditRequestId: payment.auditRequestId,
      stripeEventId: payment.stripeEventId,
      eventType: payment.eventType,
      applicationStatus: result.status,
    },
  });

  return Response.json({
    received: true,
    applicationStatus: result.status,
    auditRequestId: payment.auditRequestId,
    stripeEventId: payment.stripeEventId,
    generationJobId: result.status === "applied" ? result.job.id : undefined,
  });
}

export async function stripeWebhookResponse(
  request: Request,
  dependencies: StripeWebhookRouteDependencies = defaultDependencies,
) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing_stripe_signature" }, { status: 400 });
  }

  try {
    const payload = await request.text();
    const event = await dependencies.verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret: dependencies.stripeWebhookSecretFromEnv(),
    });
    return await stripeWebhookResponseFromEvent(event, dependencies);
  } catch {
    return Response.json(
      {
        error: "invalid_stripe_webhook",
        message: "Webhook verification failed.",
      },
      { status: 400 },
    );
  }
}

export function stripeWebhookSecretFromEnv() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required for webhook verification.");
  }

  return webhookSecret;
}
