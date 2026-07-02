import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import { buildLlmsTxt } from "@/server/public-pages/public-content";

export async function GET() {
  const pages = await getPublicKnowledgeCatalog().listEligiblePages();

  return new Response(buildLlmsTxt(pages), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
