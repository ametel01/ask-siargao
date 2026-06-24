import { z } from "zod";

import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
} from "@/server/providers/google-places-chat";
import {
  type OpenMeteoForecastLocation,
  siargaoForecastLocations,
} from "@/server/providers/open-meteo";
import {
  getLatestSiargaoWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(12),
});

export type ChatRouteDependencies = {
  generateAskSiargaoChatResponse: typeof generateAskSiargaoChatResponse;
  getLatestSiargaoWeatherSnapshot?: typeof getLatestSiargaoWeatherSnapshot;
  getGooglePlacesChatContext?: typeof getGooglePlacesChatContext;
};

const defaultDependencies: Required<ChatRouteDependencies> = {
  generateAskSiargaoChatResponse,
  getLatestSiargaoWeatherSnapshot,
  getGooglePlacesChatContext,
};

export async function chatResponse(
  request: Request,
  dependencies: ChatRouteDependencies = defaultDependencies,
  headers?: HeadersInit,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400, headers },
    );
  }

  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_chat_request",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers },
    );
  }

  if (shouldDeclineNonSiargaoTopic(parsed.data.messages)) {
    return Response.json({ message: siargaoScopeDeclineMessage }, { headers });
  }

  try {
    const weatherContext = await getWeatherContext(parsed.data.messages, dependencies);
    const placesContext = await getPlacesContext(parsed.data.messages, dependencies);
    const result = await dependencies.generateAskSiargaoChatResponse({
      messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
      ...(weatherContext ? { weatherContext } : {}),
      ...(placesContext ? { placesContext } : {}),
    });

    return Response.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat response failed.";
    const missingConfiguration = message.includes("OPENAI_API_KEY");

    return Response.json(
      {
        error: missingConfiguration ? "chat_not_configured" : "chat_generation_failed",
        message: missingConfiguration
          ? "OpenAI is not configured for chat responses."
          : "Ask Siargao could not generate a response right now.",
      },
      { status: missingConfiguration ? 503 : 502, headers },
    );
  }
}

async function getPlacesContext(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
): Promise<GooglePlacesChatContext | undefined> {
  const latestUserMessage = getLatestUserMessage(messages);
  const search = latestUserMessage
    ? buildGooglePlacesChatSearch(latestUserMessage.content)
    : undefined;

  if (!search) {
    return undefined;
  }

  try {
    const getContext =
      dependencies.getGooglePlacesChatContext ?? defaultDependencies.getGooglePlacesChatContext;
    return await getContext({ search });
  } catch {
    return undefined;
  }
}

async function getWeatherContext(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
): Promise<WeatherSnapshot | undefined> {
  if (!isWeatherQuestion(messages)) {
    return undefined;
  }

  try {
    const getSnapshot =
      dependencies.getLatestSiargaoWeatherSnapshot ??
      defaultDependencies.getLatestSiargaoWeatherSnapshot;
    const location = detectWeatherLocation(messages);
    return await (location ? getSnapshot({ location }) : getSnapshot());
  } catch {
    return undefined;
  }
}

function detectWeatherLocation(
  messages: readonly AskSiargaoChatMessage[],
): OpenMeteoForecastLocation | undefined {
  const latestUserMessage = getLatestUserMessage(messages);
  const content = latestUserMessage?.content ?? "";

  if (/\bdel\s+carmen\b/i.test(content)) {
    return siargaoForecastLocations.delCarmen;
  }

  return undefined;
}

function isWeatherQuestion(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages);

  return latestUserMessage
    ? /\b(weather|forecast|rain|raining|showers?|wind|windy|storm|cloudy|sunny|humidity|temperature|temp|tide|waves?|surf|sea conditions?)\b/i.test(
        latestUserMessage.content,
      )
    : false;
}

function shouldDeclineNonSiargaoTopic(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages);
  const content = latestUserMessage?.content ?? "";

  if (!content || hasSiargaoScopeSignal(content) || hasLikelySiargaoTravelSignal(content)) {
    return false;
  }

  return hasClearlyUnrelatedTopicSignal(content);
}

