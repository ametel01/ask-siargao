import { describe, expect, test } from "bun:test";

import {
  buildGooglePlacesChatSearchBody,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
  googlePlacesChatSearchCenterLogFields,
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
      [
        "places.id",
        "places.name",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.types",
        "places.primaryType",
        "places.businessStatus",
        "places.googleMapsUri",
        "places.rating",
        "places.userRatingCount",
        "places.currentOpeningHours",
        "places.regularOpeningHours",
        "places.priceLevel",
        "places.priceRange",
        "places.websiteUri",
        "places.internationalPhoneNumber",
      ].join(","),
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

  test("redacts search center coordinates from provider log fields", () => {
    const logFields = googlePlacesChatSearchCenterLogFields();

    expect(logFields).toEqual({ source: "redacted_coordinates" });
    expect(JSON.stringify(logFields)).not.toContain("9.8116");
    expect(JSON.stringify(logFields)).not.toContain("126.1651");
  });

  test("adds an open-now filter and returns only currently open places when requested", async () => {
    const openNowSearch: GooglePlacesChatSearch = {
      ...cloud9RestaurantSearch,
      openNow: true,
    };
    const requests: RequestInit[] = [];
    const context = await getGooglePlacesChatContext({
      apiKey: "test-key",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      search: openNowSearch,
      fetcher: async (_url, init) => {
        requests.push(init);
        return Response.json({
          places: [
            {
              id: "place_closed",
              name: "places/place_closed",
              displayName: { text: "Closed Dinner Spot" },
              googleMapsUri: "https://maps.google.com/?cid=closed",
              currentOpeningHours: { openNow: false },
            },
            {
              id: "place_open",
              name: "places/place_open",
              displayName: { text: "Open Dinner Spot" },
              googleMapsUri: "https://maps.google.com/?cid=open",
              currentOpeningHours: { openNow: true },
            },
          ],
        });
      },
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({ openNow: true });
    expect(context.places.map((place) => place.displayName)).toEqual(["Open Dinner Spot"]);
    expect(context.places[0]?.currentOpeningHours?.openNow).toBe(true);
  });

  test("returns enhanced Google Places context without review text or availability fields", async () => {
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
              id: "place_no_uri",
              name: "places/place_no_uri",
              displayName: { text: "No URI Cafe" },
              formattedAddress: "General Luna, Siargao",
              location: { latitude: 9.81, longitude: 126.16 },
              types: ["cafe", "food", "point_of_interest", "establishment"],
              primaryType: "cafe",
              businessStatus: "OPERATIONAL",
              rating: 4.3,
              userRatingCount: 42,
            },
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
              rating: 4.6,
              userRatingCount: 1240,
              currentOpeningHours: {
                openNow: true,
                weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"],
                nextCloseTime: "2026-06-24T14:00:00Z",
              },
              regularOpeningHours: {
                weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"],
              },
              priceLevel: "PRICE_LEVEL_MODERATE",
              priceRange: {
                startPrice: { currencyCode: "PHP", units: "300" },
                endPrice: { currencyCode: "PHP", units: "600" },
              },
              websiteUri: "https://kermit.example",
              internationalPhoneNumber: "+63 917 123 4567",
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
      freshness: "live",
      search: cloud9RestaurantSearch,
      places: [
        {
          placeId: "place_no_uri",
          displayName: "No URI Cafe",
          primaryType: "cafe",
          businessStatus: "OPERATIONAL",
          rating: 4.3,
          userRatingCount: 42,
        },
        {
          placeId: "place_kermit",
          displayName: "Kermit Surf Resort and Restaurant",
          primaryType: "restaurant",
          businessStatus: "OPERATIONAL",
          googleMapsUri: "https://maps.google.com/?cid=123",
          rating: 4.6,
          userRatingCount: 1240,
          currentOpeningHours: {
            openNow: true,
            weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"],
            nextCloseTime: "2026-06-24T14:00:00Z",
          },
          regularOpeningHours: {
            weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"],
          },
          priceLevel: "PRICE_LEVEL_MODERATE",
          priceRange: {
            startPrice: { currencyCode: "PHP", units: "300" },
            endPrice: { currencyCode: "PHP", units: "600" },
          },
          websiteUri: "https://kermit.example",
          internationalPhoneNumber: "+63 917 123 4567",
          captureJson: {
            displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
            locationJson: { latitude: 9.803, longitude: 126.161 },
            typesJson: ["restaurant", "food", "point_of_interest", "establishment"],
            rating: 4.6,
            userRatingCount: 1240,
            priceLevel: "PRICE_LEVEL_MODERATE",
          },
        },
      ],
    });
    const fallbackMapsUrl = new URL(context.places[0]?.googleMapsUri ?? "");
    expect(fallbackMapsUrl.origin + fallbackMapsUrl.pathname).toBe(
      "https://www.google.com/maps/search/",
    );
    expect(fallbackMapsUrl.searchParams.get("api")).toBe("1");
    expect(fallbackMapsUrl.searchParams.get("query")).toBe("No URI Cafe, General Luna, Siargao");
    expect(fallbackMapsUrl.searchParams.get("query_place_id")).toBe("place_no_uri");
    expect(context.places[1]?.googleMapsUri).toBe("https://maps.google.com/?cid=123");
    expect(context.caveats.join(" ")).toContain("Review text");
    expect(context.caveats.join(" ")).not.toContain("Do not store");
    expect(context.caveats.join(" ")).not.toContain("raw provider");
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
