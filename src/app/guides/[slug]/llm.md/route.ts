import { buildPlanningGuideMarkdown } from "@/server/guides/planning-guide-output";
import { getPlanningGuide, planningGuides } from "@/server/guides/planning-guides";

export const dynamicParams = false;

export function generateStaticParams() {
  return planningGuides.map((guide) => ({ slug: guide.slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const guide = getPlanningGuide((await params).slug);
  if (!guide) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buildPlanningGuideMarkdown(guide), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
