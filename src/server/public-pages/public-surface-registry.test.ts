import { describe, expect, test } from "bun:test";

import { publicKnowledgePages } from "@/server/public-pages/public-content";
import {
  buildPublicCanonicalUrl,
  buildPublicHubPath,
  buildPublicHumanPath,
  buildPublicJsonApiPath,
  buildPublicLlmMarkdownPath,
  getPublicSurfaceByRouteSegment,
  isPublicPageFamily,
  type PublicPageFamily,
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";

const expectedFixtureSlugs = {
  accommodations: "example-surf-stay",
  areas: "general-luna",
  routes: "surigao-to-dapa",
  operators: "licensed-van-transfer",
  risks: "late-arrival-transfer-risk",
} satisfies Record<PublicPageFamily, string>;

describe("public surface registry", () => {
  test("enumerates exactly the current catalog families", () => {
    expect(publicPageFamilies).toEqual(["accommodations", "areas", "routes", "operators", "risks"]);
    expect(Object.keys(publicSurfaceRegistry)).toEqual([...publicPageFamilies]);
    expect(isPublicPageFamily("accommodations")).toBe(true);
    expect(isPublicPageFamily("restaurants")).toBe(false);
  });

  test("defines the current human, LLM markdown, JSON, sitemap, and llms.txt surfaces", () => {
    for (const family of publicPageFamilies) {
      const surface = publicSurfaceRegistry[family];
      const slug = expectedFixtureSlugs[family];

      expect(surface.family).toBe(family);
      expect(surface.catalogFamilyKey).toBe(family);
      expect(surface.routeSegment).toBe(family);
      expect(surface.hubPath).toBe(`/${family}`);
      expect(buildPublicHubPath(family)).toBe(`/${family}`);
      expect(surface.humanRoutePattern).toBe(`/${family}/[slug]`);
      expect(surface.llmMarkdownRoutePattern).toBe(`/${family}/[slug]/llm.md`);
      expect(surface.jsonRoutePattern).toBe(`/api/public/${family}/[slug].json`);
      expect(surface.includeInSitemap).toBe(true);
      expect(surface.includeInLlmsTxt).toBe(true);
      expect(getPublicSurfaceByRouteSegment(surface.routeSegment)).toBe(surface);
      expect(buildPublicHumanPath(family, slug)).toBe(`/${family}/${slug}`);
      expect(buildPublicLlmMarkdownPath(family, slug)).toBe(`/${family}/${slug}/llm.md`);
      expect(buildPublicJsonApiPath(family, slug)).toBe(`/api/public/${family}/${slug}.json`);
      expect(buildPublicCanonicalUrl("https://siargao.test/", family, slug)).toBe(
        `https://siargao.test/${family}/${slug}`,
      );
    }
  });

  test("derives fixture page paths from the registry helpers", () => {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://siargao.example").replace(
      /\/$/,
      "",
    );

    for (const family of publicPageFamilies) {
      const slug = expectedFixtureSlugs[family];
      const page = publicKnowledgePages.find(
        (candidate) => candidate.family === family && candidate.slug === slug,
      );

      expect(page).toBeDefined();
      if (!page) {
        throw new Error(`Expected fixture page for ${family}.`);
      }

      expect(page.humanPath).toBe(buildPublicHumanPath(family, slug));
      expect(page.llmMarkdownPath).toBe(buildPublicLlmMarkdownPath(family, slug));
      expect(page.jsonApiPath).toBe(buildPublicJsonApiPath(family, slug));
      expect(page.canonicalUrl).toBe(`${appUrl}${page.humanPath}`);
    }
  });
});
