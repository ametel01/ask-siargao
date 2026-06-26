import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import {
  type AnswerSourceSummary,
  renderAnswerSourceLines,
} from "@/server/chat/answer-source-summary";
import { deriveTripContext, type TripContext } from "@/server/chat/intent";
import { interpretPlaceIntent, type PlaceIntent } from "@/server/chat/place-intent";
import {
  createDefaultRecommendationAgent,
  type RecommendationAgent,
  type RecommendationAgentResponse,
} from "@/server/chat/recommendation-agent";
import {
  type AskSiargaoChatMessage,
  generateAskSiargaoChatResponse,
} from "@/server/llm/chat-adapter";
import {
  type BeachRecommendationRequest,
  renderSiargaoBeachRecommendation,
} from "@/server/local/siargao-beaches";
import { createComponentLogger } from "@/server/observability/logger";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
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
  tripContext: TripContext;
  locationLabel?: "Cloud 9" | "Del Carmen" | "General Luna" | "Siargao Island";
  activityPlan: boolean;
  beach: boolean;
  beachRequest?: BeachRecommendationRequest;
  nearby: boolean;
  placeIntent?: PlaceIntent;
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

  if (shouldAskForMissingContext(intent)) {
    logger.info(
      { durationMs: Date.now() - startedAt, intent: summarizeIntentForLogs(intent) },
      "Chat request needs clarification for missing context.",
    );
    return Response.json({ message: missingContextClarificationMessage, requestId }, { headers });
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
    const beachRecommendation = renderGroundedBeachRecommendation(intent);
    if (beachRecommendation) {
      logger.info(
        {
          branch: "grounded_beach_recommendation",
          intent: summarizeIntentForLogs(intent),
          durationMs: Date.now() - startedAt,
        },
        "Chat request answered.",
      );
      return Response.json({ message: beachRecommendation, requestId }, { headers });
    }

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

    const sourceSummaries = weatherContext
      ? [
          weatherSourceSummary(weatherContext),
          genericFallbackSourceSummary({ includeWeatherForecast: false }),
        ]
      : [genericFallbackSourceSummary()];

    return Response.json(
      {
        message: appendSourceLines(result.message, sourceSummaries),
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
            ? appendSourceLines("Ask Siargao could not search local places right now.", [
                recommendationProviderUnavailableSourceSummary,
              ])
            : "Ask Siargao could not generate a response right now.",
      },
      { status, headers },
    );
  }
}

function genericFallbackSourceSummary({
  includeWeatherForecast = true,
}: {
  includeWeatherForecast?: boolean;
} = {}): AnswerSourceSummary {
  return {
    label: "not_verified",
    sourceName: "Generic model reasoning",
    checked: [],
    notChecked: [
      "live Google Places",
      "fresh cached Google Places",
      ...(includeWeatherForecast ? ["Open-Meteo weather forecast"] : []),
      "curated local guide checks",
      "bookings",
      "review text",
    ],
  };
}

const recommendationProviderUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: googlePlacesDiscoverySourceProfileId,
  confidence: "low",
  checked: [],
  notChecked: [
    "Google Places recommendation lookup",
    "open-now status",
    "bookings",
    "review text",
    "independent local validation",
  ],
};

function appendSourceLines(message: string, summaries: readonly AnswerSourceSummary[]) {
  const sourceLines = renderAnswerSourceLines(summaries);
  if (sourceLines.length === 0) {
    return message;
  }
  return [message.trimEnd(), "", ...sourceLines].join("\n");
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
  return Boolean(intent.placeIntent);
}

