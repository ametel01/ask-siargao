import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import {
  createDefaultRecommendationAgent,
  type RecommendationAgent,
  type RecommendationAgentResponse,
} from "@/server/chat/recommendation-agent";
import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import { createComponentLogger } from "@/server/observability/logger";
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
  logger?: Logger;
  recommendationAgent?: Pick<RecommendationAgent, "answer">;
};

const chatLogger = createComponentLogger("api.chat");

const defaultDependencies: ChatRouteDependencies = {
  generateAskSiargaoChatResponse,
  getLatestSiargaoWeatherSnapshot,
  logger: chatLogger,
};

export function createDefaultChatRouteDependencies(): ChatRouteDependencies {
  return {
    ...defaultDependencies,
    recommendationAgent: createDefaultRecommendationAgent(),
  };
}

export async function chatResponse(
  request: Request,
  dependencies: ChatRouteDependencies = createDefaultChatRouteDependencies(),
  headers?: HeadersInit,
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const logger = (dependencies.logger ?? chatLogger).child({
    route: "/api/chat",
    requestId,
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn({ durationMs: Date.now() - startedAt }, "Chat request rejected: invalid JSON.");
    return Response.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400, headers },
    );
  }

  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    logger.warn(
      {
        durationMs: Date.now() - startedAt,
        issueCount: parsed.error.issues.length,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      "Chat request rejected: schema validation failed.",
    );
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

  const latestUserMessage = getLatestUserMessage(parsed.data.messages);
  logger.info(
    {
      messageCount: parsed.data.messages.length,
      latestUserMessage: latestUserMessage
        ? summarizeMessageForLogs(latestUserMessage.content)
        : null,
      isRecommendationQuestion: isRecommendationQuestion(parsed.data.messages),
      isWeatherQuestion: isWeatherQuestion(parsed.data.messages),
    },
    "Chat request received.",
  );

  if (shouldDeclineNonSiargaoTopic(parsed.data.messages)) {
    logger.info({ durationMs: Date.now() - startedAt }, "Chat request declined: outside scope.");
    return Response.json({ message: siargaoScopeDeclineMessage, requestId }, { headers });
  }

  try {
    const recommendation = await getRecommendationResponse(parsed.data.messages, dependencies, {
      logger,
      requestId,
    });
    if (recommendation) {
      logger.info(
        {
          branch: "recommendation",
          recommendationStatus: recommendation.status,
          model: recommendation.model,
          upstreamRequestId: recommendation.requestId,
          durationMs: Date.now() - startedAt,
        },
        "Chat request answered.",
      );
      return Response.json(
        {
          message: recommendation.message,
          requestId,
          ...(recommendation.requestId ? { upstreamRequestId: recommendation.requestId } : {}),
        },
        { headers },
      );
    }

    const weatherContext = await getWeatherContext(parsed.data.messages, dependencies, logger);
    logger.debug(
      {
        branch: "generic_llm",
        hasWeatherContext: Boolean(weatherContext),
      },
      "Chat request falling through to generic LLM response.",
    );
    const result = await dependencies.generateAskSiargaoChatResponse({
      messages: parsed.data.messages satisfies AskSiargaoChatMessage[],
      ...(weatherContext ? { weatherContext } : {}),
    });

    logger.info(
      {
        branch: weatherContext ? "weather_generic_llm" : "generic_llm",
        model: result.model,
        upstreamRequestId: result.requestId,
        durationMs: Date.now() - startedAt,
      },
      "Chat request answered.",
    );

    return Response.json(
      {
        message: result.message,
        requestId,
        ...(result.requestId ? { upstreamRequestId: result.requestId } : {}),
      },
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat response failed.";
    const recommendationFailure = message.startsWith("RECOMMENDATION_AGENT_FAILED:");
    const missingConfiguration =
      message.includes("OPENAI_API_KEY") ||
      message.includes("GOOGLE_API_KEY") ||
      message.includes("GOOGLE_PLACES_API_KEY");
    const status = missingConfiguration ? 503 : 502;
    const errorCode = recommendationFailure
      ? "recommendation_failed"
      : missingConfiguration
        ? "chat_not_configured"
        : "chat_generation_failed";

    logger.error(
      {
        error,
        durationMs: Date.now() - startedAt,
        errorCode,
        status,
      },
      "Chat request failed.",
    );

    return Response.json(
      {
        error: errorCode,
        message: missingConfiguration
          ? "Ask Siargao is missing required provider configuration."
          : recommendationFailure
            ? "Ask Siargao could not search local places right now."
            : "Ask Siargao could not generate a response right now.",
      },
      { status, headers },
    );
  }
}

async function getRecommendationResponse(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
  context: { logger: Logger; requestId: string },
): Promise<RecommendationAgentResponse | undefined> {
  const isRecommendation = isRecommendationQuestion(messages);
  context.logger.debug(
    {
      hasRecommendationAgent: Boolean(dependencies.recommendationAgent),
      isRecommendationQuestion: isRecommendation,
    },
    "Recommendation routing evaluated.",
  );

  if (!dependencies.recommendationAgent || !isRecommendation) {
    return undefined;
  }

  try {
    const result = await dependencies.recommendationAgent.answer({
      messages,
      trace: { requestId: context.requestId },
    });
    if (result.status === "unsupported") {
      context.logger.info(
        { branch: "recommendation", recommendationStatus: result.status },
        "Recommendation agent marked request unsupported.",
      );
      return undefined;
    }
    return result;
  } catch (error) {
    context.logger.error({ error }, "Recommendation agent failed.");
    const message =
      error instanceof Error ? error.message : "Recommendation agent failed with non-error value.";
    throw new Error(`RECOMMENDATION_AGENT_FAILED: ${message}`, { cause: error });
  }
}

async function getWeatherContext(
  messages: readonly AskSiargaoChatMessage[],
  dependencies: ChatRouteDependencies,
  logger: Logger,
): Promise<WeatherSnapshot | undefined> {
  if (!isWeatherQuestion(messages)) {
    logger.debug("Weather routing skipped.");
    return undefined;
  }

  try {
    const getSnapshot =
      dependencies.getLatestSiargaoWeatherSnapshot ??
      defaultDependencies.getLatestSiargaoWeatherSnapshot;
    if (!getSnapshot) {
      logger.debug("Weather routing matched but no snapshot provider is configured.");
      return undefined;
    }

    const location = detectWeatherLocation(messages);
    const snapshot = await (location ? getSnapshot({ location }) : getSnapshot());
    logger.debug(
      {
        locationId: location?.id,
        sourceProfileId: snapshot.sourceProfileId,
        fetchedAt: snapshot.fetchedAt,
      },
      "Weather context loaded.",
    );
    return snapshot;
  } catch (error) {
    logger.warn({ error }, "Weather context lookup failed; continuing without weather context.");
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

function isRecommendationQuestion(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages);
  const conversationContent = messages.map((message) => message.content).join(" ");
  const content = latestUserMessage?.content ?? "";

  return (
    /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|cafes?|coffee|bars?|nightlife|places?\s+to\s+(?:eat|go|stop)|stop\s+to\s+eat|food\s+stops?|car[ie]nderias?|seafood)\b/i.test(
      content,
    ) ||
    (/\b(route|on\s+the\s+way|from\s+.+\s+to|proper|sit[-\s]?down|not\s+car[ie]nderia)\b/i.test(
      content,
    ) &&
      /\b(restaurants?|eat|food|dinner|lunch|breakfast|car[ie]nderias?|seafood)\b/i.test(
        conversationContent,
      ))
  );
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

function summarizeMessageForLogs(content: string) {
  return {
    length: content.length,
    hash: createHash("sha256").update(content).digest("hex").slice(0, 16),
    preview: content.replaceAll(/\s+/g, " ").trim().slice(0, 160),
  };
}

const siargaoScopeDeclineMessage =
  "I can only help with Siargao travel and local trip-planning questions. Ask me about stays, surf, food, weather, transport, activities, safety, budget, or logistics for Siargao.";
