import { publicSurfaceRegistry } from "@/server/public-pages/public-surface-registry";
import { publicJsonResponse } from "@/server/public-pages/responses";

const surface = publicSurfaceRegistry.risks;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  return publicJsonResponse(surface, slug.join("/"), request);
}
