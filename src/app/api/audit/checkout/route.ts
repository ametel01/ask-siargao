import { checkoutResponse } from "@/app/api/audit/checkout/checkout-route";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "checkout");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return checkoutResponse(request, undefined, rateLimit.headers);
}
