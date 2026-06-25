import { describe, expect, test } from "bun:test";

import {
  createGooglePlacesDetailsSourceRecordId,
  enrichGooglePlacesCaptureDetails,
  enrichGooglePlacesDetails,
  googlePlacesAtmosphereDetailsFieldMask,
  googlePlacesDetailsFieldMask,
  normalizeGooglePlacesDetailsPayload,
} from "@/server/providers/google-places-enrichment";

describe("Google Places details enrichment", () => {
  test("uses the narrow Place Details Pro field mask", async () => {
    const requests: RequestInit[] = [];
    const [details] = await enrichGooglePlacesDetails({
      apiKey: "test-key",
      placeIds: ["ChIJExample-123"],
      fetchedAt: "2026-06-24T00:00:00.000Z",
      fetcher: async (_url, init) => {
        requests.push(init);
        return Response.json({
          id: "ChIJExample-123",
          name: "places/ChIJExample-123",
          displayName: { text: "Example Surf Stay", languageCode: "en" },
          formattedAddress: "Tourism Road, General Luna, Surigao del Norte, Philippines",
          location: { latitude: 9.8, longitude: 126.16 },
          types: ["hotel", "lodging", "point_of_interest", "establishment"],
          primaryType: "hotel",
          businessStatus: "OPERATIONAL",
          googleMapsUri: "https://maps.google.com/?cid=123",
        });
      },
    });

    expect(googlePlacesDetailsFieldMask).toBe(
      "id,name,displayName,formattedAddress,location,types,primaryType,businessStatus,googleMapsUri",
    );
    expect(
      requests.every(
        (request) =>
          (request.headers as Record<string, string>)["X-Goog-FieldMask"] ===
          googlePlacesDetailsFieldMask,
      ),
    ).toBe(true);
    expect(details).toEqual({
      placeId: "ChIJExample-123",
      resourceName: "places/ChIJExample-123",
      displayName: "Example Surf Stay",
      formattedAddress: "Tourism Road, General Luna, Surigao del Norte, Philippines",
      latitude: 9.8,
      longitude: 126.16,
      types: ["hotel", "lodging", "point_of_interest", "establishment"],
      primaryType: "hotel",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=123",
      fetchedAt: "2026-06-24T00:00:00.000Z",
    });
  });

  test("deduplicates place IDs before enrichment", async () => {
    let calls = 0;

    const details = await enrichGooglePlacesDetails({
      apiKey: "test-key",
      placeIds: ["place_1", "place_1", "place_2"],
      fetcher: async (url) => {
        calls += 1;
        const placeId = url.includes("place_2") ? "place_2" : "place_1";
        return Response.json({
          id: placeId,
          name: `places/${placeId}`,
          displayName: { text: `Stay ${placeId}` },
        });
      },
    });

    expect(calls).toBe(2);
    expect(details.map((detail) => detail.placeId)).toEqual(["place_1", "place_2"]);
  });

  test("parses review-bearing capture details behind an explicit field mask", async () => {
    const requests: RequestInit[] = [];
    const [details] = await enrichGooglePlacesCaptureDetails({
      apiKey: "test-key",
      placeIds: ["place_kermit"],
      fieldMask: googlePlacesAtmosphereDetailsFieldMask,
      fetchedAt: "2026-06-24T00:00:00.000Z",
      fetcher: async (_url, init) => {
        requests.push(init);
        return Response.json({
          id: "place_kermit",
          name: "places/place_kermit",
          displayName: { text: "Kermit Surf Resort and Restaurant", languageCode: "en" },
          formattedAddress: "Tourism Road, General Luna, Siargao",
          shortFormattedAddress: "Tourism Road",
          addressComponents: [{ longText: "General Luna", types: ["locality"] }],
          location: { latitude: 9.803, longitude: 126.161 },
          viewport: {
            low: { latitude: 9.802, longitude: 126.16 },
            high: { latitude: 9.804, longitude: 126.162 },
          },
          types: ["restaurant", "food", "point_of_interest", "establishment"],
          primaryType: "restaurant",
          businessStatus: "OPERATIONAL",
          googleMapsUri: "https://maps.google.com/?cid=123",
          websiteUri: "https://kermit.example",
          nationalPhoneNumber: "0917 123 4567",
          internationalPhoneNumber: "+63 917 123 4567",
          currentOpeningHours: { openNow: true },
          regularOpeningHours: { weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"] },
          priceLevel: "PRICE_LEVEL_MODERATE",
          priceRange: {
            startPrice: { currencyCode: "PHP", units: "300" },
            endPrice: { currencyCode: "PHP", units: "600" },
          },
          rating: 4.6,
          userRatingCount: 1240,
          paymentOptions: { acceptsCreditCards: true },
          parkingOptions: { freeStreetParking: true },
          goodForChildren: true,
          outdoorSeating: true,
          attributions: [{ provider: "Google" }],
          reviews: [
            {
              name: "places/place_kermit/reviews/review_1",
              relativePublishTimeDescription: "a week ago",
              rating: 5,
              text: { text: "Great pizza after surfing.", languageCode: "en" },
              originalText: { text: "Great pizza after surfing.", languageCode: "en" },
              authorAttribution: { displayName: "A reviewer" },
              publishTime: "2026-06-20T00:00:00Z",
            },
          ],
        });
      },
    });

    expect(googlePlacesAtmosphereDetailsFieldMask).not.toContain("*");
    expect(
      requests.every(
        (request) =>
          (request.headers as Record<string, string>)["X-Goog-FieldMask"] ===
          googlePlacesAtmosphereDetailsFieldMask,
      ),
    ).toBe(true);
    expect(details).toMatchObject({
      placeId: "place_kermit",
      displayName: "Kermit Surf Resort and Restaurant",
      displayNameJson: { text: "Kermit Surf Resort and Restaurant", languageCode: "en" },
      formattedAddress: "Tourism Road, General Luna, Siargao",
      locationJson: { latitude: 9.803, longitude: 126.161 },
      priceLevel: "PRICE_LEVEL_MODERATE",
      rating: 4.6,
      userRatingCount: 1240,
      paymentOptionsJson: { acceptsCreditCards: true },
      parkingOptionsJson: { freeStreetParking: true },
      amenitiesJson: {
        goodForChildren: true,
        outdoorSeating: true,
      },
      attributionsJson: [{ provider: "Google" }],
      reviews: [
        {
          name: "places/place_kermit/reviews/review_1",
          rating: 5,
          text: { text: "Great pizza after surfing.", languageCode: "en" },
        },
      ],
      fieldMask: googlePlacesAtmosphereDetailsFieldMask,
    });
  });

  test("builds storage metadata for a detail source record", () => {
    const sourceRecordId = createGooglePlacesDetailsSourceRecordId("ChIJExample-123");
    const payload = normalizeGooglePlacesDetailsPayload({
      placeId: "ChIJExample-123",
      resourceName: "places/ChIJExample-123",
      displayName: "Example Surf Stay",
      formattedAddress: "Tourism Road",
      latitude: 9.8,
      longitude: 126.16,
      types: ["hotel", "lodging"],
      primaryType: "hotel",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=123",
      fetchedAt: "2026-06-24T00:00:00.000Z",
    });

    expect(sourceRecordId).toBe("record_google_places_details_ChIJExample_123");
    expect(payload).toMatchObject({
      placeId: "ChIJExample-123",
      displayName: "Example Surf Stay",
      fieldMask: googlePlacesDetailsFieldMask,
      sku: "Places API Place Details Pro",
    });
  });

  test("surfaces Google API errors", async () => {
    await expect(
      enrichGooglePlacesDetails({
        apiKey: "test-key",
        placeIds: ["place_denied"],
        fetcher: async () =>
          Response.json(
            {
              error: {
                status: "PERMISSION_DENIED",
                message: "API key is not authorized.",
              },
            },
            { status: 403 },
          ),
      }),
    ).rejects.toThrow("Google Places enrichment failed: PERMISSION_DENIED");
  });
});
