import { deleteSavedTripItemResponse } from "@/app/api/trips/trip-routes";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function DELETE(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const rateLimit = rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const { itemId } = await context.params;
  return deleteSavedTripItemResponse(request, { itemId, headers: rateLimit.headers });
}
