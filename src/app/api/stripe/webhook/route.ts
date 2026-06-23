import {
  stripeWebhookResponseFromEvent,
  stripeWebhookSecretFromEnv,
} from "@/app/api/stripe/webhook/webhook-route";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";
import { verifyStripeWebhookPayload } from "@/server/payments/stripe";

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

    return stripeWebhookResponseFromEvent(event);
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
