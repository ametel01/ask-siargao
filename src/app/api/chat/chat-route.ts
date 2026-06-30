import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import type {
  AgentMemoryMetadata,
  AgentToolCallAudit,
  AgentTurnResult,
  ChatClientContext,
  ChatClientGeolocationConsentScope,
  ChatClientGeolocationContext,
  DecisionSummary,
  ItineraryPlan,
  RecommendationCard,
} from "@/server/chat/agent-runtime";
import {
  type AnswerSourceSummary,
  renderAnswerSourceLines,
} from "@/server/chat/answer-source-summary";
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
import { interpretPlaceIntent, type PlaceIntent } from "@/server/chat/place-intent";
import {
  assertChatAnswerSourceConsistency,
  SourceConsistencyError,
} from "@/server/chat/source-consistency";
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
  nearMeUsesBrowserGeolocation: boolean;
  nightlifePlan: boolean;
  placeIntent?: PlaceIntent;
  roadCondition: boolean;
  shouldDeclineNonSiargaoTopic: boolean;
  today: boolean;
  tripAdvice: boolean;
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

    const publicAnswerSources = chatAnswerSourcesForValidation(
      result.publicSources,
      result.cards,
      result.itineraries,
      result.decisionSummaries,
    );
    let responseMessage = stripInternalDisclosureText(result.message);
    const sourceValidationInput = {
      message: responseMessage,
      sources: publicAnswerSources,
      toolCalls: publicToolCalls,
      browserGeolocation: clientContext.geolocation,
    };
    try {
      assertChatAnswerSourceConsistency(sourceValidationInput);
    } catch (error) {
      if (!(error instanceof SourceConsistencyError)) {
        throw error;
      }
      const repairedMessage = repairMalformedRenderedSourceLines(responseMessage, error);
      if (!repairedMessage) {
        throw error;
      }
      responseMessage = stripInternalDisclosureText(repairedMessage);
      assertChatAnswerSourceConsistency({
        ...sourceValidationInput,
        message: responseMessage,
      });
      logger.warn(
        {
          issueCount: error.issues.length,
          repairedLineCount: result.message.split("\n").length - responseMessage.split("\n").length,
        },
        "Chat answer repaired by removing malformed rendered source lines.",
      );
    }
    assertRenderedSourceLinesArePublic(responseMessage, publicAnswerSources);

    let assistantMessageId: string | undefined;
    if (authenticatedPersistence?.status === "ready") {
      assistantMessageId = createChatRouteId(dependencies, "chat_message");
      const completedAt = new Date();
      await appendChatHistoryMessage(authenticatedPersistence.db, {
        id: assistantMessageId,
        threadId: authenticatedPersistence.thread.id,
        userId: authenticatedPersistence.userId,
        role: "assistant",
        content: responseMessage,
        requestId: result.requestId,
        model: result.model,
        sources: result.publicSources,
        cards: result.cards ?? [],
        actions: result.actions ?? [],
        itineraries: result.itineraries ?? [],
        decisionSummaries: result.decisionSummaries ?? [],
        toolCalls: summarizeToolCallsForStoredHistory(publicToolCalls),
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
        providerFailure: publicToolCalls.some(isProviderFailureToolCall),
        sourceLabels: [...new Set(result.sources.map((source) => source.label))],
        publicSourceLabels: [...new Set(result.publicSources.map((source) => source.label))],
        toolCallCount: publicToolCalls.length,
        toolCalls: publicToolCalls.map(summarizeToolCallForLogs),
        sourceCount: result.sources.length,
        publicSourceCount: result.publicSources.length,
        cardCount: result.cards?.length ?? 0,
        actionCount: result.actions?.length ?? 0,
        itineraryCount: result.itineraries?.length ?? 0,
        decisionSummaryCount: result.decisionSummaries?.length ?? 0,
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
        message: responseMessage,
        requestId: result.requestId,
        model: result.model,
        ...(result.upstreamRequestIds?.length
          ? { upstreamRequestIds: result.upstreamRequestIds }
          : {}),
        toolCalls: publicToolCalls,
        sources: result.publicSources,
        ...(result.memory ? { memory: summarizeMemoryForResponse(result.memory) } : {}),
        ...(result.cards?.length ? { cards: result.cards } : {}),
        ...(result.actions?.length ? { actions: result.actions } : {}),
        ...(result.itineraries?.length ? { itineraries: result.itineraries } : {}),
        ...(result.decisionSummaries?.length
          ? { decisionSummaries: result.decisionSummaries }
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

function chatAnswerSourcesForValidation(
  sources: readonly AnswerSourceSummary[],
  cards: readonly RecommendationCard[] | undefined,
  itineraries: readonly ItineraryPlan[] | undefined,
  decisionSummaries: readonly DecisionSummary[] | undefined,
) {
  return [
    ...sources,
    ...(cards?.flatMap((card) => card.sources ?? []) ?? []),
    ...(itineraries?.flatMap((itinerary) => itinerary.sources) ?? []),
    ...(decisionSummaries?.flatMap((summary) => summary.sources) ?? []),
  ];
}

function assertRenderedSourceLinesArePublic(
  message: string,
  publicSources: readonly AnswerSourceSummary[],
) {
  const renderedSourceLines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Checked: ") || line.startsWith("Not checked: "));
  if (renderedSourceLines.length === 0) {
    return;
  }

  const publicSourceLines = new Set(renderAnswerSourceLines(publicSources));
  const nonPublicLines = renderedSourceLines.filter((line) => !publicSourceLines.has(line));
  if (nonPublicLines.length === 0) {
    return;
  }

  throw new SourceConsistencyError(
    nonPublicLines.map((line) => ({
      code: "structured_source_not_tool_backed",
      line,
      message:
        "Rendered source lines must be represented by public response sources or selected artifacts.",
    })),
  );
}

function repairMalformedRenderedSourceLines(
  message: string,
  error: SourceConsistencyError,
): string | undefined {
  if (
    error.issues.length === 0 ||
    error.issues.some((issue) => issue.code !== "rendered_source_label_unknown")
  ) {
    return undefined;
  }

  const invalidLines = new Set(error.issues.flatMap((issue) => (issue.line ? [issue.line] : [])));
  if (invalidLines.size === 0) {
    return undefined;
  }

  const repaired = message
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !invalidLines.has(trimmed) ||
        (!trimmed.startsWith("Checked: ") && !trimmed.startsWith("Not checked: "))
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return repaired.length > 0 && repaired !== message ? repaired : undefined;
}

function stripInternalDisclosureText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => stripInternalDisclosureSentences(line))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripInternalDisclosureSentences(line: string) {
  const trimmedLine = line.trim();
  if (/^not checked:/i.test(trimmedLine)) {
    return "";
  }

  return line
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isInternalDisclosure(sentence))
    .join(" ")
    .trim();
}

function isInternalDisclosure(value: string) {
  return [
    /\bnot\s+checked\b/i,
    /\bwasn['’]?t\s+(?:separately\s+)?checked\b/i,
    /\bwere\s+not\s+checked\b/i,
    /\bno\s+live\b.{0,90}\bcheck\b/i,
    /\bunchecked\b/i,
    /\bnot\s+verified\b/i,
    /\bI\s+(?:didn['’]?t|did\s+not)\s+(?:live[-\s]?)?check\b/i,
    /\b(?:live[-\s]?)?check(?:ed|ing)?\s+(?:was|were|is|are)?\s*(?:not|needed|needs)\b/i,
    /\bcurated\s+local\s+guide\s+estimate\b/i,
    /\bexact\s+ride\s+time\s+depends\b/i,
    /\buser\s+constraints\s+preserved\b/i,
    /\borigin-specific\s+route\s+timing\b/i,
    /\bthis\s+artifact\b/i,
    /\bsource\s+caveats?\b/i,
    /\bavoid\s+overclaiming\b/i,
    /\buse\s+(?:search_places|places)\b/i,
    /\bplaces\s+evidence\b/i,
    /\b(?:open|opening|cafe|menu|booking|availability|crowd|quietness).{0,80}\bshould\s+be\s+checked\b/i,
    /\bclaim(?:ing)?\b.{0,80}\b(?:open|status|hours|safety|reliability)\b/i,
    /\bwithout\b.{0,80}\b(?:condition|safety|tide|surf|road).{0,40}\bcheck/i,
  ].some((pattern) => pattern.test(value));
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

function summarizeToolCallsForStoredHistory(toolCalls: readonly AgentToolCallAudit[]) {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    errorCode: toolCall.errorCode,
    providerOperation: toolCall.providerOperation,
    sourceProfileIds: toolCall.sourceProfileIds,
    sources: toolCall.sources,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    durationMs: toolCall.durationMs,
  }));
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

function interpretChatRequestIntent(
  messages: readonly AskSiargaoChatMessage[],
  clientContext?: ChatClientContext,
): ChatRequestIntent {
  const derivedTripContext = deriveTripContext(messages);
  const { fullUserContext, latestUserTurn, recentUserContext } = derivedTripContext;
  const nearMeUsesBrowserGeolocation =
    isBrowserLocationNearMeRequest(latestUserTurn) &&
    clientContext?.geolocation.status === "available";
  const tripContext = nearMeUsesBrowserGeolocation
    ? withoutDefaultNearbyLocation(derivedTripContext)
    : derivedTripContext;
  const rawPlaceIntent = interpretPlaceIntent(messages);
  const placeIntent = nearMeUsesBrowserGeolocation
    ? withoutDefaultNearbyPlaceIntent(rawPlaceIntent)
    : rawPlaceIntent;
  const latestBeach =
    isBeachContent(latestUserTurn) ||
    tripContext.activeGoal === "beach_swimming" ||
    tripContext.activeGoal === "beach_sunset";
  const contextualBeach =
    isBeachConstraintContent(latestUserTurn) && isBeachContent(recentUserContext);
  const locationLabel =
    inferChatLocationLabelFromTripContext(tripContext) ?? inferChatLocationLabel(fullUserContext);
  const today =
    /\btoday|tonight|right\s+now|now|this\s+(?:morning|afternoon|evening|night)\b/i.test(
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
  const nightlifePlan = isNightlifePlanContent(latestUserTurn);
  const tripAdvice = tripContext.activeGoal === "trip_advice";
  const weatherSensitive =
    weather ||
    Boolean(conditionActivity) ||
    marineCondition ||
    roadCondition ||
    tripContext.activeGoal === "rain_plan" ||
    /\brainy|rain(?:ing)?|showers?|storm|windy|surf|waves?|conditions?|cloudy\b/i.test(
      latestUserTurn,
    ) ||
    ((today || nearby) && isActivityPlanContent(latestUserTurn)) ||
    nightlifePlan;
  const excludesActivityPlan = isLogisticsOrCritiquePlanContent(latestUserTurn);
  const activityPlan =
    !excludesActivityPlan &&
    (isActivityPlanContent(latestUserTurn) || tripContext.activeGoal === "itinerary") &&
    (Boolean(locationLabel) || /\bsiargao\b/i.test(fullUserContext));
  const partialIntent = {
    latestUserTurn,
    recentUserContext,
    tripContext,
    ...(locationLabel || nightlifePlan
      ? { locationLabel: locationLabel ?? ("General Luna" as const) }
      : {}),
    activityPlan,
    beach: latestBeach || contextualBeach,
    ...(conditionActivity ? { conditionActivity } : {}),
    marineCondition,
    nearby,
    nearMeUsesBrowserGeolocation,
    nightlifePlan,
    ...(placeIntent ? { placeIntent } : {}),
    roadCondition,
    today,
    tripAdvice,
    weatherSensitive,
    weather,
  };

  return {
    ...partialIntent,
    missingContext: shouldAskForMissingContext(partialIntent),
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

function withoutDefaultNearbyPlaceIntent(placeIntent: PlaceIntent | null): PlaceIntent | null {
  if (placeIntent?.areaScope !== "nearby" || placeIntent.location !== "General Luna") {
    return placeIntent;
  }

  const tripContext = withoutDefaultNearbyLocation(placeIntent.tripContext);
  return {
    ...placeIntent,
    location: null,
    tripContext,
  };
}

function isBrowserLocationNearMeRequest(content: string) {
  return /\b(?:near\s+me|around\s+me|close\s+to\s+me|by\s+me|my\s+(?:location|area)|current\s+location|where\s+i\s+am|around\s+here|near\s+here|near\s+us|around\s+us|close\s+to\s+us)\b/i.test(
    content,
  );
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

function isNightlifePlanContent(content: string) {
  const nightlifeSignal =
    /\b(?:party|nightlife|bar[-\s]?hopp?ing|bar\s+crawl|dj|live\s*music|foam\s*party|pub\s*quiz|trivia|drinks?\s+tonight|where\s+(?:should|can)\s+(?:we|i)\s+go\s+out)\b/i.test(
      content,
    );
  const timeBoundSignal =
    /\b(?:tonight|today|right\s+now|now|this\s+(?:evening|night)|late[-\s]?night)\b/i.test(content);
  const generalLunaSignal = /\b(?:general\s+luna|\bgl\b|siargao)\b/i.test(content);
  return nightlifeSignal && (timeBoundSignal || generalLunaSignal);
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
    nearMeUsesBrowserGeolocation: intent.nearMeUsesBrowserGeolocation,
    nightlifePlan: intent.nightlifePlan,
    placeIntent: intent.placeIntent,
    roadCondition: intent.roadCondition,
    shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
    today: intent.today,
    tripAdvice: intent.tripAdvice,
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
    browserGeolocation: intent.nearMeUsesBrowserGeolocation
      ? {
          useAsProximityAnchor: true,
          source: "browser_geolocation",
          exactCoordinatesHidden: true,
          instruction:
            "The user asked near me/my location and browser geolocation is available. Do not assume any named area unless a tool or user text supports it.",
        }
      : undefined,
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
    nearMeUsesBrowserGeolocation: intent.nearMeUsesBrowserGeolocation,
    nightlifePlan: intent.nightlifePlan,
    tripContext: {
      activeGoal: intent.tripContext.activeGoal,
      currentLocation: intent.tripContext.currentLocation?.label,
      currentLocationSource: intent.tripContext.currentLocation?.source,
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
    tripAdvice: intent.tripAdvice,
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
  };
}
