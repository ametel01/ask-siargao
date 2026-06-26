import { describe, expect, test } from "bun:test";

import {
  type ChatResponsesClient,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import {
  type GooglePlacesChatContext,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

describe("Ask Siargao chat adapter", () => {
  test("includes weather context in the OpenAI request when provided", async () => {
    const requests: Record<string, unknown>[] = [];
    const client: ChatResponsesClient = {
      responses: {
        create: async (params) => {
          requests.push(params);
          return {
            output_text: "Today looks variable, so plan around rain and wind windows.",
            _request_id: "req_weather_context",
          };
        },
      },
    };

    const response = await generateAskSiargaoChatResponse({
      client,
      messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      weatherContext: fallbackWeatherSnapshot,
    });

    const request = requests[0];
    const input = parseOpenAIInput(request?.input);

    expect(response.requestId).toBe("req_weather_context");
    expect(String(request?.instructions)).toContain("When weatherContext is present");
    expect(String(request?.instructions)).toContain("politely decline");
    expect(input.responseContract?.scope).toContain("Siargao-related");
    expect(input.weatherContext?.status).toBe("fallback");
    expect(input.weatherContext?.sourceProfileId).toBe("source_open_meteo");
    expect(input.weatherContext?.summary).toContain("Open-Meteo");
  });

  test("includes Google Places context in the OpenAI request when provided", async () => {
    const requests: Record<string, unknown>[] = [];
    const client: ChatResponsesClient = {
      responses: {
        create: async (params) => {
          requests.push(params);
          return {
            output_text:
              "Start with **Kermit Surf Resort and Restaurant** from the Google Places shortlist near Cloud 9.",
            _request_id: "req_places_context",
          };
        },
      },
    };

    const response = await generateAskSiargaoChatResponse({
      client,
      messages: [{ role: "user", content: "find me the best restaurant around cloud9" }],
      placesContext: googlePlacesContextFixture,
    });

    const request = requests[0];
    const input = parseOpenAIInput(request?.input);

    expect(response.requestId).toBe("req_places_context");
    expect(response.message).toContain("Maps: https://maps.google.com/?cid=123");
    expect(String(request?.instructions)).toContain("When placesContext is present");
    expect(String(request?.instructions)).toContain("Use available rating");
    expect(String(request?.instructions)).toContain("Every place or finding");
    expect(input.placesContext?.sourceProfileId).toBe("source_google_places");
    expect(input.placesContext?.places[0]?.displayName).toBe("Kermit Surf Resort and Restaurant");
    expect(input.placesContext?.places[0]?.googleMapsUri).toBe("https://maps.google.com/?cid=123");
    expect(input.placesContext?.places[0]?.rating).toBe(4.6);
    expect(input.placesContext?.places[0]?.userRatingCount).toBe(1240);
    expect(input.placesContext?.places[0]?.currentOpeningHours?.openNow).toBe(true);
    expect(input.placesContext?.places[0]?.priceLevel).toBe("PRICE_LEVEL_MODERATE");
    expect(input.placesContext?.places[0]?.websiteUri).toBe("https://kermit.example");
    expect(input.placesContext?.places[0]?.internationalPhoneNumber).toBe("+63 917 123 4567");
    expect(input.placesContext?.caveats?.join(" ")).toContain("does not include review text");
  });

  test("adds a fallback Maps link section when the model omits the exact place name", async () => {
    const client: ChatResponsesClient = {
      responses: {
        create: async () => ({
          output_text: "Short name: Kermit is the easiest pick near Cloud 9.",
          _request_id: "req_places_fallback_link",
        }),
      },
    };

    const response = await generateAskSiargaoChatResponse({
      client,
      messages: [{ role: "user", content: "find me a restaurant around cloud9" }],
      placesContext: googlePlacesContextFixture,
    });

    expect(response.message).toContain("Google Maps links:");
    expect(response.message).toContain(
      "- Kermit Surf Resort and Restaurant Maps: https://maps.google.com/?cid=123",
    );
  });
});

function parseOpenAIInput(input: unknown): {
  responseContract?: {
    scope?: string;
  };
  weatherContext?: {
    status?: string;
    sourceProfileId?: string;
    summary?: string;
  };
  placesContext?: {
    sourceProfileId?: string;
    caveats?: string[];
    places: Array<{
      displayName?: string;
      googleMapsUri?: string;
      rating?: number;
      userRatingCount?: number;
      currentOpeningHours?: {
        openNow?: boolean;
      };
      priceLevel?: string;
      websiteUri?: string;
      internationalPhoneNumber?: string;
    }>;
  };
} {
  return typeof input === "string" ? JSON.parse(input) : {};
}

const googlePlacesContextFixture: GooglePlacesChatContext = {
  status: "available",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-24T00:00:00.000Z",
  freshness: "live",
  search: {
    label: "chat_restaurant_cloud_9",
    textQuery: "find me the best restaurant around cloud9 Siargao Philippines",
    includedType: "restaurant",
    center: { latitude: 9.8116, longitude: 126.1651 },
    radiusMeters: 4_000,
    pageSize: 8,
  },
  fieldMask: googlePlacesChatSearchFieldMask,
  caveats: ["Enhanced chat lookup does not include review text, bookings, or availability."],
  places: [
    {
      placeId: "place_kermit",
      resourceName: "places/place_kermit",
      displayName: "Kermit Surf Resort and Restaurant",
      formattedAddress: "Tourism Road, General Luna, Siargao",
      types: ["restaurant", "food"],
      primaryType: "restaurant",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=123",
      rating: 4.6,
      userRatingCount: 1240,
      currentOpeningHours: {
        openNow: true,
        weekdayDescriptions: ["Wednesday: 8:00 AM - 10:00 PM"],
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
};
