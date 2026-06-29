import {
  deleteChatThreadResponse,
  getChatThreadResponse,
  patchChatThreadResponse,
} from "@/app/api/chat/threads/thread-routes";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  return getChatThreadResponse(threadId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  return patchChatThreadResponse(request, threadId);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  return deleteChatThreadResponse(threadId);
}
