import { z } from "zod";

import {
  type AnswerContext,
  type AnswerContextStore,
  planGooglePlacesRequirement,
} from "@/server/chat/answer-context-store";
import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
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
  answerContextStore?: Pick<AnswerContextStore, "getOrRefresh">;
};

const defaultDependencies: ChatRouteDependencies = {
  generateAskSiargaoChatResponse,
  getLatestSiargaoWeatherSnapshot,
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
    const answerContext = await getAnswerContext(parsed.data.messages, dependencies);
    const result = await dependencies.generateAskSiargaoChatResponse({
      messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
      ...(answerContext ? { answerContext } : {}),
      ...(weatherContext ? { weatherContext } : {}),
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

async function getAnswerContext(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
): Promise<AnswerContext | undefined> {
  if (!dependencies.answerContextStore || !planGooglePlacesRequirement(messages)) {
    return undefined;
  }

  try {
    return await dependencies.answerContextStore.getOrRefresh({
      messages,
      userMessageId: createRequestScopedUserMessageId(messages),
    });
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
    if (!getSnapshot) {
      return undefined;
    }

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

function getLatestUserMessage(messages: readonly AskSiargaoChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

function createRequestScopedUserMessageId(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages);
  const content = latestUserMessage?.content ?? "empty";
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return `request_user_message_${hash.toString(16)}`;
}

const siargaoScopeDeclineMessage =
  "I can only help with Siargao travel and local trip-planning questions. Ask me about stays, surf, food, weather, transport, activities, safety, budget, or logistics for Siargao.";
