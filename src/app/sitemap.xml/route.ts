import { planningGuideSitemapEntries } from "@/server/guides/planning-guide-output";
import { planningGuides } from "@/server/guides/planning-guides";
import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import { buildSitemapXml } from "@/server/public-pages/public-content";

export const dynamic = "force-dynamic";

const SITEMAP_PAGE_LIMIT = 1_000;

export async function GET() {
  const pages = await getPublicKnowledgeCatalog().listEligiblePages({ limit: SITEMAP_PAGE_LIMIT });

  return new Response(buildSitemapXml(pages, planningGuideSitemapEntries(planningGuides)), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
