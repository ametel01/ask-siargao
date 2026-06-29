import { clerkWebhookResponse } from "@/app/api/clerk/webhooks/clerk-webhook-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return clerkWebhookResponse(request);
}
