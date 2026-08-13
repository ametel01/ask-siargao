import { after } from "next/server";

import { chatResponse, createDefaultChatRouteDependencies } from "@/app/api/chat/chat-route";
import {
  hasModelProviderConsent,
  modelProviderConsentVersion,
  requiresModelProviderConsent,
} from "@/lib/model-provider-consent";
import { getAuthenticatedClerkUserId } from "@/server/auth/clerk-users";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

type ChatRouteEntrypointDependencies = {
  authenticate: () => Promise<string | null>;
  env?: Record<string, string | undefined>;
  rateLimit: typeof rateLimitRequest;
  respond: (request: Request, headers: HeadersInit) => Promise<Response>;
};

export async function postChatRouteResponse(
  request: Request,
  dependencies: ChatRouteEntrypointDependencies = {
    authenticate: getAuthenticatedClerkUserId,
    rateLimit: rateLimitRequest,
    respond: (chatRequest, headers) =>
      chatResponse(
        chatRequest,
        createDefaultChatRouteDependencies({
          deferPersistence: (task) => after(task),
        }),
        headers,
      ),
  },
) {
  const userId = await dependencies.authenticate();
  if (!userId) {
    return Response.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }

  if (
    requiresModelProviderConsent(dependencies.env) &&
    !hasModelProviderConsent(request.headers.get("cookie"))
  ) {
    return Response.json(
      {
        error: "model_provider_consent_required",
        consentVersion: modelProviderConsentVersion,
        privacyUrl: "/legal/privacy",
      },
      { status: 428, headers: { "cache-control": "private, no-store" } },
    );
  }

  const rateLimit = await dependencies.rateLimit(request, "chat");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return dependencies.respond(request, rateLimit.headers);
}
