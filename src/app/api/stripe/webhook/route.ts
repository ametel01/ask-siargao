import {
  stripeWebhookResponseFromEvent,
  stripeWebhookSecretFromEnv,
} from "@/app/api/stripe/webhook/webhook-route";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing_stripe_signature" }, { status: 400 });
  }

  let event: Awaited<ReturnType<typeof verifyStripeWebhookPayload>>;

  try {
    const payload = await request.text();
    event = await verifyStripeWebhookPayload({
      payload,
      signature,
      webhookSecret: stripeWebhookSecretFromEnv(),
    });
  } catch {
    return Response.json(
      {
        error: "invalid_stripe_webhook",
        message: "Webhook verification failed.",
      },
      { status: 400 },
    );
  }

  return await stripeWebhookResponseFromEvent(event);
}
