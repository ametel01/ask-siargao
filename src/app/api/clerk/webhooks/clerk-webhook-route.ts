import type { UserWebhookEvent, WebhookEvent } from "@clerk/backend";
import { verifyWebhook as verifyClerkWebhook } from "@clerk/nextjs/webhooks";

import { applyClerkUserWebhookEvent } from "@/server/auth/clerk-users";

export type ClerkWebhookRouteDependencies = {
  applyClerkUserWebhookEvent: typeof applyClerkUserWebhookEvent;
  verifyWebhook: (request: Request) => Promise<WebhookEvent>;
};

const defaultDependencies: ClerkWebhookRouteDependencies = {
  applyClerkUserWebhookEvent,
  verifyWebhook: (request) =>
    verifyClerkWebhook(request as Parameters<typeof verifyClerkWebhook>[0]),
};

export async function clerkWebhookResponse(
  request: Request,
  dependencies: ClerkWebhookRouteDependencies = defaultDependencies,
) {
  let event: WebhookEvent;

  try {
    event = await dependencies.verifyWebhook(request);
  } catch (error) {
    return Response.json(
      {
        error: "invalid_clerk_webhook",
        message: error instanceof Error ? error.message : "Webhook verification failed.",
      },
      { status: 400 },
    );
  }

  if (!isUserWebhookEvent(event)) {
    return Response.json({ received: true, ignored: true });
  }

  try {
    const result = await dependencies.applyClerkUserWebhookEvent(event);
    return Response.json({ received: true, ...result });
  } catch (error) {
    return Response.json(
      {
        error: "clerk_user_sync_failed",
        message: error instanceof Error ? error.message : "Failed to sync Clerk user.",
      },
      { status: 500 },
    );
  }
}

function isUserWebhookEvent(event: WebhookEvent): event is UserWebhookEvent {
  return (
    event.type === "user.created" || event.type === "user.updated" || event.type === "user.deleted"
  );
}
