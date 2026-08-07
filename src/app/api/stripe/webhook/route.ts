import {
  stripeWebhookResponse,
  stripeWebhookRouteDependenciesForRequest,
} from "@/app/api/stripe/webhook/webhook-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return await stripeWebhookResponse(request, stripeWebhookRouteDependenciesForRequest());
}
