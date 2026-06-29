import {
  createChatThreadResponse,
  listChatThreadsResponse,
} from "@/app/api/chat/threads/thread-routes";

export const runtime = "nodejs";

export async function GET() {
  return listChatThreadsResponse();
}

export async function POST(request: Request) {
  return createChatThreadResponse(request);
}
