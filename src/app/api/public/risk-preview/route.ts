import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import { buildPublicRiskPreview } from "@/server/public-pages/public-content";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function GET(request: Request) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const pages = await getPublicKnowledgeCatalog().listEligiblePages();

  return Response.json(buildPublicRiskPreview(pages));
}
