import type { Metadata } from "next";

import { publicSurfaceRegistry } from "@/server/public-pages/public-surface-registry";
import {
  generatePublicKnowledgePageMetadata,
  renderPublicHumanPage,
} from "@/server/public-pages/responses";

const surface = publicSurfaceRegistry.operators;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return generatePublicKnowledgePageMetadata(surface, slug);
}

export default async function OperatorPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return renderPublicHumanPage(surface, slug);
}
