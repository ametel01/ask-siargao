import { afterEach, beforeEach, expect, test } from "bun:test";

import { GET } from "@/app/llms.txt/route";
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

test("serves recommended llms.txt Markdown with browsable canonical links", async () => {
  const response = await GET();
  const markdown = await response.text();
  const links = [...markdown.matchAll(/\[[^\]]+\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(markdown).toStartWith("# Ask Siargao\n");
  expect(markdown).toContain("[Public entities](https://www.asksiargao.com/api/public/entities)");
  expect(markdown).toContain(
    "[Example Surf Stay](https://www.asksiargao.com/accommodations/example-surf-stay)",
  );
  expect(markdown).toContain(
    "[Complete Siargao Travel Guide](https://www.asksiargao.com/guides/complete-siargao-travel-guide)",
  );
  expect(markdown).toContain(
    "[LLM-ready Markdown](https://www.asksiargao.com/guides/complete-siargao-travel-guide/llm.md)",
  );
  expect(links.length).toBeGreaterThanOrEqual(20);
  expect(links.every((url) => url?.startsWith("https://www.asksiargao.com/"))).toBe(true);
  expect(markdown).not.toContain("http://");
});
