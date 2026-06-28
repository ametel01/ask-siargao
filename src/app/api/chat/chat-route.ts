import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import type {
  AgentMemoryMetadata,
  AgentToolCallAudit,
  ChatClientContext,
  ChatClientGeolocationConsentScope,
  ChatClientGeolocationContext,
  ItineraryPlan,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  type AskSiargaoAgentDependencies,
  runAskSiargaoAgentTurn as defaultRunAskSiargaoAgentTurn,
} from "@/server/chat/ask-siargao-agent";
import { deriveTripContext, type TripContext } from "@/server/chat/intent";
import { interpretPlaceIntent, type PlaceIntent } from "@/server/chat/place-intent";
import {
  assertChatAnswerSourceConsistency,
  SourceConsistencyError,
} from "@/server/chat/source-consistency";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import { createComponentLogger } from "@/server/observability/logger";

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
  clientContext: z
    .object({
      geolocation: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracyMeters: z.number().min(0).optional(),
          capturedAt: z.iso.datetime(),
          consentScope: z.enum(["single_request", "trip_session"]),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
});

type ParsedChatClientContext = z.infer<typeof chatRequestSchema>["clientContext"];

export type ChatRouteDependencies = AskSiargaoAgentDependencies & {
  runAskSiargaoAgentTurn?: typeof defaultRunAskSiargaoAgentTurn;
  logger?: Logger;
};

type ChatRequestIntent = {
  latestUserTurn: string;
  recentUserContext: string;
  tripContext: TripContext;
  conditionActivity?: "swimming" | "surfing" | "scooter" | "rain_plan" | "sunset" | "boat_trip";
  locationLabel?: "Cloud 9" | "Del Carmen" | "General Luna" | "Siargao Island";
  activityPlan: boolean;
  beach: boolean;
  marineCondition: boolean;
  missingContext: boolean;
  nearby: boolean;
  placeIntent?: PlaceIntent;
  roadCondition: boolean;
  shouldDeclineNonSiargaoTopic: boolean;
  today: boolean;
  weatherSensitive: boolean;
  weather: boolean;
};

type PublicAgentMemoryMetadata = {
  versionId: string;
  files: Array<{
    id: string;
    fileName: string;
    role: AgentMemoryMetadata["files"][number]["role"];
  }>;
};

const siargaoAreaBounds = {
  minLatitude: 9.35,
  maxLatitude: 10.15,
  minLongitude: 125.75,
  maxLongitude: 126.45,
} as const;
const maxGeolocationAgeMs = 30 * 60 * 1_000;
const maxFutureGeolocationSkewMs = 5 * 60 * 1_000;
const maxUsableAccuracyMeters = 3_000;
const maxChatRequestBodyBytes = 32_768;

const chatLogger = createComponentLogger("api.chat");

const defaultDependencies: ChatRouteDependencies = {
  runAskSiargaoAgentTurn: defaultRunAskSiargaoAgentTurn,
  logger: chatLogger,
};

