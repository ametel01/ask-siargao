import { postChatRouteResponse } from "@/app/api/chat/route-entrypoint";

export async function POST(request: Request) {
  return postChatRouteResponse(request);
}
