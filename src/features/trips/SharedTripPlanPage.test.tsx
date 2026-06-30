import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SharedTripPlanPage } from "@/features/trips/SharedTripPlanPage";
import type { ItineraryPlan, RecommendationCard } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  publicSharedTripPlanFromStored,
  savedTripItemFromItineraryPlan,
  savedTripItemFromRecommendationCard,
} from "@/server/trips/shared-trip-types";

describe("SharedTripPlanPage", () => {
  test("renders selected cards and itineraries without chat transcript fields", () => {
    const html = renderToStaticMarkup(
      <SharedTripPlanPage
        plan={publicSharedTripPlanFromStored({
          id: "shared_plan_1",
          title: "Cloud 9 saved plan",
          createdAt: "2026-06-28T01:00:00.000Z",
          items: [
            savedTripItemFromRecommendationCard({
              card: shakaCard,
              sources: [placesSource],
              savedAt: "2026-06-28T01:00:00.000Z",
              tripId: "local_trip_page_123456",
            }),
            savedTripItemFromItineraryPlan({
              id: "itinerary_cloud9",
              plan: rainyPlan,
              savedAt: "2026-06-28T01:00:00.000Z",
              tripId: "local_trip_page_123456",
            }),
          ],
        })}
      />,
    );

    expect(html).toContain("Cloud 9 saved plan");
    expect(html).toContain("Shaka Siargao");
    expect(html).not.toContain("Review text and bookings were not checked.");
    expect(html).toContain("Rain-aware Cloud 9 afternoon");
    expect(html).toContain("Cloud 9 boardwalk");
    expect(html).toContain("Covered cafe backup");
    expect(html).toContain("General Luna");
    expect(html).not.toContain("Live open status should be checked before leaving.");
    expect(html).toContain("Open now from Google Places");
    expect(html).toContain("Google Places - live checked");
    expect(html).toContain("Google Places API - live checked - fetched 2026-06-28T00:45:00.000Z");
    expect(html).toContain("Checked by Google Places API: place identity");
    expect(html).toContain(
      "Open-Meteo weather API - weather checked - fetched 2026-06-28T00:30:00.000Z",
    );
    expect(html).toContain("Checked by Open-Meteo weather API: forecast for General Luna");
    expect(html).toContain("Not checked by Open-Meteo weather API: surf reports");
    expect(html).toContain(
      "Not checked by Browser saved trip: Saved from browser and not reverified by Ask Siargao before sharing.",
    );
    expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=Shaka%20Siargao");
    expect(html).toContain(
      "https://www.google.com/maps/search/?api=1&amp;query=General%20Luna%20cafe",
    );
    expect(html).not.toContain("Where should I eat?");
    expect(html).not.toContain("assistant");
    expect(html).not.toContain("rawProviderPayload");
    expect(html).not.toContain("9.8116");
  });

  test("renders a generic unavailable state for invalid, expired, or deleted tokens", () => {
    const html = renderToStaticMarkup(<SharedTripPlanPage plan={null} />);

    expect(html).toContain("Shared plan unavailable");
    expect(html).toContain("fresh link");
    expect(html).not.toContain("expired");
    expect(html).not.toContain("deleted");
    expect(html).not.toContain("not found");
  });
});

const placesSource: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places API",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-28T00:45:00.000Z",
  confidence: "high",
  checked: ["place identity", "current opening status"],
  notChecked: ["review text", "table availability"],
};

const weatherSource: AnswerSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-28T00:30:00.000Z",
  confidence: "medium",
  checked: ["forecast for General Luna"],
  notChecked: ["surf reports", "road flooding"],
};

const shakaCard: RecommendationCard = {
  id: "place_shaka",
  kind: "place",
  title: "Shaka Siargao",
  subtitle: "Smoothie bowls near Cloud 9",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Shaka%20Siargao",
  distanceLabel: "8 min from Cloud 9",
  openStatusLabel: "Open now from Google Places",
  fitReasons: ["Near Cloud 9", "Good light breakfast stop"],
  caveats: ["Review text and bookings were not checked."],
  sourceLabel: "Google Places - live checked",
};

const rainyPlan: ItineraryPlan = {
  title: "Rain-aware Cloud 9 afternoon",
  durationLabel: "3 hours",
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Cloud%209%20Siargao",
      rationale: "Quick photo stop before heavier rain.",
      caveats: ["Skip exposed boardwalk time if lightning is nearby."],
    },
  ],
  fallbackStops: [
    {
      title: "Covered cafe backup",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=General%20Luna%20cafe",
      rationale: "Keeps the plan useful during passing rain.",
      caveats: ["Live open status should be checked before leaving."],
    },
  ],
  skip: ["Long exposed scooter loops in heavy rain."],
  sources: [weatherSource],
};