export function createDefaultChatRouteDependencies(): ChatRouteDependencies {
  return {
    ...defaultDependencies,
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

  const rawBody = await readChatRequestBodyText(request);
  if (rawBody.status === "too_large") {
    logger.warn(
      {
        durationMs: Date.now() - startedAt,
        maxBytes: maxChatRequestBodyBytes,
      },
      "Chat request rejected: body too large.",
    );
    return Response.json(
      {
        error: "request_too_large",
        message: `Request body must be ${maxChatRequestBodyBytes} bytes or smaller.`,
      },
      { status: 413, headers },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.text);
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

  const messages = parsed.data.messages satisfies AskSiargaoChatMessage[];
  const clientContext = normalizeChatClientContext(parsed.data.clientContext, new Date(startedAt));
  const intent = interpretChatRequestIntent(messages);
  const latestUserMessage = getLatestUserMessage(messages);
  logger.info(
    {
      messageCount: messages.length,
      latestUserMessage: latestUserMessage
        ? summarizeMessageForLogs(latestUserMessage.content)
        : null,
      isRecommendationQuestion: isRecommendationQuestion(intent),
      isWeatherQuestion: isWeatherQuestion(intent),
      shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
      missingContext: intent.missingContext,
      geolocation: summarizeGeolocationForLogs(clientContext.geolocation),
    },
    "Chat request received.",
  );
  logger.debug(
    {
      intent: summarizeIntentForLogs(intent),
    },
    "Chat request intent interpreted.",
  );

  try {
    const runAgent = dependencies.runAskSiargaoAgentTurn ?? defaultRunAskSiargaoAgentTurn;
    const result = await runAgent(
      {
        messages,
        requestId,
        clientContext,
        metadata: {
          route: "/api/chat",
          clientContext: summarizeClientContextForMetadata(clientContext),
        },
        deterministicSignals: {
          clientContext: summarizeClientContextForAgent(clientContext),
          intent: summarizeIntentForAgent(intent),
          scope: {
            shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
            missingContext: intent.missingContext,
          },
        },
      },
      {
        ...dependencies,
        logger,
      },
    );
    const publicToolCalls = redactToolCallsForPublicResponse(
      result.toolCalls,
      clientContext.geolocation,
    );

    assertChatAnswerSourceConsistency({
      message: result.message,
      sources: chatAnswerSourcesForValidation(result.sources, result.itineraries),
      toolCalls: publicToolCalls,
      browserGeolocation: clientContext.geolocation,
    });

    logger.info(
      {
        branch: "agent_runtime",
        model: result.model,
        providerFailure: publicToolCalls.some(isProviderFailureToolCall),
        sourceLabels: [...new Set(result.sources.map((source) => source.label))],
        toolCallCount: publicToolCalls.length,
        toolCalls: publicToolCalls.map(summarizeToolCallForLogs),
        sourceCount: result.sources.length,
        itineraryCount: result.itineraries?.length ?? 0,
        upstreamRequestIds: result.upstreamRequestIds,
        agentMemoryVersionId: result.memory?.versionId,
        geolocation: summarizeGeolocationForLogs(clientContext.geolocation),
        durationMs: Date.now() - startedAt,
      },
      "Chat request answered.",
    );

    return Response.json(
      {
        message: result.message,
        requestId: result.requestId,
        model: result.model,
        ...(result.upstreamRequestIds?.length
          ? { upstreamRequestIds: result.upstreamRequestIds }
          : {}),
        toolCalls: publicToolCalls,
        sources: result.sources,
        ...(result.memory ? { memory: summarizeMemoryForResponse(result.memory) } : {}),
        ...(result.cards?.length ? { cards: result.cards } : {}),
        ...(result.actions?.length ? { actions: result.actions } : {}),
        ...(result.itineraries?.length ? { itineraries: result.itineraries } : {}),
      },
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat response failed.";
    const missingConfiguration =
      message.includes("OPENAI_API_KEY") ||
      message.includes("GOOGLE_API_KEY") ||
      message.includes("GOOGLE_PLACES_API_KEY");
    const sourceConsistencyFailure = error instanceof SourceConsistencyError;
    const status = missingConfiguration ? 503 : sourceConsistencyFailure ? 502 : 502;
    const errorCode = missingConfiguration
      ? "chat_not_configured"
      : sourceConsistencyFailure
        ? "source_consistency_failed"
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
          : sourceConsistencyFailure
            ? "Ask Siargao could not verify the answer sources."
            : "Ask Siargao could not generate a response right now.",
      },
      { status, headers },
    );
  }
}

async function readChatRequestBodyText(request: Request) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxChatRequestBodyBytes) {
    return { status: "too_large" as const };
  }

  if (!request.body) {
    return { status: "ok" as const, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxChatRequestBodyBytes) {
      await reader.cancel();
      return { status: "too_large" as const };
    }
    chunks.push(value);
  }

  return {
    status: "ok" as const,
    text: new TextDecoder().decode(concatChunks(chunks, totalBytes)),
  };
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number) {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function chatAnswerSourcesForValidation(
  sources: readonly AnswerSourceSummary[],
  itineraries: readonly ItineraryPlan[] | undefined,
) {
  return [...sources, ...(itineraries?.flatMap((itinerary) => itinerary.sources) ?? [])];
}

function normalizeChatClientContext(
  clientContext: ParsedChatClientContext,
  now: Date,
): ChatClientContext {
  return {
    geolocation: normalizeClientGeolocation(clientContext?.geolocation, now),
  };
}

function normalizeClientGeolocation(
  geolocation: NonNullable<ParsedChatClientContext>["geolocation"] | undefined,
  now: Date,
): ChatClientGeolocationContext {
  if (!geolocation) {
    return {
      status: "missing",
      source: "browser_geolocation",
    };
  }

  const base = {
    source: "browser_geolocation",
    consentScope: geolocation.consentScope satisfies ChatClientGeolocationConsentScope,
  } as const;

  if (!isInSiargaoArea(geolocation.latitude, geolocation.longitude)) {
    return {
      ...base,
      status: "out_of_area",
    };
  }

  if (isStaleGeolocation(geolocation.capturedAt, now)) {
    return {
      ...base,
      status: "stale",
    };
  }

  if (
    geolocation.accuracyMeters !== undefined &&
    geolocation.accuracyMeters > maxUsableAccuracyMeters
  ) {
    return {
      ...base,
      status: "low_accuracy",
    };
  }

  return {
    ...base,
    status: "available",
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
    ...(geolocation.accuracyMeters !== undefined
      ? { accuracyMeters: geolocation.accuracyMeters }
      : {}),
    capturedAt: geolocation.capturedAt,
  };
}

function isInSiargaoArea(latitude: number, longitude: number) {
  return (
    latitude >= siargaoAreaBounds.minLatitude &&
    latitude <= siargaoAreaBounds.maxLatitude &&
    longitude >= siargaoAreaBounds.minLongitude &&
    longitude <= siargaoAreaBounds.maxLongitude
  );
}

function isStaleGeolocation(capturedAt: string, now: Date) {
  const capturedTime = Date.parse(capturedAt);
  const ageMs = now.getTime() - capturedTime;
  return ageMs > maxGeolocationAgeMs || ageMs < -maxFutureGeolocationSkewMs;
}

function summarizeClientContextForMetadata(clientContext: ChatClientContext) {
  return {
    geolocation: summarizeGeolocationForLogs(clientContext.geolocation),
  };
}

function summarizeClientContextForAgent(clientContext: ChatClientContext) {
  const geolocation = clientContext.geolocation;
  return {
    geolocation: {
      status: geolocation.status,
      source: geolocation.source,
      consentScope: geolocation.consentScope,
      ...(geolocation.status === "available" ? { centerSource: "browser_geolocation" } : {}),
    },
  };
}

function summarizeGeolocationForLogs(geolocation: ChatClientGeolocationContext) {
  return {
    status: geolocation.status,
    source: geolocation.source,
    consentScope: geolocation.consentScope,
  };
}

function isWeatherQuestion(intent: ChatRequestIntent) {
  return intent.weather || intent.weatherSensitive || intent.activityPlan;
}

function summarizeMemoryForResponse(memory: AgentMemoryMetadata): PublicAgentMemoryMetadata {
  return {
    versionId: memory.versionId,
    files: memory.files.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      role: file.role,
    })),
  };
}

