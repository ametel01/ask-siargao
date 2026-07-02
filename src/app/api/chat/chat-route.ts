import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import type {
  AgentMemoryMetadata,
  AgentTurnResult,
  ChatClientContext,
  ChatClientGeolocationConsentScope,
  ChatClientGeolocationContext,
  PublicAgentToolCall,
} from "@/server/chat/agent-runtime";
import {
  type AskSiargaoAgentDependencies,
  runAskSiargaoAgentTurn as defaultRunAskSiargaoAgentTurn,
} from "@/server/chat/ask-siargao-agent";
import {
  appendChatHistoryMessage,
  type ChatHistoryThread,
  createChatThread,
  loadOwnedChatThread,
  touchChatThread,
} from "@/server/chat/chat-history-store";
import { deriveTripContext, type TripContext } from "@/server/chat/intent";
import { assemblePublicChatTurn } from "@/server/chat/public-turn-assembly";
import { SourceConsistencyError } from "@/server/chat/source-consistency";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import { createComponentLogger } from "@/server/observability/logger";

const chatRequestSchema = z.strictObject({
  threadId: z.string().min(1).max(128).optional(),
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
        .strictObject({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracyMeters: z.number().min(0).optional(),
          capturedAt: z.iso.datetime(),
          consentScope: z.enum(["single_request", "trip_session"]),
        })
        .optional(),
    })
    .optional(),
});

type ParsedChatClientContext = z.infer<typeof chatRequestSchema>["clientContext"];

export type ChatRouteDependencies = AskSiargaoAgentDependencies & {
  auth?: EnsureCurrentUserDependencies["auth"] | null;
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  runAskSiargaoAgentTurn?: typeof defaultRunAskSiargaoAgentTurn;
  now?: () => Date;
  logger?: Logger;
};

type AuthenticatedChatPersistence = {
  db: DatabaseQueryClient;
  thread: ChatHistoryThread;
  userId: string;
  userMessageId: string;
};

