import { describe, expect, test } from "bun:test";

import { publicKnowledgePages } from "@/server/public-pages/public-content";
import {
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";
import {
  publicKnowledgeHubMetadata,
  publicKnowledgePageMetadata,
} from "@/server/public-pages/responses";

describe("public page metadata", () => {
  test("gives every public hub distinct canonical and social metadata", () => {
    const metadata = publicPageFamilies.map((family) =>
      publicKnowledgeHubMetadata(publicSurfaceRegistry[family]),
    );

    expect(new Set(metadata.map((entry) => entry.title)).size).toBe(publicPageFamilies.length);
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(
      publicPageFamilies.length,
    );

    for (const [index, entry] of metadata.entries()) {
      const surface = publicSurfaceRegistry[publicPageFamilies[index]];
      const canonicalUrl = `https://www.asksiargao.com${surface.hubPath}`;
      const title = `${surface.hubTitle} | Ask Siargao`;

      expect(entry.alternates?.canonical).toBe(canonicalUrl);
      expect(entry.openGraph?.url).toBe(canonicalUrl);
      expect(entry.openGraph?.title).toBe(title);
      expect(entry.openGraph?.description).toBe(surface.hubDescription);
      expect(entry.twitter?.title).toBe(title);
      expect(entry.twitter?.description).toBe(surface.hubDescription);
      expect(entry.robots).toEqual({ index: true, follow: true });
    }
  });

  test("derives every public leaf page's metadata from its visible page content", () => {
    const metadata = publicKnowledgePages.map((page) => publicKnowledgePageMetadata(page));

    expect(new Set(metadata.map((entry) => entry.title)).size).toBe(publicKnowledgePages.length);
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(
      publicKnowledgePages.length,
    );

    for (const [index, entry] of metadata.entries()) {
      const page = publicKnowledgePages[index];
      const canonicalUrl = `https://www.asksiargao.com${page.humanPath}`;

      expect(entry.title).toBe(`${page.title} | Ask Siargao`);
      expect(entry.description).toBe(page.summary);
      expect(entry.alternates?.canonical).toBe(canonicalUrl);
      expect(entry.openGraph?.url).toBe(canonicalUrl);
      expect(entry.openGraph?.images).toHaveLength(1);
      expect(entry.twitter?.images).toHaveLength(1);
    }
  });
});