function interpretChatRequestIntent(messages: readonly AskSiargaoChatMessage[]): ChatRequestIntent {
  const tripContext = deriveTripContext(messages);
  const { fullUserContext, latestUserTurn, recentUserContext } = tripContext;
  const placeIntent = interpretPlaceIntent(messages);
  const latestBeach =
    isBeachContent(latestUserTurn) ||
    tripContext.activeGoal === "beach_swimming" ||
    tripContext.activeGoal === "beach_sunset";
  const contextualBeach =
    isBeachConstraintContent(latestUserTurn) && isBeachContent(recentUserContext);
  const locationLabel =
    inferChatLocationLabelFromTripContext(tripContext) ?? inferChatLocationLabel(fullUserContext);
  const beachRequest =
    latestBeach || contextualBeach
      ? inferBeachRequest({
          fullUserContext,
          latestUserTurn,
          tripContext,
        })
      : null;
  const today = /\btoday|right\s+now|now|this\s+(?:morning|afternoon|evening)\b/i.test(
    fullUserContext,
  );
  const nearby = /\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(
    fullUserContext,
  );
  const weather = isWeatherContent(latestUserTurn);
  const weatherSensitive =
    weather ||
    tripContext.activeGoal === "rain_plan" ||
    /\brainy|rain(?:ing)?|showers?|storm|windy|surf|waves?|conditions?|cloudy\b/i.test(
      latestUserTurn,
    ) ||
    ((today || nearby) && isActivityPlanContent(latestUserTurn));
  const activityPlan =
    !placeIntent &&
    (isActivityPlanContent(latestUserTurn) || tripContext.activeGoal === "itinerary") &&
    (Boolean(locationLabel) || /\bsiargao\b/i.test(fullUserContext));

  return {
    latestUserTurn,
    recentUserContext,
    tripContext,
    ...(locationLabel ? { locationLabel } : {}),
    activityPlan,
    beach: latestBeach || contextualBeach,
    ...(beachRequest ? { beachRequest } : {}),
    nearby,
    ...(placeIntent ? { placeIntent } : {}),
    today,
    weatherSensitive,
    weather,
  };
}

function isActivityPlanContent(content: string) {
  return /\b(w?hat\s+should|w?hat\s+can|things?\s+to\s+do|activities?|plan|itinerary)\b/i.test(
    content,
  );
}

function isBeachContent(content: string) {
  return /\b(beaches?|beach\s+day|swim(?:ming)?|sand(?:y)?\s+beaches?|not\s+rocky|rocky|sunset\s+beach|within\s+\d+\s*(?:min|minutes?)\s+(?:ride|drive)|scooter\s+(?:ride|day|trip))\b/i.test(
    content,
  );
}

