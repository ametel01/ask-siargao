import { describe, expect, test } from "bun:test";

import {
  buildGuideChatHref,
  getPlanningGuide,
  planningGuides,
} from "@/server/guides/planning-guides";

const expectedSlugs = [
  "complete-siargao-travel-guide",
  "siargao-first-timer-guide",
  "siargao-3-day-itinerary",
  "siargao-5-day-itinerary",
  "siargao-7-day-itinerary",
  "best-time-to-visit-siargao",
  "siargao-by-month",
] as const;

describe("planning guide registry", () => {
  test("publishes the complete foundation cluster with trust and decision content", () => {
    expect(planningGuides.map((guide) => guide.slug)).toEqual([...expectedSlugs]);

    for (const guide of planningGuides) {
      expect(guide.quickRecommendation.length).toBeGreaterThan(80);
      expect(guide.sections.length).toBeGreaterThanOrEqual(3);
      expect(guide.travelTimes.length).toBeGreaterThanOrEqual(3);
      expect(guide.mapStops.length).toBeGreaterThanOrEqual(3);
      expect(guide.realityChecks.length).toBeGreaterThanOrEqual(4);
      expect(guide.faqs.length).toBeGreaterThanOrEqual(3);
      expect(guide.sources.length).toBeGreaterThanOrEqual(2);
      expect(guide.limitations.length).toBeGreaterThanOrEqual(2);
      expect(guide.author.name).toBeTruthy();
      expect(guide.reviewer.name).toBeTruthy();
      expect(guide.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(guide.image.src).toStartWith("/images/guides/");
    }
  });

  test("looks up only known planning guides", () => {
    expect(getPlanningGuide("siargao-5-day-itinerary")?.title).toContain("5-Day");
    expect(getPlanningGuide("made-up-guide")).toBeUndefined();
  });

  test("builds a page-aware chat URL with one encoded prompt", () => {
    const guide = getPlanningGuide("siargao-5-day-itinerary");
    const action = guide?.realityChecks[0];

    expect(guide).toBeDefined();
    expect(action).toBeDefined();
    if (!guide || !action) {
      throw new Error("Expected the five-day guide and its first Reality Check.");
    }

    const href = buildGuideChatHref(guide, action);
    const url = new URL(href, "https://www.asksiargao.com");

    expect(url.pathname).toBe("/chat");
    expect(url.searchParams.get("prompt")).toContain(guide.title);
    expect(url.searchParams.get("prompt")).toContain(action.prompt);
    expect([...url.searchParams.keys()]).toEqual(["prompt"]);
  });

  test("bases seasonal guidance on the nearest official rainfall normals", () => {
    const bestTime = getPlanningGuide("best-time-to-visit-siargao");
    const byMonth = getPlanningGuide("siargao-by-month");

    expect(bestTime?.quickRecommendation).toContain("May or June");
    expect(bestTime?.quickRecommendation).toContain("Surigao City");
    expect(byMonth?.quickRecommendation).toContain("lowest from May to August");
    expect(byMonth?.sections[0]?.items[0]?.body).toContain("661.5 mm");
    expect(byMonth?.sections[2]?.items[3]?.body).toContain("597.3 mm");
    expect(byMonth?.sources.some((source) => source.name.includes("climatological normals"))).toBe(
      true,
    );
  });
});
