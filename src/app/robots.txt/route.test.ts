import { expect, test } from "bun:test";

import { GET } from "@/app/robots.txt/route";

test("publishes the fully qualified canonical sitemap URL", async () => {
  const response = GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toContain("Sitemap: https://www.asksiargao.com/sitemap.xml");
});
