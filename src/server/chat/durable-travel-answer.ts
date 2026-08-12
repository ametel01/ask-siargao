import { createHash, randomUUID } from "node:crypto";

import type { Logger } from "pino";

import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import type {
  AgentMemoryMetadata,
  AgentProgressUpdate,
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
  storeAssistantTravelAnswer,
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
import { beginTravelAnswerExposure } from "@/server/operations/production-exposure";
import { loadUserProfile } from "@/server/profile/user-profile-store";
import { checkRequestIdempotency, idempotencyJson } from "@/server/security/request-idempotency";
import {
  type AnonymousFreeAllowanceBeginResult,
  beginAnonymousFreeChat as defaultBeginAnonymousFreeChat,
  beginAuthenticatedFreeChat as defaultBeginAuthenticatedFreeChat,
  mergeHeaders,
} from "@/server/trip-pass/anonymous-free-allowance";
import {
  openChatUsageSession as defaultOpenChatUsageSession,
  type PaidChatUsageSessionResult,
  type PaidChatUsageSettlement,
  paidChatUsageJson,
} from "@/server/trip-pass/usage";

export type DurableTravelAnswerDependencies = AskSiargaoAgentDependencies & {
  auth?: EnsureCurrentUserDependencies["auth"] | null;
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  deferPersistence?: (task: () => Promise<void>) => void;
  beginAuthenticatedFreeChat?: typeof defaultBeginAuthenticatedFreeChat | null;
  beginAnonymousFreeChat?: typeof defaultBeginAnonymousFreeChat | null;
  openChatUsageSession?: typeof defaultOpenChatUsageSession | null;
  runAskSiargaoAgentTurn?: typeof defaultRunAskSiargaoAgentTurn;
  now?: () => Date;
  logger?: Logger;
  beginTravelAnswerExposure?: typeof beginTravelAnswerExposure;
};

export type DurableTravelAnswerInput = {
  body: string;
  clientContext?: TripContextClientContextInput;
  messages: AskSiargaoChatMessage[];
  request: Request;
  threadId?: string;
};

export type DurableTravelAnswerOptions = {
  headers?: HeadersInit;
  onHeadersReady?: (headers: Headers) => void;
  onProgress?: (update: AgentProgressUpdate) => void | Promise<void>;
  startedAt?: number;
};

export type TravelAnswerLatencyMetrics = {
  preflightMs: number;
  agentMs?: number;
  modelMs?: number;
  settlementMs?: number;
  persistenceMs?: number;
  modelCallCount?: number;
  toolCallCount?: number;
  repairCount?: number;
  modelCalls?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
};

export type DurableTravelAnswerOutcome = {
  body: Record<string, unknown>;
  headers: Headers;
  latency: TravelAnswerLatencyMetrics;
  status: number;
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

const travelAnswerLogger = createComponentLogger("chat.durable-travel-answer");

const defaultDependencies: DurableTravelAnswerDependencies = {
  runAskSiargaoAgentTurn: defaultRunAskSiargaoAgentTurn,
  logger: travelAnswerLogger,
};

export function createDefaultDurableTravelAnswerDependencies(): DurableTravelAnswerDependencies {
  return {
    ...defaultDependencies,
  };
}

export async function answerTravelQuestion(
  input: DurableTravelAnswerInput,
  dependencies: DurableTravelAnswerDependencies = createDefaultDurableTravelAnswerDependencies(),
  options: DurableTravelAnswerOptions = {},
): Promise<DurableTravelAnswerOutcome> {
  const startedAt = options.startedAt ?? Date.now();
  const requestId = randomUUID();
  const latency: TravelAnswerLatencyMetrics = { preflightMs: 0 };
  const logger = (dependencies.logger ?? travelAnswerLogger).child({
    module: "durable-travel-answer",
    requestId,
    route: "/api/chat",
  });
  let responseHeaders = new Headers(options.headers);
  let anonymousFreeAllowance: Extract<
    AnonymousFreeAllowanceBeginResult,
    { status: "allowed" }
  > | null = null;
  let paidChatUsage: Extract<PaidChatUsageSessionResult, { status: "allowed" }> | null = null;
  let paidChatSettlement: PaidChatUsageSettlement | null = null;
  let authenticatedIdempotency: Awaited<ReturnType<typeof checkRequestIdempotency>> | null = null;
  let headersAnnounced = false;
  const announceHeadersReady = () => {
    if (headersAnnounced) {
      return;
    }
    headersAnnounced = true;
    options.onHeadersReady?.(new Headers(responseHeaders));
  };
  const now = dependencies.now?.() ?? new Date(startedAt);
  const idempotencyKey =
    input.request.headers.get("idempotency-key") ?? input.request.headers.get("x-idempotency-key");
  try {
    const exposure = await (dependencies.beginTravelAnswerExposure ?? beginTravelAnswerExposure)(
      requestId,
      { now },
    );
    if (exposure.status !== "allowed") {
      announceHeadersReady();
      return outcomeFromJsonResponse(exposure.response, responseHeaders, latency);
    }

    const normalizedClientContext = normalizeTripContextClientContext(input.clientContext, now);
    const latestUserMessage = getLatestUserMessage(input.messages);
    if (!latestUserMessage) {
      announceHeadersReady();
      return outcome(
        { error: "invalid_travel_answer_input", message: "A user message is required." },
        responseHeaders,
        latency,
        400,
      );
    }
    const authenticatedUserContext = await resolveAuthenticatedChatUserContext(dependencies, now);
    const allowClientTripDraft = authenticatedUserContext === null;
    const clientContext = allowClientTripDraft
      ? normalizedClientContext
      : withoutClientTripDraft(normalizedClientContext);
    const intent = interpretChatRequestIntent({
      allowClientTripDraft,
      clientContext,
      messages: input.messages,
      profileContext: authenticatedUserContext?.profileContext ?? null,
    });

    if (authenticatedUserContext) {
      const idempotency = await checkRequestIdempotency({
        actorId: authenticatedUserContext.userId,
        body: input.body,
        headerValue: idempotencyKey,
        nowMs: now.getTime(),
      });
      authenticatedIdempotency = idempotency;
      if (idempotency.status === "conflict" || idempotency.status === "unavailable") {
        announceHeadersReady();
        return outcomeFromJsonResponse(idempotencyJson(idempotency), responseHeaders, latency);
      }

      if (dependencies.openChatUsageSession !== null) {
        const openChatUsageSession =
          dependencies.openChatUsageSession ?? defaultOpenChatUsageSession;
        const usage = await openChatUsageSession({
          bodyHash:
            idempotency.status === "stored" || idempotency.status === "duplicate"
              ? idempotency.bodyHash
              : hashChatRequestBody(input.body),
          db: authenticatedUserContext.db,
          idempotencyKey:
            idempotency.status === "stored" || idempotency.status === "duplicate"
              ? idempotency.tokenHash
              : undefined,
          now,
          requestId,
          userId: authenticatedUserContext.userId,
        });
        if (usage.status === "allowed") {
          paidChatUsage = usage;
        } else if (usage.status === "replay") {
          announceHeadersReady();
          return outcome(usage.responseBody, responseHeaders, latency);
        } else if (usage.status === "in_progress" || usage.status === "conflict") {
          announceHeadersReady();
          return outcome(
            {
              error:
                usage.status === "in_progress"
                  ? "paid_answer_in_progress"
                  : "idempotency_key_conflict",
            },
            responseHeaders,
            latency,
            409,
          );
        } else if (
          usage.status === "usage_limit_reached" &&
          usage.reason === "paid_chat_meter_exhausted"
        ) {
          paidChatUsage = null;
        } else if (usage.status === "usage_limit_reached" || usage.status === "unavailable") {
          announceHeadersReady();
          return outcomeFromJsonResponse(paidChatUsageJson(usage), responseHeaders, latency);
        }
      }
      if (!paidChatUsage && authenticatedIdempotency.status === "duplicate") {
        announceHeadersReady();
        return outcomeFromJsonResponse(
          idempotencyJson(authenticatedIdempotency),
          responseHeaders,
          latency,
        );
      }
    }

    if (
      authenticatedUserContext &&
      !paidChatUsage &&
      dependencies.beginAuthenticatedFreeChat !== null
    ) {
      const beginAuthenticatedFreeChat =
        dependencies.beginAuthenticatedFreeChat ?? defaultBeginAuthenticatedFreeChat;
      const allowance = await beginAuthenticatedFreeChat(
        input.request,
        { userId: authenticatedUserContext.userId },
        {
          now: () => now,
          requestId,
        },
      );
      responseHeaders = mergeHeaders(responseHeaders, allowance.headers);
      if (allowance.status !== "allowed") {
        trackFreeAllowanceBlock(allowance, now);
        announceHeadersReady();
        return outcomeFromJsonResponse(allowance.response, responseHeaders, latency);
      }
      anonymousFreeAllowance = allowance;
    } else if (!authenticatedUserContext && dependencies.beginAnonymousFreeChat !== null) {
      const beginAnonymousFreeChat =
        dependencies.beginAnonymousFreeChat ?? defaultBeginAnonymousFreeChat;
      const allowance = await beginAnonymousFreeChat(input.request, {
        now: () => now,
        requestId,
      });
      responseHeaders = mergeHeaders(responseHeaders, allowance.headers);
      if (allowance.status !== "allowed") {
        trackFreeAllowanceBlock(allowance, now);
        announceHeadersReady();
        return outcomeFromJsonResponse(allowance.response, responseHeaders, latency);
      }
      anonymousFreeAllowance = allowance;
    }

    const authenticatedPersistence = await prepareAuthenticatedChatPersistence({
      authenticatedUserContext,
      dependencies,
      latestUserMessage,
      threadId: input.threadId,
      intent,
      now,
    });

    if (authenticatedPersistence?.status === "not_found") {
      await anonymousFreeAllowance?.settle({ success: false });
      await paidChatUsage?.settle({ success: false, releaseReason: "internal_failure" });
      announceHeadersReady();
      return outcome({ error: "chat_thread_not_found" }, responseHeaders, latency, 404);
    }

    if (!authenticatedUserContext) {
      const idempotency = await checkRequestIdempotency({
        actorId: anonymousFreeAllowance?.actor.tripHash ?? "anonymous-free-allowance-disabled",
        body: input.body,
        headerValue: idempotencyKey,
        nowMs: now.getTime(),
      });
      if (
        idempotency.status === "duplicate" ||
        idempotency.status === "conflict" ||
        idempotency.status === "unavailable"
      ) {
        await anonymousFreeAllowance?.settle({ success: false });
        announceHeadersReady();
        return outcomeFromJsonResponse(idempotencyJson(idempotency), responseHeaders, latency);
      }
    }

    logger.info(
      {
        messageCount: input.messages.length,
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
      "Travel Answer scope interpreted.",
    );
    latency.preflightMs = Date.now() - startedAt;
    announceHeadersReady();

    const runAgent = dependencies.runAskSiargaoAgentTurn ?? defaultRunAskSiargaoAgentTurn;
    const agentStartedAt = Date.now();
    const result = await runAgent(
      {
        messages: input.messages,
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
        onProgress: options.onProgress,
        requireStructuredFinalOutput: true,
      },
    );
    latency.agentMs = Date.now() - agentStartedAt;
    latency.modelMs = result.modelCost?.totalLatencyMs ?? 0;
    latency.modelCallCount = result.modelCost?.callCount ?? 0;
    latency.toolCallCount = result.toolCalls.length;
    latency.repairCount = result.repairCount ?? 0;
    latency.modelCalls = result.modelCost?.calls.map((call) => ({
      callIndex: call.callIndex,
      provider: call.provider,
      mode: call.mode,
      latencyMs: call.latencyMs,
      fallback: call.fallback,
    }));
    latency.tools = result.toolCalls.map((toolCall) => ({
      name: toolCall.name,
      status: toolCall.status,
      durationMs: toolCall.durationMs,
    }));
    await options.onProgress?.({
      stage: "checking",
      message: "Finalizing the answer and its source details.",
    });
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
        "Travel Answer repaired by removing malformed rendered source lines.",
      );
    }

    if (!publicTurn.storage.message.trim()) {
      paidChatSettlement =
        (await paidChatUsage?.settle({
          success: false,
          releaseReason: "empty_output",
        })) ?? null;
      throw new Error("Travel Answer was empty after policy assembly.");
    }

    let assistantMessageId: string | undefined;
    if (authenticatedPersistence?.status === "ready") {
      const generatedAssistantMessageId = createTravelAnswerId(dependencies, "chat_message");
      assistantMessageId = generatedAssistantMessageId;
      const completedAt = new Date();
      const persistAssistantMessage = (
        deferred: boolean,
        db: DatabaseQueryClient = authenticatedPersistence.db,
      ) =>
        persistAssistantChatHistory({
          assistantMessageId: generatedAssistantMessageId,
          authenticatedPersistence,
          completedAt,
          contextSummary: summarizeTripContextForStoredHistory(intent),
          db,
          deferred,
          logger,
          model: result.model,
          publicTurn,
          requestId: result.requestId,
        });

      if (paidChatUsage) {
        const settlementStartedAt = Date.now();
        paidChatSettlement = await paidChatUsage.settle({
          answerMessageId: generatedAssistantMessageId,
          persistAnswer: async (transaction, allowance) => {
            await persistAssistantMessage(false, transaction);
            return buildTravelAnswerBody({
              allowance,
              assistantMessageId: generatedAssistantMessageId,
              authenticatedPersistence,
              publicTurn,
              result,
            });
          },
          providerRequestIds: result.upstreamRequestIds ?? [],
          success: true,
        });
        latency.settlementMs = Date.now() - settlementStartedAt;
        if (paidChatSettlement.status !== "settled" && paidChatSettlement.status !== "duplicate") {
          throw new Error(`Paid Travel Answer could not finalize: ${paidChatSettlement.status}.`);
        }
        if (input.request.signal.aborted) {
          trackServerEvent({
            name: "trip_pass_paid_chat_delivery_cancelled",
            now,
            payload: {
              requestId: result.requestId,
              settlementStatus: paidChatSettlement.status,
            },
          });
        }
      } else if (dependencies.deferPersistence) {
        try {
          dependencies.deferPersistence(async () => {
            await persistAssistantMessage(true);
          });
          latency.persistenceMs = 0;
        } catch (error) {
          logger.warn(
            { error },
            "Deferred Travel Answer storage scheduling failed; storing before delivery.",
          );
          latency.persistenceMs = await persistAssistantMessage(false);
        }
      } else {
        latency.persistenceMs = await persistAssistantMessage(false);
      }
    }

    logCompletedTravelAnswer({
      clientContext,
      intent,
      logger,
      publicTurn,
      result,
      startedAt,
    });

    await anonymousFreeAllowance?.settle({ success: true, meters: ["chat_message"] });

    if (paidChatSettlement?.status === "settled" || paidChatSettlement?.status === "duplicate") {
      if (!paidChatSettlement.responseBody) {
        throw new Error("Paid Travel Answer finalization did not return a durable response.");
      }
      return outcome(paidChatSettlement.responseBody, responseHeaders, latency);
    }

    return outcome(
      buildTravelAnswerBody({
        assistantMessageId,
        authenticatedPersistence,
        publicTurn,
        result,
      }),
      responseHeaders,
      latency,
    );
  } catch (error) {
    await anonymousFreeAllowance?.settle({ success: false }).catch(() => undefined);
    if (!paidChatSettlement) {
      await paidChatUsage
        ?.settle({ success: false, releaseReason: "internal_failure" })
        .catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Travel Answer failed.";
    const missingConfiguration =
      message.includes("OPENAI_API_KEY") ||
      message.includes("DEEPSEEK_API_KEY") ||
      message.includes("GOOGLE_API_KEY") ||
      message.includes("GOOGLE_PLACES_API_KEY");
    const sourceConsistencyFailure = error instanceof SourceConsistencyError;
    const modelBudgetFailure =
      error instanceof ChatCostPolicyBudgetError || error instanceof ModelCostCircuitError;
    const status = missingConfiguration || modelBudgetFailure ? 503 : 502;
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
      "Travel Answer failed.",
    );

    announceHeadersReady();
    return outcome(
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
      responseHeaders,
      latency,
      status,
    );
  }
}

async function persistAssistantChatHistory({
  assistantMessageId,
  authenticatedPersistence,
  completedAt,
  contextSummary,
  db,
  deferred,
  logger,
  model,
  publicTurn,
  requestId,
}: {
  assistantMessageId: string;
  authenticatedPersistence: AuthenticatedChatPersistence;
  completedAt: Date;
  contextSummary: ReturnType<typeof summarizeTripContextForStoredHistory>;
  db: DatabaseQueryClient;
  deferred: boolean;
  logger: Logger;
  model: string;
  publicTurn: ReturnType<typeof assemblePublicChatTurn>;
  requestId: string;
}) {
  const persistenceStartedAt = Date.now();

  try {
    await storeAssistantTravelAnswer(db, {
      id: assistantMessageId,
      threadId: authenticatedPersistence.thread.id,
      userId: authenticatedPersistence.userId,
      content: publicTurn.storage.message,
      requestId,
      model,
      sources: publicTurn.storage.sources,
      cards: publicTurn.storage.cards,
      actions: publicTurn.storage.actions,
      itineraries: publicTurn.storage.itineraries,
      decisionSummaries: publicTurn.storage.decisionSummaries,
      toolCalls: publicTurn.storage.toolCalls,
      contextSummary,
      createdAt: completedAt,
    });
    const durationMs = Date.now() - persistenceStartedAt;
    logger.info({ deferred, durationMs }, "Travel Answer stored.");
    return durationMs;
  } catch (error) {
    logger.error(
      { error, deferred, durationMs: Date.now() - persistenceStartedAt },
      "Travel Answer storage failed.",
    );
    throw error;
  }
}

function buildTravelAnswerBody({
  allowance,
  assistantMessageId,
  authenticatedPersistence,
  publicTurn,
  result,
}: {
  allowance?: PaidChatUsageSettlement["allowance"];
  assistantMessageId?: string;
  authenticatedPersistence:
    | (AuthenticatedChatPersistence & { status: "ready" })
    | { status: "not_found" }
    | null;
  publicTurn: ReturnType<typeof assemblePublicChatTurn>;
  result: AgentTurnResult;
}): Record<string, unknown> {
  return {
    message: publicTurn.display.message,
    requestId: result.requestId,
    model: result.model,
    ...(result.completionStatus ? { completionStatus: result.completionStatus } : {}),
    ...(result.terminationReason ? { terminationReason: result.terminationReason } : {}),
    ...(result.upstreamRequestIds?.length ? { upstreamRequestIds: result.upstreamRequestIds } : {}),
    toolCalls: publicTurn.display.toolCalls,
    sources: publicTurn.display.sources,
    ...(result.memory ? { memory: summarizeMemoryForResponse(result.memory) } : {}),
    ...(allowance ? { tripPassUsage: allowance } : {}),
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
  };
}

async function outcomeFromJsonResponse(
  response: Response,
  headers: Headers,
  latency: TravelAnswerLatencyMetrics,
) {
  return outcome(
    (await response.json()) as Record<string, unknown>,
    headers,
    latency,
    response.status,
  );
}

function outcome(
  body: Record<string, unknown>,
  headers: Headers,
  latency: TravelAnswerLatencyMetrics,
  status = 200,
): DurableTravelAnswerOutcome {
  return { body, headers, latency, status };
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

async function prepareAuthenticatedChatPersistence({
  authenticatedUserContext,
  dependencies,
  intent,
  latestUserMessage,
  now,
  threadId,
}: {
  authenticatedUserContext: AuthenticatedChatUserContext | null;
  dependencies: DurableTravelAnswerDependencies;
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
        id: createTravelAnswerId(dependencies, "chat_thread"),
        userId,
        title: chatThreadTitleFromMessage(latestUserMessage.content),
        now,
      });

  if (!thread) {
    return { status: "not_found" as const };
  }

  const userMessageId = createTravelAnswerId(dependencies, "chat_message");
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
  dependencies: DurableTravelAnswerDependencies,
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

function createTravelAnswerId(dependencies: DurableTravelAnswerDependencies, prefix: string) {
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

function logCompletedTravelAnswer({
  clientContext,
  intent,
  logger,
  publicTurn,
  result,
  startedAt,
}: {
  clientContext: ReturnType<typeof normalizeTripContextClientContext>;
  intent: ChatRequestIntent;
  logger: Logger;
  publicTurn: ReturnType<typeof assemblePublicChatTurn>;
  result: AgentTurnResult;
  startedAt: number;
}) {
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
      clientGeolocationStatus: clientContext.geolocation.status,
      durationMs: Date.now() - startedAt,
    },
    "Chat request answered.",
  );
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

function hashChatRequestBody(body: string) {
  return createHash("sha256").update(body).digest("base64url");
}
