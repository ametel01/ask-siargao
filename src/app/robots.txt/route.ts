export function GET() {
  return new Response(
    [
      "User-agent: *",
      "Disallow: /admin/",
      "Disallow: /audits/",
      "Disallow: /api/audit/",
      "Disallow: /api/stripe/",
      "Allow: /api/public/",
      "Sitemap: /sitemap.xml",
      "",
    ].join("\n"),
    {
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}
