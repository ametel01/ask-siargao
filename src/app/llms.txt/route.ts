import { buildLlmsTxt } from "@/server/public-pages/public-content";

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
