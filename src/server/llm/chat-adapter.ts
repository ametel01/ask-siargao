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
        scope:
          "Answer only Siargao-related travel and local trip-planning questions. Politely decline unrelated questions.",
        caveat:
          "Use weatherContext and placesContext when present. Say when live local data needed for the answer has not been checked yet.",
      },
    }),
  });

  if (!response.output_text) {
    throw new Error("OpenAI response did not include output_text.");
  }

  const message = ensureGoogleMapsLinks(response.output_text.trim(), input.placesContext);

  return {
    message,
    model,
    requestId: response._request_id,
  };
}

function ensureGoogleMapsLinks(message: string, context: GooglePlacesChatContext | undefined) {
  if (!context?.places.length) {
    return message;
  }

  const lines = message.split("\n");
  const linkedGoogleMapsUris = extractLinkedUris(message);
  const lineIndexByDisplayName = indexLinesByDisplayName(
    lines,
    context.places.map((place) => place.displayName.toLowerCase()),
  );
  const missingLinkedPlaces: string[] = [];

  for (const place of context.places) {
    if (linkedGoogleMapsUris.has(place.googleMapsUri)) {
      continue;
    }

    const displayName = place.displayName.toLowerCase();
    const lineIndex = lineIndexByDisplayName.get(displayName);

    if (lineIndex !== undefined) {
      lines[lineIndex] = `${lines[lineIndex]} Maps: ${place.googleMapsUri}`;
    } else {
      missingLinkedPlaces.push(`- ${place.displayName} Maps: ${place.googleMapsUri}`);
    }
  }

  const linkedMessage = lines.join("\n");
  if (missingLinkedPlaces.length === 0) {
    return linkedMessage;
  }

  return `${linkedMessage}\n\nGoogle Maps links:\n${missingLinkedPlaces.join("\n")}`;
}

function extractLinkedUris(message: string) {
  const uriPattern = /https?:\/\/\S+/g;
  return new Set((message.match(uriPattern) ?? []).map(normalizeLinkedUri));
}

function normalizeLinkedUri(uri: string) {
  return uri.replace(/[),.;:!?]+$/u, "");
}

function indexLinesByDisplayName(lines: readonly string[], displayNames: readonly string[]) {
  const lineIndexByDisplayName = new Map<string, number>();
  const displayNameMatchers = new Map(
    displayNames.map((displayName) => [displayName, new RegExp(escapeRegExp(displayName), "i")]),
  );

  for (const [lineIndex, line] of lines.entries()) {
    for (const [displayName, matcher] of displayNameMatchers) {
      if (matcher.test(line)) {
        lineIndexByDisplayName.set(displayName, lineIndex);
        displayNameMatchers.delete(displayName);
      }
    }

    if (displayNameMatchers.size === 0) {
      break;
    }
  }

  return lineIndexByDisplayName;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      currentOpeningHours: place.currentOpeningHours,
      regularOpeningHours: place.regularOpeningHours,
      priceLevel: place.priceLevel,
      priceRange: place.priceRange,
      websiteUri: place.websiteUri,
      internationalPhoneNumber: place.internationalPhoneNumber,
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
  "Stay strictly scoped to Siargao Island, Siargao travel, and local trip-planning topics.",
  "If the latest question is not about Siargao or a plausible follow-up to Siargao trip planning, politely decline and invite the traveler to ask a Siargao-related question.",
  "Do not answer unrelated general knowledge, coding, entertainment, sports, finance, politics, or other-destination questions.",
  "If a short or ambiguous follow-up can reasonably be interpreted as Siargao-related from the conversation, answer it in that Siargao context.",
  "Use only general destination knowledge unless the prompt includes specific facts.",
  "When weatherContext is present, use it for Siargao weather, rain, wind, and forecast questions.",
  "If weatherContext.status is fallback, say the live forecast snapshot has not been loaded yet.",
  "When placesContext is present, use it for place, restaurant, cafe, bar, and nearby recommendation questions.",
  "Treat the order of placesContext.places as Google Places search relevance, not as a verified quality ranking.",
  "Use available rating, review count, opening hours, price, website, and phone fields from placesContext to make recommendations more complete.",
  "Every place or finding from placesContext that you mention must include its Google Maps link as a raw URL after `Maps:` so the UI can make it clickable.",
  "Do not imply absent rating, opening-hours, price, contact, review-text, booking, or availability data was checked.",
  "When placesContext.status is no_results, say the Google Places lookup did not return a useful shortlist.",
  "Do not pretend you checked review text, events, bookings, room availability, table availability, or non-Google local validation.",
  "When other live or source-backed data would materially improve the answer, say what should be checked.",
  "Prefer concise, actionable answers with Siargao-specific tradeoffs.",
  "Do not frame the product as a trip risk audit or paid report.",
].join("\n");
