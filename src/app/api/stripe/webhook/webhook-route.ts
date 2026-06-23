import { trackServerEvent } from "@/server/observability/events";
import {
  extractVerifiedCheckoutPayment,
  verifyStripeWebhookPayload,
} from "@/server/payments/stripe";
import { applyVerifiedCheckoutPayment } from "@/server/payments/webhook-application";

export type StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment: typeof applyVerifiedCheckoutPayment;
  stripeWebhookSecretFromEnv: typeof stripeWebhookSecretFromEnv;
  trackServerEvent: typeof trackServerEvent;
  verifyStripeWebhookPayload: typeof verifyStripeWebhookPayload;
};

const defaultDependencies: StripeWebhookRouteDependencies = {
  applyVerifiedCheckoutPayment,
  stripeWebhookSecretFromEnv,
  trackServerEvent,
  verifyStripeWebhookPayload,
};

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
  } catch (error) {
    return Response.json(
      {
        error: "invalid_stripe_webhook",
        message: error instanceof Error ? error.message : "Webhook verification failed.",
      },
      { status: 400 },
    );
  }
}

function stripeWebhookSecretFromEnv() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required for webhook verification.");
  }

  return webhookSecret;
}
