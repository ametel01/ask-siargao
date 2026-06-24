import { describe, expect, test } from "bun:test";

import {
  createGooglePlacesDetailsSourceRecordId,
  enrichGooglePlacesDetails,
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
