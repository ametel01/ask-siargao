import { canonicalSitemapUrl } from "@/server/public-pages/canonical-urls";

export function GET() {
  return new Response(
    [
      "User-agent: *",
      "Disallow: /admin/",
      "Disallow: /audits/",
      "Disallow: /api/audit/",
      "Disallow: /api/stripe/",
      "Disallow: /api/payments/",
      "Allow: /api/public/",
      `Sitemap: ${canonicalSitemapUrl}`,
      "",
    ].join("\n"),
    {
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
