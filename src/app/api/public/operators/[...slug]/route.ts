import { publicJsonResponse } from "@/server/public-pages/responses";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  return publicJsonResponse("operators", slug.join("/"));
}
