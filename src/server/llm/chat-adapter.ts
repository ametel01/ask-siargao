import OpenAI from "openai";

import type { GooglePlacesChatContext } from "@/server/providers/google-places-chat";
import type { WeatherSnapshot } from "@/server/public-pages/weather-snapshot";

export type AskSiargaoChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponsesClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{
      output_text?: string;
      _request_id?: string;
    }>;
  };
};

export type AskSiargaoChatResponse = {
  message: string;
  model: string;
  requestId?: string;
};

function createOpenAIChatClient(apiKey = process.env.OPENAI_API_KEY): ChatResponsesClient {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Ask Siargao chat.");
  }

  return new OpenAI({ apiKey, timeout: 30_000 }) as ChatResponsesClient;
}

export async function generateAskSiargaoChatResponse(input: {
  messages: readonly AskSiargaoChatMessage[];
  weatherContext?: WeatherSnapshot;
  placesContext?: GooglePlacesChatContext;
  model?: string;
  client?: ChatResponsesClient;
}): Promise<AskSiargaoChatResponse> {
  const model = input.model ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
  const client = input.client ?? createOpenAIChatClient();
  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 900,
    instructions: askSiargaoChatInstructions,
    input: JSON.stringify({
      product: "Ask Siargao",
      conversation: input.messages.slice(-10),
      weatherContext: input.weatherContext
        ? summarizeWeatherContext(input.weatherContext)
        : undefined,
      placesContext: input.placesContext
        ? summarizeGooglePlacesContext(input.placesContext)
        : undefined,
      responseContract: {
        tone: "practical local travel assistant",
        caveat:
          "Use weatherContext and placesContext when present. Say when live local data needed for the answer has not been checked yet.",
      },
    }),
  });

  if (!response.output_text) {
    throw new Error("OpenAI response did not include output_text.");
  }

  return {
    message: response.output_text.trim(),
    model,
    requestId: response._request_id,
  };
}

function summarizeGooglePlacesContext(context: GooglePlacesChatContext) {
  return {
    status: context.status,
    sourceName: context.sourceName,
    sourceProfileId: context.sourceProfileId,
    fetchedAt: context.fetchedAt,
    search: {
      label: context.search.label,
      textQuery: context.search.textQuery,
      includedType: context.search.includedType,
      center: context.search.center,
      radiusMeters: context.search.radiusMeters,
    },
    fieldMask: context.fieldMask,
    caveats: context.caveats,
    places: context.places.map((place) => ({
      placeId: place.placeId,
      displayName: place.displayName,
      formattedAddress: place.formattedAddress,
      primaryType: place.primaryType,
      types: place.types,
      businessStatus: place.businessStatus,
      googleMapsUri: place.googleMapsUri,
    })),
  };
}

function summarizeWeatherContext(weather: WeatherSnapshot) {
  return {
    status: weather.status,
    locationName: weather.locationName,
    sourceName: weather.sourceName,
    sourceProfileId: weather.sourceProfileId,
    fetchedAt: weather.fetchedAt,
    expiresAt: weather.expiresAt,
    freshness: weather.freshness,
    confidence: weather.confidence,
    citationUrl: weather.citationUrl,
    evidenceIds: weather.evidenceIds,
    summary: weather.summary,
    today: weather.today,
    metrics: weather.metrics,
  };
}

const askSiargaoChatInstructions = [
  "You are Ask Siargao, a practical Siargao travel assistant.",
  "Answer the traveler's latest question directly and conversationally.",
  "Use only general destination knowledge unless the prompt includes specific facts.",
  "When weatherContext is present, use it for Siargao weather, rain, wind, and forecast questions.",
  "If weatherContext.status is fallback, say the live forecast snapshot has not been loaded yet.",
  "When placesContext is present, use it for place, restaurant, cafe, bar, and nearby recommendation questions.",
  "Treat the order of placesContext.places as Google Places search relevance, not as a verified quality ranking.",
  "Include Google Maps links from placesContext when useful.",
  "Do not claim you checked Google reviews, ratings, opening hours, prices, bookings, or availability unless those exact fields are present in placesContext.",
  "When placesContext.status is no_results, say the Google Places lookup did not return a useful shortlist.",
  "Do not pretend you checked reviews, opening hours, events, prices, bookings, or availability.",
  "When other live or source-backed data would materially improve the answer, say what should be checked.",
  "Prefer concise, actionable answers with Siargao-specific tradeoffs.",
  "Do not frame the product as a trip risk audit or paid report.",
].join("\n");
