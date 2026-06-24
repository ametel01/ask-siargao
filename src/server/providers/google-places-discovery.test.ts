import { describe, expect, test } from "bun:test";

import {
  buildGooglePlacesTextSearchBody,
  createGooglePlacesDiscoveryObservations,
  discoverGooglePlacesAccommodationIds,
  googlePlacesDiscoveryFieldMask,
  siargaoAccommodationDiscoverySearches,
} from "@/server/providers/google-places-discovery";

describe("Google Places ID-only discovery", () => {
  test("builds ID-only lodging discovery requests for the Siargao MVP areas", () => {
    const body = buildGooglePlacesTextSearchBody(siargaoAccommodationDiscoverySearches[0]);

    expect(googlePlacesDiscoveryFieldMask).toBe("places.id,places.name,nextPageToken");
    expect(body).toEqual({
      textQuery: "lodging in General Luna Siargao",
      includedType: "lodging",
      pageSize: 20,
      locationBias: {
        circle: {
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius: 7_000,
        },
      },
      regionCode: "PH",
      languageCode: "en",
    });
  });

  test("discovers unique Place IDs without requesting paid detail fields", async () => {
    const requests: RequestInit[] = [];
    const batch = await discoverGooglePlacesAccommodationIds({
      apiKey: "test-key",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      searches: siargaoAccommodationDiscoverySearches.slice(0, 2),
      fetcher: async (_url, init) => {
        requests.push(init);
        const requestBody = JSON.parse(String(init.body)) as { textQuery: string };
        const places = requestBody.textQuery.includes("Cloud")
          ? [
              { id: "place_cloud_9", name: "places/place_cloud_9" },
              { id: "place_shared", name: "places/place_shared" },
            ]
          : [
              { id: "place_general_luna", name: "places/place_general_luna" },
              { id: "place_shared", name: "places/place_shared" },
            ];

        return Response.json({ places, nextPageToken: "next-page-token" });
      },
    });

    expect(batch.results).toHaveLength(2);
    expect(batch.uniquePlaceIds.toSorted()).toEqual([
      "place_cloud_9",
      "place_general_luna",
      "place_shared",
    ]);
    expect(
      requests.every(
        (request) =>
          (request.headers as Record<string, string>)["X-Goog-FieldMask"] ===
          "places.id,places.name,nextPageToken",
      ),
    ).toBe(true);
  });

  test("creates deterministic source records and candidates for database insertion", async () => {
    const batch = await discoverGooglePlacesAccommodationIds({
      apiKey: "test-key",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      searches: [siargaoAccommodationDiscoverySearches[0]],
      fetcher: async () =>
        Response.json({
          places: [
            {
              id: "ChIJExample-123",
              name: "places/ChIJExample-123",
            },
          ],
        }),
    });

    const observations = createGooglePlacesDiscoveryObservations(batch);

    expect(observations).toEqual([
      {
        id: "google_places_general_luna_lodging_ChIJExample_123",
        sourceRecordId: "record_google_places_general_luna_lodging_ChIJExample_123",
        candidateEntityId: "candidate_google_places_ChIJExample-123",
        placeId: "ChIJExample-123",
        resourceName: "places/ChIJExample-123",
        searchLabel: "general_luna_lodging",
        areaSlug: "general-luna",
        textQuery: "lodging in General Luna Siargao",
        fetchedAt: "2026-06-24T00:00:00.000Z",
      },
    ]);
  });

  test("surfaces Google API errors", async () => {
    await expect(
      discoverGooglePlacesAccommodationIds({
        apiKey: "test-key",
        searches: [siargaoAccommodationDiscoverySearches[0]],
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
    ).rejects.toThrow("Google Places discovery failed: PERMISSION_DENIED");
  });
});