type ChatRequestIntent = {
  tripContext: TripContext;
  locationLabel?: "Cloud 9" | "Del Carmen" | "General Luna" | "Siargao Island";
  nearby: boolean;
  nearMeUsesBrowserGeolocation: boolean;
  shouldDeclineNonSiargaoTopic: boolean;
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
  const intent = interpretChatRequestIntent(messages, clientContext);
  const latestUserMessage = getLatestUserMessage(messages);
  const authenticatedPersistence = await prepareAuthenticatedChatPersistence({
    dependencies,
    latestUserMessage,
    threadId: parsed.data.threadId,
    clientContext,
    intent,
    now: new Date(startedAt),
  });

  if (authenticatedPersistence?.status === "not_found") {
    return Response.json({ error: "chat_thread_not_found" }, { status: 404, headers });
  }

  logger.info(
    {
      messageCount: messages.length,
      latestUserMessage: latestUserMessage
        ? summarizeMessageForLogs(latestUserMessage.content)
        : null,
      shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
      geolocation: summarizeGeolocationForLogs(clientContext.geolocation),
    },
    "Chat request received.",
  );
  logger.debug(
    {
      scope: summarizeScopeForLogs(intent),
    },
    "Chat request scope interpreted.",
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
          scope: {
            shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
          },
        },
      },
      {
        ...dependencies,
        logger,
      },
    );
    const publicTurn = assemblePublicChatTurn({
      result,
      browserGeolocation: clientContext.geolocation,
    });
    if (publicTurn.repair) {
      logger.warn(
        {
          issueCount: publicTurn.repair.issueCount,
          repairedLineCount: publicTurn.repair.repairedLineCount,
        },
        "Chat answer repaired by removing malformed rendered source lines.",
      );
    }

    let assistantMessageId: string | undefined;
    if (authenticatedPersistence?.status === "ready") {
      assistantMessageId = createChatRouteId(dependencies, "chat_message");
      const completedAt = new Date();
      await appendChatHistoryMessage(authenticatedPersistence.db, {
        id: assistantMessageId,
        threadId: authenticatedPersistence.thread.id,
        userId: authenticatedPersistence.userId,
        role: "assistant",
        content: publicTurn.storage.message,
        requestId: result.requestId,
        model: result.model,
        sources: publicTurn.storage.sources,
        cards: publicTurn.storage.cards,
        actions: publicTurn.storage.actions,
        itineraries: publicTurn.storage.itineraries,
        decisionSummaries: publicTurn.storage.decisionSummaries,
        toolCalls: publicTurn.storage.toolCalls,
        contextSummary: summarizeClientContextForStoredHistory(clientContext, intent),
        createdAt: completedAt,
      });
      await touchChatThread(authenticatedPersistence.db, {
        threadId: authenticatedPersistence.thread.id,
        lastMessageAt: completedAt,
      });
    }

    logger.info(
      {
        branch: "agent_runtime",
        model: result.model,
        providerFailure: publicTurn.display.toolCalls.some(isProviderFailureToolCall),
        sourceLabels: [...new Set(result.sources.map((source) => source.label))],
        publicSourceLabels: [...new Set(publicTurn.display.sources.map((source) => source.label))],
        toolCallCount: publicTurn.display.toolCalls.length,
        toolCalls: publicTurn.display.toolCalls.map(summarizeToolCallForLogs),
        sourceCount: result.sources.length,
        publicSourceCount: publicTurn.display.sources.length,
        cardCount: publicTurn.display.cards.length,
        actionCount: publicTurn.display.actions.length,
        itineraryCount: publicTurn.display.itineraries.length,
        decisionSummaryCount: publicTurn.display.decisionSummaries.length,
        ...(result.artifactSelection
          ? { artifactSelection: summarizeArtifactSelectionForLogs(result.artifactSelection) }
          : {}),
        upstreamRequestIds: result.upstreamRequestIds,
        agentMemoryVersionId: result.memory?.versionId,
        geolocation: summarizeGeolocationForLogs(clientContext.geolocation),
        durationMs: Date.now() - startedAt,
      },
      "Chat request answered.",
    );

    return Response.json(
      {
        message: publicTurn.display.message,
        requestId: result.requestId,
        model: result.model,
        ...(result.upstreamRequestIds?.length
          ? { upstreamRequestIds: result.upstreamRequestIds }
          : {}),
        toolCalls: publicTurn.display.toolCalls,
        sources: publicTurn.display.sources,
        ...(result.memory ? { memory: summarizeMemoryForResponse(result.memory) } : {}),
        ...(publicTurn.display.cards.length ? { cards: publicTurn.display.cards } : {}),
        ...(publicTurn.display.actions.length ? { actions: publicTurn.display.actions } : {}),
        ...(publicTurn.display.itineraries.length
          ? { itineraries: publicTurn.display.itineraries }
          : {}),
        ...(publicTurn.display.decisionSummaries.length
          ? { decisionSummaries: publicTurn.display.decisionSummaries }
          : {}),
        ...(authenticatedPersistence?.status === "ready"
          ? {
              threadId: authenticatedPersistence.thread.id,
              userMessageId: authenticatedPersistence.userMessageId,
              assistantMessageId,
            }
          : {}),
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

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const value of request.body) {
    totalBytes += value.byteLength;
    if (totalBytes > maxChatRequestBodyBytes) {
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

async function prepareAuthenticatedChatPersistence({
  clientContext,
  dependencies,
  intent,
  latestUserMessage,
  now,
  threadId,
}: {
  clientContext: ChatClientContext;
  dependencies: ChatRouteDependencies;
  intent: ChatRequestIntent;
  latestUserMessage: AskSiargaoChatMessage | undefined;
  now: Date;
  threadId: string | undefined;
}) {
  if (latestUserMessage?.role !== "user") {
    return null;
  }

  const currentUser = await resolveAuthenticatedChatUser(dependencies, now);
  if (!currentUser) {
    return null;
  }

  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const thread = threadId
    ? await loadOwnedChatThread(db, { threadId, userId: currentUser.userId })
    : await createChatThread(db, {
        id: createChatRouteId(dependencies, "chat_thread"),
        userId: currentUser.userId,
        title: chatThreadTitleFromMessage(latestUserMessage.content),
        now,
      });

  if (!thread) {
    return { status: "not_found" as const };
  }

  const userMessageId = createChatRouteId(dependencies, "chat_message");
  await appendChatHistoryMessage(db, {
    id: userMessageId,
    threadId: thread.id,
    userId: currentUser.userId,
    role: "user",
    content: latestUserMessage.content,
    contextSummary: summarizeClientContextForStoredHistory(clientContext, intent),
    createdAt: now,
  });
  await touchChatThread(db, { threadId: thread.id, lastMessageAt: now });

  return {
    status: "ready" as const,
    db,
    thread,
    userId: currentUser.userId,
    userMessageId,
  } satisfies AuthenticatedChatPersistence & { status: "ready" };
}

async function resolveAuthenticatedChatUser(dependencies: ChatRouteDependencies, now: Date) {
  if (dependencies.auth === null) {
    return null;
  }
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db ?? getDefaultDatabaseQueryClient(),
    now: () => now,
  });
}

function summarizeClientContextForStoredHistory(
  clientContext: ChatClientContext,
  intent: ChatRequestIntent,
) {
  const geolocation = clientContext.geolocation;
  return {
    geolocation: {
      status: geolocation.status,
      source: geolocation.source,
      consentScope: geolocation.consentScope,
      usedAsProximityAnchor:
        geolocation.status === "available" && intent.nearMeUsesBrowserGeolocation,
    },
  };
}

function createChatRouteId(dependencies: ChatRouteDependencies, prefix: string) {
  return dependencies.createId?.(prefix) ?? `${prefix}_${randomUUID()}`;
}

function chatThreadTitleFromMessage(message: string) {
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "New Siargao chat";
  }

  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine;
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

function summarizeToolCallForLogs(toolCall: PublicAgentToolCall) {
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

function summarizeArtifactSelectionForLogs(
  artifactSelection: NonNullable<AgentTurnResult["artifactSelection"]>,
) {
  return {
    mode: artifactSelection.mode,
    structuredFinalPayload: artifactSelection.structuredFinalPayload,
    totalCardCount: artifactSelection.totalCardCount,
    totalActionCount: artifactSelection.totalActionCount,
    totalItineraryCount: artifactSelection.totalItineraryCount,
    totalDecisionSummaryCount: artifactSelection.totalDecisionSummaryCount,
    selectedCardCount: artifactSelection.selectedCardCount,
    selectedActionCount: artifactSelection.selectedActionCount,
    selectedItineraryCount: artifactSelection.selectedItineraryCount,
    selectedDecisionSummaryCount: artifactSelection.selectedDecisionSummaryCount,
    unselectedCardCount: artifactSelection.unselectedCardCount,
    unselectedActionCount: artifactSelection.unselectedActionCount,
    unselectedItineraryCount: artifactSelection.unselectedItineraryCount,
    unselectedDecisionSummaryCount: artifactSelection.unselectedDecisionSummaryCount,
    ...(artifactSelection.unknownCardIds.length
      ? { unknownCardIds: artifactSelection.unknownCardIds }
      : {}),
    ...(artifactSelection.unknownActionIds.length
      ? { unknownActionIds: artifactSelection.unknownActionIds }
      : {}),
    ...(artifactSelection.unknownItineraryIds.length
      ? { unknownItineraryIds: artifactSelection.unknownItineraryIds }
      : {}),
    ...(artifactSelection.unknownDecisionSummaryIds.length
      ? { unknownDecisionSummaryIds: artifactSelection.unknownDecisionSummaryIds }
      : {}),
  };
}

function isProviderFailureToolCall(toolCall: PublicAgentToolCall) {
  return (
    toolCall.status === "error" ||
    toolCall.errorCode === "provider_unavailable" ||
    toolCall.sources.some((source) => source.label === "provider_unavailable")
  );
}

function interpretChatRequestIntent(
  messages: readonly AskSiargaoChatMessage[],
  clientContext?: ChatClientContext,
): ChatRequestIntent {
  const derivedTripContext = deriveTripContext(messages);
  const { fullUserContext, latestUserTurn } = derivedTripContext;
  const nearMeUsesBrowserGeolocation =
    isBrowserLocationNearMeRequest(latestUserTurn) &&
    clientContext?.geolocation.status === "available";
  const tripContext = nearMeUsesBrowserGeolocation
    ? withoutDefaultNearbyLocation(derivedTripContext)
    : derivedTripContext;
  const locationLabel =
    inferChatLocationLabelFromTripContext(tripContext) ?? inferChatLocationLabel(fullUserContext);
  const nearby = /\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(
    fullUserContext,
  );

  return {
    tripContext,
    ...(locationLabel ? { locationLabel } : {}),
    nearby,
    nearMeUsesBrowserGeolocation,
    shouldDeclineNonSiargaoTopic: shouldDeclineNonSiargaoTopic(messages),
  };
}

function withoutDefaultNearbyLocation(tripContext: TripContext): TripContext {
  if (tripContext.currentLocation?.source !== "gazetteer") {
    return tripContext;
  }

  const { currentArea: _currentArea, currentLocation: _currentLocation, ...rest } = tripContext;
  return rest;
}

function isBrowserLocationNearMeRequest(content: string) {
  return /\b(?:near\s+me|around\s+me|close\s+to\s+me|by\s+me|my\s+(?:location|area)|current\s+location|where\s+i\s+am|around\s+here|near\s+here|near\s+us|around\s+us|close\s+to\s+us)\b/i.test(
    content,
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

function summarizeScopeForLogs(intent: ChatRequestIntent) {
  return {
    locationLabel: intent.locationLabel,
    nearby: intent.nearby,
    nearMeUsesBrowserGeolocation: intent.nearMeUsesBrowserGeolocation,
    tripContext: {
      currentLocation: intent.tripContext.currentLocation?.label,
      currentLocationSource: intent.tripContext.currentLocation?.source,
      durableConstraints: intent.tripContext.durableConstraints,
      temporaryModifiers: intent.tripContext.temporaryModifiers,
      unresolvedReference: intent.tripContext.unresolvedReference,
    },
    shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
  };
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
  };
}