function hasSiargaoScopeSignal(content: string) {
  return /\b(siargao|general\s+luna|cloud\s*9|cloud9|catangnan|dapa|del\s+carmen|sayak|pacifico|malinao|pilar|santa\s+monica|bucas\s+grande|sugba\s+lagoon|magpupungko|maasin\s+river|daku|guyam|naked\s+island|sohoton)\b/i.test(
    content,
  );
}

function hasLikelySiargaoTravelSignal(content: string) {
  return /\b(weather|forecast|rain|wind|waves?|surf|tides?|ferr(?:y|ies)|airport|flight|van|tricycle|scooter|motorbike|transfer|route|itinerary|trip|stay|stays|hotel|hostel|resort|villa|accommodation|restaurants?|cafes?|coffee|bars?|nightlife|food|dinner|lunch|breakfast|brunch|beach|island\s+hopping|tour|activity|activities|budget|cash|atm|sim|wifi|internet|power|brownout|quiet|safe|safety|pack|packing)\b/i.test(
    content,
  );
}

function hasClearlyUnrelatedTopicSignal(content: string) {
  return /\b(capital\s+of|president\s+of|prime\s+minister|who\s+(is|was|won)|nba|nfl|mlb|nhl|olympics|stock|stocks|bitcoin|crypto|cryptocurrency|recipe|homework|essay|poem|song|lyrics|movie|netflix|celebrity|quantum|calculus|algebra|debug|code|coding|program|script|function|regex|sql|python|javascript|typescript|react|next\.?js)\b/i.test(
    content,
  );
}

function buildGooglePlacesChatSearch(content: string): GooglePlacesChatSearch | undefined {
  if (!isPlacesRecommendationQuestion(content)) {
    return undefined;
  }

  const includedType = detectGooglePlacesIncludedType(content);
  const area = detectGooglePlacesSearchArea(content);
  return {
    label: `chat_${includedType ?? "place"}_${area.slug}`,
    textQuery: normalizeGooglePlacesTextQuery(content),
    ...(includedType ? { includedType } : {}),
    center: area.center,
    radiusMeters: area.radiusMeters,
    pageSize: 8,
  };
}

function isPlacesRecommendationQuestion(content: string) {
  return /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch|cafes?|coffee|bars?|nightlife|places?\s+near|nearby\s+places?|best\s+.+\s+(near|around))\b/i.test(
    content,
  );
}

function detectGooglePlacesIncludedType(content: string) {
  if (/\b(cafes?|coffee)\b/i.test(content)) {
    return "cafe";
  }

  if (/\b(bars?|nightlife|cocktails?|drinks?)\b/i.test(content)) {
    return "bar";
  }

  if (
    /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch)\b/i.test(
      content,
    )
  ) {
    return "restaurant";
  }

  return undefined;
}

function detectGooglePlacesSearchArea(content: string) {
  if (/\b(cloud\s*9|cloud9|catangnan)\b/i.test(content)) {
    return {
      slug: "cloud_9",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 4_000,
    };
  }

  if (/\bgeneral\s+luna\b/i.test(content)) {
    return {
      slug: "general_luna",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 7_000,
    };
  }

  return {
    slug: "siargao",
    center: { latitude: 9.8006, longitude: 126.1586 },
    radiusMeters: 12_000,
  };
}

function normalizeGooglePlacesTextQuery(content: string) {
  const textQuery = content
    .trim()
    .replaceAll(/\s+/g, " ")
    .replace(/[.?!]+$/g, "");
  return /\bsiargao\b/i.test(textQuery) ? textQuery : `${textQuery} Siargao Philippines`;
}

function getLatestUserMessage(messages: readonly AskSiargaoChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

const siargaoScopeDeclineMessage =
  "I can only help with Siargao travel and local trip-planning questions. Ask me about stays, surf, food, weather, transport, activities, safety, budget, or logistics for Siargao.";
