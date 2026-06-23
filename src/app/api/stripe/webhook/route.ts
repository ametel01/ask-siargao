import { trackServerEvent } from "@/server/observability/events";
import {
  buildVerifiedPaymentEventRecord,
  extractVerifiedCheckoutPayment,
  verifyStripeWebhookPayload,
} from "@/server/payments/stripe";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "provider_call");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing_stripe_signature" }, { status: 400 });
  }

  try {
    const payload = await request.text();
    const event = await verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret: stripeWebhookSecretFromEnv(),
    });
    const payment = extractVerifiedCheckoutPayment(event);

    if (!payment) {
      return Response.json({ received: true, ignored: true });
    }

    trackServerEvent({
      name: "payment_succeeded",
      payload: {
        auditRequestId: payment.auditRequestId,
        stripeEventId: payment.stripeEventId,
        eventType: payment.eventType,
      },
    });

    return Response.json({
      received: true,
      paymentEvent: buildVerifiedPaymentEventRecord({
        payment,
        rawEvent: event,
        verifiedAt: new Date(),
      }),
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
