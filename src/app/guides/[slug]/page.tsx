import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlanningGuidePage } from "@/features/guides/PlanningGuidePage";
import { planningGuidePath } from "@/server/guides/planning-guide-output";
import { getPlanningGuide, planningGuides } from "@/server/guides/planning-guides";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

export const dynamicParams = false;

export function generateStaticParams() {
  return planningGuides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const guide = getPlanningGuide((await params).slug);
  if (!guide) {
    notFound();
  }

  const canonicalUrl = buildCanonicalSiteUrl(planningGuidePath(guide));
  const metadata = buildIndexablePageMetadata({
    title: `${guide.title} | Ask Siargao`,
    description: guide.description,
    canonicalUrl,
  });

  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: "article",
      authors: [guide.author.name],
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getPlanningGuide((await params).slug);
  if (!guide) {
    notFound();
  }

  return <PlanningGuidePage guide={guide} />;
}
