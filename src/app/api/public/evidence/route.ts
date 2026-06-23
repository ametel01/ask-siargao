import { publicPagesForIndex } from "@/server/public-pages/public-content";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export function GET(request: Request) {
  const rateLimit = rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return Response.json({
    evidenceBundles: publicPagesForIndex().map((page) => ({
      slug: `${page.family}-${page.slug}`,
      canonicalUrl: page.canonicalUrl,
      evidenceIds: page.facts.map((fact) => fact.evidenceId),
      allowedUse: "public_republish",
    })),
  });
}
