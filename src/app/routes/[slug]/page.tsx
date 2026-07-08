import { publicSurfaceRegistry } from "@/server/public-pages/public-surface-registry";
import { renderPublicHumanPage } from "@/server/public-pages/responses";

const surface = publicSurfaceRegistry.routes;

export default async function RoutePublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return renderPublicHumanPage(surface, slug);
}
