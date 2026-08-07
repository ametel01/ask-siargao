import {
  deleteTripPassCheckoutResponse,
  postTripPassCheckoutResponse,
} from "@/app/api/me/trip-pass/trip-pass-route";
import { rateLimitRequest } from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: "rate_limited",
        resetAt: rateLimit.resetAt,
      },
      {
        status: 429,
        headers: { ...rateLimit.headers, "cache-control": "private, no-store" },
      },
    );
  }

  return postTripPassCheckoutResponse(request, undefined, rateLimit.headers);
}

export async function DELETE(request: Request) {
  const rateLimit = await rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: "rate_limited",
        resetAt: rateLimit.resetAt,
      },
      {
        status: 429,
        headers: { ...rateLimit.headers, "cache-control": "private, no-store" },
      },
    );
  }

  return deleteTripPassCheckoutResponse(request, undefined, rateLimit.headers);
}
