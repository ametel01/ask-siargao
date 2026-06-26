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

type ChatRequestIntent = {
  latestUserTurn: string;
  recentUserContext: string;
  locationLabel?: "Cloud 9" | "Del Carmen" | "Siargao Island";
  activityPlan: boolean;
  food: boolean;
  nearby: boolean;
  today: boolean;
  weatherSensitive: boolean;
  weather: boolean;
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

  const intent = interpretChatRequestIntent(parsed.data.messages);
  const latestUserMessage = getLatestUserMessage(parsed.data.messages);
  logger.info(
    {
      messageCount: parsed.data.messages.length,
      latestUserMessage: latestUserMessage
        ? summarizeMessageForLogs(latestUserMessage.content)
        : null,
      isRecommendationQuestion: isRecommendationQuestion(intent),
      isWeatherQuestion: isWeatherQuestion(intent),
    },
    "Chat request received.",
  );
  logger.debug(
    {
      intent: summarizeIntentForLogs(intent),
    },
    "Chat request intent interpreted.",
  );

  if (shouldDeclineNonSiargaoTopic(parsed.data.messages)) {
    logger.info({ durationMs: Date.now() - startedAt }, "Chat request declined: outside scope.");
    return Response.json({ message: siargaoScopeDeclineMessage, requestId }, { headers });
  }

  try {
    const recommendation = await getRecommendationResponse(
      parsed.data.messages,
      intent,
      dependencies,
      {
        logger,
        requestId,
      },
    );
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

    const weatherContext = await getWeatherContext(intent, dependencies, logger);
    const localPlan = renderGroundedLocalPlan(intent, weatherContext);
    if (localPlan) {
      logger.info(
        {
          branch: "grounded_local_plan",
          hasWeatherContext: Boolean(weatherContext),
          intent: summarizeIntentForLogs(intent),
          durationMs: Date.now() - startedAt,
        },
        "Chat request answered.",
      );
      return Response.json({ message: localPlan, requestId }, { headers });
    }

    logger.debug(
      {
        branch: intent.activityPlan || intent.weatherSensitive ? "grounded_llm" : "generic_llm",
        hasWeatherContext: Boolean(weatherContext),
        intent: summarizeIntentForLogs(intent),
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
  intent: ChatRequestIntent,
  dependencies: ChatRouteDependencies,
  context: { logger: Logger; requestId: string },
): Promise<RecommendationAgentResponse | undefined> {
  const isRecommendation = isRecommendationQuestion(intent);
  context.logger.debug(
    {
      hasRecommendationAgent: Boolean(dependencies.recommendationAgent),
      isRecommendationQuestion: isRecommendation,
      intent: summarizeIntentForLogs(intent),
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
  intent: ChatRequestIntent,
  dependencies: ChatRouteDependencies,
  logger: Logger,
): Promise<WeatherSnapshot | undefined> {
  if (!isWeatherQuestion(intent)) {
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

    const location = detectWeatherLocation(intent);
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

function detectWeatherLocation(intent: ChatRequestIntent): OpenMeteoForecastLocation | undefined {
  if (intent.locationLabel === "Del Carmen") {
    return siargaoForecastLocations.delCarmen;
  }

  return undefined;
}

function isWeatherQuestion(intent: ChatRequestIntent) {
  return intent.weather || intent.weatherSensitive || intent.activityPlan;
}

function isRecommendationQuestion(intent: ChatRequestIntent) {
  return intent.food;
}

function interpretChatRequestIntent(messages: readonly AskSiargaoChatMessage[]): ChatRequestIntent {
  const userTurns = messages.filter((message) => message.role === "user");
  const latestUserTurn = userTurns.at(-1)?.content ?? "";
  const recentUserContext = userTurns
    .slice(0, -1)
    .slice(-6)
    .map((message) => message.content)
    .join(" ");
  const fullUserContext = `${recentUserContext} ${latestUserTurn}`;
  const latestFood = isFoodContent(latestUserTurn);
  const contextualFood =
    /\b(what\s+about|how\s+about|instead|nearby|there|that\s+area|places?)\b/i.test(
      latestUserTurn,
    ) && isFoodContent(recentUserContext);
  const locationLabel =
    inferChatLocationLabel(latestUserTurn) ?? inferChatLocationLabel(recentUserContext);
  const today = /\btoday|right\s+now|now|this\s+(?:morning|afternoon|evening)\b/i.test(
    fullUserContext,
  );
  const nearby = /\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(
    fullUserContext,
  );
  const weather = isWeatherContent(latestUserTurn);
  const weatherSensitive =
    weather ||
    /\brainy|rain(?:ing)?|showers?|storm|windy|surf|waves?|conditions?|cloudy\b/i.test(
      latestUserTurn,
    ) ||
    ((today || nearby) &&
      /\b(what\s+should|what\s+can|things?\s+to\s+do|activities?|plan|itinerary|beach|surf|walk|ride|island\s+hopping)\b/i.test(
        latestUserTurn,
      ));
  const activityPlan =
    !latestFood &&
    /\b(what\s+should|what\s+can|things?\s+to\s+do|activities?|plan|itinerary)\b/i.test(
      latestUserTurn,
    ) &&
    (Boolean(locationLabel) || /\bsiargao\b/i.test(fullUserContext));

  return {
    latestUserTurn,
    recentUserContext,
    ...(locationLabel ? { locationLabel } : {}),
    activityPlan,
    food: latestFood || contextualFood,
    nearby,
    today,
    weatherSensitive,
    weather,
  };
}

function isFoodContent(content: string) {
  return /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|cafes?|coffee|bars?|nightlife|places?\s+to\s+(?:eat|go|stop)|stop\s+to\s+eat|food\s+stops?|car[ie]nderias?|seafood)\b/i.test(
    content,
  );
}

function isWeatherContent(content: string) {
  return /\b(weather|forecast|rain|rainy|raining|showers?|wind|windy|storm|cloudy|sunny|humidity|temperature|temp|tide|waves?|surf|sea conditions?)\b/i.test(
    content,
  );
}

function inferChatLocationLabel(content: string): ChatRequestIntent["locationLabel"] {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bdel\s+carmen\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bsiargao\b/i.test(content)) {
    return "Siargao Island";
  }
  return undefined;
}

function summarizeIntentForLogs(intent: ChatRequestIntent) {
  return {
    activityPlan: intent.activityPlan,
    food: intent.food,
    locationLabel: intent.locationLabel,
    nearby: intent.nearby,
    today: intent.today,
    weather: intent.weather,
    weatherSensitive: intent.weatherSensitive,
  };
}

function renderGroundedLocalPlan(
  intent: ChatRequestIntent,
  weatherContext: WeatherSnapshot | undefined,
) {
  if (intent.food || intent.weather) {
    const directWeatherQuestion =
      /\b(weather|forecast|temperature|temp|humidity|wind|surf|waves?|sea conditions?)\b/i.test(
        intent.latestUserTurn,
      );
    if (directWeatherQuestion) {
      return undefined;
    }
  }
  if (!intent.activityPlan && !intent.weatherSensitive) {
    return undefined;
  }

  const location = intent.locationLabel ?? "Siargao";
  const today = weatherContext?.today;
  const rainLevel = today?.level ?? "medium";
  const rainy =
    /rainy|rain(?:ing)?|showers?|storm/i.test(intent.latestUserTurn) || rainLevel === "high";
  const sourceLine = weatherContext
    ? `Checked: ${weatherContext.sourceName} forecast for ${weatherContext.locationName}.`
    : "Checked: no live weather snapshot was available for this request.";
  const weatherLine = today
    ? `Weather signal: ${today.condition}; rain ${formatNullableWeatherMetric(
        today.rainSum,
        "mm",
      )}; precipitation chance ${formatNullableWeatherMetric(
        today.precipitationProbability,
        "%",
      )}; wind gust ${formatNullableWeatherMetric(today.windGust, "km/h")}.`
    : "Weather signal: live conditions were not available.";

  const plan = rainy
    ? [
        `For ${location} on a rainy day, I would keep this flexible and covered:`,
        "",
        "1. Start with a covered cafe or brunch stop near Catangnan/General Luna.",
        "2. Use a massage/spa, laundry, cash, SIM, or transfer-booking errand for the heaviest rain window.",
        "3. Walk the Cloud 9 boardwalk only during a clear break and skip long exposed rides if roads are flooding.",
        "4. For dinner, ask for dinner places and I will check Google Places instead of guessing.",
      ]
    : [
        `For ${location} today, I would keep the plan close and weather-aware:`,
        "",
        "1. Check Cloud 9 boardwalk/viewing deck first while conditions are comfortable.",
        "2. Add a surf lesson or board rental only if local surf conditions look suitable when you arrive.",
        "3. Use a cafe or lunch stop near Catangnan/General Luna as your weather fallback.",
        "4. Keep sunset flexible; switch to dinner nearby if rain or wind picks up.",
      ];

  return [
    ...plan,
    "",
    sourceLine,
    weatherLine,
    "Not checked: Google Places open-now results, surf/swell reports, road flooding, bookings, or review text.",
  ].join("\n");
}

function formatNullableWeatherMetric(value: number | null | undefined, unit: string) {
  return value === null || value === undefined ? "unavailable" : `${value}${unit}`;
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
