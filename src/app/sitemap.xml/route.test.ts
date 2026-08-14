import { afterEach, beforeEach, expect, test } from "bun:test";

import { GET } from "@/app/sitemap.xml/route";
import {
  createFixturePublicKnowledgeCatalog,
  resetPublicKnowledgeCatalogForTests,
} from "@/server/public-pages/public-catalog";

beforeEach(() => {
  resetPublicKnowledgeCatalogForTests(createFixturePublicKnowledgeCatalog());
});

afterEach(() => {
  resetPublicKnowledgeCatalogForTests();
});

test("serves home, topic hubs, and every eligible tourism page as canonical URLs", async () => {
  const response = await GET();
  const xml = await response.text();
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
  expect(locations).toHaveLength(11);
  expect(locations[0]).toBe("https://www.asksiargao.com/");
  expect(locations).toContain("https://www.asksiargao.com/accommodations");
  expect(locations).toContain("https://www.asksiargao.com/accommodations/example-surf-stay");
  expect(locations.every((url) => url?.startsWith("https://www.asksiargao.com/"))).toBe(true);
  expect(xml).not.toContain("audit_");
  expect(xml).not.toContain("<loc>/");
});
