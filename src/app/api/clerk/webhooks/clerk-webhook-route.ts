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

export const maxClerkWebhookBodyBytes = 262_144;

export async function clerkWebhookResponse(
  request: Request,
  dependencies: ClerkWebhookRouteDependencies = defaultDependencies,
) {
  let event: WebhookEvent;

  const boundedRequest = await readBoundedWebhookRequest(request);
  if (boundedRequest.status === "too_large") {
    return Response.json(
      {
        error: "clerk_webhook_too_large",
        message: `Webhook body must be ${maxClerkWebhookBodyBytes} bytes or smaller.`,
      },
      { status: 413 },
    );
  }

  try {
    event = await dependencies.verifyWebhook(boundedRequest.request);
  } catch {
    return Response.json(
      {
        error: "invalid_clerk_webhook",
        message: "Webhook verification failed.",
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
  } catch {
    return Response.json(
      {
        error: "clerk_user_sync_failed",
        message: "Failed to sync Clerk user.",
      },
      { status: 500 },
    );
  }
}

async function readBoundedWebhookRequest(
  request: Request,
): Promise<{ status: "ok"; request: Request } | { status: "too_large" }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > maxClerkWebhookBodyBytes) {
      return { status: "too_large" };
    }
  }

  if (!request.body) {
    return { status: "ok", request };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxClerkWebhookBodyBytes) {
      await reader.cancel();
      return { status: "too_large" };
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    status: "ok",
    request: new Request(request.url, {
      body,
      headers: request.headers,
      method: request.method,
    }),
  };
}

function isUserWebhookEvent(event: WebhookEvent): event is UserWebhookEvent {
  return (
    event.type === "user.created" || event.type === "user.updated" || event.type === "user.deleted"
  );
}