function isBeachConstraintContent(content: string) {
  return /\b(sand(?:y)?|not\s+rocky|rocky|swim(?:ming)?|sunset|within\s+\d+\s*(?:min|minutes?)|ride|scooter|half[-\s]?day)\b/i.test(
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
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  if (/\bsiargao\b/i.test(content)) {
    return "Siargao Island";
  }
  return undefined;
}

function inferBeachRequest({
  fullUserContext,
  latestUserTurn,
  tripContext,
}: {
  fullUserContext: string;
  latestUserTurn: string;
  tripContext: TripContext;
}): BeachRecommendationRequest {
  const latestSwimming =
    tripContext.temporaryModifiers.includes("swimming") ||
    /\bswim(?:ming)?|calm\s+water\b/i.test(latestUserTurn);
  const latestSunset =
    tripContext.activeGoal === "beach_sunset" ||
    tripContext.temporaryModifiers.includes("sunset") ||
    /\bsunset\b/i.test(latestUserTurn);
  return {
    originLabel:
      inferBeachOriginLabelFromTripContext(tripContext) ?? inferBeachOriginLabel(fullUserContext),
    maxRideMinutes: tripContext.rideTimeLimitMinutes ?? inferRideMinuteConstraint(fullUserContext),
    sandOnly: /\bsand(?:y)?(?:\s+beaches?)?\s+only|\bsandy\s+beaches?\b/i.test(fullUserContext),
    avoidRocky:
      tripContext.travelerProfile.avoidsRockyBeach ||
      /\bnot\s+rocky|no\s+rocks?|avoid\s+rocks?|smooth\s+sand\b/i.test(fullUserContext),
    swimming: latestSwimming && !latestSunset,
    sunset: latestSunset,
    conciseFollowUp:
      latestSwimming &&
      !latestSunset &&
      /\b(?:best\s+for|est\s+for|for)\s+swimming\b|^swim(?:ming)?\??$/i.test(latestUserTurn.trim()),
    ...(tripContext.transportMode !== "unknown"
      ? { transportMode: tripContext.transportMode }
      : {}),
    ...(tripContext.travelerProfile.withKids ? { withKids: true } : {}),
    ...(tripContext.durableConstraints.length
      ? { durableConstraints: tripContext.durableConstraints }
      : {}),
  };
}

function inferChatLocationLabelFromTripContext(
  tripContext: TripContext,
): ChatRequestIntent["locationLabel"] {
  const label = tripContext.currentLocation?.label ?? tripContext.currentArea;
  if (label === "Cloud 9" || label === "General Luna" || label === "Siargao Island") {
    return label;
  }
  if (label === "Del Carmen" || label === "Del Carmen Port" || label === "Sugba Lagoon") {
    return "Del Carmen";
  }
  return undefined;
}

function inferBeachOriginLabelFromTripContext(
  tripContext: TripContext,
): BeachRecommendationRequest["originLabel"] {
  const label =
    tripContext.origin?.label ?? tripContext.currentLocation?.label ?? tripContext.currentArea;
  if (label === "Cloud 9" || label === "General Luna" || label === "Siargao Island") {
    return label;
  }
  return undefined;
}

function inferBeachOriginLabel(content: string): BeachRecommendationRequest["originLabel"] {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  if (/\bsiargao\b/i.test(content)) {
    return "Siargao Island";
  }
  return undefined;
}

function inferRideMinuteConstraint(content: string) {
  const match = /\bwithin\s+(\d{1,3})\s*(?:min|minutes?)\b/i.exec(content);
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

function summarizeIntentForLogs(intent: ChatRequestIntent) {
  return {
    activityPlan: intent.activityPlan,
    beach: intent.beach,
    beachRequest: intent.beachRequest,
    locationLabel: intent.locationLabel,
    nearby: intent.nearby,
    tripContext: {
      activeGoal: intent.tripContext.activeGoal,
      currentLocation: intent.tripContext.currentLocation?.label,
      durableConstraints: intent.tripContext.durableConstraints,
      temporaryModifiers: intent.tripContext.temporaryModifiers,
      unresolvedReference: intent.tripContext.unresolvedReference,
    },
    placeIntent: intent.placeIntent
      ? {
          category: intent.placeIntent.category,
          liveNeeds: intent.placeIntent.liveNeeds,
          location: intent.placeIntent.location,
        }
      : undefined,
    today: intent.today,
    weather: intent.weather,
    weatherSensitive: intent.weatherSensitive,
  };
}

function shouldAskForMissingContext(intent: ChatRequestIntent) {
  return intent.tripContext.unresolvedReference === "there";
}

function renderGroundedLocalPlan(
  intent: ChatRequestIntent,
  weatherContext: WeatherSnapshot | undefined,
) {
  if (intent.placeIntent || intent.weather) {
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
  const hasAvailableWeatherSnapshot = weatherContext?.status === "live";
  const today = hasAvailableWeatherSnapshot ? weatherContext.today : undefined;
  const weatherAssessment = assessTodayWeather(intent, today);
  const weatherSignal = today ? compactWeatherSignal(today) : "live conditions were not available";

  const plan = localPlanLines(location, weatherAssessment);

  return [
    ...plan,
    "",
    ...renderAnswerSourceLines([weatherSourceSummary(weatherContext)], {
      weatherSignal: weatherSignal.replace(/\.$/, ""),
    }),
  ].join("\n");
}

function weatherSourceSummary(weatherContext: WeatherSnapshot | undefined): AnswerSourceSummary {
  if (weatherContext?.status === "live") {
    return {
      label: "weather_checked",
      sourceName: weatherContext.sourceName,
      sourceProfileId: weatherContext.sourceProfileId,
      fetchedAt: weatherContext.fetchedAt,
      confidence: weatherContext.confidence,
      checked: [`forecast for ${weatherContext.locationName}`],
      notChecked: [
        "Google Places open-now results",
        "surf/swell reports",
        "road flooding",
        "bookings",
        "review text",
      ],
    };
  }

  return {
    label: "provider_unavailable",
    sourceName: weatherContext?.sourceName ?? "Open-Meteo weather API",
    sourceProfileId: weatherContext?.sourceProfileId ?? "source_open_meteo",
    confidence: "low",
    checked: [],
    notChecked: [
      "Open-Meteo weather snapshot for this request",
      "Google Places open-now results",
      "surf/swell reports",
      "road flooding",
      "bookings",
      "review text",
    ],
  };
}

function renderGroundedBeachRecommendation(intent: ChatRequestIntent) {
  if (!intent.beach || !intent.beachRequest) {
    return undefined;
  }

  return renderSiargaoBeachRecommendation(intent.beachRequest);
}

function assessTodayWeather(
  intent: ChatRequestIntent,
  today: WeatherSnapshot["today"] | undefined,
): {
  headline: string;
  planKind: "stormy" | "flexible" | "outdoor";
} {
  const condition = today?.condition ?? "Forecast unavailable";
  const precipitationProbability = today?.precipitationProbability ?? 0;
  const rainSum = today?.rainSum ?? 0;
  const windGust = today?.windGust ?? 0;
  const explicitRainPlan = /rainy|rain(?:ing)?|showers?|storm/i.test(intent.latestUserTurn);
  const thunderstorm = /thunderstorm/i.test(condition);

  if (explicitRainPlan || thunderstorm || precipitationProbability >= 70) {
    return {
      headline: `Rain is possible near ${intent.locationLabel ?? "Siargao"} today. Keep plans close and covered.`,
      planKind: "stormy",
    };
  }

  if (precipitationProbability >= 45 || rainSum >= 6 || windGust >= 35) {
    return {
      headline: `The forecast near ${intent.locationLabel ?? "Siargao"} is mixed today. Keep outdoor stops easy to change.`,
      planKind: "flexible",
    };
  }

  return {
    headline: `${condition} near ${intent.locationLabel ?? "Siargao"} today. Start outdoors, but keep a covered fallback.`,
    planKind: "outdoor",
  };
}

function localPlanLines(location: string, assessment: ReturnType<typeof assessTodayWeather>) {
  if (assessment.planKind === "stormy") {
    return [
      assessment.headline,
      "",
      "1. Start with a covered cafe, massage, or errands.",
      "2. Use the Cloud 9 boardwalk only during a clear break.",
      "3. Keep dinner nearby and avoid long scooter rides if roads start pooling.",
    ];
  }

  if (assessment.planKind === "flexible") {
    return [
      assessment.headline,
      "",
      "1. Check the Cloud 9 boardwalk/viewing deck first, before conditions turn.",
      "2. Keep lunch or coffee near Catangnan/General Luna so you have cover within a short ride.",
      "3. Add surf or beach time only if conditions look comfortable when you arrive.",
    ];
  }

  return [
    assessment.headline,
    "",
    `1. Start at the ${location === "Cloud 9" ? "Cloud 9" : location} boardwalk/viewing area while conditions are good.`,
    "2. Add a surf lesson or board rental only after checking local surf conditions at the beach.",
    "3. Use a cafe or lunch stop near Catangnan/General Luna as your fallback.",
  ];
}

function compactWeatherSignal(today: WeatherSnapshot["today"]) {
  const parts = [today.condition];
  if ((today.precipitationProbability ?? 0) >= 40 || (today.rainSum ?? 0) > 0) {
    parts.push("rain possible");
  }
  if ((today.windGust ?? 0) >= 30) {
    parts.push("gusty");
  }
  return `${parts.join("; ")}.`;
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

const missingContextClarificationMessage =
  "Which Siargao place or area do you mean by there? Tell me the spot, area, or where you are staying and I can tailor the answer.";
