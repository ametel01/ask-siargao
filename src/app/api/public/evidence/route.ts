import { publicPagesForIndex } from "@/server/public-pages/public-content";

export function GET() {
  return Response.json({
    evidenceBundles: publicPagesForIndex().map((page) => ({
      slug: `${page.family}-${page.slug}`,
      canonicalUrl: page.canonicalUrl,
      evidenceIds: page.facts.map((fact) => fact.evidenceId),
      allowedUse: "public_republish",
    })),
  });
}
