import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";
import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import type {
  AgentMemoryMetadata,
  AgentTurnResult,
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
import { ModelCostCircuitError } from "@/server/chat/cost-circuits";
import { ChatCostPolicyBudgetError } from "@/server/chat/cost-policy";
import { assemblePublicChatTurn } from "@/server/chat/public-turn-assembly";
import { SourceConsistencyError } from "@/server/chat/source-consistency";
import {
  type ChatRequestIntent,
  interpretChatRequestIntent,
  normalizeTripContextClientContext,
  summarizeClientContextForAgent,
  summarizeClientContextForMetadata,
  summarizeTripContextForAgent,
  summarizeTripContextForLogs,
  summarizeTripContextForStoredHistory,
  type TripContextClientContextInput,
  type TripContextProfileInput,
} from "@/server/chat/trip-context";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import { trackServerEvent } from "@/server/observability/events";
import { createComponentLogger } from "@/server/observability/logger";
import { loadUserProfile } from "@/server/profile/user-profile-store";
import { checkRequestIdempotency, idempotencyJson } from "@/server/security/request-idempotency";
import {
  type AnonymousFreeAllowanceBeginResult,
  beginAnonymousFreeChat as defaultBeginAnonymousFreeChat,
  beginAuthenticatedFreeChat as defaultBeginAuthenticatedFreeChat,
  mergeHeaders,
} from "@/server/trip-pass/anonymous-free-allowance";

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
      tripContext: z.unknown().optional(),
    })
    .optional(),
});

export type ChatRouteDependencies = AskSiargaoAgentDependencies & {
  auth?: EnsureCurrentUserDependencies["auth"] | null;
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  beginAuthenticatedFreeChat?: typeof defaultBeginAuthenticatedFreeChat | null;
  beginAnonymousFreeChat?: typeof defaultBeginAnonymousFreeChat | null;
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

type AuthenticatedChatUserContext = {
  db: DatabaseQueryClient;
  profileContext: TripContextProfileInput | null;
  userId: string;
};

type PublicAgentMemoryMetadata = {
  versionId: string;
  files: Array<{
    id: string;
    fileName: string;
    role: AgentMemoryMetadata["files"][number]["role"];
  }>;
};

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
  let responseHeaders = new Headers(headers);
  let anonymousFreeAllowance: Extract<
    AnonymousFreeAllowanceBeginResult,
    { status: "allowed" }
  > | null = null;
  const now = new Date(startedAt);
  const normalizedClientContext = normalizeTripContextClientContext(
    parsed.data.clientContext as TripContextClientContextInput | undefined,
    now,
  );
  const latestUserMessage = getLatestUserMessage(messages);
  const authenticatedUserContext = await resolveAuthenticatedChatUserContext(dependencies, now);
  const allowClientTripDraft = authenticatedUserContext === null;
  const clientContext = allowClientTripDraft
    ? normalizedClientContext
    : withoutClientTripDraft(normalizedClientContext);
  const intent = interpretChatRequestIntent({
    allowClientTripDraft,
    clientContext,
    messages,
    profileContext: authenticatedUserContext?.profileContext ?? null,
  });
  const authenticatedPersistence = await prepareAuthenticatedChatPersistence({
    authenticatedUserContext,
    dependencies,
    latestUserMessage,
    threadId: parsed.data.threadId,
    intent,
    now,
  });

  if (authenticatedPersistence?.status === "not_found") {
    return Response.json(
      { error: "chat_thread_not_found" },
      { status: 404, headers: responseHeaders },
    );
  }

  if (authenticatedUserContext && dependencies.beginAuthenticatedFreeChat !== null) {
    const beginAuthenticatedFreeChat =
      dependencies.beginAuthenticatedFreeChat ?? defaultBeginAuthenticatedFreeChat;
    const allowance = await beginAuthenticatedFreeChat(
      request,
      { userId: authenticatedUserContext.userId },
      {
        now: () => now,
        requestId,
      },
    );
    responseHeaders = mergeHeaders(responseHeaders, allowance.headers);
    if (allowance.status !== "allowed") {
      trackFreeAllowanceBlock(allowance, now);
      return cloneJsonResponseWithHeaders(allowance.response, responseHeaders);
    }
    anonymousFreeAllowance = allowance;
  } else if (!authenticatedUserContext && dependencies.beginAnonymousFreeChat !== null) {
    const beginAnonymousFreeChat =
      dependencies.beginAnonymousFreeChat ?? defaultBeginAnonymousFreeChat;
    const allowance = await beginAnonymousFreeChat(request, {
      now: () => now,
      requestId,
    });
    responseHeaders = mergeHeaders(responseHeaders, allowance.headers);
    if (allowance.status !== "allowed") {
      trackFreeAllowanceBlock(allowance, now);
      return cloneJsonResponseWithHeaders(allowance.response, responseHeaders);
    }
    anonymousFreeAllowance = allowance;
  }

  const idempotency = await checkRequestIdempotency({
    actorId:
      anonymousFreeAllowance?.actor.tripHash ??
      authenticatedUserContext?.userId ??
      "anonymous-free-allowance-disabled",
    body: rawBody.text,
    headerValue: request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key"),
    nowMs: now.getTime(),
  });
  if (
    idempotency.status === "duplicate" ||
    idempotency.status === "conflict" ||
    idempotency.status === "unavailable"
  ) {
    await anonymousFreeAllowance?.settle({ success: false });
    return cloneJsonResponseWithHeaders(idempotencyJson(idempotency), responseHeaders);
  }

  logger.info(
    {
      messageCount: messages.length,
      latestUserMessage: latestUserMessage
        ? summarizeMessageForLogs(latestUserMessage.content)
        : null,
      shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
      geolocation: intent.tripContext.browserGeolocation,
    },
    "Chat request received.",
  );
  logger.debug(
    {
      scope: summarizeTripContextForLogs(intent),
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
          tripContext: summarizeTripContextForLogs(intent).tripContext,
        },
        deterministicSignals: {
          clientContext: summarizeClientContextForAgent(clientContext),
          context: summarizeTripContextForAgent(intent),
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
        contextSummary: summarizeTripContextForStoredHistory(intent),
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
        modelCost: result.modelCost
          ? {
              callCount: result.modelCost.callCount,
              fallbackUsed: result.modelCost.fallbackUsed,
              totalModeledCostUsd: result.modelCost.totalModeledCostUsd,
              priceVersion: result.modelCost.priceVersion,
              totals: result.modelCost.totals,
            }
          : undefined,
        ...(result.artifactSelection
          ? { artifactSelection: summarizeArtifactSelectionForLogs(result.artifactSelection) }
          : {}),
        upstreamRequestIds: result.upstreamRequestIds,
        agentMemoryVersionId: result.memory?.versionId,
        geolocation: intent.tripContext.browserGeolocation,
        durationMs: Date.now() - startedAt,
      },
      "Chat request answered.",
    );

    await anonymousFreeAllowance?.settle({ success: true, meters: ["chat_message"] });

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
      { headers: responseHeaders },
    );
  } catch (error) {
    await anonymousFreeAllowance?.settle({ success: false });
    const message = error instanceof Error ? error.message : "Chat response failed.";
    const missingConfiguration =
      message.includes("OPENAI_API_KEY") ||
      message.includes("DEEPSEEK_API_KEY") ||
      message.includes("GOOGLE_API_KEY") ||
      message.includes("GOOGLE_PLACES_API_KEY");
    const sourceConsistencyFailure = error instanceof SourceConsistencyError;
    const modelBudgetFailure =
      error instanceof ChatCostPolicyBudgetError || error instanceof ModelCostCircuitError;
    const status =
      missingConfiguration || modelBudgetFailure ? 503 : sourceConsistencyFailure ? 502 : 502;
    const errorCode = missingConfiguration
      ? "chat_not_configured"
      : modelBudgetFailure
        ? "model_budget_exhausted"
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
          : modelBudgetFailure
            ? "Ask Siargao hit a model budget limit before finishing."
            : sourceConsistencyFailure
              ? "Ask Siargao could not verify the answer sources."
              : "Ask Siargao could not generate a response right now.",
      },
      { status, headers: responseHeaders },
    );
  }
}

