import { publicJsonResponse } from "@/server/public-pages/responses";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  return publicJsonResponse("operators", slug.join("/"), request);
}
