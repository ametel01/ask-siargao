import { describe, expect, test } from "bun:test";

import type { ItineraryPlan, RecommendationCard } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  browserSavedTripStateSchema,
  createSharedTripPlanRequestSchema,
  mapsUrlSchema,
  normalizePublicTripTitle,
  normalizeSavedTripItem,
  publicSharedTripPlanFromStored,
  savedTripItemFromItineraryPlan,
  savedTripItemFromRecommendationCard,
  savedTripItemSchema,
} from "@/server/trips/shared-trip-types";

describe("shared trip artifact contracts", () => {
  test("normalizes recommendation cards without importing React UI components", () => {
    const savedAt = "2026-06-28T01:00:00.000Z";
    const item = savedTripItemFromRecommendationCard({
      card: {
        ...placeCard,
        title: "  Shaka   Siargao  ",
        caveats: ["  Open-now can change quickly.  ", ""],
      },
      sources: [placesSource],
      savedAt,
      tripId: "local_trip_123456",
    });

    expect(item).toMatchObject({
      id: "place_shaka",
      tripId: "local_trip_123456",
      kind: "place",
      title: "Shaka Siargao",
      createdAt: savedAt,
      updatedAt: savedAt,
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Shaka%20Siargao",
      payload: {
        type: "recommendation_card",
        card: {
          id: "place_shaka",
          kind: "place",
          title: "Shaka Siargao",
          caveats: ["Open-now can change quickly."],
        },
      },
      sources: [placesSource],
      caveats: ["Open-now can change quickly."],
    });
  });

  test("normalizes itinerary artifacts with allowed source summaries", () => {
    const item = savedTripItemFromItineraryPlan({
      id: "itinerary_cloud9_rain",
      plan: rainyPlan,
      savedAt: "2026-06-28T01:05:00.000Z",
      tripId: "local_trip_123456",
    });

    expect(item.kind).toBe("itinerary");
    expect(item.title).toBe("Rain-aware Cloud 9 afternoon");
    expect(item.sources).toEqual([...rainyPlan.sources]);
    expect(item.payload.type).toBe("itinerary_plan");
    expect(item.payload.type === "itinerary_plan" ? item.payload.plan.stops : []).toHaveLength(2);
    expect(JSON.stringify(item)).toContain("Open-Meteo weather API");
    expect(JSON.stringify(item)).not.toContain("toolCalls");
    expect(JSON.stringify(item)).not.toContain("messages");
  });

  test("preserves allowed source freshness, trust labels, and not-checked caveats", () => {
    const item = savedTripItemFromItineraryPlan({
      id: "itinerary_source_policy",
      plan: {
        ...rainyPlan,
        sources: [placesSource, weatherSource, curatedLocalSource, freshCacheSource],
      },
      savedAt: "2026-06-28T01:05:00.000Z",
      tripId: "local_trip_123456",
    });

    expect(item.sources).toEqual([
      placesSource,
      weatherSource,
      curatedLocalSource,
      freshCacheSource,
    ]);
    expect(item.payload.type === "itinerary_plan" ? item.payload.plan.sources : []).toEqual([
      placesSource,
      weatherSource,
      curatedLocalSource,
      freshCacheSource,
    ]);
    expect(JSON.stringify(item)).toContain("2026-06-28T00:45:00.000Z");
    expect(JSON.stringify(item)).toContain("table availability");
    expect(JSON.stringify(item)).toContain("local guide notes");
  });

  test("public shared plans preserve captured source evidence and add not-reverified context", () => {
    const item = savedTripItemFromItineraryPlan({
      id: "itinerary_public_source_policy",
      plan: {
        ...rainyPlan,
        sources: [placesSource, weatherSource],
      },
      savedAt: "2026-06-28T01:05:00.000Z",
      tripId: "local_trip_123456",
    });
    const publicPlan = publicSharedTripPlanFromStored({
      id: "shared_trip_source_policy",
      title: "Source policy plan",
      items: [item],
      createdAt: "2026-06-28T01:06:00.000Z",
    });

    const publicItem = publicPlan.items[0];
    expect(publicItem?.tripId).toBeUndefined();
    expect(publicItem?.sources).toEqual([
      placesSource,
      weatherSource,
      browserSavedNotReverifiedSource,
    ]);
    expect(
      publicItem?.payload.type === "itinerary_plan" ? publicItem.payload.plan.sources : [],
    ).toEqual([placesSource, weatherSource, browserSavedNotReverifiedSource]);
    expect(JSON.stringify(publicPlan)).toContain("live_checked");
    expect(JSON.stringify(publicPlan)).toContain("weather_checked");
    expect(JSON.stringify(publicPlan)).toContain("current opening status");
    expect(JSON.stringify(publicPlan)).toContain("Saved from browser and not reverified");
  });

  test("public shared recommendation cards keep captured live and open-status labels", () => {
    const item = savedTripItemFromRecommendationCard({
      card: placeCard,
      sources: [placesSource],
      savedAt: "2026-06-28T01:00:00.000Z",
      tripId: "local_trip_123456",
    });
    const publicPlan = publicSharedTripPlanFromStored({
      id: "shared_trip_open_status",
      title: "Open status plan",
      items: [item],
      createdAt: "2026-06-28T01:06:00.000Z",
    });

    const publicItem = publicPlan.items[0];
    expect(
      publicItem?.payload.type === "recommendation_card"
        ? publicItem.payload.card.openStatusLabel
        : undefined,
    ).toBe("Open now from Google Places");
    expect(
      publicItem?.payload.type === "recommendation_card"
        ? publicItem.payload.card.sourceLabel
        : undefined,
    ).toBe("Google Places - live checked");
    expect(publicItem?.sources).toEqual([placesSource, browserSavedNotReverifiedSource]);
    expect(JSON.stringify(publicPlan)).toContain("Google Places - live checked");
    expect(JSON.stringify(publicPlan)).toContain("Open now from Google Places");
    expect(JSON.stringify(publicPlan)).toContain("Saved from browser and not reverified");
  });

  test("rejects oversized, malformed, or mismatched saved items", () => {
    const baseItem = savedTripItemFromRecommendationCard({
      card: placeCard,
      sources: [placesSource],
      savedAt: "2026-06-28T01:00:00.000Z",
    });

    expect(
      savedTripItemSchema.safeParse({
        ...baseItem,
        title: "x".repeat(181),
      }).success,
    ).toBe(false);
    expect(
      savedTripItemSchema.safeParse({
        ...baseItem,
        kind: "beach",
      }).success,
    ).toBe(false);
    expect(
      savedTripItemSchema.safeParse({
        ...baseItem,
        mapsUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  test("allows only Google Maps URL patterns for public map links", () => {
    const allowedUrls = [
      "https://google.com/maps/search/?api=1&query=Shaka%20Siargao",
      "https://www.google.com/maps/place/Cloud+9",
      "https://google.com.ph/maps/search/?api=1&query=General%20Luna",
      "https://www.google.com.ph/maps/place/Cloud+9",
      "https://maps.google.com/?q=Cloud%209%20Siargao",
      "https://maps.google.com.ph/maps?q=General%20Luna",
      "https://maps.app.goo.gl/abc123",
    ];
    const rejectedUrls = [
      "https://accounts.google.com/signin",
      "https://docs.google.com/document/d/fake",
      "https://goo.gl/maps/legacy",
      "https://maps.google.evil.com/maps?q=Cloud%209",
      "https://maps.google.evil/maps?q=Cloud%209",
      "https://maps.google.zip/maps?q=Cloud%209",
      "https://google.com/search?q=Cloud%209",
      "https://www.google.com/calendar",
      "http://www.google.com/maps/search/?api=1&query=Shaka%20Siargao",
    ];

    for (const url of allowedUrls) {
      expect(mapsUrlSchema.safeParse(url).success).toBe(true);
    }

    for (const url of rejectedUrls) {
      expect(mapsUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  test("rejects raw tool calls, provider payloads, full chat messages, and coordinates", () => {
    const baseItem = savedTripItemFromRecommendationCard({
      card: placeCard,
      sources: [placesSource],
      savedAt: "2026-06-28T01:00:00.000Z",
    });

    const forbiddenVariants = [
      { ...baseItem, toolCalls: [{ name: "search_places" }] },
      { ...baseItem, messages: [{ role: "user", content: "Where should I eat?" }] },
      { ...baseItem, latitude: 9.8116, longitude: 126.1651 },
      {
        ...baseItem,
        payload: {
          ...baseItem.payload,
          card: {
            ...(baseItem.payload.type === "recommendation_card" ? baseItem.payload.card : {}),
            rawProviderPayload: { reviews: ["Do not republish"] },
          },
        },
      },
      {
        ...baseItem,
        payload: {
          ...baseItem.payload,
          card: {
            ...(baseItem.payload.type === "recommendation_card" ? baseItem.payload.card : {}),
            googleReviews: [{ text: "Best smoothie bowl on the island." }],
          },
        },
      },
      {
        ...baseItem,
        payload: {
          ...baseItem.payload,
          card: {
            ...(baseItem.payload.type === "recommendation_card" ? baseItem.payload.card : {}),
            reviewText: "Best smoothie bowl on the island.",
          },
        },
      },
      {
        ...baseItem,
        payload: {
          ...baseItem.payload,
          card: {
            ...(baseItem.payload.type === "recommendation_card" ? baseItem.payload.card : {}),
            location: { latitude: 9.8116, longitude: 126.1651 },
          },
        },
      },
      {
        ...baseItem,
        sources: [{ ...placesSource, rawSource: { body: "private provider body" } }],
      },
      {
        ...baseItem,
        toolCallArguments: {
          center: { latitude: 9.8116, longitude: 126.1651 },
        },
      },
    ];

    for (const variant of forbiddenVariants) {
      expect(savedTripItemSchema.safeParse(variant).success).toBe(false);
    }
  });

  test("validates browser storage and share request DTOs", () => {
    const item = savedTripItemFromRecommendationCard({
      card: placeCard,
      sources: [placesSource],
      savedAt: "2026-06-28T01:00:00.000Z",
      tripId: "local_trip_123456",
    });

    expect(
      browserSavedTripStateSchema.safeParse({
        tripId: "local_trip_123456",
        items: [item],
        updatedAt: "2026-06-28T01:01:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      createSharedTripPlanRequestSchema.safeParse({
        tripId: "local_trip_123456",
        title: "Cloud 9 food plan",
        itemIds: [item.id],
      }).success,
    ).toBe(true);
    expect(
      createSharedTripPlanRequestSchema.safeParse({
        tripId: "local_trip_123456",
        itemIds: [],
      }).success,
    ).toBe(false);
    expect(
      browserSavedTripStateSchema.safeParse({
        tripId: "local_trip_123456",
        items: [item],
        updatedAt: "2026-06-28T01:01:00.000Z",
        messages: [{ role: "user", content: "Where should I eat?" }],
      }).success,
    ).toBe(false);
    expect(
      createSharedTripPlanRequestSchema.safeParse({
        tripId: "local_trip_123456",
        itemIds: [item.id],
        clientContext: {
          geolocation: {
            latitude: 9.8116,
            longitude: 126.1651,
            capturedAt: "2026-06-28T01:01:00.000Z",
            consentScope: "single_request",
          },
        },
      }).success,
    ).toBe(false);
  });

  test("normalizes public plan titles without accepting empty labels", () => {
    expect(normalizePublicTripTitle("  Cloud 9   dinner  ")).toBe("Cloud 9 dinner");
    expect(normalizePublicTripTitle(undefined)).toBe("Siargao saved plan");
    expect(() =>
      normalizeSavedTripItem({
        ...savedTripItemFromRecommendationCard({
          card: placeCard,
          sources: [placesSource],
          savedAt: "2026-06-28T01:00:00.000Z",
        }),
        title: "   ",
      }),
    ).toThrow();
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

const curatedLocalSource: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao local guide",
  sourceProfileId: "source_local_guide",
  confidence: "medium",
  checked: ["local guide notes"],
  notChecked: ["current closures"],
};

const freshCacheSource: AnswerSourceSummary = {
  label: "fresh_cache",
  sourceName: "Google Places API cached result",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-28T00:10:00.000Z",
  confidence: "high",
  checked: ["place identity"],
  notChecked: ["review text", "table availability"],
};

const browserSavedNotReverifiedSource: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Browser saved trip",
  confidence: "low",
  checked: [],
  notChecked: ["Saved from browser and not reverified by Ask Siargao before sharing."],
};

const placeCard: RecommendationCard = {
  id: "place_shaka",
  kind: "place",
  title: "Shaka Siargao",
  subtitle: "Smoothie bowls near Cloud 9",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Shaka%20Siargao",
  distanceLabel: "8 min from Cloud 9",
  openStatusLabel: "Open now from Google Places",
  fitReasons: ["Near Cloud 9", "Good light breakfast stop"],
  caveats: ["Open-now can change quickly."],
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
    {
      title: "Covered cafe backup",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 12,
      rationale: "Keeps the plan useful during passing rain.",
      caveats: ["Live open status should be checked before leaving."],
    },
  ],
  fallbackStops: [
    {
      title: "Indoor coffee stop",
      kind: "meal",
      sequence: 3,
      area: "General Luna",
      rationale: "Better if showers turn persistent.",
      caveats: ["Confirm current hours."],
    },
  ],
  skip: ["Long exposed scooter loops in heavy rain."],
  sources: [weatherSource],
};
