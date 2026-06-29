import { verifyWebhook as verifyClerkWebhook } from "@clerk/nextjs/webhooks";

import { clerkWebhookResponse } from "@/app/api/clerk/webhooks/clerk-webhook-route";
import { applyClerkUserWebhookEvent } from "@/server/auth/clerk-users";

export const runtime = "nodejs";

const verifyWebhook = (webhookRequest: Request) =>
  verifyClerkWebhook(webhookRequest as Parameters<typeof verifyClerkWebhook>[0]);

export async function POST(request: Request) {
  return clerkWebhookResponse(request, {
    applyClerkUserWebhookEvent,
    verifyWebhook,
  });
}
