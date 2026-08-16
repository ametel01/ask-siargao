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

test("surfaces the commercial ladder near the hero and pricing before guides", () => {
  const html = renderToStaticMarkup(<LandingPage />);
  const ladderIndex = html.indexOf(' id="commercial-ladder"');
  const planningIndex = html.indexOf(' id="plan-smarter"');
  const pricingIndex = html.indexOf(' id="trip-pass"');
  const guidesIndex = html.indexOf(' id="travel-guides"');

  expect(ladderIndex).toBeGreaterThan(-1);
  expect(ladderIndex).toBeLessThan(planningIndex);
  expect(pricingIndex).toBeGreaterThan(planningIndex);
  expect(pricingIndex).toBeLessThan(guidesIndex);
  expect(html).toContain("10 answers");
  expect(html).toContain("150 answers");
});

test("distinguishes Trip Pass as the recommended trip-long option", () => {
  const html = renderToStaticMarkup(<LandingPage />);

  expect(html).toContain("Recommended for your trip");
  expect(html).toContain("Trip Pass · 150 answers · 14 days");
  expect(html).toContain("about $0.07 each");
  expect(html).toContain("$0.71 a day");
  expect(html).toContain("bg-gradient-price-card");
});

test("describes Trip Pass purchase and activation without exposing the settings destination", () => {
  const html = renderToStaticMarkup(<LandingPage />);

  expect(html).toContain("Get the 14-day Trip Pass — $9.99");
  expect(html).toContain(
    "Sign in to continue your purchase. Your 14-day Trip Pass activates only after payment is confirmed.",
  );
  expect(html).not.toContain("Trip Pass in settings");
  expect(html).not.toContain("signed-in settings");
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