async function cloneJsonResponseWithHeaders(response: Response, headers: HeadersInit) {
  return Response.json(await response.json(), {
    status: response.status,
    headers,
  });
}

function trackFreeAllowanceBlock(
  allowance: Exclude<AnonymousFreeAllowanceBeginResult, { status: "allowed" }>,
  now: Date,
) {
  trackServerEvent({
    name: "trip_pass_free_allowance_blocked",
    now,
    payload: {
      status: allowance.status,
      actor: allowance.actor
        ? {
            cohortVersion: allowance.actor.cohortVersion,
            tripVersion: allowance.actor.tripVersion,
          }
        : null,
    },
  });
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

async function prepareAuthenticatedChatPersistence({
  authenticatedUserContext,
  dependencies,
  intent,
  latestUserMessage,
  now,
  threadId,
}: {
  authenticatedUserContext: AuthenticatedChatUserContext | null;
  dependencies: ChatRouteDependencies;
  intent: ChatRequestIntent;
  latestUserMessage: AskSiargaoChatMessage | undefined;
  now: Date;
  threadId: string | undefined;
}) {
  if (latestUserMessage?.role !== "user" || !authenticatedUserContext) {
    return null;
  }

  const { db, userId } = authenticatedUserContext;
  const thread = threadId
    ? await loadOwnedChatThread(db, { threadId, userId })
    : await createChatThread(db, {
        id: createChatRouteId(dependencies, "chat_thread"),
        userId,
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
    userId,
    role: "user",
    content: latestUserMessage.content,
    contextSummary: summarizeTripContextForStoredHistory(intent),
    createdAt: now,
  });
  await touchChatThread(db, { threadId: thread.id, lastMessageAt: now });

  return {
    status: "ready" as const,
    db,
    thread,
    userId,
    userMessageId,
  } satisfies AuthenticatedChatPersistence & { status: "ready" };
}

async function resolveAuthenticatedChatUserContext(
  dependencies: ChatRouteDependencies,
  now: Date,
): Promise<AuthenticatedChatUserContext | null> {
  if (dependencies.auth === null) {
    return null;
  }
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const currentUser = await ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db,
    now: () => now,
  });

  if (!currentUser) {
    return null;
  }

  const profile = await loadUserProfile(db, currentUser.userId);
  return {
    db,
    profileContext: profile?.profile.updatedAt ? profile.profile : null,
    userId: currentUser.userId,
  };
}

function withoutClientTripDraft(
  clientContext: ReturnType<typeof normalizeTripContextClientContext>,
) {
  const { tripContext: _tripContext, ...trustedClientContext } = clientContext;
  return trustedClientContext;
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

function getLatestUserMessage(messages: readonly AskSiargaoChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

function summarizeMessageForLogs(content: string) {
  return {
    length: content.length,
    hash: createHash("sha256").update(content).digest("hex").slice(0, 16),
  };
}
