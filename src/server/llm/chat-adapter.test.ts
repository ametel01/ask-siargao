import { describe, expect, test } from "bun:test";

import {
  type ChatResponsesClient,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import type { GooglePlacesChatContext } from "@/server/providers/google-places-chat";
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
            output_text: "Start with the Google Places shortlist near Cloud 9.",
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
    expect(String(request?.instructions)).toContain("When placesContext is present");
    expect(input.placesContext?.sourceProfileId).toBe("source_google_places");
    expect(input.placesContext?.places[0]?.displayName).toBe("Kermit Surf Resort and Restaurant");
    expect(input.placesContext?.caveats?.join(" ")).toContain("does not include reviews");
  });
});

function parseOpenAIInput(input: unknown): {
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
  search: {
    label: "chat_restaurant_cloud_9",
    textQuery: "find me the best restaurant around cloud9 Siargao Philippines",
    includedType: "restaurant",
    center: { latitude: 9.8116, longitude: 126.1651 },
    radiusMeters: 4_000,
    pageSize: 8,
  },
  fieldMask:
    "places.id,places.name,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.googleMapsUri",
  caveats: ["Basic chat lookup does not include reviews, ratings, prices, or opening hours."],
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
    },
  ],
};
