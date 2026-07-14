import { savedTripsResponse } from "@/app/api/trips/trip-routes";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function GET(request: Request) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return savedTripsResponse(request, undefined, rateLimit.headers);
}

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return savedTripsResponse(request, undefined, rateLimit.headers);
}
