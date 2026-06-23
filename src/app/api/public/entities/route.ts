import { buildPublicPageJson, publicPagesForIndex } from "@/server/public-pages/public-content";

export function GET() {
  return Response.json({
    entities: publicPagesForIndex().map((page) => buildPublicPageJson(page)),
  });
}
