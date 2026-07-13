import { publicSurfaceRegistry } from "@/server/public-pages/public-surface-registry";
import { publicMarkdownResponse } from "@/server/public-pages/responses";

const surface = publicSurfaceRegistry.risks;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return publicMarkdownResponse(surface, slug);
}
