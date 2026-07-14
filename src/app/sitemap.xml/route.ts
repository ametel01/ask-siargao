import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import { buildSitemapXml } from "@/server/public-pages/public-content";

export const dynamic = "force-dynamic";

export async function GET() {
  const pages = await getPublicKnowledgeCatalog().listEligiblePages();

  return new Response(buildSitemapXml(pages), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
