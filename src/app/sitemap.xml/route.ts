import { buildSitemapXml } from "@/server/public-pages/public-content";

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
