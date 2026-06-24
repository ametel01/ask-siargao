import { describe, expect, test } from "bun:test";

import {
  buildGooglePlacesChatSearchBody,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";

const cloud9RestaurantSearch: GooglePlacesChatSearch = {
  label: "chat_restaurant_cloud_9",
  textQuery: "find me the best restaurant around Cloud 9 Siargao Philippines",
  includedType: "restaurant",
  center: { latitude: 9.8116, longitude: 126.1651 },
  radiusMeters: 4_000,
  pageSize: 8,
};

describe("Google Places chat lookup", () => {
  test("builds a narrow Text Search request for chat recommendations", () => {
    const body = buildGooglePlacesChatSearchBody(cloud9RestaurantSearch);

    expect(googlePlacesChatSearchFieldMask).toBe(
      "places.id,places.name,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri",
    );
    expect(body).toEqual({
      textQuery: "find me the best restaurant around Cloud 9 Siargao Philippines",
      includedType: "restaurant",
      strictTypeFiltering: true,
      pageSize: 8,
      locationBias: {
        circle: {
          center: { latitude: 9.8116, longitude: 126.1651 },
          radius: 4_000,
        },
      },
      regionCode: "PH",
      languageCode: "en",
    });
  });

  test("returns compact Google Places context without review or rating fields", async () => {
    const requests: RequestInit[] = [];
    const context = await getGooglePlacesChatContext({
      apiKey: "test-key",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      search: cloud9RestaurantSearch,
      fetcher: async (_url, init) => {
        requests.push(init);
        return Response.json({
          places: [
            {
              id: "place_kermit",
              name: "places/place_kermit",
              displayName: { text: "Kermit Surf Resort and Restaurant" },
              formattedAddress: "Tourism Road, General Luna, Siargao",
              location: { latitude: 9.803, longitude: 126.161 },
              types: ["restaurant", "food", "point_of_interest", "establishment"],
              primaryType: "restaurant",
              businessStatus: "OPERATIONAL",
              googleMapsUri: "https://maps.google.com/?cid=123",
            },
          ],
        });
      },
    });

    expect(
      requests.every(
        (request) =>
          (request.headers as Record<string, string>)["X-Goog-FieldMask"] ===
          googlePlacesChatSearchFieldMask,
      ),
    ).toBe(true);
    expect(context).toMatchObject({
      status: "available",
      sourceName: "Google Places",
      sourceProfileId: "source_google_places",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      search: cloud9RestaurantSearch,
      places: [
        {
          placeId: "place_kermit",
          displayName: "Kermit Surf Resort and Restaurant",
          primaryType: "restaurant",
          businessStatus: "OPERATIONAL",
          googleMapsUri: "https://maps.google.com/?cid=123",
        },
      ],
    });
    expect(context.caveats.join(" ")).toContain("does not include reviews");
  });

  test("surfaces Google API errors", async () => {
    await expect(
      getGooglePlacesChatContext({
        apiKey: "test-key",
        search: cloud9RestaurantSearch,
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
    ).rejects.toThrow("Google Places chat lookup failed: PERMISSION_DENIED");
  });
});
