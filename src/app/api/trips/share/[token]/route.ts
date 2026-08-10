import {
  revokeSharedTripTokenResponse,
  sharedTripTokenResponse,
} from "@/app/api/trips/trip-routes";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const { token } = await context.params;
  return sharedTripTokenResponse(request, { token, headers: rateLimit.headers });
}

export async function DELETE(request: Request, context: { params: Promise<{ token: string }> }) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const { token } = await context.params;
  return revokeSharedTripTokenResponse(request, { token, headers: rateLimit.headers });
}
