import { describe, expect, test } from "bun:test";

import { createPlacesEvidenceAdapter } from "@/server/providers/google-places-evidence";
import type { FreshGooglePlaceDetails } from "@/server/providers/google-places-store";

describe("Places evidence adapter", () => {
  test("routes chat search through an injected provider adapter", async () => {
    const calls: unknown[] = [];
    const adapter = createPlacesEvidenceAdapter({
      getGooglePlacesChatContext: async (input) => {
        calls.push(input);
        return {
          status: "no_results",
          sourceName: "Google Places",
          sourceProfileId: "source_google_places",
          fetchedAt: input.fetchedAt,
          freshness: "live",
          search: input.search,
          fieldMask:
            "places.id,places.name,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel,places.priceRange,places.websiteUri,places.internationalPhoneNumber",
          places: [],
          caveats: [],
        };
      },
    });

    const result = await adapter.search({
      fetchedAt: "2026-07-01T00:00:00.000Z",
      requiresLiveStatus: true,
      search: {
        label: "agent_scooter_rental",
        textQuery: "scooter rental in General Luna Siargao",
        center: { latitude: 9.784, longitude: 126.158 },
        radiusMeters: 8_000,
        pageSize: 8,
      },
      trace: { requestId: "request_places" },
    });

    expect(result.status).toBe("no_results");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fetchedAt: "2026-07-01T00:00:00.000Z",
      requiresLiveStatus: true,
      trace: { requestId: "request_places" },
    });
  });

  test("normalizes fresh cached details behind the adapter seam", async () => {
    const adapter = createPlacesEvidenceAdapter({
      findFreshPlaceDetails: async () => freshDetailsRow(),
    });

    const details = await adapter.findFreshDetails({
      now: "2026-07-01T00:00:00.000Z",
      placeId: "place_kermit",
    });

    expect(details).toMatchObject({
      placeId: "place_kermit",
      resourceName: "places/place_kermit",
      displayName: "Kermit Surf Resort and Restaurant",
      googleMapsUri: "https://maps.google.com/?cid=123",
      currentOpeningHours: { openNow: true, nextCloseTime: "2026-07-01T22:00:00Z" },
      priceRange: {
        startPrice: { currencyCode: "PHP", units: "300" },
        endPrice: { currencyCode: "PHP", units: "600" },
      },
      rating: 4.6,
      userRatingCount: 1240,
      fetchedAt: "2026-06-25T00:00:00.000Z",
    });
  });
});

function freshDetailsRow(): FreshGooglePlaceDetails {
  return {
    place_id: "place_kermit",
    resource_name: "places/place_kermit",
    display_name_json: { text: "Kermit Surf Resort and Restaurant" },
    formatted_address: "Tourism Road, General Luna, Siargao",
    latitude: "9.803",
    longitude: "126.161",
    types_json: ["restaurant", "food"],
    primary_type: "restaurant",
    business_status: "OPERATIONAL",
    google_maps_uri: "https://maps.google.com/?cid=123",
    opening_hours_json: {
      openNow: true,
      nextCloseTime: "2026-07-01T22:00:00Z",
    },
    price_level: "PRICE_LEVEL_MODERATE",
    price_range_json: {
      startPrice: { currencyCode: "PHP", units: "300" },
      endPrice: { currencyCode: "PHP", units: "600" },
    },
    rating: "4.6",
    user_rating_count: 1240,
    fetched_at: new Date("2026-06-25T00:00:00.000Z"),
    stale_at: new Date("2026-07-02T00:00:00.000Z"),
    retention_expires_at: new Date("2026-07-25T00:00:00.000Z"),
  };
}
