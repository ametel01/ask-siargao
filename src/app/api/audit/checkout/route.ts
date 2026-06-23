import { checkoutResponse } from "@/app/api/audit/checkout/checkout-route";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return checkoutResponse(request, undefined, rateLimit.headers);
}
