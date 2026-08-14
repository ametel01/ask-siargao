import { expect, test } from "bun:test";

import { GET } from "@/app/robots.txt/route";

test("publishes the fully qualified canonical sitemap URL", async () => {
  const response = GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toContain("Sitemap: https://www.asksiargao.com/sitemap.xml");
});

test("allows crawlers to observe noindex metadata on application surfaces", async () => {
  const robots = await GET().text();

  for (const route of ["/chat", "/sign-in", "/sign-up", "/profile", "/settings", "/trips/"]) {
    expect(robots).not.toContain(`Disallow: ${route}`);
  }
});
