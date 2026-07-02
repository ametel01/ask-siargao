import { describe, expect, test } from "bun:test";

import type { GooglePlacesChatContext } from "@/server/providers/google-places-chat";
import {
  createGooglePlacesChatCaptureInput,
  googlePlacesChatSearchCacheKey,
} from "@/server/providers/google-places-governed-capture";

describe("Google Places governed capture", () => {
  test("builds policy-compliant chat capture records from provider observations", () => {
    const context = googlePlacesChatContext();
    const capture = createGooglePlacesChatCaptureInput({
      context,
      place: context.places[0],
      resultIndex: 0,
    });

    expect(capture.sourceRecord).toMatchObject({
      id: "record_google_places_chat_place_kermit",
      providerEntityId: "place_kermit",
      entityType: "restaurant",
      name: "Kermit Surf Resort and Restaurant",
      sourceUrl: "https://maps.google.com/?cid=123",
      fetchedAt: "2026-06-25T22:08:55.090Z",
      allowedUse: "citation_only",
      normalizedPayload: expect.objectContaining({
        fieldMask: context.fieldMask,
        searchCacheKey: googlePlacesChatSearchCacheKey(context.search),
        storagePolicy: "google_attribution_required_cache",
      }),
    });
    expect(capture.snapshot).toMatchObject({
      requestKind: "chat_search",
      fieldMask: context.fieldMask,
      fetchedAt: "2026-06-25T22:08:55.090Z",
      storagePolicy: "google_attribution_required_cache",
      attributionJson: expect.objectContaining({
        fieldMask: context.fieldMask,
        requiresGoogleAttribution: true,
      }),
    });
    expect(capture.snapshot?.payloadJson).toMatchObject({
      search: {
        cacheKey: googlePlacesChatSearchCacheKey(context.search),
        resultIndex: 0,
      },
      place: {
        placeId: "place_kermit",
        displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
      },
    });
    expect(capture.details).toMatchObject({
      displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
      googleMapsUri: "https://maps.google.com/?cid=123",
      openingHoursJson: { openNow: true },
      rating: 4.6,
      userRatingCount: 1240,
      fetchedAt: "2026-06-25T22:08:55.090Z",
      staleAt: capture.snapshot?.staleAt,
      retentionExpiresAt: capture.snapshot?.retentionExpiresAt,
    });
  });
});

function googlePlacesChatContext(): GooglePlacesChatContext {
  return {
    status: "available",
    sourceName: "Google Places",
    sourceProfileId: "source_google_places",
    fetchedAt: "2026-06-25T22:08:55.090Z",
    freshness: "live",
    search: {
      label: "agent_good_restaurant_in_general_luna_siargao",
      textQuery: "good restaurant in General Luna Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 12_000,
      pageSize: 8,
    },
    fieldMask:
      "places.id,places.name,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.priceLevel,places.priceRange,places.websiteUri,places.internationalPhoneNumber",
    places: [
      {
        placeId: "place_kermit",
        resourceName: "places/place_kermit",
        displayName: "Kermit Surf Resort and Restaurant",
        formattedAddress: "Tourism Road, General Luna, Siargao",
        latitude: 9.803,
        longitude: 126.161,
        types: ["restaurant", "food", "point_of_interest", "establishment"],
        primaryType: "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=123",
        rating: 4.6,
        userRatingCount: 1240,
        currentOpeningHours: { openNow: true },
      },
    ],
    caveats: [],
  };
}
