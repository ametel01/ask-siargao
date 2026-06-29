import { putChatRatingResponse } from "@/app/api/chat/ratings/rating-route";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  return putChatRatingResponse(request);
}