function summarizeToolCallForLogs(toolCall: AgentToolCallAudit) {
  return {
    name: toolCall.name,
    status: toolCall.status,
    errorCode: toolCall.errorCode,
    providerOperation: toolCall.providerOperation,
    sourceLabels: toolCall.sources.map((source) => source.label),
    sourceProfileIds: toolCall.sourceProfileIds,
    durationMs: toolCall.durationMs,
  };
}

function isProviderFailureToolCall(toolCall: AgentToolCallAudit) {
  return (
    toolCall.status === "error" ||
    toolCall.errorCode === "provider_unavailable" ||
    toolCall.sources.some((source) => source.label === "provider_unavailable")
  );
}

function redactToolCallsForPublicResponse(
  toolCalls: readonly AgentToolCallAudit[],
  geolocation: ChatClientGeolocationContext,
) {
  if (!hasExactBrowserGeolocation(geolocation)) {
    return toolCalls;
  }

  return toolCalls.map((toolCall) => {
    if (toolCall.name !== "search_places") {
      return toolCall;
    }

    const center = toolCall.arguments.center;
    if (!isRecord(center) || !centerMatchesBrowserGeolocation(center, geolocation)) {
      return toolCall;
    }

    return {
      ...toolCall,
      arguments: {
        ...toolCall.arguments,
        center: browserGeolocationCenterReference(),
      },
    };
  });
}

