import { stripeWebhookResponse } from "@/app/api/stripe/webhook/webhook-route";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "provider_call");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return stripeWebhookResponse(request);
}
