import { buildPublicPageJson, publicPagesForIndex } from "@/server/public-pages/public-content";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export function GET(request: Request) {
  const rateLimit = rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return Response.json({
    entities: publicPagesForIndex().map((page) => buildPublicPageJson(page)),
  });
}
