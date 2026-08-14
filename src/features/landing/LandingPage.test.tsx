import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningGuidesHubPage } from "@/features/guides/PlanningGuidesHubPage";
import { LandingPage } from "@/features/landing/LandingPage";
import { PublicKnowledgeHubPage } from "@/features/public-pages/PublicKnowledgeHubPage";
import { planningGuidePath } from "@/server/guides/planning-guide-output";
import { planningGuides } from "@/server/guides/planning-guides";
import { publicKnowledgePages } from "@/server/public-pages/public-content";
import {
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";

test("uses a homepage H1 aligned with the page title", () => {
  const html = renderToStaticMarkup(<LandingPage />);

  expect(html).toContain("<h1");
  expect(html).toContain("Live, local Siargao <span");
  expect(html).toContain(">travel advice</span>");
});

test("loads Trip Pass pricing telemetry through Next Script", () => {
  const html = renderToStaticMarkup(<LandingPage />);

  expect(html).not.toContain('<script defer="" src="/scripts/trip-pass-pricing-telemetry.js"');
});

test("makes every eligible tourism page reachable from home through HTML links", () => {
  const documents = new Map<string, string>([["/", renderToStaticMarkup(<LandingPage />)]]);
  documents.set("/guides", renderToStaticMarkup(<PlanningGuidesHubPage />));

  for (const family of publicPageFamilies) {
    const surface = publicSurfaceRegistry[family];
    documents.set(
      surface.hubPath,
      renderToStaticMarkup(
        <PublicKnowledgeHubPage
          pages={publicKnowledgePages.filter((page) => page.family === family)}
          surface={surface}
        />,
      ),
    );
  }

  const discoveredPaths = crawlHtmlLinks(documents, "/");

  for (const family of publicPageFamilies) {
    expect(discoveredPaths).toContain(publicSurfaceRegistry[family].hubPath);
  }
  for (const page of publicKnowledgePages) {
    expect(discoveredPaths).toContain(page.humanPath);
  }
  expect(discoveredPaths).toContain("/guides");
  for (const guide of planningGuides) {
    expect(discoveredPaths).toContain(planningGuidePath(guide));
  }
});

function crawlHtmlLinks(documents: ReadonlyMap<string, string>, startPath: string) {
  const visitedDocuments = new Set<string>();
  const discoveredPaths = new Set<string>([startPath]);
  const pendingDocuments = [startPath];

  while (pendingDocuments.length > 0) {
    const path = pendingDocuments.shift();
    if (!path || visitedDocuments.has(path)) {
      continue;
    }

    visitedDocuments.add(path);
    for (const href of htmlLinkTargets(documents.get(path) ?? "")) {
      discoveredPaths.add(href);
      if (documents.has(href) && !visitedDocuments.has(href)) {
        pendingDocuments.push(href);
      }
    }
  }

  return [...discoveredPaths];
}

function htmlLinkTargets(html: string) {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((href): href is string => Boolean(href));
}
