import { describe, expect, test } from "bun:test";

import { normalizeLocalRecommendation } from "@/server/chat/local-recommendation";

describe("normalizeLocalRecommendation", () => {
  test("maps candidate identity, map link, open-now status, and live source freshness", () => {
    const recommendation = normalizeLocalRecommendation({
      candidate: {
        placeId: "place_shaka",
        name: "Shaka Siargao",
        formattedAddress: "Cloud 9, General Luna",
        primaryType: "cafe",
        types: ["cafe", "food"],
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=shaka",
        distanceMeters: 320,
        rating: 4.7,
        userRatingCount: 500,
        priceLevel: "PRICE_LEVEL_MODERATE",
        currentOpeningHours: { openNow: true },
        source: {
          provider: "google_places",
          fetchedAt: "2026-06-26T01:00:00.000Z",
          freshness: "live",
        },
      },
      category: "coffee",
      centerLabel: "Cloud 9",
      constraints: [],
      index: 0,
    });

    expect(recommendation).toMatchObject({
      id: "place_shaka",
      name: "Shaka Siargao",
      category: "coffee",
      mapsUrl: "https://maps.google.com/?cid=shaka",
      address: "Cloud 9, General Luna",
      distanceMeters: 320,
      openNow: true,
      businessStatus: "OPERATIONAL",
      rating: 4.7,
      reviewCount: 500,
      priceLevel: "PRICE_LEVEL_MODERATE",
      source: {
        provider: "google_places",
        fetchedAt: "2026-06-26T01:00:00.000Z",
        freshness: "live",
      },
    });
    expect(recommendation.fitReasons).toEqual([
      "closest strong match, 320 m from Cloud 9",
      "open now",
    ]);
  });

  test("labels missing hours and carries fresh-cache source freshness", () => {
    const recommendation = normalizeLocalRecommendation({
      candidate: {
        placeId: "place_cache",
        name: "Cached Cafe",
        types: ["cafe"],
        googleMapsUri: "https://maps.google.com/?cid=cache",
        source: {
          provider: "google_places",
          fetchedAt: "2026-06-25T01:00:00.000Z",
          freshness: "fresh_cache",
        },
      },
      category: "coffee",
      centerLabel: "General Luna",
      constraints: [],
      index: 0,
    });

    expect(recommendation.openNow).toBeUndefined();
    expect(recommendation.fitReasons).toEqual(["top-ranked match", "hours not returned"]);
    expect(recommendation.source.freshness).toBe("fresh_cache");
  });

  test("caveats covered and beachfront constraints without claiming verification", () => {
    const recommendation = normalizeLocalRecommendation({
      candidate: {
        placeId: "place_beach",
        name: "Beachfront Spot",
        types: ["restaurant"],
        googleMapsUri: "https://maps.google.com/?cid=beach",
        source: {
          provider: "google_places",
          fetchedAt: "2026-06-26T01:00:00.000Z",
          freshness: "live",
        },
      },
      category: "activity_place",
      centerLabel: "General Luna",
      constraints: ["covered_seating", "beachfront"],
      index: 1,
    });

    expect(recommendation.caveats).toContain("Covered seating is not verified by Google Places.");
    expect(recommendation.caveats).toContain(
      "Beachfront fit is inferred from provider text and not independently verified.",
    );
  });
});
