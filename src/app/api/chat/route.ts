import { after } from "next/server";

import { chatResponse, createDefaultChatRouteDependencies } from "@/app/api/chat/chat-route";
import {
  hasModelProviderConsent,
  modelProviderConsentVersion,
  requiresModelProviderConsent,
} from "@/lib/model-provider-consent";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  return postChatRouteResponse(request);
}

type ChatRouteEntrypointDependencies = {
  env?: Record<string, string | undefined>;
  rateLimit: typeof rateLimitRequest;
  respond: (request: Request, headers: HeadersInit) => Promise<Response>;
};

export async function postChatRouteResponse(
  request: Request,
  dependencies: ChatRouteEntrypointDependencies = {
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
