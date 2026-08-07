import { stripeWebhookResponse } from "@/app/api/stripe/webhook/webhook-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return stripeWebhookResponse(request);
}
