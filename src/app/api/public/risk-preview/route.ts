import { buildPublicPageJson, publicPagesForIndex } from "@/server/public-pages/public-content";

export function GET() {
  return Response.json({
    risks: publicPagesForIndex()
      .filter((page) => page.family === "risks")
      .map((page) => buildPublicPageJson(page)),
  });
}
