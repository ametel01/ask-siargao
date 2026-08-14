import { planningGuideLlmsLines } from "@/server/guides/planning-guide-output";
import { planningGuides } from "@/server/guides/planning-guides";
import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import { buildLlmsTxt } from "@/server/public-pages/public-content";

export const dynamic = "force-dynamic";

export async function GET() {
  const pages = await getPublicKnowledgeCatalog().listEligiblePages();

  return new Response(buildLlmsTxt(pages, planningGuideLlmsLines(planningGuides)), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
