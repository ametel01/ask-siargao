import { lemonSqueezyWebhookResponse } from "@/app/api/payments/lemon-squeezy/webhook/webhook-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return lemonSqueezyWebhookResponse(request);
}
