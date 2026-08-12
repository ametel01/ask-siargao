import { after } from "next/server";

import { chatResponse, createDefaultChatRouteDependencies } from "@/app/api/chat/chat-route";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "chat");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return chatResponse(
    request,
    createDefaultChatRouteDependencies({
      deferPersistence: (task) => after(task),
    }),
    rateLimit.headers,
  );
}
