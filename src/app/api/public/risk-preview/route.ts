import { buildPublicPageJson, publicPagesForIndex } from "@/server/public-pages/public-content";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export function GET(request: Request) {
  const rateLimit = rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const risks = [];
  for (const page of publicPagesForIndex()) {
    if (page.family === "risks") {
      risks.push(buildPublicPageJson(page));
    }
  }

  return Response.json({
    risks,
  });
}