function hasExactBrowserGeolocation(
  geolocation: ChatClientGeolocationContext,
): geolocation is ChatClientGeolocationContext & { latitude: number; longitude: number } {
  return (
    geolocation.status === "available" &&
    geolocation.source === "browser_geolocation" &&
    typeof geolocation.latitude === "number" &&
    typeof geolocation.longitude === "number"
  );
}

function centerMatchesBrowserGeolocation(
  center: Record<string, unknown>,
  geolocation: ChatClientGeolocationContext & { latitude: number; longitude: number },
) {
  return center.latitude === geolocation.latitude && center.longitude === geolocation.longitude;
}

function browserGeolocationCenterReference() {
  return { source: "browser_geolocation" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const today = /\btoday|right\s+now|now|this\s+(?:morning|afternoon|evening)\b/i.test(
    fullUserContext,
  );
  const nearby = /\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(
    fullUserContext,
  );
  const bareRideBoatFollowUp = isBareRideBoatFollowUp(latestUserTurn, recentUserContext);
  const directConditionActivity = bareRideBoatFollowUp
    ? undefined
    : inferConditionActivity(latestUserTurn);
  const conditionActivity = bareRideBoatFollowUp
    ? "boat_trip"
    : (directConditionActivity ??
      inferFollowUpConditionActivity(latestUserTurn, recentUserContext));
  const inheritedConditionContext = directConditionActivity ? latestUserTurn : recentUserContext;
  const marineCondition =
    isMarineConditionContent(latestUserTurn) ||
    (Boolean(conditionActivity) && isMarineConditionContent(inheritedConditionContext));
  const roadCondition =
    (!bareRideBoatFollowUp && isRoadConditionContent(latestUserTurn)) ||
    (Boolean(conditionActivity) && isRoadConditionContent(inheritedConditionContext));
  const weather = isWeatherContent(latestUserTurn);
  const weatherSensitive =
    weather ||
    Boolean(conditionActivity) ||
    marineCondition ||
    roadCondition ||
    tripContext.activeGoal === "rain_plan" ||
    /\brainy|rain(?:ing)?|showers?|storm|windy|surf|waves?|conditions?|cloudy\b/i.test(
      latestUserTurn,
    ) ||
    ((today || nearby) && isActivityPlanContent(latestUserTurn));
  const excludesActivityPlan = isLogisticsOrCritiquePlanContent(latestUserTurn);
  const activityPlan =
    !excludesActivityPlan &&
    (isActivityPlanContent(latestUserTurn) || tripContext.activeGoal === "itinerary") &&
    (Boolean(locationLabel) || /\bsiargao\b/i.test(fullUserContext));
  const partialIntent = {
    latestUserTurn,
    recentUserContext,
    tripContext,
    ...(locationLabel ? { locationLabel } : {}),
    activityPlan,
    beach: latestBeach || contextualBeach,
    ...(conditionActivity ? { conditionActivity } : {}),
    marineCondition,
    nearby,
    ...(placeIntent ? { placeIntent } : {}),
    roadCondition,
    today,
    weatherSensitive,
    weather,
  };

  return {
    ...partialIntent,
    missingContext: shouldAskForMissingContext(partialIntent),
    shouldDeclineNonSiargaoTopic: shouldDeclineNonSiargaoTopic(messages),
  };
}

function isActivityPlanContent(content: string) {
  if (isLogisticsOrCritiquePlanContent(content)) {
    return false;
  }
  const directActivityLanguage =
    /\b(w?hat\s+should|w?hat\s+can|things?\s+to\s+do|activities?|itinerary|half[-\s]?day|food\s+crawl|sandy\s+beach(?:es)?)\b/i.test(
      content,
    );
  const scopedPlanLanguage =
    /\bplan\b/i.test(content) &&
    /\b(?:rainy\s+cloud\s*9|sunset|dinner|food\s+crawl|sandy\s+beach|non[-\s]?surfer|half[-\s]?day|(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?|stops?|sequence|route)\b/i.test(
      content,
    );
  return directActivityLanguage || scopedPlanLanguage;
}

function isLogisticsOrCritiquePlanContent(content: string) {
  if (
    /\b(critique|review|audit|improve\s+my\s+itinerary|plan\s+my\s+(?:trip|vacation|holiday))\b/i.test(
      content,
    )
  ) {
    return true;
  }
  return (
    /\b(airport|flight|ferry|pier|port|transfer|pickup|pick\s+up|drop[-\s]?off|taxi|shuttle|transport|transportation|logistics?)\b/i.test(
      content,
    ) && !hasScopedLocalItineraryContent(content)
  );
}

function hasScopedLocalItineraryContent(content: string) {
  return (
    /\b(?:rainy\s+cloud\s*9|sunset|dinner|food\s+crawl|sandy\s+beach|non[-\s]?surfer|half[-\s]?day)\b/i.test(
      content,
    ) ||
    (/\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(content) &&
      /\b(food\s+crawl|crawl|things?\s+to\s+do|activities?|stops?|beaches?|sunset|dinner|lunch|breakfast|brunch|caf[eé]s?|restaurants?|eat)\b/i.test(
        content,
      )) ||
    (/\b(?:route|sequence)\b/i.test(content) && /\bstops?\b/i.test(content))
  );
}

function isBeachContent(content: string) {
  return /\b(beaches?|beach\s+day|swim(?:ming)?|sand(?:y)?\s+beach(?:es)?|not\s+rocky|rocky|sunset\s+beach|within\s+\d+\s*(?:min|minutes?)\s+(?:ride|drive)|scooter\s+(?:ride|day|trip))\b/i.test(
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

function inferConditionActivity(
  content: string,
): ChatRequestIntent["conditionActivity"] | undefined {
  if (/\b(swim|swimming|swimmable)\b/i.test(content)) {
    return "swimming";
  }
  if (/\b(boat|boat\s+tour|island\s+hopping|sugba|lagoon)\b/i.test(content)) {
    return "boat_trip";
  }
  if (/\b(surf|surfing|waves?|swell)\b/i.test(content)) {
    return "surfing";
  }
  if (/\b(scooter|motorbike|motor\s*bike|land\s+tour)\b/i.test(content)) {
    return "scooter";
  }
  if (
    /\bdrive\b/i.test(content) ||
    (/\bride\b/i.test(content) && !isMarineConditionContent(content))
  ) {
    return "scooter";
  }
  if (/\brain\s+plan|rainy\s+day|covered|avoid\s+rain\b/i.test(content)) {
    return "rain_plan";
  }
  if (/\bsunset\b/i.test(content)) {
    return "sunset";
  }
  return undefined;
}

function inferFollowUpConditionActivity(
  latestUserTurn: string,
  recentUserContext: string,
): ChatRequestIntent["conditionActivity"] | undefined {
  if (!isConditionFollowUpContent(latestUserTurn)) {
    return undefined;
  }
  if (
    /\b(food|eat|restaurants?|caf[eé]s?|coffee|dinner|lunch|breakfast|brunch|bar|hotel|stay)\b/i.test(
      latestUserTurn,
    )
  ) {
    return undefined;
  }
  return inferConditionActivity(recentUserContext);
}

function isBareRideBoatFollowUp(latestUserTurn: string, recentUserContext: string) {
  return (
    /\bride\b/i.test(latestUserTurn) &&
    !/\b(scooter|motorbike|motor\s*bike|drive|land\s+tour)\b/i.test(latestUserTurn) &&
    !hasBoatTripConditionContent(latestUserTurn) &&
    hasBoatTripConditionContent(recentUserContext)
  );
}

function isConditionFollowUpContent(content: string) {
  return /\b(what\s+about|how\s+about|same|tomorrow|tmrw|next\s+7\s+days?|next\s+seven\s+days?|this\s+week|next\s+week|weekend|later\s+this\s+week)\b/i.test(
    content,
  );
}

function hasBoatTripConditionContent(content: string) {
  return /\b(boat|island\s+hopping|sugba|lagoon|boat\s+trip|boat\s+ride|marine)\b/i.test(content);
}

function isMarineConditionContent(content: string) {
  return /\b(tides?|surf|swell|waves?|currents?|sea\s+conditions?|swim(?:ming)?|boat|island\s+hopping|lagoon)\b/i.test(
    content,
  );
}

function isRoadConditionContent(content: string) {
  return (
    /\b(scooter|motorbike|motor\s*bike|road|flood(?:ed|ing)?|drive|land\s+tour)\b/i.test(content) ||
    (/\bride\b/i.test(content) && !isMarineConditionContent(content))
  );
}

function inferChatLocationLabel(content: string): ChatRequestIntent["locationLabel"] {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bdel\s+carmen\b|\bsugba(?:\s+lagoon)?\b/i.test(content)) {
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

function summarizeIntentForAgent(intent: ChatRequestIntent) {
  return {
    activityPlan: intent.activityPlan,
    beach: intent.beach,
    conditionActivity: intent.conditionActivity,
    locationLabel: intent.locationLabel,
    marineCondition: intent.marineCondition,
    missingContext: intent.missingContext,
    nearby: intent.nearby,
    placeIntent: intent.placeIntent,
    roadCondition: intent.roadCondition,
    shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
    today: intent.today,
    weather: intent.weather,
    weatherSensitive: intent.weatherSensitive,
    tripContext: {
      activeGoal: intent.tripContext.activeGoal,
      currentArea: intent.tripContext.currentArea,
      currentLocation: intent.tripContext.currentLocation,
      durableConstraints: intent.tripContext.durableConstraints,
      origin: intent.tripContext.origin,
      rideTimeLimitMinutes: intent.tripContext.rideTimeLimitMinutes,
      temporaryModifiers: intent.tripContext.temporaryModifiers,
      transportMode: intent.tripContext.transportMode,
      travelerProfile: intent.tripContext.travelerProfile,
      unresolvedReference: intent.tripContext.unresolvedReference,
    },
  };
}

function summarizeIntentForLogs(intent: ChatRequestIntent) {
  return {
    activityPlan: intent.activityPlan,
    beach: intent.beach,
    conditionActivity: intent.conditionActivity,
    locationLabel: intent.locationLabel,
    marineCondition: intent.marineCondition,
    missingContext: intent.missingContext,
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
    roadCondition: intent.roadCondition,
    shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
    today: intent.today,
    weather: intent.weather,
    weatherSensitive: intent.weatherSensitive,
  };
}

function shouldAskForMissingContext(intent: Pick<ChatRequestIntent, "tripContext">) {
  return intent.tripContext.unresolvedReference === "there";
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
