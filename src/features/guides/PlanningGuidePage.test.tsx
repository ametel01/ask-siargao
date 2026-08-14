import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PlanningGuidePage } from "@/features/guides/PlanningGuidePage";
import { getPlanningGuide } from "@/server/guides/planning-guides";

test("renders a complete, trusted guide with a contextual Reality Check", () => {
  const guide = getPlanningGuide("siargao-5-day-itinerary");

  expect(guide).toBeDefined();
  if (!guide) {
    throw new Error("Expected the five-day planning guide.");
  }

  const html = renderToStaticMarkup(<PlanningGuidePage guide={guide} />);

  expect(html).toContain("5-Day Siargao Itinerary");
  expect(html).toContain("Quick recommendation");
  expect(html).toContain("Realistic travel-time guide");
  expect(html).toContain("Planning map");
  expect(html).toContain("Ask Siargao Editorial Desk");
  expect(html).toContain("Ask Siargao Local Knowledge Review");
  expect(html).toContain("Last checked");
  expect(html).toContain("Sources and limitations");
  expect(html).toContain("Corrections policy");
  expect(html).toContain("Commercial disclosure");
  expect(html).toContain("Frequently asked questions");
  expect(html).toContain("Related planning guides");
  expect(html).toContain('href="/chat?prompt=Context%3A+5-Day+Siargao+Itinerary.');
  expect(html).toContain('"@type":"Article"');
  expect(html).toContain('"@type":"Organization"');
  expect(html).toContain('"@type":"TouristDestination"');
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).not.toContain('"datePublished"');
});
