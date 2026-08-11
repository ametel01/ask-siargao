import { createHash } from "node:crypto";

import type { Logger } from "pino";

import {
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
  renderAvailableAgentMemory,
} from "@/server/chat/agent-memory";
import {
  type AgentRepairAdapter,
  type AgentRepairToolOutput,
  runAgentRepairPipeline,
} from "@/server/chat/agent-repair-pipeline";
import {
  type AgentFinalPayload,
  type AgentMemoryMetadata,
  type AgentProgressUpdate,
  type AgentResponsesClient,
  type AgentRuntimeDependencies,
  type AgentRuntimeRequest,
  type AgentToolCallAudit,
  type AgentToolExecutionContext,
  type AgentToolExecutionRequest,
  type AgentToolResult,
  type AgentTurnResult,
  agentItineraryArtifactId,
  type ChatClientGeolocationContext,
  createAgentToolCallAudit,
  createAgentTurnResult,
  type DecisionSummary,
  resolveAgentRuntimeRequest,
} from "@/server/chat/agent-runtime";
import { selectAgentResponseTools } from "@/server/chat/agent-tool-selection";
import {
  type AgentToolDependencies,
  buildAgentResponseTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
import {
  applyChatEvidenceFinalPayloadPolicy,
  buildChatEvidencePolicy,
  buildChatEvidenceRepair,
  finalPayloadSatisfiesChatEvidencePolicy,
  requiredEvidenceAllowedCardIds,
} from "@/server/chat/chat-evidence-policy";
import type { ConditionJudgmentRequest } from "@/server/chat/condition-tools";
import { assertModelCostCircuit, reserveModelCost } from "@/server/chat/cost-circuits";
import {
  assertModelCallAllowed,
  type ChatCostPolicy,
  resolveChatCostPolicy,
  responseModelCostPolicy,
} from "@/server/chat/cost-policy";
import type {
  ItineraryRequiredToolChecks,
  LocalItineraryRequest,
} from "@/server/chat/itinerary-tools";
import {
  parseRealityCheckProposal,
  type RealityCheckRecognition,
  type RealityCheckValidationResult,
  type RealityCheckVerdict,
  recognizeRealityCheckRequest,
  type ValidatedRealityCheck,
  validateRealityCheckProposal,
} from "@/server/chat/reality-check";
import {
  nightlifePlacesEnrichmentIsUnavailable,
  type RequiredEvidencePlan,
  researchPlacesEnrichmentIsUnavailable,
  selectedNightlifeEventVenueNames,
  selectedResearchEntityNames,
} from "@/server/chat/required-evidence";
import { createConfiguredChatResponsesClient } from "@/server/llm/chat-model-provider";
import {
  createModelCostAccumulator,
  estimateModelCallCostUsd,
  modelCostTelemetryPayload,
} from "@/server/llm/model-cost";
import { trackServerEvent } from "@/server/observability/events";
import { createComponentLogger } from "@/server/observability/logger";
import { createConfiguredWebResearchProvider } from "@/server/providers/web-search";
import type { QuotaStore } from "@/server/security/rate-limit";
import type {
  PaidChatUsageSessionResult,
  PaidDecisionMeterReservation,
  PaidDecisionMeterType,
} from "@/server/trip-pass/usage";

export type MeteredToolPlan = "free" | "paid";

export type MeteredToolUsageSession = {
  reserveDecisionMeter(input: {
    meterType: PaidDecisionMeterType;
  }): Promise<PaidDecisionMeterReservation>;
};

export type AskSiargaoAgentDependencies = AgentRuntimeDependencies &
  AgentToolDependencies & {
    agentMemoryVectorStoreId?: string;
    forceAgentMemorySearchFallback?: boolean;
    includeAgentMemoryFallbackWithFileSearch?: boolean;
    loadMemorySnapshot?: () => AgentMemorySnapshot;
    now?: () => Date;
    requireStructuredFinalOutput?: boolean;
    costPolicyEnv?: Record<string, string | undefined>;
    costCircuitStore?: QuotaStore;
    decisionMeterPlan?: MeteredToolPlan;
    decisionMeterSession?: MeteredToolUsageSession | null;
    usageSession?: Extract<PaidChatUsageSessionResult, { status: "allowed" }> | null;
  };

type ParsedFunctionCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ModelFacingAgentMemoryMetadata = {
  versionId: string;
  files: Array<{
    id: string;
    role: AgentMemoryMetadata["files"][number]["role"];
  }>;
};

type ResponseInputItem = Record<string, unknown>;

const maxConversationMessages = 10;
const agentLogger = createComponentLogger("chat_agent");
const structuredFinalOutputTextConfig = {
  format: { type: "json_object" },
} as const;

export async function runAskSiargaoAgentTurn(
  request: AgentRuntimeRequest,
  dependencies: AskSiargaoAgentDependencies = {},
): Promise<AgentTurnResult> {
  const resolved = resolveAgentRuntimeRequest(request, dependencies);
  const costPolicy = resolveChatCostPolicy(resolved, { env: dependencies.costPolicyEnv });
  const costAccumulator = createModelCostAccumulator({ requestId: resolved.requestId });
  const client = costAccumulator.wrapClient(
    dependencies.client ??
      createConfiguredChatResponsesClient({
        openAiFallbackEnabled: costPolicy.openAiFallback.enabled,
      }),
  );
  const memorySnapshot =
    dependencies.memorySnapshot ?? dependencies.loadMemorySnapshot?.() ?? loadAgentMemorySnapshot();
  const toolDependencies: AgentToolDependencies = {
    ...dependencies,
    memorySnapshot,
    webResearchProvider: dependencies.webResearchProvider ?? createConfiguredWebResearchProvider(),
  };
  const baseExecuteTool =
    dependencies.executeTool ??
    ((toolRequest: AgentToolExecutionRequest) => executeAgentTool(toolRequest, toolDependencies));
  const decisionMeterSession = dependencies.usageSession ?? dependencies.decisionMeterSession;
  const executeTool = decisionMeterSession
    ? createMeteredToolExecutor({
        executeTool: baseExecuteTool,
        plan: dependencies.usageSession ? "paid" : (dependencies.decisionMeterPlan ?? "paid"),
        usageSession: decisionMeterSession,
      })
    : baseExecuteTool;
  const logger = (dependencies.logger ?? agentLogger).child({ requestId: resolved.requestId });
  const upstreamRequestIds: string[] = [];
  const toolCalls: AgentToolCallAudit[] = [];
  const toolResults: AgentToolResult[] = [];
  let repairCount = 0;
  const hostedMemoryFileNames = new Set<string>();
  const maxToolCalls = dependencies.maxToolCalls ?? costPolicy.maxToolCalls;
  const maxTurns = dependencies.maxTurns ?? costPolicy.maxTurns;
  const maxOutputTokens = costPolicy.maxOutputTokens;
  const modelCostPolicy = responseModelCostPolicy(costPolicy);
  const requireStructuredFinalOutput = dependencies.requireStructuredFinalOutput === true;
  const responseText = requireStructuredFinalOutput ? structuredFinalOutputTextConfig : undefined;
  const budgetedClient = createBudgetedModelClient({
    client,
    costAccumulator,
    costPolicy,
    costPolicyEnv: dependencies.costPolicyEnv,
    costCircuitStore: dependencies.costCircuitStore,
    maxOutputTokens,
    modelCostPolicy,
    now: dependencies.now,
    responseText,
  });
  const agentMemoryVectorStoreId =
    dependencies.agentMemoryVectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID;
  const memory = createAgentMemoryMetadata(memorySnapshot, agentMemoryVectorStoreId);
  const responseContract = buildResponseContract({ requireStructuredFinalOutput });
  const instructions = buildAskSiargaoAgentInstructions(memorySnapshot, {
    requireStructuredFinalOutput,
  });
  const chatEvidencePolicy = buildChatEvidencePolicy(resolved);
  const realityCheckRecognition = requireStructuredFinalOutput
    ? recognizeRuntimeRealityCheck(resolved)
    : { explicit: false, missingContext: [] };
  const { requiredEvidencePlan } = chatEvidencePolicy;
  const tools = selectAgentResponseTools(
    buildAgentResponseTools(memorySnapshot, {
      vectorStoreId: agentMemoryVectorStoreId,
      forceMemoryFallback: dependencies.forceAgentMemorySearchFallback,
      includeMemoryFallbackWithFileSearch: dependencies.includeAgentMemoryFallbackWithFileSearch,
    }),
    resolved,
    requiredEvidencePlan,
  );
  const responseInclude = agentMemoryVectorStoreId ? ["file_search_call.results"] : undefined;

  logger.info(
    {
      model: resolved.model,
      messageCount: resolved.messages.length,
      maxToolCalls,
      maxTurns,
      costPolicy,
      agentMemory: summarizeMemoryForLogs(memory),
    },
    "Ask Siargao agent turn started.",
  );

  await emitAgentProgress(dependencies.onProgress, {
    stage: "model",
    message: "Understanding your question and choosing the right checks.",
  });

  const initialMemoryLoadCall = initialNightlifeMemoryLoadCall(resolved);
  const initialMemoryOutputs = initialMemoryLoadCall
    ? [
        await executeAndAuditTool({
          executeTool,
          functionCall: initialMemoryLoadCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        }),
      ]
    : [];
  toolCalls.push(...initialMemoryOutputs.map((output) => output.audit));
  toolResults.push(...initialMemoryOutputs.map((output) => output.result));

  let responseInput: ResponseInputItem[] = [
    userInputMessage({
      product: "Ask Siargao",
      conversation: resolved.messages.slice(-maxConversationMessages),
      requestMetadata: resolved.metadata,
      deterministicSignals: modelFacingDeterministicSignals(resolved),
      agentMemory: summarizeMemoryForModel(memory),
      ...(initialMemoryOutputs.length > 0
        ? {
            instruction:
              "Required memory preflight: use this loaded Ask Siargao memory as local reference context before choosing tools or answering. Keep memory separate from live/current evidence.",
            automaticRequiredMemoryLoads: initialMemoryOutputs.map((output) => ({
              toolCallId: output.functionCall.callId,
              name: output.functionCall.name,
              arguments: publicToolArguments(output.functionCall),
              result: JSON.parse(serializeToolOutput(output.result)),
            })),
          }
        : {}),
      responseContract: responseContract,
    }),
  ];
  let response = await createBudgetedModelResponse({
    client,
    costAccumulator,
    costPolicy,
    costPolicyEnv: dependencies.costPolicyEnv,
    costCircuitStore: dependencies.costCircuitStore,
    now: dependencies.now,
    params: {
      model: resolved.model,
      store: false,
      max_output_tokens: maxOutputTokens,
      instructions,
      modelCostPolicy,
      tools,
      ...(responseText ? { text: responseText } : {}),
      ...(responseInclude ? { include: responseInclude } : {}),
      input: responseInput,
    },
  });
  let activeModel = response.model ?? resolved.model;
  collectUpstreamRequestId(response._request_id, upstreamRequestIds);
  collectHostedFileSearchMemoryFileNames(response.output, memorySnapshot, hostedMemoryFileNames);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const finalText = response.output_text?.trim();
    if (finalText) {
      const repairResult = await runAgentRepairPipeline({
        adapters: buildAgentRepairAdapters({
          chatEvidencePolicy,
          hostedMemoryFileNames,
          logger,
          realityCheckRecognition,
          request: resolved,
          requireStructuredFinalOutput,
        }),
        client: budgetedClient,
        executeToolCalls: (functionCalls) =>
          executeAndAuditToolBatch({
            executeTool,
            functionCalls,
            logger,
            now: dependencies.now ?? (() => new Date()),
            requiredEvidencePlan,
            runtimeRequest: resolved,
            requestId: resolved.requestId,
            toolResults,
          }),
        finalText,
        instructions,
        maxToolCalls,
        model: activeModel,
        publicToolArguments,
        response,
        responseContract,
        responseInclude,
        responseInput,
        responseTools: tools,
        serializeToolOutput,
        toolCalls,
        toolResults,
        collectUpstreamRequestId: (requestId) =>
          collectUpstreamRequestId(requestId, upstreamRequestIds),
        collectHostedMemory: (retryResponse) =>
          collectHostedFileSearchMemoryFileNames(
            retryResponse.output,
            memorySnapshot,
            hostedMemoryFileNames,
          ),
      });
      if (repairResult.repaired) {
        repairCount += 1;
        await emitAgentProgress(dependencies.onProgress, {
          stage: "checking",
          message: "Checking the answer against the available evidence.",
        });
        response = repairResult.response;
        activeModel = response.model ?? activeModel;
        responseInput = repairResult.responseInput;
        continue;
      }
      const parsedFinalPayload = parseFinalPayloadOrLegacyText(finalText, {
        logger,
        requireStructuredFinalOutput,
        hostedMemoryFileNames,
        toolCalls,
        toolResults,
      });
      if (!parsedFinalPayload && shouldRepairMalformedFinalAnswer(finalText)) {
        repairCount += 1;
        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            instruction:
              "The previous final answer was malformed internal JSON, internal tool-call markup, or an unfinished code fence. Return only normal traveler-facing Markdown/plain text. Do not wrap the answer in JSON, tool-call markup, or a code fence.",
            responseContract,
          }),
        ];
        response = await createBudgetedModelResponse({
          client,
          costAccumulator,
          costPolicy,
          costPolicyEnv: dependencies.costPolicyEnv,
          costCircuitStore: dependencies.costCircuitStore,
          now: dependencies.now,
          params: {
            model: activeModel,
            store: false,
            max_output_tokens: maxOutputTokens,
            instructions,
            modelCostPolicy,
            tools,
            ...(responseText ? { text: responseText } : {}),
            ...(responseInclude ? { include: responseInclude } : {}),
            input: responseInput,
          },
        });
        activeModel = response.model ?? activeModel;
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }
      const finalPayload = applyChatEvidenceFinalPayloadPolicy({
        finalPayload: parsedFinalPayload,
        policy: chatEvidencePolicy,
        request: resolved,
        toolCalls,
        toolResults,
      });
      const realityCheckOutcome = resolveRealityCheckOutcome({
        finalPayload,
        recognition: realityCheckRecognition,
        requestId: resolved.requestId,
        toolCalls,
        toolResults,
      });
      logger.info(
        {
          durationMs: sumDurations(toolCalls),
          model: activeModel,
          toolCallCount: toolCalls.length,
          upstreamRequestCount: upstreamRequestIds.length,
          agentMemoryVersionId: memory.versionId,
        },
        "Ask Siargao agent turn completed.",
      );
      const sanitizedAnswer = sanitizeFinalAnswer(
        realityCheckOutcome.answer ?? finalPayload?.answer ?? finalText,
        resolved,
        toolCalls,
      );
      const sanitizedFinalPayload = finalPayload
        ? {
            ...finalPayload,
            answer: sanitizedAnswer,
            displayDecisionSummaryIds: realityCheckOutcome.explicit
              ? realityCheckOutcome.summary
                ? [realityCheckOutcome.summary.id]
                : []
              : finalPayload.displayDecisionSummaryIds,
          }
        : finalPayload;
      const realityCheckAllowedArtifacts = allowedRealityCheckArtifacts({
        finalPayload: sanitizedFinalPayload,
        recognition: realityCheckRecognition,
        toolResults,
      });
      const artifactFilteredFinalPayload =
        sanitizedFinalPayload && realityCheckAllowedArtifacts
          ? {
              ...sanitizedFinalPayload,
              displayCardIds: filterAllowedArtifactIds(
                sanitizedFinalPayload.displayCardIds,
                realityCheckAllowedArtifacts.cardIds,
              ),
              displayItineraryIds: filterAllowedArtifactIds(
                sanitizedFinalPayload.displayItineraryIds,
                realityCheckAllowedArtifacts.itineraryIds,
              ),
            }
          : sanitizedFinalPayload;
      const modelCost = costAccumulator.summary();
      if (modelCost.callCount > 0) {
        trackServerEvent({
          name: "llm_cost_recorded",
          payload: modelCostTelemetryPayload(modelCost),
          now: dependencies.now?.(),
        });
      }
      const result = createAgentTurnResult({
        message: sanitizedAnswer,
        requestId: resolved.requestId,
        model: activeModel,
        modelCost,
        memory,
        upstreamRequestIds,
        toolCalls,
        toolResults,
        ...(realityCheckOutcome.summary
          ? { decisionSummaries: [realityCheckOutcome.summary] }
          : {}),
        ...(artifactFilteredFinalPayload ? { finalPayload: artifactFilteredFinalPayload } : {}),
        allowedCardKinds: requiredEvidencePlan.allowedCardKinds,
        allowedCardIds: combinedAllowedCardIds(
          requiredEvidenceAllowedCardIds(chatEvidencePolicy, toolResults),
          realityCheckAllowedArtifacts?.cardIds,
        ),
        allowedItineraryIds: realityCheckAllowedArtifacts?.itineraryIds,
        artifactSelectionMode: requireStructuredFinalOutput ? "strict" : "compatibility",
        repairCount,
      });
      if (realityCheckOutcome.validated && realityCheckOutcome.summary) {
        trackServerEvent({
          name: "reality_check_completed",
          payload: {
            status: "completed",
            kind: realityCheckOutcome.validated.proposal.kind,
            verdict: realityCheckOutcome.validated.proposal.verdict,
            sourceState: realityCheckOutcome.validated.sourceState,
            sourceCount: realityCheckOutcome.validated.sources.length,
            toolCallCount: toolCalls.length,
            durationMs: sumDurations(toolCalls),
            cardCount: result.cards?.length ?? 0,
            itineraryCount: result.itineraries?.length ?? 0,
            decisionSummaryCount: result.decisionSummaries?.length ?? 0,
          },
          now: dependencies.now?.(),
        });
      }
      return result;
    }

    const functionCalls = extractFunctionCalls(response.output);
    if (functionCalls.length === 0) {
      throw new Error("OpenAI response did not include output_text.");
    }

    if (toolCalls.length + functionCalls.length > maxToolCalls) {
      const repeatedInvalidToolNames = repeatedInvalidToolArgumentNames(toolCalls);
      if (repeatedInvalidToolNames.length > 0) {
        logger.warn(
          {
            model: activeModel,
            toolCallCount: toolCalls.length,
            proposedToolCallCount: functionCalls.length,
            repeatedInvalidToolNames,
          },
          "Ask Siargao agent forcing final answer after repeated invalid tool arguments would exceed the tool budget.",
        );
        responseInput = [
          ...responseInput,
          userInputMessage({
            instruction: invalidToolArgumentsFinalAnswerInstruction(repeatedInvalidToolNames),
            responseContract,
          }),
        ];
        response = await createBudgetedModelResponse({
          client,
          costAccumulator,
          costPolicy,
          costPolicyEnv: dependencies.costPolicyEnv,
          costCircuitStore: dependencies.costCircuitStore,
          now: dependencies.now,
          params: {
            model: activeModel,
            store: false,
            max_output_tokens: maxOutputTokens,
            instructions,
            modelCostPolicy,
            ...(responseText ? { text: responseText } : {}),
            input: responseInput,
          },
        });
        activeModel = response.model ?? activeModel;
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }
      logger.warn(
        {
          model: activeModel,
          toolCallCount: toolCalls.length,
          proposedToolCallCount: functionCalls.length,
          maxToolCalls,
        },
        "Ask Siargao agent forcing final answer because another tool call would exceed the budget.",
      );
      responseInput = [
        ...responseInput,
        userInputMessage({
          instruction: toolBudgetExhaustedFinalAnswerInstruction(),
          validationRepairToolBudgetExhausted: {
            existingToolCallCount: toolCalls.length,
            maxToolCalls,
            requestedToolNames: functionCalls.map((functionCall) => functionCall.name),
          },
          responseContract,
        }),
      ];
      response = await createBudgetedModelResponse({
        client,
        costAccumulator,
        costPolicy,
        costPolicyEnv: dependencies.costPolicyEnv,
        costCircuitStore: dependencies.costCircuitStore,
        now: dependencies.now,
        params: {
          model: activeModel,
          store: false,
          max_output_tokens: maxOutputTokens,
          instructions,
          modelCostPolicy,
          ...(responseText ? { text: responseText } : {}),
          input: responseInput,
        },
      });
      activeModel = response.model ?? activeModel;
      collectUpstreamRequestId(response._request_id, upstreamRequestIds);
      collectHostedFileSearchMemoryFileNames(
        response.output,
        memorySnapshot,
        hostedMemoryFileNames,
      );
      continue;
    }

    await emitAgentProgress(dependencies.onProgress, {
      stage: "tools",
      message:
        functionCalls.length === 1
          ? "Checking one relevant source."
          : `Checking ${functionCalls.length} relevant sources.`,
      toolCount: functionCalls.length,
    });
    const toolOutputs = await executeAndAuditToolBatch({
      executeTool,
      functionCalls,
      logger,
      now: dependencies.now ?? (() => new Date()),
      requiredEvidencePlan,
      runtimeRequest: resolved,
      requestId: resolved.requestId,
      toolResults,
    });
    toolCalls.push(...toolOutputs.map((output) => output.audit));
    toolResults.push(...toolOutputs.map((output) => output.result));

    responseInput = [
      ...responseInput,
      ...responseOutputItemsWithSyntheticFunctionCalls(response.output, functionCalls),
      ...toolOutputs.map((output) => ({
        type: "function_call_output",
        call_id: output.functionCall.callId,
        output: serializeToolOutput(output.result),
      })),
    ];
    const repeatedInvalidToolNames = repeatedInvalidToolArgumentNames(toolCalls);
    const forceFinalAnswer = repeatedInvalidToolNames.length > 0;
    if (forceFinalAnswer) {
      logger.warn(
        {
          model: activeModel,
          toolCallCount: toolCalls.length,
          repeatedInvalidToolNames,
        },
        "Ask Siargao agent forcing final answer after repeated invalid tool arguments.",
      );
      responseInput = [
        ...responseInput,
        userInputMessage({
          instruction: invalidToolArgumentsFinalAnswerInstruction(repeatedInvalidToolNames),
          responseContract,
        }),
      ];
    }
    await emitAgentProgress(dependencies.onProgress, {
      stage: "synthesis",
      message: "Turning the checked results into a useful answer.",
    });
    response = await createBudgetedModelResponse({
      client,
      costAccumulator,
      costPolicy,
      costPolicyEnv: dependencies.costPolicyEnv,
      costCircuitStore: dependencies.costCircuitStore,
      now: dependencies.now,
      params: {
        model: activeModel,
        store: false,
        max_output_tokens: maxOutputTokens,
        instructions,
        modelCostPolicy,
        ...(responseText ? { text: responseText } : {}),
        ...(forceFinalAnswer ? {} : { tools }),
        ...(!forceFinalAnswer && responseInclude ? { include: responseInclude } : {}),
        input: responseInput,
      },
    });
    activeModel = response.model ?? activeModel;
    collectUpstreamRequestId(response._request_id, upstreamRequestIds);
    collectHostedFileSearchMemoryFileNames(response.output, memorySnapshot, hostedMemoryFileNames);
  }

  throw new Error("Ask Siargao agent exceeded the maximum turn count.");
}

async function emitAgentProgress(
  onProgress: AskSiargaoAgentDependencies["onProgress"],
  update: AgentProgressUpdate,
) {
  await onProgress?.(update);
}

function createBudgetedModelClient({
  client,
  costAccumulator,
  costPolicy,
  costPolicyEnv,
  costCircuitStore,
  maxOutputTokens,
  modelCostPolicy,
  now,
  responseText,
}: {
  client: AgentResponsesClient;
  costAccumulator: ReturnType<typeof createModelCostAccumulator>;
  costPolicy: ChatCostPolicy;
  costPolicyEnv?: Record<string, string | undefined>;
  costCircuitStore?: QuotaStore;
  maxOutputTokens: number;
  modelCostPolicy: ReturnType<typeof responseModelCostPolicy>;
  now?: () => Date;
  responseText?: Record<string, unknown>;
}) {
  return {
    responses: {
      create: (params: Record<string, unknown>) =>
        createBudgetedModelResponse({
          client,
          costAccumulator,
          costPolicy,
          costPolicyEnv,
          costCircuitStore,
          now,
          params: {
            ...params,
            max_output_tokens: boundedMaxOutputTokens(params.max_output_tokens, maxOutputTokens),
            modelCostPolicy: params.modelCostPolicy ?? modelCostPolicy,
            ...(params.text === undefined && responseText ? { text: responseText } : {}),
          },
        }),
    },
  };
}

export function createMeteredToolExecutor({
  executeTool,
  plan = "paid",
  usageSession,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  plan?: MeteredToolPlan;
  usageSession: MeteredToolUsageSession;
}) {
  return async (request: AgentToolExecutionRequest) => {
    const meterTypes = meterTypesForTool(request.name, plan);
    const reservations = await Promise.all(
      meterTypes.map(async (meterType) => usageSession.reserveDecisionMeter({ meterType })),
    );
    const blocked = reservations.find(
      (reservation) => reservation.status === "usage_limit_reached",
    );
    if (blocked) {
      await Promise.all(
        reservations.map((reservation) =>
          reservation.status === "reserved" ? reservation.release() : Promise.resolve(),
        ),
      );
      return liveAccessRequiredToolResult(request, blocked.meterType);
    }

    try {
      const result = await executeTool(request);
      const providerRequestIds = providerRequestIdsFromToolResult(result);
      await Promise.all(
        reservations.map((reservation) =>
          reservation.status === "reserved"
            ? reservation.settle({
                success: toolResultConsumesMeter(request.name, reservation.meterType, result),
                providerRequestIds,
              })
            : Promise.resolve(),
        ),
      );
      return result;
    } catch (error) {
      await Promise.all(
        reservations.map((reservation) =>
          reservation.status === "reserved" ? reservation.release() : Promise.resolve(),
        ),
      );
      throw error;
    }
  };
}

function meterTypesForTool(toolName: string, plan: MeteredToolPlan): PaidDecisionMeterType[] {
  if (plan === "paid") return [];
  switch (toolName) {
    case "get_weather_forecast":
    case "get_marine_conditions":
    case "get_tide_forecast":
    case "get_condition_judgment":
    case "plan_local_itinerary":
      return ["live_refresh"];
    case "research_web":
    case "search_nightlife_events":
    case "search_places":
    case "get_place_details":
      return ["live_refresh", "heavy_recommendation"];
    default:
      return [];
  }
}

function toolResultConsumesMeter(
  toolName: string,
  meterType: PaidDecisionMeterType,
  result: AgentToolResult,
) {
  if (result.status !== "success") {
    return false;
  }
  if (meterType === "route_lookup") {
    return toolName === "plan_local_itinerary";
  }

  const sourceLabels = new Set(result.sources.map((source) => source.label));
  if (meterType === "weather_refresh") {
    return (
      sourceLabels.has("weather_checked") ||
      sourceLabels.has("marine_checked") ||
      sourceLabels.has("tide_forecast_checked")
    );
  }
  if (meterType === "heavy_recommendation") {
    return sourceLabels.has("live_checked") || toolName === "research_web";
  }
  if (
    toolName === "plan_local_itinerary" ||
    toolName === "research_web" ||
    toolName === "search_nightlife_events"
  ) {
    return true;
  }
  return (
    sourceLabels.has("live_checked") ||
    sourceLabels.has("weather_checked") ||
    sourceLabels.has("marine_checked") ||
    sourceLabels.has("tide_forecast_checked")
  );
}

function liveAccessRequiredToolResult(
  request: AgentToolExecutionRequest,
  meterType: PaidDecisionMeterType,
): AgentToolResult {
  return {
    name: request.name,
    toolCallId: request.toolCallId,
    status: "error",
    errorCode: "live_access_required",
    text: "Live Trip Pass allowance is exhausted for this category. Use cached or local evidence only, and label the limitation clearly.",
    sources: [
      {
        label: "not_verified",
        sourceName: "Trip Pass live allowance",
        fetchedAt: new Date().toISOString(),
        confidence: "low",
        checked: [],
        notChecked: [`${meterType} allowance exhausted`],
      },
    ],
    data: {
      meterType,
      reason: "live_access_required",
    },
  };
}

function providerRequestIdsFromToolResult(result: AgentToolResult) {
  const upstream = result.logData?.upstreamRequestId ?? result.logData?.upstreamRequestIds;
  if (typeof upstream === "string") {
    return [upstream];
  }
  if (Array.isArray(upstream)) {
    return upstream.filter((value): value is string => typeof value === "string");
  }
  return [];
}

async function createBudgetedModelResponse({
  client,
  costAccumulator,
  costPolicy,
  costPolicyEnv,
  costCircuitStore,
  now,
  params,
}: {
  client: AgentResponsesClient;
  costAccumulator: ReturnType<typeof createModelCostAccumulator>;
  costPolicy: ChatCostPolicy;
  costPolicyEnv?: Record<string, string | undefined>;
  costCircuitStore?: QuotaStore;
  now?: () => Date;
  params: Record<string, unknown>;
}) {
  assertModelCallAllowed(costAccumulator.summary().callCount, costPolicy);
  const model = typeof params.model === "string" ? params.model : "unknown";
  const reservation = await reserveModelCost(
    { model, requestId: costAccumulator.summary().requestId },
    { env: costPolicyEnv, now, store: costCircuitStore },
  );
  assertModelCostCircuit(reservation);
  try {
    const response = await client.responses.create(params);
    if (reservation.status === "allowed") {
      const modeledCostUsd = response.usage ? estimateModelCallCostUsd(response.usage) : "0";
      const actualMicros =
        response.usage?.provider === "deepseek"
          ? Number.parseInt((Number(modeledCostUsd) * 1_000_000).toFixed(0), 10)
          : reservation.amountMicros;
      await reservation.settle(actualMicros);
    }
    return response;
  } catch (error) {
    if (reservation.status === "allowed") {
      await reservation.settle(0);
    }
    throw error;
  }
}

function boundedMaxOutputTokens(value: unknown, maxOutputTokens: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(value, maxOutputTokens)
    : maxOutputTokens;
}

function userInputMessage(input: Record<string, unknown>): ResponseInputItem {
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: JSON.stringify(input),
      },
    ],
  };
}

function responseOutputItems(output: unknown): ResponseInputItem[] {
  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => (isRecord(item) ? [item] : []));
}

function responseOutputItemsWithSyntheticFunctionCalls(
  output: unknown,
  functionCalls: readonly ParsedFunctionCall[],
): ResponseInputItem[] {
  const outputItems = responseOutputItems(output);
  const observedCallIds = new Set(
    outputItems.flatMap((item) =>
      item.type === "function_call" && typeof item.call_id === "string" ? [item.call_id] : [],
    ),
  );
  const syntheticFunctionCalls = functionCalls.filter(
    (functionCall) => !observedCallIds.has(functionCall.callId),
  );

  return [
    ...outputItems,
    ...syntheticFunctionCalls.map((functionCall) => ({
      type: "function_call",
      call_id: functionCall.callId,
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.arguments),
    })),
  ];
}

function collectHostedFileSearchMemoryFileNames(
  output: unknown,
  memorySnapshot: AgentMemorySnapshot,
  fileNames: Set<string>,
) {
  if (!Array.isArray(output)) {
    return;
  }

  const knownFiles = new Map<string, string>();
  for (const file of memorySnapshot.referenceFiles) {
    knownFiles.set(file.fileName, file.fileName);
    knownFiles.set(file.id, file.fileName);
    knownFiles.set(file.relativePath, file.fileName);
  }

  for (const item of output) {
    if (!isRecord(item) || item.type !== "file_search_call" || !Array.isArray(item.results)) {
      continue;
    }
    for (const result of item.results) {
      const fileName = hostedFileSearchMemoryFileName(result, knownFiles);
      if (fileName) {
        fileNames.add(fileName);
      }
    }
  }
}

function hostedFileSearchMemoryFileName(result: unknown, knownFiles: ReadonlyMap<string, string>) {
  if (!isRecord(result)) {
    return undefined;
  }

  for (const candidate of hostedFileSearchMemoryFileCandidates(result)) {
    const exactMatch = knownFiles.get(candidate);
    if (exactMatch) {
      return exactMatch;
    }
    const baseName = candidate.split(/[\\/]/u).at(-1);
    if (baseName) {
      const baseNameMatch = knownFiles.get(baseName);
      if (baseNameMatch) {
        return baseNameMatch;
      }
    }
  }

  return undefined;
}

function hostedFileSearchMemoryFileCandidates(result: Record<string, unknown>) {
  const candidates = [
    readString(result.filename),
    readString(result.file_id),
    readString(result.fileName),
    readString(result.file_name),
  ];
  const attributes = isRecord(result.attributes) ? result.attributes : {};
  candidates.push(
    readString(attributes.agent_memory_file_name),
    readString(attributes.agent_memory_id),
    readString(attributes.fileName),
    readString(attributes.file_name),
    readString(attributes.relativePath),
    readString(attributes.relative_path),
  );
  return candidates.flatMap((candidate) => (candidate ? [candidate] : []));
}

function parseFinalPayloadOrLegacyText(
  finalText: string,
  {
    logger,
    requireStructuredFinalOutput,
    hostedMemoryFileNames,
    toolCalls,
    toolResults,
  }: {
    logger: Logger;
    requireStructuredFinalOutput: boolean;
    hostedMemoryFileNames: ReadonlySet<string>;
    toolCalls: readonly AgentToolCallAudit[];
    toolResults: readonly AgentToolResult[];
  },
): AgentFinalPayload | undefined {
  const parsed = parseAgentFinalPayload(finalText);
  if (!parsed) {
    if (requireStructuredFinalOutput) {
      throw new Error(
        "Ask Siargao agent returned legacy plain text instead of final payload JSON.",
      );
    }
    return undefined;
  }

  return validateFinalPayloadMemoryFiles(
    validateFinalPayloadToolCallIds(parsed, toolCalls, requireStructuredFinalOutput, logger),
    toolResults,
    hostedMemoryFileNames,
    requireStructuredFinalOutput,
    logger,
  );
}

function parseAgentFinalPayload(finalText: string): AgentFinalPayload | undefined {
  const jsonText = extractFinalPayloadJson(finalText);
  if (!jsonText) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }
  const answer = readString(parsed.answer)?.trim();
  if (!answer) {
    return undefined;
  }

  const usedMemoryFiles = readStringArray(parsed.usedMemoryFiles);
  const usedToolCallIds = readStringArray(parsed.usedToolCallIds);
  const displayCardIds = readStringArray(parsed.displayCardIds);
  const displayActionIds = readStringArray(parsed.displayActionIds);
  const displayItineraryIds = readStringArray(parsed.displayItineraryIds);
  const displayDecisionSummaryIds = readStringArray(parsed.displayDecisionSummaryIds);
  if (
    !usedMemoryFiles ||
    !usedToolCallIds ||
    !displayCardIds ||
    !displayActionIds ||
    !displayItineraryIds ||
    !displayDecisionSummaryIds
  ) {
    return undefined;
  }

  const realityCheck =
    parsed.realityCheck === undefined ? undefined : parseRealityCheckProposal(parsed.realityCheck);
  return {
    answer,
    usedMemoryFiles,
    usedToolCallIds,
    displayCardIds,
    displayActionIds,
    displayItineraryIds,
    displayDecisionSummaryIds,
    ...(realityCheck ? { realityCheck } : {}),
  };
}

type RuntimeRealityCheckOutcome = {
  explicit: boolean;
  answer?: string;
  summary?: DecisionSummary;
  validated?: ValidatedRealityCheck;
};

function allowedRealityCheckArtifacts(input: {
  finalPayload: AgentFinalPayload | undefined;
  recognition: RealityCheckRecognition;
  toolResults: readonly AgentToolResult[];
}) {
  if (
    !input.finalPayload ||
    (input.recognition.kind !== "immediate_plan" &&
      input.recognition.kind !== "surf_session" &&
      input.recognition.kind !== "disruption_recovery") ||
    input.recognition.missingContext.length > 0
  ) {
    return undefined;
  }

  const usedToolCallIds = new Set(input.finalPayload.usedToolCallIds);
  const allowedToolNames =
    input.recognition.kind === "disruption_recovery"
      ? disruptionReplacementToolNames
      : currentConditionDependentToolNames;
  const allowedResults = input.toolResults.filter(
    (result) =>
      result.status === "success" &&
      Boolean(result.toolCallId && usedToolCallIds.has(result.toolCallId)) &&
      allowedToolNames.has(result.name),
  );
  return {
    cardIds: uniqueText(
      allowedResults.flatMap((result) => result.cards?.map((card) => card.id) ?? []),
    ),
    itineraryIds: uniqueText(
      allowedResults.flatMap((result) => result.itineraries?.map(agentItineraryArtifactId) ?? []),
    ),
  };
}

function combinedAllowedCardIds(
  requiredEvidenceIds: readonly string[] | undefined,
  realityCheckIds: readonly string[] | undefined,
) {
  if (!requiredEvidenceIds) {
    return realityCheckIds;
  }
  if (!realityCheckIds) {
    return requiredEvidenceIds;
  }
  const realityCheckIdSet = new Set(realityCheckIds);
  return requiredEvidenceIds.filter((id) => realityCheckIdSet.has(id));
}

function filterAllowedArtifactIds(ids: readonly string[], allowedIds: readonly string[]) {
  const allowedIdSet = new Set(allowedIds);
  return ids.filter((id) => allowedIdSet.has(id));
}

function recognizeRuntimeRealityCheck(request: AgentRuntimeRequest) {
  const userTurns: string[] = [];
  for (const message of request.messages) {
    if (message.role === "user") {
      userTurns.push(message.content);
    }
  }
  return recognizeRealityCheckRequest({
    latestUserTurn: userTurns.at(-1) ?? "",
    recentUserContext: userTurns.slice(0, -1).slice(-3).join("\n"),
  });
}

function resolveRealityCheckOutcome(input: {
  finalPayload: AgentFinalPayload | undefined;
  recognition: RealityCheckRecognition;
  requestId: string;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
}): RuntimeRealityCheckOutcome {
  if (!input.recognition.explicit) {
    return { explicit: false };
  }
  if (!input.recognition.kind || input.recognition.missingContext.length > 0) {
    return {
      explicit: true,
      answer: realityCheckClarification(input.recognition),
    };
  }
  const conditionFallback = acceptedConditionRealityCheckFallback(input);
  if (!input.finalPayload?.realityCheck) {
    if (conditionFallback) {
      return resolvedValidatedRealityCheck(conditionFallback, input.requestId);
    }
    return {
      explicit: true,
      answer: unresolvedRealityCheckAnswer(input.recognition),
    };
  }

  const validation = validateRealityCheckProposal({
    expectedKind: input.recognition.kind,
    proposal: input.finalPayload.realityCheck,
    usedToolCallIds: input.finalPayload.usedToolCallIds,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
  });
  const validated = acceptedRealityCheck(validation) ?? conditionFallback;
  if (!validated) {
    return {
      explicit: true,
      answer: unresolvedRealityCheckAnswer(input.recognition),
    };
  }

  return resolvedValidatedRealityCheck(validated, input.requestId);
}

function resolvedValidatedRealityCheck(
  validated: ValidatedRealityCheck,
  requestId: string,
): RuntimeRealityCheckOutcome {
  const summary = buildRealityCheckDecisionSummary(validated, requestId);
  return {
    explicit: true,
    answer: renderRealityCheckAnswer(validated.proposal),
    summary,
    validated,
  };
}

function acceptedConditionRealityCheckFallback(input: {
  finalPayload: AgentFinalPayload | undefined;
  recognition: RealityCheckRecognition;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
}) {
  if (
    !input.finalPayload ||
    (input.recognition.kind !== "immediate_plan" && input.recognition.kind !== "surf_session")
  ) {
    return undefined;
  }
  const usedToolCallIds = new Set(input.finalPayload.usedToolCallIds);
  const conditionResult = [...input.toolResults]
    .reverse()
    .find(
      (result) =>
        result.name === "get_condition_judgment" &&
        result.status === "success" &&
        Boolean(result.toolCallId && usedToolCallIds.has(result.toolCallId)),
    );
  const conditionSummary = conditionResult?.decisionSummaries?.[0];
  const recommendation = readStringPath(conditionResult?.data, ["judgment", "recommendation"]);
  const verdict = conditionRecommendationVerdict(recommendation);
  if (!conditionResult?.toolCallId || !conditionSummary || !verdict) {
    return undefined;
  }
  const subject = [conditionSummary.area, conditionSummary.timing].filter(Boolean).join(" ");
  if (!subject) {
    return undefined;
  }

  const validation = validateRealityCheckProposal({
    expectedKind: input.recognition.kind,
    proposal: {
      kind: input.recognition.kind,
      verdict,
      subject,
      bestAction: conditionSummary.bestAction,
      basis: conditionSummary.basis,
      ...(conditionSummary.fallback ? { fallback: conditionSummary.fallback } : {}),
      ...(conditionSummary.avoid ? { avoid: conditionSummary.avoid } : {}),
      ...(conditionSummary.timing ? { timing: conditionSummary.timing } : {}),
      ...(conditionSummary.area ? { area: conditionSummary.area } : {}),
      evidenceToolCallIds: [conditionResult.toolCallId],
    },
    usedToolCallIds: input.finalPayload.usedToolCallIds,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
  });
  return acceptedRealityCheck(validation);
}

function conditionRecommendationVerdict(
  value: string | undefined,
): RealityCheckVerdict | undefined {
  if (value === "good") return "keep";
  if (value === "flexible") return "change";
  if (value === "avoid") return "avoid";
  if (value === "needs_local_confirmation") return "needs_confirmation";
  return undefined;
}

function acceptedRealityCheck(
  validation: RealityCheckValidationResult,
): ValidatedRealityCheck | undefined {
  return validation.status === "valid" ? validation.value : validation.fallback;
}

function buildRealityCheckDecisionSummary(
  validated: ValidatedRealityCheck,
  requestId: string,
): DecisionSummary {
  const proposal = validated.proposal;
  const fingerprint = createHash("sha256")
    .update(`${requestId}\u0000${proposal.kind}\u0000${proposal.subject}`)
    .digest("hex")
    .slice(0, 16);
  return {
    id: `reality_check:${proposal.kind}:${fingerprint}`,
    kind: proposal.kind,
    verdict: proposal.verdict,
    subject: proposal.subject,
    bestAction: proposal.bestAction,
    basis: proposal.basis,
    ...(proposal.fallback ? { fallback: proposal.fallback } : {}),
    ...(proposal.avoid ? { avoid: proposal.avoid } : {}),
    ...(proposal.timing ? { timing: proposal.timing } : {}),
    ...(proposal.area ? { area: proposal.area } : {}),
    sources: validated.sources,
  };
}

function renderRealityCheckAnswer(proposal: ValidatedRealityCheck["proposal"]) {
  const verdictLabel = proposal.verdict.replaceAll("_", " ");
  return [
    `**${verdictLabel}: ${proposal.subject}**`,
    proposal.bestAction,
    proposal.basis,
    ...(proposal.fallback ? [`Fallback: ${proposal.fallback}`] : []),
    ...(proposal.avoid ? [`Avoid: ${proposal.avoid}`] : []),
    ...(proposal.timing ? [`Timing: ${proposal.timing}`] : []),
    ...(proposal.area ? [`Area: ${proposal.area}`] : []),
  ].join("\n\n");
}

function realityCheckClarification(recognition: RealityCheckRecognition) {
  const missing = recognition.missingContext[0];
  if (missing === "subject") {
    return "Which accommodation should I reality-check? Send its name or listing link.";
  }
  if (missing === "plan") {
    return "Send the itinerary stops and timing you want me to reality-check.";
  }
  if (missing === "activity") {
    return "What activity or trip should I reality-check for today or tomorrow?";
  }
  if (missing === "skill_level") {
    return "What is the surfer's level: beginner, intermediate, or advanced?";
  }
  if (missing === "location") {
    return "Which Siargao surf spot or area should I reality-check?";
  }
  if (missing === "timing") {
    return "When do you want to surf: today or tomorrow, and roughly what time?";
  }
  if (missing === "disruption") {
    return "What was cancelled or became unavailable, and when did you plan to do it?";
  }
  return "Please add the specific plan you want me to reality-check.";
}

function unresolvedRealityCheckAnswer(recognition: RealityCheckRecognition) {
  if (recognition.kind === "immediate_plan") {
    return [
      "**needs confirmation: today's Siargao plan**",
      "Keep the outing short and flexible, with a nearby covered option, rather than cancelling it outright.",
      "Live conditions were not established, so this is planning guidance rather than a checked go/no-go verdict.",
      "Check the visible sky and any local warnings before leaving. Avoid entering the water if there is thunder or lightning, and get a local check before surfing or swimming.",
    ].join("\n\n");
  }
  if (recognition.kind === "surf_session") {
    return [
      "**needs confirmation: surf session**",
      "Do not treat the session as cleared yet. Check the exact break with a local coach or experienced surfer before paddling out.",
      "Match the decision to your level, tide, swell, wind, reef exposure, and any thunder or lightning. If those cannot be confirmed, watch from shore or choose a coached session instead.",
    ].join("\n\n");
  }
  if (recognition.kind === "accommodation") {
    return [
      "**needs confirmation: accommodation**",
      "Keep the property on the shortlist, but do not make a non-refundable booking until its exact identity, location, current price, and availability are confirmed.",
      "Also confirm the room-specific details that matter most to you, such as road noise, backup power, Wi-Fi, and transport access.",
    ].join("\n\n");
  }
  if (recognition.kind === "itinerary") {
    return [
      "**needs confirmation: itinerary**",
      "Keep the plan flexible and protect the time-critical leg first.",
      "Confirm current travel times, opening or departure times, and weather-sensitive stops before committing. Drop the least important stop if the route has no useful buffer.",
    ].join("\n\n");
  }
  return [
    "**needs confirmation: replacement plan**",
    "Choose the closest low-commitment Siargao option that still works if conditions or availability change.",
    "Confirm the replacement directly before leaving, keep a nearby covered alternative, and avoid making a non-refundable commitment until the key detail is checked.",
  ].join("\n\n");
}

function shouldRepairMalformedFinalAnswer(finalText: string) {
  const trimmed = finalText.trim();
  if (!trimmed) {
    return false;
  }

  const startsLikeJsonFence = /^```(?:json)?\s*[\r\n{]/iu.test(trimmed);
  const startsLikeFinalPayload = trimmed.startsWith("{") && /"answer"\s*:/u.test(trimmed);
  const containsDsmlToolCall =
    /<\s*[|｜]{2}DSML[|｜]{2}tool_calls\s*>/u.test(trimmed) ||
    /<\s*[|｜]{2}DSML[|｜]{2}invoke\s+name=/u.test(trimmed);
  const containsEscapedMarkdown =
    /\\n(?:\\n)?(?:#{1,6}\s|\|.+\||[-*]\s+)/u.test(trimmed) ||
    /"answer"\s*:\s*"[\s\S]*\\n/u.test(trimmed);
  const codeFenceCount = trimmed.match(/```/gu)?.length ?? 0;
  const hasUnmatchedFence = codeFenceCount % 2 === 1;

  return (
    startsLikeJsonFence ||
    startsLikeFinalPayload ||
    containsDsmlToolCall ||
    containsEscapedMarkdown ||
    hasUnmatchedFence
  );
}

function extractFinalPayloadJson(finalText: string) {
  const trimmed = finalText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced?.[1]?.trim();
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.flatMap((item) => {
    const text = readString(item)?.trim();
    return text ? [text] : [];
  });
  return strings.length === value.length ? strings : undefined;
}

function validateFinalPayloadToolCallIds(
  payload: AgentFinalPayload,
  toolCalls: readonly AgentToolCallAudit[],
  strict: boolean,
  logger: Logger,
): AgentFinalPayload {
  const knownToolCallIds = new Set(
    toolCalls.flatMap((toolCall) => (toolCall.toolCallId ? [toolCall.toolCallId] : [])),
  );
  const usedToolCallIds = expandFinalPayloadToolCallIds(payload.usedToolCallIds, toolCalls);
  const unknownToolCallIds = usedToolCallIds.filter(
    (toolCallId) => !knownToolCallIds.has(toolCallId),
  );

  if (strict && unknownToolCallIds.length > 0) {
    throw new Error(
      `Agent final payload referenced unknown tool call ID(s): ${unknownToolCallIds.join(", ")}`,
    );
  }

  if (unknownToolCallIds.length > 0) {
    logger.warn(
      { usedToolCallIds: unknownToolCallIds },
      "Agent final payload referenced unknown tool call ID(s).",
    );
  }

  return {
    ...payload,
    usedMemoryFiles: uniqueText(payload.usedMemoryFiles),
    usedToolCallIds: usedToolCallIds.filter((toolCallId) => knownToolCallIds.has(toolCallId)),
    displayCardIds: normalizeFinalPayloadCardIds(payload.displayCardIds),
    displayActionIds: uniqueText(payload.displayActionIds),
    displayItineraryIds: uniqueText(payload.displayItineraryIds),
    displayDecisionSummaryIds: uniqueText(payload.displayDecisionSummaryIds),
  };
}

function expandFinalPayloadToolCallIds(
  values: readonly string[],
  toolCalls: readonly AgentToolCallAudit[],
) {
  const knownToolCallIds = new Set(
    toolCalls.flatMap((toolCall) => (toolCall.toolCallId ? [toolCall.toolCallId] : [])),
  );
  const calledToolNames = new Set(toolCalls.map((toolCall) => toolCall.name));
  return uniqueText(
    values.flatMap((value) => {
      const normalizedValue = value.trim();
      if (knownToolCallIds.has(normalizedValue)) {
        return [normalizedValue];
      }
      const toolReference = modelFacingToolNameReference(normalizedValue, calledToolNames);
      if (!toolReference) {
        return [value];
      }
      const matchingToolCallIds = toolCalls.flatMap((toolCall) =>
        toolCall.name === toolReference.name && toolCall.toolCallId ? [toolCall.toolCallId] : [],
      );
      if (toolReference.index !== undefined) {
        const indexedToolCallId =
          matchingToolCallIds[toolReference.index] ??
          (toolReference.index > 0 ? matchingToolCallIds[toolReference.index - 1] : undefined);
        return indexedToolCallId ? [indexedToolCallId] : [value];
      }
      return matchingToolCallIds.length ? matchingToolCallIds : [value];
    }),
  );
}

function modelFacingToolNameReference(value: string, calledToolNames: ReadonlySet<string>) {
  const normalizedValue = value.trim();
  const functionsMatch = /^functions\.([A-Za-z0-9_]+)$/u.exec(normalizedValue);
  const candidate = functionsMatch?.[1] ?? normalizedValue;
  if (calledToolNames.has(candidate)) {
    return { name: candidate };
  }

  for (const toolName of calledToolNames) {
    const indexedAliasMatch = new RegExp(`^${toolName}_(\\d+)$`, "u").exec(candidate);
    if (indexedAliasMatch?.[1] !== undefined) {
      return { name: toolName, index: Number(indexedAliasMatch[1]) };
    }
  }

  const candidateTokens = new Set(
    candidate
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter(Boolean),
  );
  const semanticMatches = [...calledToolNames].filter((toolName) =>
    toolName
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .every((token) => candidateTokens.has(token)),
  );
  if (semanticMatches.length === 1) {
    return { name: semanticMatches[0] };
  }

  return undefined;
}

function normalizeFinalPayloadCardIds(values: readonly string[]) {
  return uniqueText(values.map(normalizeFinalPayloadCardId));
}

function normalizeFinalPayloadCardId(value: string) {
  const normalizedValue = value.trim();
  const placeResourceMatch = /^places\/(.+)$/u.exec(normalizedValue);
  if (placeResourceMatch?.[1]) {
    return `place_${slugPart(placeResourceMatch[1]).toLowerCase()}`;
  }
  if (/^ChIJ[A-Za-z0-9_-]+$/u.test(normalizedValue)) {
    return `place_${slugPart(normalizedValue).toLowerCase()}`;
  }
  return value;
}

function validateFinalPayloadMemoryFiles(
  payload: AgentFinalPayload,
  toolResults: readonly AgentToolResult[],
  hostedMemoryFileNames: ReadonlySet<string>,
  strict: boolean,
  logger: Logger,
): AgentFinalPayload {
  const observedMemoryFiles = currentTurnMemoryFileNames(toolResults);
  for (const fileName of hostedMemoryFileNames) {
    observedMemoryFiles.add(fileName);
  }
  const usedMemoryFiles = uniqueText(payload.usedMemoryFiles);
  const unknownMemoryFiles = usedMemoryFiles.filter(
    (fileName) => !observedMemoryFiles.has(fileName),
  );

  if (strict && unknownMemoryFiles.length > 0) {
    throw new Error(
      `Agent final payload referenced memory file(s) not loaded or returned this turn: ${unknownMemoryFiles.join(", ")}`,
    );
  }

  if (unknownMemoryFiles.length > 0) {
    logger.warn(
      { usedMemoryFiles: unknownMemoryFiles },
      "Agent final payload referenced unobserved memory file(s).",
    );
  }

  return {
    ...payload,
    usedMemoryFiles: usedMemoryFiles.filter((fileName) => observedMemoryFiles.has(fileName)),
  };
}

function currentTurnMemoryFileNames(toolResults: readonly AgentToolResult[]) {
  const fileNames = new Set<string>();
  for (const result of toolResults) {
    if (result.name === "load_agent_memory_file") {
      for (const fileName of readStringArrayFromPath(result.data, ["loadedMemoryFileNames"])) {
        fileNames.add(fileName);
      }
      for (const fileName of readFileNamesFromArrayPath(result.data, ["files"])) {
        fileNames.add(fileName);
      }
    }
    if (result.name === "search_agent_memory") {
      for (const fileName of readFileNamesFromArrayPath(result.data, ["results"])) {
        fileNames.add(fileName);
      }
    }
  }
  return fileNames;
}

function buildAgentRepairAdapters({
  chatEvidencePolicy,
  hostedMemoryFileNames,
  logger,
  realityCheckRecognition,
  request,
  requireStructuredFinalOutput,
}: {
  chatEvidencePolicy: ReturnType<typeof buildChatEvidencePolicy>;
  hostedMemoryFileNames: ReadonlySet<string>;
  logger: ReturnType<typeof createComponentLogger>;
  realityCheckRecognition: RealityCheckRecognition;
  request: AgentRuntimeRequest;
  requireStructuredFinalOutput: boolean;
}): AgentRepairAdapter[] {
  const parsePolicyFinalPayload = (
    finalText: string,
    toolCalls: readonly AgentToolCallAudit[],
    toolResults: readonly AgentToolResult[],
  ) =>
    applyChatEvidenceFinalPayloadPolicy({
      finalPayload: parseFinalPayloadOrLegacyText(finalText, {
        logger,
        requireStructuredFinalOutput,
        hostedMemoryFileNames,
        toolCalls,
        toolResults,
      }),
      policy: chatEvidencePolicy,
      request,
      toolCalls,
      toolResults,
    });

  return [
    {
      name: "initial-itinerary-plan",
      createRepair: ({ toolCalls, toolResults }) => {
        const repairCall = missingInitialItineraryPlanRepairCall(request, toolCalls, toolResults);
        if (!repairCall) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: [repairCall],
          payloadKey: "validationRepairItineraryPlan",
          payload: ([output]) => (output ? repairToolOutputPayload(output) : undefined),
          instruction:
            "Validation repair: you attempted a final itinerary answer before choosing plan_local_itinerary as required. Use this runtime-repaired itinerary artifact as planning evidence, preserve its caveats, and continue with any required follow-up checks before the final traveler-facing answer.",
        };
      },
    },
    {
      name: "condition-judgment",
      createRepair: ({ toolCalls, toolResults }) => {
        if (realityCheckRequiresClarification(realityCheckRecognition)) {
          return undefined;
        }
        const repairCall = missingConditionJudgmentRepairCall(request, toolCalls, toolResults);
        if (!repairCall) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: [repairCall],
          payloadKey: "validationRepairConditionJudgment",
          payload: ([output]) => (output ? repairToolOutputPayload(output) : undefined),
          instruction: conditionJudgmentRepairInstruction(repairCall.arguments),
        };
      },
    },
    {
      name: "required-evidence-tools",
      createRepair: ({ toolCalls, toolResults }) => {
        const repair = buildChatEvidenceRepair({
          policy: chatEvidencePolicy,
          toolCalls,
          toolResults,
        });
        if (!repair) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: repair.functionCalls,
          payloadKey: "automaticRequiredEvidence",
          instruction: repair.instruction,
        };
      },
    },
    {
      name: "browser-location-surf-ranking",
      createRepair: ({ toolCalls, toolResults }) => {
        if (realityCheckRequiresClarification(realityCheckRecognition)) {
          return undefined;
        }
        const repairCall = missingSurfSpotRankingRepairCall(request, toolCalls, toolResults);
        if (!repairCall) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: [repairCall],
          payloadKey: "validationRepairSurfSpotRanking",
          payload: ([output]) => (output ? repairToolOutputPayload(output) : undefined),
          instruction:
            "Validation repair: the user asked for closest surf spots near their shared location. Use this ranked surf-spot output for the nearest list, include approximate km distances, do not infer a named base area from memory alone, and preserve the distance and live-condition caveats.",
        };
      },
    },
    {
      name: "required-itinerary-follow-up-checks",
      createRepair: ({ toolCalls, toolResults }) => {
        const missingRequiredChecks = missingRequiredItineraryChecks(toolResults, toolCalls);
        if (missingRequiredChecks.length === 0) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: missingRequiredChecks,
          payloadKey: "automaticRequiredToolChecks",
          instruction:
            "You attempted a final itinerary answer before required follow-up checks completed. Use these automatically executed safe tool outputs, preserve provider failures as caveats, and write the final traveler-facing answer now.",
        };
      },
    },
    {
      name: "memory-load",
      createRepair: ({ finalText, toolCalls, toolResults }) => {
        if (realityCheckRequiresClarification(realityCheckRecognition)) {
          return undefined;
        }
        const repairCall = missingClearMemoryLoadRepairCall(
          finalText,
          request,
          toolCalls,
          toolResults,
          hostedMemoryFileNames,
        );
        if (!repairCall) {
          return undefined;
        }

        return {
          type: "tool",
          functionCalls: [repairCall],
          payloadKey: "validationRepairMemoryLoad",
          payload: ([output]) => (output ? repairToolOutputPayload(output) : undefined),
          instruction:
            "Validation repair: you attempted a final answer for a topic covered by the loaded INDEX.md before loading the exact memory file. Use this loaded memory file as reference context, keep memory separate from live evidence, and return the final traveler-facing JSON payload now.",
        };
      },
    },
    {
      name: "surf-final-payload",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        if (realityCheckRequiresClarification(realityCheckRecognition)) {
          return undefined;
        }
        const repair = missingSurfSpotRankingPayloadRepair(
          finalText,
          request,
          toolCalls,
          toolResults,
          responseInput,
        );
        if (!repair) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairSurfSpotFinalPayload",
          payload: repair,
          instruction:
            "Validation repair: the user asked for closest surf spots near their shared location, and the ranked surf-spot tool output must shape the public answer. Return final JSON whose answer names the nearest ranked surf spots with approximate km distances, then layer any checked condition warning on top. Include the rank_surf_spots_nearby toolCallId in usedToolCallIds even when the recommendation is to skip surfing today.",
        };
      },
    },
    {
      name: "structured-final-output",
      createRepair: ({ finalText, responseInput }) => {
        if (
          !requireStructuredFinalOutput ||
          parseAgentFinalPayload(finalText) ||
          hasValidationRepairInput(responseInput, "validationRepairStructuredFinalOutput")
        ) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairStructuredFinalOutput",
          payload: { issue: "invalid_or_legacy_final_output" },
          instruction:
            "Validation repair: the previous final answer did not match the required JSON response contract. Preserve its useful traveler-facing content and return one valid final JSON object now. Include answer and every required artifact-selection array, using only observed memory files and completed toolCallIds. Do not call another tool.",
        };
      },
    },
    {
      name: "final-payload-reference-integrity",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        if (
          !requireStructuredFinalOutput ||
          hasValidationRepairInput(responseInput, "validationRepairFinalPayloadReferences")
        ) {
          return undefined;
        }
        const payload = parseAgentFinalPayload(finalText);
        if (!payload) {
          return undefined;
        }

        const knownToolCallIds = new Set(
          toolCalls.flatMap((toolCall) => (toolCall.toolCallId ? [toolCall.toolCallId] : [])),
        );
        const expandedToolCallIds = expandFinalPayloadToolCallIds(
          payload.usedToolCallIds,
          toolCalls,
        );
        const unknownToolCallIds = expandedToolCallIds.filter(
          (toolCallId) => !knownToolCallIds.has(toolCallId),
        );
        const observedMemoryFiles = currentTurnMemoryFileNames(toolResults);
        for (const fileName of hostedMemoryFileNames) {
          observedMemoryFiles.add(fileName);
        }
        const unknownMemoryFiles = uniqueText(payload.usedMemoryFiles).filter(
          (fileName) => !observedMemoryFiles.has(fileName),
        );
        if (unknownToolCallIds.length === 0 && unknownMemoryFiles.length === 0) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairFinalPayloadReferences",
          payload: {
            allowedMemoryFiles: [...observedMemoryFiles].sort(),
            allowedToolCallIds: [...knownToolCallIds].sort(),
            unknownMemoryFiles,
            unknownToolCallIds,
          },
          instruction:
            "Validation repair: the previous final JSON invented or reused memory filenames or toolCallIds that were not observed in this turn. Preserve its useful traveler-facing answer, but return one corrected final JSON object using only the allowed memory filenames and completed toolCallIds supplied here. Use empty arrays when none apply. Do not call another tool and do not invent replacement identifiers.",
        };
      },
    },
    {
      name: "legacy-structured-answer-quality",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        const finalPayload = parsePolicyFinalPayload(finalText, toolCalls, toolResults);
        const repair = missingLegacyStructuredAnswerQualityRepair(
          finalText,
          finalPayload,
          toolCalls,
          responseInput,
          request,
        );
        if (!repair) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairStructuredAnswerQuality",
          payload: repair,
          maxOutputTokens: 1_600,
          instruction:
            "Validation repair: the answer used legacy plain text even though checked evidence is available. Return the final response as JSON matching the response contract. Rewrite the answer as a structured, traveler-facing result with concrete names, area, why it fits, checked details, and a clear first move. Do not ask whether the traveler wants details that are already available.",
        };
      },
    },
    {
      name: "nightlife-memory-baseline",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        const finalPayload = parsePolicyFinalPayload(finalText, toolCalls, toolResults);
        const repair = missingNightlifeMemoryBaselineRepair(
          finalPayload,
          request,
          toolResults,
          responseInput,
        );
        if (!repair) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairNightlifeMemoryBaseline",
          payload: repair,
          instruction:
            "Validation repair: current nightlife event facts did not return usable event-route venues, but NIGHTLIFE.md is loaded and contains a stable baseline route for the matched local weekday. Do not collapse the answer to weather-only advice and do not ask whether the traveler wants the party route. Answer the move first from the memory baseline, then add weather or transport as a modifier. Make clear that the named route is baseline local guidance, not event_checked current evidence. Select no place cards from the skipped or failed Places enrichment.",
        };
      },
    },
    {
      name: "required-evidence-final-payload",
      createRepair: ({ finalText, toolCalls, toolResults }) => {
        const finalPayload = parsePolicyFinalPayload(finalText, toolCalls, toolResults);
        if (
          finalPayloadSatisfiesChatEvidencePolicy(
            chatEvidencePolicy,
            finalPayload,
            toolCalls,
            toolResults,
          )
        ) {
          return undefined;
        }

        return {
          type: "retry",
          instruction:
            "Validation repair: your final payload did not satisfy the required evidence contract. If the required provider check succeeded, use the successful checked tool evidence and select only matching public artifacts. If the required provider check was unavailable, revise to a caveated final JSON answer with no checked/live claims and no place cards or checked source claims from the failed provider output.",
        };
      },
    },
    {
      name: "reality-check-final-payload",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        if (
          !realityCheckRecognition.explicit ||
          !realityCheckRecognition.kind ||
          realityCheckRecognition.missingContext.length > 0 ||
          hasValidationRepairInput(responseInput, "validationRepairRealityCheck")
        ) {
          return undefined;
        }
        const finalPayload = parsePolicyFinalPayload(finalText, toolCalls, toolResults);
        const validation = finalPayload?.realityCheck
          ? validateRealityCheckProposal({
              expectedKind: realityCheckRecognition.kind,
              proposal: finalPayload.realityCheck,
              usedToolCallIds: finalPayload.usedToolCallIds,
              toolCalls,
              toolResults,
            })
          : undefined;
        if (validation?.status === "valid") {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairRealityCheck",
          payload: {
            expectedKind: realityCheckRecognition.kind,
            reason: validation?.reason ?? "missing_reality_check",
          },
          instruction:
            "Validation repair: this is an explicit on-demand reality check, but the final payload omitted or could not support its realityCheck proposal. Return final JSON with a realityCheck object matching the response contract. Reference only completed toolCallIds that also appear in usedToolCallIds. A keep, change, or avoid verdict needs successful source-backed evidence; current plan and surf verdicts need successful current-condition evidence. If the required provider check failed, use needs_confirmation and a concrete safe next action. Do not invent source objects or artifact IDs.",
        };
      },
    },
    {
      name: "structured-answer-quality",
      createRepair: ({ finalText, responseInput, toolCalls, toolResults }) => {
        const finalPayload = parsePolicyFinalPayload(finalText, toolCalls, toolResults);
        const repair = missingStructuredAnswerQualityRepair(
          finalPayload,
          toolCalls,
          responseInput,
          request,
        );
        if (!repair) {
          return undefined;
        }

        return {
          type: "retry",
          payloadKey: "validationRepairStructuredAnswerQuality",
          payload: repair,
          maxOutputTokens: 1_600,
          instruction:
            "Validation repair: the answer is too thin for the evidence already gathered. Rewrite the final JSON answer as a structured, traveler-facing result. For multiple options, use a compact markdown table or tight bullets with concrete names, area, why it fits, relevant checked details, and a clear first move. For a single result, use a concise heading plus the key details and next action. Include prices, phone numbers, map links, opening status, weather/condition details, booking notes, caveats, and artifact selections only when tool output supports them. Do not ask whether the traveler wants details that are already available.",
        };
      },
    },
  ];
}

function realityCheckRequiresClarification(recognition: RealityCheckRecognition) {
  return recognition.explicit && recognition.missingContext.length > 0;
}

function repairToolOutputPayload(output: AgentRepairToolOutput) {
  return {
    toolCallId: output.functionCall.callId,
    name: output.functionCall.name,
    arguments: publicToolArguments(output.functionCall),
    result: JSON.parse(serializeToolOutput(output.result)),
  };
}

function missingInitialItineraryPlanRepairCall(
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
): ParsedFunctionCall | undefined {
  if (hasSuccessfulItineraryPlanArtifact(toolCalls, toolResults)) {
    return undefined;
  }

  const argumentsForPlan = inferRequiredInitialItineraryPlanArguments(request);
  if (!argumentsForPlan) {
    return undefined;
  }

  return {
    callId: "auto_required_itinerary_plan_1",
    name: "plan_local_itinerary",
    arguments: argumentsForPlan,
  };
}

function missingConditionJudgmentRepairCall(
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
): ParsedFunctionCall | undefined {
  const argumentsForCondition = inferRequiredConditionJudgmentArguments(request);
  if (!argumentsForCondition) {
    return undefined;
  }
  if (hasCompletedConditionJudgment(toolCalls, argumentsForCondition)) {
    return undefined;
  }
  if (hasCompletedSpecificVisitConditionJudgment(toolCalls, argumentsForCondition)) {
    return undefined;
  }
  if (hasAdjacentSurfConditionEvidence(toolCalls, argumentsForCondition)) {
    return undefined;
  }
  if (hasSuccessfulConditionJudgment(toolCalls, toolResults, argumentsForCondition)) {
    return undefined;
  }

  return {
    callId: "auto_required_condition_judgment_1",
    name: "get_condition_judgment",
    arguments: argumentsForCondition,
  };
}

function isVehicleRentalLookup(content: string) {
  return (
    /\b(?:where\s+(?:can|should)\s+(?:i|we)\s+)?(?:rent|rental|rentals|hire|hiring)\b/i.test(
      content,
    ) &&
    /\b(?:scooters?|motorbikes?|motor\s*bikes?)\b/i.test(content) &&
    !/\b(?:safe|safety|rain|weather|roads?|flood|conditions?|ride\s+to|drive\s+to)\b/i.test(content)
  );
}

function missingLegacyStructuredAnswerQualityRepair(
  finalText: string,
  finalPayload: AgentFinalPayload | undefined,
  toolCalls: readonly AgentToolCallAudit[],
  responseInput: readonly ResponseInputItem[],
  request: AgentRuntimeRequest,
) {
  if (finalPayload) {
    return undefined;
  }
  if (hasValidationRepairInput(responseInput, "validationRepairStructuredAnswerQuality")) {
    return undefined;
  }
  if (!isVehicleRentalLookup(latestUserContent(request.messages))) {
    return undefined;
  }

  const evidenceToolCallIds = successfulAnswerEvidenceToolCallIds(toolCalls);
  if (evidenceToolCallIds.length === 0) {
    return undefined;
  }
  const answerPunts = puntsOnAvailableEvidence(finalText);
  const vehicleRentalAnswerTooThin = !hasDetailedVehicleRentalAnswer(finalText);
  if (!answerPunts && !vehicleRentalAnswerTooThin) {
    return undefined;
  }

  return {
    issue: answerPunts
      ? "legacy_answer_punts_on_available_evidence"
      : "legacy_vehicle_rental_answer_too_thin",
    evidenceToolCallIds,
    selectedEvidenceToolCallIds: [],
    answerLength: finalText.length,
    hasComparisonTable: hasMarkdownComparisonTable(finalText),
    tableDataRowCount: markdownTableDataRowCount(finalText),
    usedToolCallIds: [],
    displayCardIds: [],
    displayActionIds: [],
    displayItineraryIds: [],
    displayDecisionSummaryIds: [],
  };
}

function missingStructuredAnswerQualityRepair(
  finalPayload: AgentFinalPayload | undefined,
  toolCalls: readonly AgentToolCallAudit[],
  responseInput: readonly ResponseInputItem[],
  request: AgentRuntimeRequest,
) {
  if (!finalPayload) {
    return undefined;
  }
  if (hasValidationRepairInput(responseInput, "validationRepairStructuredAnswerQuality")) {
    return undefined;
  }

  const evidenceToolCallIds = successfulAnswerEvidenceToolCallIds(toolCalls);
  if (evidenceToolCallIds.length === 0) {
    return undefined;
  }
  const evidenceToolCallIdSet = new Set(evidenceToolCallIds);
  const selectedEvidenceToolCallIds = finalPayload.usedToolCallIds.filter((toolCallId) =>
    evidenceToolCallIdSet.has(toolCallId),
  );
  const answerIsStructured = isStructuredPracticalAnswer(finalPayload.answer);
  const answerPunts = puntsOnAvailableEvidence(finalPayload.answer);
  const vehicleRentalAnswerTooThin =
    isVehicleRentalLookup(latestUserContent(request.messages)) &&
    !hasDetailedVehicleRentalAnswer(finalPayload.answer);

  if (
    selectedEvidenceToolCallIds.length > 0 &&
    answerIsStructured &&
    !answerPunts &&
    !vehicleRentalAnswerTooThin
  ) {
    return undefined;
  }

  if (
    selectedEvidenceToolCallIds.length > 0 &&
    answerIsStructured &&
    !answerPunts &&
    vehicleRentalAnswerTooThin
  ) {
    return {
      issue: "vehicle_rental_answer_too_thin",
      evidenceToolCallIds,
      selectedEvidenceToolCallIds,
      answerLength: finalPayload.answer.length,
      hasComparisonTable: hasMarkdownComparisonTable(finalPayload.answer),
      tableDataRowCount: markdownTableDataRowCount(finalPayload.answer),
      usedToolCallIds: finalPayload.usedToolCallIds,
      displayCardIds: finalPayload.displayCardIds,
      displayActionIds: finalPayload.displayActionIds,
      displayItineraryIds: finalPayload.displayItineraryIds,
      displayDecisionSummaryIds: finalPayload.displayDecisionSummaryIds,
    };
  }

  if (selectedEvidenceToolCallIds.length > 0 && answerIsStructured && !answerPunts) {
    return undefined;
  }

  if (selectedEvidenceToolCallIds.length > 0 && !answerPunts) {
    return undefined;
  }

  return {
    issue:
      selectedEvidenceToolCallIds.length === 0
        ? "missing_public_evidence_tool_ids"
        : answerPunts
          ? "answer_punts_on_available_evidence"
          : "structured_answer_quality_too_thin",
    evidenceToolCallIds,
    selectedEvidenceToolCallIds,
    answerLength: finalPayload.answer.length,
    hasComparisonTable: hasMarkdownComparisonTable(finalPayload.answer),
    tableDataRowCount: markdownTableDataRowCount(finalPayload.answer),
    usedToolCallIds: finalPayload.usedToolCallIds,
    displayCardIds: finalPayload.displayCardIds,
    displayActionIds: finalPayload.displayActionIds,
    displayItineraryIds: finalPayload.displayItineraryIds,
    displayDecisionSummaryIds: finalPayload.displayDecisionSummaryIds,
  };
}

function successfulAnswerEvidenceToolCallIds(toolCalls: readonly AgentToolCallAudit[]) {
  return toolCalls.flatMap((toolCall) => {
    if (toolCall.status === "success" && toolCall.toolCallId && isAnswerEvidenceTool(toolCall)) {
      return [toolCall.toolCallId];
    }
    return [];
  });
}

function isAnswerEvidenceTool(toolCall: AgentToolCallAudit) {
  return ![
    "describe_database_schema",
    "describe_source_policy",
    "load_agent_memory_file",
    "rank_surf_spots_nearby",
    "search_agent_memory",
  ].includes(toolCall.name);
}

function sanitizeFinalAnswer(
  answer: string,
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
) {
  if (
    !isVehicleRentalLookup(latestUserContent(request.messages)) ||
    successfulAnswerEvidenceToolCallIds(toolCalls).length === 0
  ) {
    return answer;
  }

  return stripTrailingFollowUpOffer(answer);
}

function stripTrailingFollowUpOffer(answer: string) {
  return answer
    .replace(/\s+If you want,?\s+I can\s+(?:also\s+|next\s+)?[^\n.?!]*(?:[.?!])?\s*$/i, "")
    .replace(/\n+If you want,?\s+I can\s+(?:also\s+|next\s+)?[^\n.?!]*(?:[.?!])?\s*$/i, "")
    .trim();
}

function puntsOnAvailableEvidence(answer: string) {
  return /\b(?:if you(?:'d| would)? like|if you want|ask if you want|want me to|can also (?:pull|narrow|find|compare|get)|can pull|can get|want (?:the )?(?:map links?|phone numbers?|contact details?|opening details?|prices?|rates?|options?|details?))\b/i.test(
    answer,
  );
}

function hasDetailedVehicleRentalAnswer(answer: string) {
  const normalizedAnswer = normalizeSearchText(answer);
  const hasEnoughOptions =
    markdownTableDataRowCount(answer) >= 3 ||
    answer.split("\n").filter((line) => /^\s*(?:[-*]\s+|\d+\.\s+)/.test(line)).length >= 3;

  return (
    hasEnoughOptions &&
    /\b(?:price|rate|₱|php|deposit|passport|helmet|whatsapp|phone|contact|delivery|pickup|open|hours)\b/i.test(
      answer,
    ) &&
    /\b(?:my pick|first move|best next move|start with)\b/i.test(normalizedAnswer)
  );
}

function isStructuredPracticalAnswer(answer: string) {
  return (
    hasMarkdownComparisonTable(answer) ||
    answer.split("\n").filter((line) => /^\s*(?:[-*]\s+|\d+\.\s+)/.test(line)).length >= 3
  );
}

function hasMarkdownComparisonTable(answer: string) {
  return /^\s*\|.+\|\s*$/m.test(answer) && /\|\s*-{3,}/.test(answer);
}

function markdownTableDataRowCount(answer: string) {
  const lines = answer.split("\n").map((line) => line.trim());
  const separatorIndex = lines.findIndex(isMarkdownTableSeparatorLine);
  if (separatorIndex < 1) {
    return 0;
  }

  let count = 0;
  for (const line of lines.slice(separatorIndex + 1)) {
    if (!/^\|.*\|$/.test(line)) {
      break;
    }
    count += 1;
  }
  return count;
}

function isMarkdownTableSeparatorLine(line: string) {
  const cells = line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function missingSurfSpotRankingRepairCall(
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
): ParsedFunctionCall | undefined {
  if (!needsBrowserLocationSurfSpotRanking(request)) {
    return undefined;
  }
  if (hasSuccessfulToolCall(toolCalls, toolResults, "rank_surf_spots_nearby")) {
    return undefined;
  }

  return {
    callId: "auto_required_surf_spots_nearby_1",
    name: "rank_surf_spots_nearby",
    arguments: {
      skill_level: inferSurfSkillLevel(latestUserContent(request.messages)),
      max_results: 7,
      include_boat_access: false,
    },
  };
}

function missingClearMemoryLoadRepairCall(
  finalText: string,
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
  hostedMemoryFileNames: ReadonlySet<string>,
): ParsedFunctionCall | undefined {
  if (!parseAgentFinalPayload(finalText)) {
    return undefined;
  }
  const requiredFileName = clearRequiredMemoryFileName(request);
  if (!requiredFileName) {
    return undefined;
  }
  const observedMemoryFiles = currentTurnMemoryFileNames(toolResults);
  for (const fileName of hostedMemoryFileNames) {
    observedMemoryFiles.add(fileName);
  }
  if (observedMemoryFiles.has(requiredFileName)) {
    return undefined;
  }
  if (hasMemoryLoadAttemptForFile(toolCalls, requiredFileName)) {
    return undefined;
  }

  return {
    callId: `auto_required_memory_load_${memoryRepairId(requiredFileName)}`,
    name: "load_agent_memory_file",
    arguments: { documents: [requiredFileName] },
  };
}

function initialNightlifeMemoryLoadCall(
  request: AgentRuntimeRequest,
): ParsedFunctionCall | undefined {
  const requiredFileName = clearRequiredMemoryFileName(request);
  if (requiredFileName !== "NIGHTLIFE.md") {
    return undefined;
  }

  return {
    callId: `auto_required_memory_load_${memoryRepairId(requiredFileName)}`,
    name: "load_agent_memory_file",
    arguments: { documents: [requiredFileName] },
  };
}

function missingSurfSpotRankingPayloadRepair(
  finalText: string,
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
  responseInput: readonly ResponseInputItem[],
) {
  if (!needsBrowserLocationSurfSpotRanking(request)) {
    return undefined;
  }
  if (hasValidationRepairInput(responseInput, "validationRepairSurfSpotFinalPayload")) {
    return undefined;
  }

  const finalPayload = parseAgentFinalPayload(finalText);
  if (!finalPayload) {
    return undefined;
  }

  const rankedOutput = successfulSurfSpotRankingOutput(toolCalls, toolResults);
  if (!rankedOutput) {
    return undefined;
  }

  const rankedSpotNames = surfSpotRankingSpotNames(rankedOutput.result);
  const answerMentionsRankedSpot =
    rankedSpotNames.length > 0 &&
    rankedSpotNames.some((spotName) => normalizedIncludes(finalPayload.answer, spotName));
  const usedRankingToolCall = finalPayload.usedToolCallIds.includes(rankedOutput.toolCallId);
  if (answerMentionsRankedSpot && usedRankingToolCall) {
    return undefined;
  }

  return {
    toolCallId: rankedOutput.toolCallId,
    name: "rank_surf_spots_nearby",
    result: JSON.parse(serializeToolOutput(rankedOutput.result)),
    issues: {
      answerMissingRankedSpots: !answerMentionsRankedSpot,
      usedToolCallIdsMissingRanking: !usedRankingToolCall,
    },
  };
}

function missingNightlifeMemoryBaselineRepair(
  finalPayload: AgentFinalPayload | undefined,
  request: AgentRuntimeRequest,
  toolResults: readonly AgentToolResult[],
  responseInput: readonly ResponseInputItem[],
) {
  if (!finalPayload || !requiresNightlifeMemoryBaseline(request)) {
    return undefined;
  }
  if (hasValidationRepairInput(responseInput, "validationRepairNightlifeMemoryBaseline")) {
    return undefined;
  }

  const noEventFacts = noCurrentNightlifeEventFactsResult(toolResults);
  if (!noEventFacts) {
    return undefined;
  }
  const dayOfWeek = readString(
    isRecord(noEventFacts.data) ? noEventFacts.data.dayOfWeek : undefined,
  );
  if (!dayOfWeek) {
    return undefined;
  }
  const baselineVenueNames = nightlifeMemoryBaselineVenueNames(toolResults, dayOfWeek);
  if (baselineVenueNames.length === 0) {
    return undefined;
  }

  const mentionedVenueNames = baselineVenueNames.filter((venueName) =>
    normalizedIncludes(finalPayload.answer, venueName),
  );
  if (mentionedVenueNames.length >= Math.min(2, baselineVenueNames.length)) {
    return undefined;
  }

  return {
    dayOfWeek,
    baselineVenueNames,
    mentionedVenueNames,
    noCurrentEventFactsToolCallId: noEventFacts.toolCallId,
    issue: "nightlife_answer_omitted_loaded_memory_baseline_route",
  };
}

function requiresNightlifeMemoryBaseline(request: AgentRuntimeRequest) {
  return clearRequiredMemoryFileName(request) === "NIGHTLIFE.md";
}

function noCurrentNightlifeEventFactsResult(toolResults: readonly AgentToolResult[]) {
  return toolResults.find(
    (result) =>
      result.name === "search_nightlife_events" &&
      result.status === "success" &&
      (readString(result.data && isRecord(result.data) ? result.data.status : undefined) ===
        "no_events" ||
        result.sources.some((source) => source.label === "no_current_event_facts")),
  );
}

function nightlifeMemoryBaselineVenueNames(
  toolResults: readonly AgentToolResult[],
  dayOfWeek: string,
) {
  const memoryContent = loadedMemoryFileContent(toolResults, "NIGHTLIFE.md");
  if (!memoryContent) {
    return [];
  }
  const weeklyRow = memoryContent
    .split("\n")
    .find((line) => line.trimStart().startsWith(`| ${dayOfWeek} |`));
  if (!weeklyRow) {
    return [];
  }
  const columns = weeklyRow.split("|").map((column) => column.trim());
  const anchorCandidates = columns[4] ?? "";
  return uniqueText(
    anchorCandidates
      .split(/,|\//u)
      .map((value) => value.replaceAll("`", "").trim())
      .filter((value) => value.length > 0)
      .filter((value) => !/\b(?:late|fallback|option|pattern|fun day)\b/iu.test(value)),
  );
}

function loadedMemoryFileContent(toolResults: readonly AgentToolResult[], fileName: string) {
  for (const result of toolResults) {
    if (result.name !== "load_agent_memory_file") {
      continue;
    }
    for (const file of readUnknownArrayPath(result.data, ["files"])) {
      if (isRecord(file) && file.fileName === fileName && typeof file.content === "string") {
        return file.content;
      }
    }
  }
  return undefined;
}

function clearRequiredMemoryFileName(request: AgentRuntimeRequest) {
  const latestUserTurn = latestUserContent(request.messages);
  if (
    /\b(source[-\s]?labels?|source policy|checked|not checked|live evidence|confidence)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "ASK_SIARGAO_SOURCE_POLICY.md";
  }
  if (
    /\b(tool[-\s]?use|use tools?|weather tool|places tool|condition tool|itinerary tool|when .*tools?)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "ASK_SIARGAO_TOOL_USE_POLICY.md";
  }
  if (
    /\b(data dictionary|database|local facts?|safe fields?|query boundaries?|data boundaries?)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "ASK_SIARGAO_DATA_DICTIONARY.md";
  }
  if (
    /\b(?:party|nightlife|bar[-\s]?hopp?ing|bar\s+crawl|dj|live\s*music|foam\s*party|pub\s*quiz|trivia|late[-\s]?night|drinks?\s+tonight|where\s+(?:should|can)\s+(?:we|i)\s+go\s+out)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "NIGHTLIFE.md";
  }
  if (isFoodOrPlaceMemoryExclusion(latestUserTurn)) {
    return undefined;
  }
  if (/\b(surf(?:ing|er|ers|s|ed)?|waves?|surf spots?|breaks?)\b/i.test(latestUserTurn)) {
    return "SURF.md";
  }
  if (
    /\b(beaches?|beach\s+day|sandy|sand|family[-\s]?friendly\s+beach|quiet\s+beach|where\s+(?:can|should)\s+i\s+swim|swim(?:ming)?\s+beach)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "LOCAL_GUIDE_BEACHES.md";
  }
  return undefined;
}

function isFoodOrPlaceMemoryExclusion(content: string) {
  return /\b(food|breakfast|brunch|lunch|dinner|caf[eé]s?|coffee|restaurants?|eat|drinks?|bars?|open(?:[-\s]?now)?|google places?)\b/i.test(
    content,
  );
}

function hasMemoryLoadAttemptForFile(toolCalls: readonly AgentToolCallAudit[], fileName: string) {
  return toolCalls.some((toolCall) => {
    if (toolCall.name !== "load_agent_memory_file") {
      return false;
    }
    return new Set(readStringArrayFromPath(toolCall.arguments, ["documents"])).has(fileName);
  });
}

function hasValidationRepairInput(
  responseInput: readonly ResponseInputItem[],
  key:
    | "validationRepairNightlifeMemoryBaseline"
    | "validationRepairFinalPayloadReferences"
    | "validationRepairRealityCheck"
    | "validationRepairStructuredAnswerQuality"
    | "validationRepairStructuredFinalOutput"
    | "validationRepairSurfSpotFinalPayload",
) {
  return responseInput.some((item) => {
    const content = item.content;
    if (!Array.isArray(content)) {
      return false;
    }
    return content.some((entry) => {
      if (!isRecord(entry) || typeof entry.text !== "string") {
        return false;
      }
      const parsed = parseJsonRecord(entry.text);
      return Boolean(parsed?.[key]);
    });
  });
}

function successfulSurfSpotRankingOutput(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  const audit = toolCalls.find(
    (
      toolCall,
    ): toolCall is AgentToolCallAudit & {
      toolCallId: string;
    } =>
      toolCall.name === "rank_surf_spots_nearby" &&
      toolCall.status === "success" &&
      typeof toolCall.toolCallId === "string" &&
      toolCall.toolCallId.length > 0,
  );
  if (!audit) {
    return undefined;
  }
  const result = toolResults.find(
    (toolResult) =>
      toolResult.name === "rank_surf_spots_nearby" &&
      toolResult.status === "success" &&
      toolResult.toolCallId === audit.toolCallId,
  );
  return result ? { result, toolCallId: audit.toolCallId } : undefined;
}

function surfSpotRankingSpotNames(result: AgentToolResult) {
  const spots = readUnknownArrayPath(result.data, ["spots"]);
  return spots.flatMap((spot) => {
    if (!isRecord(spot)) {
      return [];
    }
    const name = readString(spot.name)?.trim();
    return name ? [name] : [];
  });
}

function normalizedIncludes(value: string, substring: string) {
  return normalizeSearchText(value).includes(normalizeSearchText(substring));
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function memoryRepairId(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/\.md$/u, "")
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "");
}

function needsBrowserLocationSurfSpotRanking(request: AgentRuntimeRequest) {
  if (!usableBrowserGeolocation(request)) {
    return false;
  }
  const latestUserTurn = latestUserContent(request.messages);
  const hasSurfSignal = /\bsurf(?:ing|er|s|ed)?\b/i.test(latestUserTurn);
  const hasNearMeSignal =
    readBooleanPath(request.deterministicSignals, [
      "context",
      "browserGeolocation",
      "useAsProximityAnchor",
    ]) === true || hasDirectBrowserLocationText(latestUserTurn);
  const asksForClosest =
    /\b(?:closest|nearest|nearby|near\s+me|around\s+me|close\s+to\s+me|around\s+here|near\s+here)\b/i.test(
      latestUserTurn,
    );
  return hasSurfSignal && hasNearMeSignal && asksForClosest;
}

function inferSurfSkillLevel(content: string): "beginner" | "intermediate" | "advanced" | "any" {
  if (/\b(beginner|learning|learn|lesson|first[-\s]?timer|newbie)\b/i.test(content)) {
    return "beginner";
  }
  if (/\b(intermediate|longboard|longboarding)\b/i.test(content)) {
    return "intermediate";
  }
  if (/\b(advanced|expert|barrel|barrels|heavy|charging)\b/i.test(content)) {
    return "advanced";
  }
  return "any";
}

function inferRequiredConditionJudgmentArguments(
  request: AgentRuntimeRequest,
): Record<string, unknown> | undefined {
  const userTurns = request.messages.flatMap((message) =>
    message.role === "user" ? [message.content] : [],
  );
  const latestUserTurn = userTurns.at(-1) ?? latestUserContent(request.messages);
  if (latestUserTurn.trim().length === 0) {
    return undefined;
  }
  if (isItineraryReviewRequest(latestUserTurn)) {
    return undefined;
  }
  if (isItineraryPlanningRequest(latestUserTurn) && !hasExplicitConditionQuestion(latestUserTurn)) {
    return undefined;
  }

  const priorUserContext = userTurns.slice(0, -1).join(" ");
  const inheritedPlaceContext = latestTurnHasConditionPlace(latestUserTurn) ? "" : priorUserContext;
  const conditionContext = [latestUserTurn, inheritedPlaceContext].filter(Boolean).join(" ");
  const activity = inferConditionRepairActivity(latestUserTurn, inheritedPlaceContext);
  if (!activity) {
    return undefined;
  }
  const conditionRequest = {
    activity,
    location: inferConditionLocation(
      latestUserTurn,
      inheritedPlaceContext,
      request.deterministicSignals,
    ),
    date_range: inferConditionDateRange(latestUserTurn),
    beach_name:
      inferConditionBeachName(latestUserTurn) ?? inferConditionBeachName(inheritedPlaceContext),
    include_local_caveats: null,
    constraints: inferItineraryConstraints(conditionContext, request.deterministicSignals),
  } satisfies ConditionJudgmentRequest;

  return conditionRequest;
}

function inferRequiredInitialItineraryPlanArguments(
  request: AgentRuntimeRequest,
): Record<string, unknown> | undefined {
  const latestUserTurn = latestUserContent(request.messages);
  const userContext = request.messages
    .flatMap((message) => (message.role === "user" ? [message.content] : []))
    .join(" ");
  if (!isItineraryPlanningRequest(latestUserTurn)) {
    return undefined;
  }

  const theme = inferLocalItineraryTheme(userContext);
  const constraints = inferItineraryConstraints(userContext, request.deterministicSignals);
  const transportMode = inferItineraryTransportMode(userContext, request.deterministicSignals);
  const durationHours = inferItineraryDurationHours(userContext);
  const maxRideMinutes = inferMaxRideMinutes(userContext, request.deterministicSignals);
  const origin = inferItineraryOrigin(userContext, request.deterministicSignals);
  const mealPreference = inferMealPreference(userContext, constraints);

  return {
    theme,
    ...(origin ? { origin } : {}),
    ...(durationHours ? { duration_hours: durationHours } : {}),
    ...(transportMode ? { transport_mode: transportMode } : {}),
    ...(maxRideMinutes ? { max_ride_minutes: maxRideMinutes } : {}),
    ...(needsWeatherCheck(userContext) ? { needs_weather_check: true } : {}),
    ...(needsOpenNowCheck(theme, userContext) ? { needs_open_now: true } : {}),
    ...(mealPreference ? { meal_preference: mealPreference } : {}),
    ...(constraints.length ? { constraints } : {}),
  } satisfies Partial<LocalItineraryRequest>;
}

function isItineraryPlanningRequest(latestUserTurn: string) {
  if (latestUserTurn.trim().length === 0) {
    return false;
  }
  if (isExcludedItineraryRepairRequest(latestUserTurn)) {
    return false;
  }
  const hasActivityPlanSignal =
    /\b(today|tomorrow|this\s+(?:morning|afternoon|evening)|cloud\s*9|general\s+luna|dapa|pacifico|del\s+carmen|sugba|malinao|doot)\b/i.test(
      latestUserTurn,
    );
  const hasInitialThemeLanguage =
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      latestUserTurn,
    );
  const hasScopedDuration =
    /\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(latestUserTurn) ||
    /\bhalf[-\s]?day\b/i.test(latestUserTurn);
  const hasRouteWithStops =
    /\b(?:route|sequence)\b/i.test(latestUserTurn) && /\bstops?\b/i.test(latestUserTurn);
  const hasOpenEndedActivityPlanLanguage =
    /\b(?:what\s+should\s+i\s+do|what\s+can\s+i\s+do|things?\s+to\s+do|activities?|day\s+plan|plan\s+(?:my|a|an|the)\s+day)\b/i.test(
      latestUserTurn,
    );
  const hasScopedItineraryLanguage =
    hasInitialThemeLanguage ||
    (hasScopedDuration &&
      /\b(itinerary|plan|route|sequence|stops?|things?\s+to\s+do|activities?)\b/i.test(
        latestUserTurn,
      )) ||
    hasRouteWithStops;

  return (
    hasInitialThemeLanguage ||
    hasScopedItineraryLanguage ||
    (hasOpenEndedActivityPlanLanguage && hasActivityPlanSignal)
  );
}

function isExcludedItineraryRepairRequest(content: string) {
  if (isItineraryReviewRequest(content)) {
    return true;
  }
  return (
    /\b(airport|flight|ferry|pier|port|transfer|pickup|pick\s+up|drop[-\s]?off|taxi|shuttle|transport|transportation|logistics?)\b/i.test(
      content,
    ) && !hasScopedLocalItineraryContent(content)
  );
}

function isItineraryReviewRequest(content: string) {
  return /\b(critique|review|audit|improve\s+my\s+itinerary|plan\s+my\s+(?:trip|vacation|holiday))\b/i.test(
    content,
  );
}

function hasScopedLocalItineraryContent(content: string) {
  return (
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      content,
    ) ||
    (/\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(content) &&
      /\b(food\s+crawl|crawl|things?\s+to\s+do|activities?|stops?|beaches?|sunset|dinner|lunch|breakfast|brunch|caf[eé]s?|restaurants?|eat)\b/i.test(
        content,
      )) ||
    (/\b(?:route|sequence)\b/i.test(content) && /\bstops?\b/i.test(content))
  );
}

function inferLocalItineraryTheme(content: string): LocalItineraryRequest["theme"] {
  if (/\bfood\s+crawl|crawl\b/i.test(content)) {
    return "food_crawl";
  }
  if (/\brainy|rain(?:ing)?|showers?|storm|covered|indoors?|inside\b/i.test(content)) {
    return "rainy_cloud_9_afternoon";
  }
  if (/\bsunset\b/i.test(content) || /\bdinner\b/i.test(content)) {
    return "sunset_plus_dinner";
  }
  if (/\b(non[-\s]?surfer|not\s+surfing|avoid\s+surf|no\s+surf(?:ing)?)\b/i.test(content)) {
    return "non_surfer_half_day";
  }
  return "sandy_beach_half_day";
}

function inferItineraryConstraints(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  return uniqueText([
    ...readStringArrayPath(deterministicSignals, ["context", "tripContext", "durableConstraints"]),
    ...(/\bkids?|children|child|toddler|family|families\b/i.test(content) ? ["with kids"] : []),
    ...(/\bno\s+scooter|without\s+(?:a\s+)?scooter|avoid\s+scooters?|walk(?:ing)?\s+only\b/i.test(
      content,
    )
      ? ["avoid scooters"]
      : []),
    ...(/\bvegetarian|vegan|plant[-\s]?based|no\s+meat\b/i.test(content) ? ["vegetarian"] : []),
    ...(/\bquiet|calm|low[-\s]?key|not\s+crowded|avoid\s+crowds?|peaceful\b/i.test(content)
      ? ["quiet"]
      : []),
    ...(/\bnon[-\s]?surfer|not\s+surfing|avoid\s+surf|no\s+surf(?:ing)?\b/i.test(content)
      ? ["not surfing"]
      : []),
  ]);
}

function inferItineraryTransportMode(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
): LocalItineraryRequest["transport_mode"] | undefined {
  const signalTransportMode = readStringPath(deterministicSignals, [
    "context",
    "tripContext",
    "transportMode",
  ]);
  if (isItineraryTransportMode(signalTransportMode)) {
    return signalTransportMode;
  }
  if (/\bwalk(?:ing)?|no\s+scooter|without\s+(?:a\s+)?scooter\b/i.test(content)) {
    return "walk";
  }
  if (/\bscooter|motorbike|motor\s*bike\b/i.test(content)) {
    return "scooter";
  }
  if (/\btricycle\b/i.test(content)) {
    return "tricycle";
  }
  if (/\bvan\b/i.test(content)) {
    return "van";
  }
  return undefined;
}

function inferItineraryDurationHours(content: string) {
  const numeric = content.match(/\b([234])[-\s]?(?:hour|hr)s?\b/i)?.[1];
  if (numeric) {
    return Number(numeric);
  }
  if (/\btwo[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 2;
  }
  if (/\bthree[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 3;
  }
  if (/\bfour[-\s]?(?:hour|hr)s?\b/i.test(content)) {
    return 4;
  }
  return undefined;
}

function inferMaxRideMinutes(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  const signalRideLimit = readNumberPath(deterministicSignals, [
    "context",
    "tripContext",
    "rideTimeLimitMinutes",
  ]);
  if (signalRideLimit) {
    return signalRideLimit;
  }
  const rideLimit = content.match(/\b(\d{1,3})[-\s]?(?:minute|min)\b/i)?.[1];
  return rideLimit ? Number(rideLimit) : undefined;
}

function inferItineraryOrigin(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  const signalLocation =
    readStringPath(deterministicSignals, ["context", "locationLabel"]) ??
    readStringPath(deterministicSignals, ["context", "tripContext", "currentArea"]);
  if (signalLocation) {
    return signalLocation;
  }
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bdel\s+carmen|sugba\s+lagoon\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  return undefined;
}

function inferConditionLocation(
  latestContent: string,
  inheritedPlaceContext: string,
  deterministicSignals: Record<string, unknown> | undefined,
): ConditionJudgmentRequest["location"] {
  const latestLocation = inferConditionLocationFromContent(latestContent);
  if (latestLocation) {
    return latestLocation;
  }
  const signalLocation =
    readStringPath(deterministicSignals, ["context", "locationLabel"]) ??
    readStringPath(deterministicSignals, ["context", "tripContext", "currentArea"]);
  if (isConditionLocation(signalLocation)) {
    return signalLocation;
  }
  return inferConditionLocationFromContent(inheritedPlaceContext) ?? "Siargao Island";
}

function inferConditionLocationFromContent(
  content: string,
): ConditionJudgmentRequest["location"] | undefined {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bmalinao|doot|sandy\s+beach|half[-\s]?day\b/i.test(content)) {
    return "General Luna";
  }
  if (/\bdel\s+carmen|sugba\s+lagoon|sugba\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  return undefined;
}

function inferConditionRepairActivity(
  latestContent: string,
  inheritedPlaceContext: string,
): ConditionJudgmentRequest["activity"] | undefined {
  if (hasBoatTripConditionContent(latestContent)) {
    return "boat_trip";
  }
  if (isBareRideBoatFollowUp(latestContent, inheritedPlaceContext)) {
    return "boat_trip";
  }
  if (
    /\bsurf(?:ing|er|s|ed)?|waves?|swell\b/i.test(latestContent) &&
    !/\b(?:not|no|avoid)\s+surf(?:ing)?\b/i.test(latestContent) &&
    /\btoday|tomorrow|conditions?|weather|waves?|swell|safe|can|okay|ok|worth|near\s+me|closest|nearest\b/i.test(
      latestContent,
    )
  ) {
    return "surfing";
  }
  if (
    /\bswim(?:ming)?|kids?\s+swim|beach\s+safety|lifeguard|rip\s+current\b/i.test(latestContent)
  ) {
    return "swimming";
  }
  if (
    /\bscooter|motorbike|motor\s*bike|roads?|ride\b/i.test(latestContent) &&
    !/\brent(?:al|ing)?|hire\b/i.test(latestContent) &&
    /\bsafe|safety|rain|weather|roads?|flood|today|tomorrow|go|ride|drive\b/i.test(latestContent)
  ) {
    return "scooter";
  }
  if (/\bsunset\b/i.test(latestContent)) {
    return "sunset";
  }
  if (
    inferConditionLocationFromContent(latestContent) &&
    (/\bshould\s+(?:i|we)\s+still\b/i.test(latestContent) ||
      /\b(?:worth\s+going|still\s+go|visit|head\s+to|stop\s+by)\b/i.test(latestContent))
  ) {
    return "visit";
  }
  return undefined;
}

function hasExplicitConditionQuestion(content: string) {
  return (
    /\b(?:tell\s+me\s+if|whether|is|are|can|could|should|safe|safety|okay|ok|worth|conditions?)\b/i.test(
      content,
    ) &&
    /\b(?:swim(?:ming)?|surf(?:ing)?|scooter|motorbike|ride|boat|island\s+hopping|sunset|rain|weather|roads?|waves?|swell|marine|beach)\b/i.test(
      content,
    )
  );
}

function inferConditionDateRange(content: string): ConditionJudgmentRequest["date_range"] {
  return /\b(tomorrow|tmrw|next\s+7\s+days?|next\s+seven\s+days?|this\s+week|next\s+week|weekend|later\s+this\s+week|in\s+(?:[2-7]|two|three|four|five|six|seven)\s+days?)\b/i.test(
    content,
  )
    ? "next_7_days"
    : "today";
}

function hasBoatTripConditionContent(content: string) {
  return /\b(boat|island\s+hopping|sugba|lagoon|boat\s+trip|boat\s+ride|marine)\b/i.test(content);
}

function isBareRideBoatFollowUp(latestContent: string, inheritedPlaceContext: string) {
  return (
    /\bride\b/i.test(latestContent) &&
    !/\b(scooter|motorbike|motor\s*bike|drive|road|land\s+tour)\b/i.test(latestContent) &&
    !hasBoatTripConditionContent(latestContent) &&
    hasBoatTripConditionContent(inheritedPlaceContext)
  );
}

function inferConditionBeachName(content: string): string | null {
  const match = /\b(malinao|doot|cloud\s*9|pacifico|alegria|magpupungko|sugba)\b/i.exec(content);
  if (!match?.[1]) {
    return null;
  }
  const normalized = match[1].replaceAll(/\s+/g, " ");
  if (/^cloud\s*9$/i.test(normalized)) {
    return "Cloud 9";
  }
  if (/^sugba$/i.test(normalized)) {
    return "Sugba Lagoon";
  }
  return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1).toLowerCase()} Beach`;
}

function latestTurnHasConditionPlace(content: string) {
  return Boolean(inferConditionLocationFromContent(content) ?? inferConditionBeachName(content));
}

function inferMealPreference(content: string, constraints: readonly string[]) {
  if (/\bseafood\b/i.test(content)) {
    return "seafood";
  }
  if (/\bvegetarian|vegan|plant[-\s]?based|no\s+meat\b/i.test(content)) {
    return "vegetarian-friendly";
  }
  if (constraints.some((constraint) => /\bvegetarian\b/i.test(constraint))) {
    return "vegetarian-friendly";
  }
  return undefined;
}

function needsWeatherCheck(content: string) {
  return /\brainy|rain(?:ing)?|showers?|storm|weather|today|this\s+(?:morning|afternoon|evening)|sunset\b/i.test(
    content,
  );
}

function needsOpenNowCheck(theme: LocalItineraryRequest["theme"], content: string) {
  return (
    theme === "food_crawl" ||
    theme === "sunset_plus_dinner" ||
    (/\btoday|tonight|this\s+(?:morning|afternoon|evening)\b/i.test(content) &&
      itineraryThemeCanUseLivePlaces(theme)) ||
    /\b(food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|drinks?|bars?|open(?:[-\s]?now)?|hours?)\b/i.test(
      content,
    )
  );
}

function itineraryThemeCanUseLivePlaces(theme: LocalItineraryRequest["theme"]) {
  return (
    theme === "rainy_cloud_9_afternoon" ||
    theme === "sandy_beach_half_day" ||
    theme === "non_surfer_half_day"
  );
}

function latestUserContent(messages: readonly AgentRuntimeRequest["messages"][number][]) {
  return messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

function conditionJudgmentRepairInstruction(argumentsForCondition: Record<string, unknown>) {
  const base =
    "Validation repair: you attempted a final condition answer before choosing get_condition_judgment as required. Use this runtime-repaired condition evidence, preserve unchecked road, lifeguard, official-warning, and safety caveats, and write the final traveler-facing answer now. If marine_checked evidence is present, describe it as modelled Open-Meteo Marine sea-level, wave, swell, and current data. If tide_forecast_checked evidence is present, describe it as predicted Tide-Forecast Dapa station page data for development/testing.";
  if (argumentsForCondition.date_range !== "next_7_days") {
    return base;
  }
  return `${base} The repaired evidence uses the next_7_days range; if the user asked about tomorrow or a specific future day, say this is a 7-day proxy rather than a tomorrow-specific forecast judgment.`;
}

function hasSuccessfulItineraryPlanArtifact(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  return (
    toolCalls.some(
      (toolCall) => toolCall.name === "plan_local_itinerary" && toolCall.status === "success",
    ) &&
    toolResults.some(
      (result) =>
        result.name === "plan_local_itinerary" &&
        result.status === "success" &&
        Boolean(result.itineraries?.length),
    )
  );
}

function hasSuccessfulConditionJudgment(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
  requiredArguments: Record<string, unknown>,
) {
  return (
    toolCalls.some(
      (toolCall) =>
        toolCall.name === "get_condition_judgment" &&
        toolCall.status === "success" &&
        conditionJudgmentMatchesRequiredArguments(toolCall.arguments, requiredArguments),
    ) &&
    toolResults.some(
      (result) => result.name === "get_condition_judgment" && result.status === "success",
    )
  );
}

function hasCompletedConditionJudgment(
  toolCalls: readonly AgentToolCallAudit[],
  requiredArguments: Record<string, unknown>,
) {
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === "get_condition_judgment" &&
      conditionJudgmentMatchesRequiredArguments(toolCall.arguments, requiredArguments),
  );
}

function hasCompletedSpecificVisitConditionJudgment(
  toolCalls: readonly AgentToolCallAudit[],
  requiredArguments: Record<string, unknown>,
) {
  return (
    requiredArguments.activity === "visit" &&
    toolCalls.some(
      (toolCall) =>
        toolCall.name === "get_condition_judgment" &&
        toolCall.arguments.activity !== "visit" &&
        toolCall.arguments.date_range === requiredArguments.date_range &&
        toolCall.arguments.location === requiredArguments.location,
    )
  );
}

function hasAdjacentSurfConditionEvidence(
  toolCalls: readonly AgentToolCallAudit[],
  requiredArguments: Record<string, unknown>,
) {
  return (
    requiredArguments.activity === "surfing" &&
    toolCalls.some(
      (toolCall) =>
        toolCall.name === "get_tide_forecast" || toolCall.name === "get_marine_conditions",
    )
  );
}

function hasSuccessfulToolCall(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
  name: string,
) {
  return (
    toolCalls.some((toolCall) => toolCall.name === name && toolCall.status === "success") &&
    toolResults.some((result) => result.name === name && result.status === "success")
  );
}

function conditionJudgmentMatchesRequiredArguments(
  actual: Record<string, unknown>,
  required: Record<string, unknown>,
) {
  return (
    actual.activity === required.activity &&
    actual.date_range === required.date_range &&
    actual.location === required.location &&
    requiredConditionBeachMatches(actual, required) &&
    requiredConditionConstraintsMatch(actual, required) &&
    requiredConditionLocalCaveatIntentMatches(actual, required)
  );
}

function requiredConditionBeachMatches(
  actual: Record<string, unknown>,
  required: Record<string, unknown>,
) {
  return (
    typeof required.beach_name !== "string" ||
    normalizeRequiredConditionText(actual.beach_name) ===
      normalizeRequiredConditionText(required.beach_name)
  );
}

function requiredConditionConstraintsMatch(
  actual: Record<string, unknown>,
  required: Record<string, unknown>,
) {
  const requiredConstraints = readConditionConstraintValues(required.constraints);
  if (requiredConstraints.length === 0) {
    return true;
  }
  const actualConstraints = new Set(
    readConditionConstraintValues(actual.constraints).map(normalizeRequiredConditionText),
  );
  return requiredConstraints
    .map(normalizeRequiredConditionText)
    .every((constraint) => actualConstraints.has(constraint));
}

function requiredConditionLocalCaveatIntentMatches(
  actual: Record<string, unknown>,
  required: Record<string, unknown>,
) {
  if (typeof required.beach_name === "string" && actual.include_local_caveats === false) {
    return false;
  }
  return (
    required.include_local_caveats === null ||
    required.include_local_caveats === undefined ||
    actual.include_local_caveats === required.include_local_caveats
  );
}

function readConditionConstraintValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeRequiredConditionText(value: unknown) {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim().toLowerCase() : "";
}

function missingRequiredItineraryChecks(
  toolResults: readonly AgentToolResult[],
  toolCalls: readonly AgentToolCallAudit[],
): ParsedFunctionCall[] {
  const missing: ParsedFunctionCall[] = [];
  const seen = new Set<string>();

  for (const result of toolResults) {
    const requiredToolChecks = readRequiredToolChecks(result.data);
    if (!requiredToolChecks?.localFacts || requiredToolChecks.localFacts.length === 0) {
      continue;
    }
    for (const localFactsCheck of requiredToolChecks.localFacts) {
      const argumentsForLocalFacts = {
        entityTypes: localFactsCheck.entityTypes,
        text: localFactsCheck.text,
        limit: localFactsCheck.limit,
      };
      const key = requiredCheckKey("query_local_facts", argumentsForLocalFacts);
      if (
        !seen.has(key) &&
        !hasMatchingToolCall(toolCalls, "query_local_facts", argumentsForLocalFacts)
      ) {
        missing.push({
          callId: `auto_required_local_facts_${missing.length + 1}`,
          name: "query_local_facts",
          arguments: argumentsForLocalFacts,
        });
        seen.add(key);
      }
    }
    if (requiredToolChecks.weather) {
      const argumentsForWeather = {
        location: requiredToolChecks.weather.location,
        date_range: requiredToolChecks.weather.date_range,
      };
      const key = requiredCheckKey("get_weather_forecast", argumentsForWeather);
      if (
        !seen.has(key) &&
        !hasMatchingToolCall(toolCalls, "get_weather_forecast", argumentsForWeather)
      ) {
        missing.push({
          callId: `auto_required_weather_${missing.length + 1}`,
          name: "get_weather_forecast",
          arguments: argumentsForWeather,
        });
        seen.add(key);
      }
    }
  }

  if (missing.length > 0) {
    return missing;
  }

  for (const result of toolResults) {
    const requiredToolChecks = readRequiredToolChecks(result.data);
    if (!requiredToolChecks) {
      continue;
    }

    if (requiredToolChecks.weather) {
      const argumentsForWeather = {
        location: requiredToolChecks.weather.location,
        date_range: requiredToolChecks.weather.date_range,
      };
      const key = requiredCheckKey("get_weather_forecast", argumentsForWeather);
      if (
        !seen.has(key) &&
        !hasMatchingToolCall(toolCalls, "get_weather_forecast", argumentsForWeather)
      ) {
        missing.push({
          callId: `auto_required_weather_${missing.length + 1}`,
          name: "get_weather_forecast",
          arguments: argumentsForWeather,
        });
        seen.add(key);
      }
    }

    for (const placesCheck of requiredToolChecks.places) {
      const argumentsForPlaces = {
        query: placesCheck.query,
        center: placesCheck.center,
        radius_meters: placesCheck.radius_meters,
        constraints: placesCheck.constraints,
      };
      const key = requiredCheckKey("search_places", argumentsForPlaces);
      if (!seen.has(key) && !hasMatchingToolCall(toolCalls, "search_places", argumentsForPlaces)) {
        missing.push({
          callId: `auto_required_places_${missing.length + 1}`,
          name: "search_places",
          arguments: argumentsForPlaces,
        });
        seen.add(key);
      }
    }
  }

  return missing;
}

function readRequiredToolChecks(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !isRequiredToolChecks(data.requiredToolChecks)) {
    return undefined;
  }
  return data.requiredToolChecks;
}

function isRequiredToolChecks(value: unknown): value is ItineraryRequiredToolChecks {
  if (!isRecord(value) || !Array.isArray(value.places)) {
    return false;
  }
  if (
    value.weather !== undefined &&
    (!isRecord(value.weather) ||
      value.weather.tool !== "get_weather_forecast" ||
      typeof value.weather.location !== "string" ||
      typeof value.weather.date_range !== "string")
  ) {
    return false;
  }
  if (
    value.localFacts !== undefined &&
    (!Array.isArray(value.localFacts) ||
      !value.localFacts.every(
        (check) =>
          isRecord(check) &&
          check.tool === "query_local_facts" &&
          Array.isArray(check.entityTypes) &&
          check.entityTypes.includes("area") &&
          check.entityTypes.includes("route") &&
          typeof check.text === "string" &&
          typeof check.limit === "number",
      ))
  ) {
    return false;
  }
  return value.places.every(
    (check) =>
      isRecord(check) &&
      check.tool === "search_places" &&
      typeof check.query === "string" &&
      isRecord(check.center) &&
      typeof check.center.latitude === "number" &&
      typeof check.center.longitude === "number" &&
      typeof check.radius_meters === "number" &&
      isRecord(check.constraints),
  );
}

function hasMatchingToolCall(
  toolCalls: readonly AgentToolCallAudit[],
  name: string,
  requiredArguments: Record<string, unknown>,
) {
  const requiredKey = normalizeRequiredToolArguments(requiredArguments);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === name && normalizeRequiredToolArguments(toolCall.arguments) === requiredKey,
  );
}

function requiredCheckKey(name: string, requiredArguments: Record<string, unknown>) {
  return `${name}:${normalizeRequiredToolArguments(requiredArguments)}`;
}

function normalizeRequiredToolArguments(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => JSON.parse(normalizeRequiredToolArguments(item))));
  }
  if (!isRecord(value)) {
    return JSON.stringify(value ?? null);
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          JSON.parse(normalizeRequiredToolArguments(nestedValue)),
        ]),
    ),
  );
}

async function executeAndAuditToolBatch({
  executeTool,
  functionCalls,
  logger,
  now,
  requiredEvidencePlan,
  runtimeRequest,
  requestId,
  toolResults,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  functionCalls: readonly ParsedFunctionCall[];
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  requiredEvidencePlan: RequiredEvidencePlan;
  runtimeRequest: AgentRuntimeRequest;
  requestId: string;
  toolResults: readonly AgentToolResult[];
}): Promise<ExecutedAgentToolOutput[]> {
  const requiredDependencyIndex = firstRequiredDependencyIndex(functionCalls, requiredEvidencePlan);
  if (requiredDependencyIndex >= 0) {
    const dependencyOutput = await executeAndAuditTool({
      executeTool,
      functionCall: functionCalls[requiredDependencyIndex] as ParsedFunctionCall,
      logger,
      now,
      runtimeRequest,
      requestId,
    });
    const remainingOutputs = await executeAndAuditToolBatch({
      executeTool,
      functionCalls: functionCalls.filter((_, index) => index !== requiredDependencyIndex),
      logger,
      now,
      requiredEvidencePlan,
      runtimeRequest,
      requestId,
      toolResults: [...toolResults, dependencyOutput.result],
    });
    return [dependencyOutput, ...remainingOutputs];
  }

  const conditionDependencyPlan = currentConditionDependencyPlan({
    functionCalls,
    runtimeRequest,
    toolResults,
  });
  if (conditionDependencyPlan) {
    const conditionOutputs = await Promise.all(
      conditionDependencyPlan.upstreamCalls.map((functionCall) =>
        executeAndAuditTool({
          executeTool,
          functionCall,
          logger,
          now,
          runtimeRequest,
          requestId,
        }),
      ),
    );
    const remainingOutputs = await executeAndAuditToolBatch({
      executeTool,
      functionCalls: conditionDependencyPlan.downstreamCalls,
      logger,
      now,
      requiredEvidencePlan,
      runtimeRequest,
      requestId,
      toolResults: [...toolResults, ...conditionOutputs.map((output) => output.result)],
    });
    return [...conditionOutputs, ...remainingOutputs];
  }

  const researchIndex = functionCalls.findIndex(
    (functionCall) => functionCall.name === "research_web",
  );
  const hasResearchDependentCalls = functionCalls.some((functionCall) =>
    requiredEvidencePlan.requiredToolCalls.some(
      (requiredCall) =>
        requiredCall.name === functionCall.name && requiredCall.dependsOn?.includes("research_web"),
    ),
  );

  if (researchIndex >= 0 && hasResearchDependentCalls) {
    const researchOutput = await executeAndAuditTool({
      executeTool,
      functionCall: functionCalls[researchIndex] as ParsedFunctionCall,
      logger,
      now,
      runtimeRequest,
      requestId,
    });
    const researchBackedToolResults = [...toolResults, researchOutput.result];
    const remainingFunctionCalls = functionCalls.filter((_, index) => index !== researchIndex);
    if (!researchWebResultIsAvailable(researchOutput.result)) {
      const skippedOutputs = remainingFunctionCalls.map((functionCall) =>
        skippedResearchDependentToolOutput({
          functionCall,
          logger,
          now,
          reason:
            "Skipped dependent enrichment because required public web research did not return usable evidence.",
        }),
      );
      return [researchOutput, ...skippedOutputs];
    }

    const remainingOutputs = await executeAndAuditToolBatch({
      executeTool,
      functionCalls: remainingFunctionCalls,
      logger,
      now,
      requiredEvidencePlan,
      runtimeRequest,
      requestId,
      toolResults: researchBackedToolResults,
    });
    return [researchOutput, ...remainingOutputs];
  }

  const nightlifeEventIndex = functionCalls.findIndex(
    (functionCall) => functionCall.name === "search_nightlife_events",
  );
  const hasPlacesEnrichment = functionCalls.some(
    (functionCall) => functionCall.name === "search_places",
  );

  if (nightlifeEventIndex >= 0 && hasPlacesEnrichment) {
    const nightlifeEventOutput = await executeAndAuditTool({
      executeTool,
      functionCall: functionCalls[nightlifeEventIndex] as ParsedFunctionCall,
      logger,
      now,
      runtimeRequest,
      requestId,
    });
    const eventBackedToolResults = [...toolResults, nightlifeEventOutput.result];
    const remainingFunctionCalls: AgentFunctionCallExecutionPlan[] = [];
    for (const [index, functionCall] of functionCalls.entries()) {
      if (index === nightlifeEventIndex) {
        continue;
      }
      remainingFunctionCalls.push(
        evidenceBackedPlacesFunctionCall(
          functionCall,
          requiredEvidencePlan,
          eventBackedToolResults,
        ),
      );
    }
    const remainingOutputs = await Promise.all(
      remainingFunctionCalls.map((functionCall) =>
        executeOrSkipPlacesTool({
          executeTool,
          functionCall,
          logger,
          now,
          runtimeRequest,
          requestId,
        }),
      ),
    );
    return [nightlifeEventOutput, ...remainingOutputs];
  }

  return Promise.all(
    functionCalls.map((functionCall) =>
      executeOrSkipPlacesTool({
        executeTool,
        functionCall: evidenceBackedPlacesFunctionCall(
          functionCall,
          requiredEvidencePlan,
          toolResults,
        ),
        logger,
        now,
        runtimeRequest,
        requestId,
      }),
    ),
  );
}

const currentConditionUpstreamToolNames = new Set([
  "get_condition_judgment",
  "get_weather_forecast",
  "get_marine_conditions",
  "get_tide_forecast",
]);

const currentConditionDependentToolNames = new Set([
  "rank_surf_spots_nearby",
  "search_local_guide",
  "search_places",
  "get_place_details",
]);

const disruptionReplacementToolNames = new Set([
  "plan_local_itinerary",
  "search_local_guide",
  "search_places",
  "get_place_details",
  "query_local_facts",
]);

const disruptionUpstreamToolNames = new Set([
  ...currentConditionUpstreamToolNames,
  "query_local_facts",
]);

function currentConditionDependencyPlan(input: {
  functionCalls: readonly ParsedFunctionCall[];
  runtimeRequest: AgentRuntimeRequest;
  toolResults: readonly AgentToolResult[];
}) {
  const recognition = recognizeRuntimeRealityCheck(input.runtimeRequest);
  if (recognition.kind === "disruption_recovery" && recognition.missingContext.length === 0) {
    const upstreamCalls = input.functionCalls.filter((functionCall) =>
      disruptionUpstreamToolNames.has(functionCall.name),
    );
    const hasDependentCall = input.functionCalls.some(
      (functionCall) =>
        disruptionReplacementToolNames.has(functionCall.name) &&
        !disruptionUpstreamToolNames.has(functionCall.name),
    );
    if (upstreamCalls.length > 0 && hasDependentCall) {
      return {
        upstreamCalls,
        downstreamCalls: input.functionCalls.filter(
          (functionCall) => !disruptionUpstreamToolNames.has(functionCall.name),
        ),
      };
    }
  }
  if (
    (recognition.kind !== "immediate_plan" && recognition.kind !== "surf_session") ||
    recognition.missingContext.length > 0 ||
    input.toolResults.some((result) => {
      if (result.status !== "success") {
        return false;
      }
      return recognition.kind === "surf_session"
        ? result.name === "get_condition_judgment"
        : currentConditionUpstreamToolNames.has(result.name);
    })
  ) {
    return undefined;
  }

  const upstreamCalls = input.functionCalls.filter((functionCall) =>
    currentConditionUpstreamToolNames.has(functionCall.name),
  );
  const hasDependentCall = input.functionCalls.some((functionCall) =>
    currentConditionDependentToolNames.has(functionCall.name),
  );
  if (upstreamCalls.length === 0 || !hasDependentCall) {
    return undefined;
  }

  return {
    upstreamCalls,
    downstreamCalls: input.functionCalls.filter(
      (functionCall) => !currentConditionUpstreamToolNames.has(functionCall.name),
    ),
  };
}

function firstRequiredDependencyIndex(
  functionCalls: readonly ParsedFunctionCall[],
  requiredEvidencePlan: RequiredEvidencePlan,
) {
  return functionCalls.findIndex((functionCall) =>
    functionCalls.some((candidateDependentCall) =>
      requiredEvidencePlan.requiredToolCalls.some(
        (requiredCall) =>
          requiredCall.name === candidateDependentCall.name &&
          requiredCall.dependsOn?.includes(functionCall.name) === true,
      ),
    ),
  );
}

function researchWebResultIsAvailable(result: AgentToolResult) {
  return (
    result.name === "research_web" &&
    result.status === "success" &&
    isRecord(result.data) &&
    result.data.status === "available"
  );
}

type AgentFunctionCallExecutionPlan =
  | {
      kind: "execute";
      functionCall: ParsedFunctionCall;
    }
  | {
      kind: "skip_places_enrichment";
      functionCall: ParsedFunctionCall;
      reason: string;
      sourceName: string;
      notChecked: readonly string[];
    };

type ExecutedAgentToolOutput = {
  audit: AgentToolCallAudit;
  functionCall: ParsedFunctionCall;
  result: AgentToolResult;
};

function evidenceBackedPlacesFunctionCall(
  functionCall: ParsedFunctionCall,
  requiredEvidencePlan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
): AgentFunctionCallExecutionPlan {
  if (functionCall.name !== "search_places") {
    return { kind: "execute", functionCall };
  }

  const requiredPlacesCall = requiredEvidencePlan.requiredToolCalls.find(
    (requiredCall) => requiredCall.name === "search_places",
  );
  if (!requiredPlacesCall) {
    return { kind: "execute", functionCall };
  }

  const researchEntityNames = selectedResearchEntityNames(toolResults);
  if (
    researchPlacesEnrichmentIsUnavailable(requiredPlacesCall, requiredEvidencePlan, toolResults)
  ) {
    return {
      kind: "skip_places_enrichment",
      functionCall,
      reason:
        "Skipped Google Places enrichment because public web research did not select entities for place-detail lookup.",
      sourceName: "Google Places research-selected entity enrichment",
      notChecked: [
        "venue identity, map links, opening-hour signals, ratings, and review counts for research-selected entities",
      ],
    };
  }
  if (researchEntityNames.length > 0) {
    return entityBackedPlacesFunctionCall(
      functionCall,
      requiredPlacesCall.arguments,
      researchEntityNames,
      "Siargao place details",
    );
  }

  const hasNightlifeEventRequirement = requiredEvidencePlan.requiredToolCalls.some(
    (requiredCall) => requiredCall.name === "search_nightlife_events",
  );
  if (!hasNightlifeEventRequirement) {
    return { kind: "execute", functionCall };
  }

  const venueNames = selectedNightlifeEventVenueNames(toolResults);
  if (
    nightlifePlacesEnrichmentIsUnavailable(requiredPlacesCall, requiredEvidencePlan, toolResults)
  ) {
    return {
      kind: "skip_places_enrichment",
      functionCall,
      reason:
        "Skipped Google Places nightlife enrichment because no selected event-route venues were available.",
      sourceName: "Google Places nightlife venue enrichment",
      notChecked: [
        "venue identity, map links, opening-hour signals, ratings, and review counts for selected event-route venues",
      ],
    };
  }
  if (venueNames.length === 0) {
    return { kind: "execute", functionCall };
  }

  return entityBackedPlacesFunctionCall(
    functionCall,
    requiredPlacesCall.arguments,
    venueNames,
    "General Luna Siargao nightlife venues",
  );
}

function entityBackedPlacesFunctionCall(
  functionCall: ParsedFunctionCall,
  requiredArguments: Record<string, unknown>,
  entityNames: readonly string[],
  querySuffix: string,
): AgentFunctionCallExecutionPlan {
  const requiredConstraints = isRecord(requiredArguments.constraints)
    ? requiredArguments.constraints
    : {};
  return {
    kind: "execute",
    functionCall: {
      ...functionCall,
      arguments: {
        ...requiredArguments,
        ...functionCall.arguments,
        query: `${entityNames.join(" ")} ${querySuffix}`,
        center: isRecord(functionCall.arguments.center)
          ? functionCall.arguments.center
          : requiredArguments.center,
        radius_meters:
          typeof functionCall.arguments.radius_meters === "number"
            ? functionCall.arguments.radius_meters
            : requiredArguments.radius_meters,
        constraints: {
          ...requiredConstraints,
          ...(isRecord(functionCall.arguments.constraints)
            ? functionCall.arguments.constraints
            : {}),
          page_size: Math.min(Math.max(entityNames.length, 1), 8),
        },
      },
    },
  };
}

async function executeOrSkipPlacesTool({
  executeTool,
  functionCall,
  logger,
  now,
  runtimeRequest,
  requestId,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  functionCall: AgentFunctionCallExecutionPlan;
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  runtimeRequest: AgentRuntimeRequest;
  requestId: string;
}) {
  if (functionCall.kind === "execute") {
    return executeAndAuditTool({
      executeTool,
      functionCall: functionCall.functionCall,
      logger,
      now,
      runtimeRequest,
      requestId,
    });
  }

  return skippedPlacesToolOutput({
    functionCall: functionCall.functionCall,
    logger,
    now,
    notChecked: functionCall.notChecked,
    reason: functionCall.reason,
    sourceName: functionCall.sourceName,
  });
}

function skippedPlacesToolOutput({
  functionCall,
  logger,
  notChecked,
  now,
  reason,
  sourceName,
}: {
  functionCall: ParsedFunctionCall;
  logger: ReturnType<typeof createComponentLogger>;
  notChecked: readonly string[];
  now: () => Date;
  reason: string;
  sourceName: string;
}): ExecutedAgentToolOutput {
  const startedAt = now();
  const completedAt = now();
  const result = {
    name: "search_places",
    toolCallId: functionCall.callId,
    status: "error",
    errorCode: "provider_unavailable",
    text: reason,
    sources: [
      {
        label: "provider_unavailable",
        sourceName,
        sourceProfileId: "source_google_places",
        fetchedAt: completedAt.toISOString(),
        confidence: "low",
        checked: [],
        notChecked: [...notChecked],
      },
    ],
  } satisfies AgentToolResult;
  const audit = createAgentToolCallAudit({
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: publicToolArguments(functionCall),
    result,
    startedAt,
    completedAt,
    providerOperation: providerOperationForTool(functionCall.name),
  });

  logger.info(
    {
      toolCallId: functionCall.callId,
      toolName: functionCall.name,
      durationMs: audit.durationMs,
      status: audit.status,
      errorCode: audit.errorCode,
      providerOperation: audit.providerOperation,
      sourceLabels: audit.sources.map((source) => source.label),
      sourceProfileIds: audit.sourceProfileIds,
    },
    "Ask Siargao agent tool call skipped.",
  );

  return { audit, functionCall, result };
}

function skippedResearchDependentToolOutput({
  functionCall,
  logger,
  now,
  reason,
}: {
  functionCall: ParsedFunctionCall;
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  reason: string;
}): ExecutedAgentToolOutput {
  const startedAt = now();
  const completedAt = now();
  const result = {
    name: functionCall.name,
    toolCallId: functionCall.callId,
    status: "error",
    errorCode: "provider_unavailable",
    text: reason,
    sources: [
      {
        label: "provider_unavailable",
        sourceName: `${functionCall.name} dependent enrichment`,
        fetchedAt: completedAt.toISOString(),
        confidence: "low",
        checked: [],
        notChecked: ["dependent enrichment after required public web research"],
      },
    ],
  } satisfies AgentToolResult;
  const audit = createAgentToolCallAudit({
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: publicToolArguments(functionCall),
    result,
    startedAt,
    completedAt,
    providerOperation: providerOperationForTool(functionCall.name),
  });

  logger.info(
    {
      toolCallId: functionCall.callId,
      toolName: functionCall.name,
      durationMs: audit.durationMs,
      status: audit.status,
      errorCode: audit.errorCode,
      providerOperation: audit.providerOperation,
      sourceLabels: audit.sources.map((source) => source.label),
      sourceProfileIds: audit.sourceProfileIds,
    },
    "Ask Siargao agent dependent tool call skipped after terminal web research.",
  );

  return { audit, functionCall, result };
}

async function executeAndAuditTool({
  executeTool,
  functionCall,
  logger,
  now,
  runtimeRequest,
  requestId,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  functionCall: ParsedFunctionCall;
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  runtimeRequest: AgentRuntimeRequest;
  requestId: string;
}): Promise<ExecutedAgentToolOutput> {
  const executableFunctionCall = applyRuntimeToolContext(functionCall, runtimeRequest);
  const startedAt = now();
  const result = await executeTool({
    requestId,
    toolCallId: executableFunctionCall.callId,
    name: executableFunctionCall.name,
    arguments: executableFunctionCall.arguments,
    ...(executableFunctionCall.toolContext
      ? { toolContext: executableFunctionCall.toolContext }
      : {}),
  });
  const resultWithToolCallId = {
    ...result,
    toolCallId: result.toolCallId ?? executableFunctionCall.callId,
  };
  const completedAt = now();
  const audit = createAgentToolCallAudit({
    toolCallId: executableFunctionCall.callId,
    name: executableFunctionCall.name,
    arguments: publicToolArguments(executableFunctionCall),
    result: resultWithToolCallId,
    startedAt,
    completedAt,
    providerOperation: providerOperationForTool(executableFunctionCall.name),
  });

  logger.info(
    {
      toolCallId: executableFunctionCall.callId,
      toolName: executableFunctionCall.name,
      durationMs: audit.durationMs,
      status: audit.status,
      errorCode: audit.errorCode,
      providerOperation: audit.providerOperation,
      sourceLabels: audit.sources.map((source) => source.label),
      sourceProfileIds: audit.sourceProfileIds,
      ...(resultWithToolCallId.logData ? { toolDiagnostics: resultWithToolCallId.logData } : {}),
      toolContext: summarizeToolContextForLogs(executableFunctionCall.toolContext),
    },
    "Ask Siargao agent tool call completed.",
  );

  return { audit, functionCall: executableFunctionCall, result: resultWithToolCallId };
}

type ExecutableFunctionCall = ParsedFunctionCall & {
  toolContext?: AgentToolExecutionContext;
};

function applyRuntimeToolContext(
  functionCall: ParsedFunctionCall,
  request: AgentRuntimeRequest,
): ExecutableFunctionCall {
  const repairedFunctionCall = repairItineraryPlanningArguments(functionCall, request);

  if (repairedFunctionCall.name === "rank_surf_spots_nearby") {
    const geolocation = usableBrowserGeolocation(request);
    if (!geolocation) {
      return repairedFunctionCall;
    }

    return {
      ...repairedFunctionCall,
      toolContext: {
        surfSpotRanking: {
          center: {
            latitude: geolocation.latitude,
            longitude: geolocation.longitude,
          },
          centerSource: "browser_geolocation",
          consentScope: geolocation.consentScope,
        },
      },
    };
  }

  if (repairedFunctionCall.name !== "search_places") {
    return repairedFunctionCall;
  }

  const geolocation = usableBrowserGeolocation(request);
  if (!geolocation || !shouldUseBrowserGeolocationForPlaces(repairedFunctionCall, request)) {
    return repairedFunctionCall;
  }

  const center = {
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
  };

  return {
    ...repairedFunctionCall,
    toolContext: {
      googlePlaces: {
        center,
        centerSource: "browser_geolocation",
        cacheMode: "no_store",
        consentScope: geolocation.consentScope,
      },
    },
  };
}

function repairItineraryPlanningArguments(
  functionCall: ParsedFunctionCall,
  request: AgentRuntimeRequest,
): ParsedFunctionCall {
  if (functionCall.name !== "plan_local_itinerary") {
    return functionCall;
  }

  const latestUserTurn = latestRuntimeUserTurn(request);
  const userContext = request.messages
    .flatMap((message) => (message.role === "user" ? [message.content] : []))
    .join(" ");
  const theme = readLocalItineraryTheme(functionCall.arguments.theme);
  const repairedArguments: Record<string, unknown> = {
    ...functionCall.arguments,
    ...(needsWeatherCheck(userContext) ? { needs_weather_check: true } : {}),
    ...(theme && needsOpenNowCheck(theme, userContext) ? { needs_open_now: true } : {}),
  };

  if (!repairedArguments.origin && isItineraryPlanningRequest(latestUserTurn)) {
    const origin = inferItineraryOrigin(userContext, request.deterministicSignals);
    if (origin) {
      repairedArguments.origin = origin;
    }
  }

  return {
    ...functionCall,
    arguments: repairedArguments,
  };
}

function readLocalItineraryTheme(value: unknown): LocalItineraryRequest["theme"] | undefined {
  return typeof value === "string" && isLocalItineraryTheme(value) ? value : undefined;
}

function isLocalItineraryTheme(value: string): value is LocalItineraryRequest["theme"] {
  return (
    value === "rainy_cloud_9_afternoon" ||
    value === "sunset_plus_dinner" ||
    value === "sandy_beach_half_day" ||
    value === "food_crawl" ||
    value === "non_surfer_half_day" ||
    value === "itinerary_review"
  );
}

function usableBrowserGeolocation(
  request: AgentRuntimeRequest,
): (ChatClientGeolocationContext & { latitude: number; longitude: number }) | undefined {
  const geolocation = request.clientContext?.geolocation;
  if (
    geolocation?.status === "available" &&
    geolocation.source === "browser_geolocation" &&
    typeof geolocation.latitude === "number" &&
    typeof geolocation.longitude === "number"
  ) {
    return geolocation as ChatClientGeolocationContext & { latitude: number; longitude: number };
  }
  return undefined;
}

function shouldUseBrowserGeolocationForPlaces(
  functionCall: ParsedFunctionCall,
  request: AgentRuntimeRequest,
) {
  const query =
    typeof functionCall.arguments.query === "string" ? functionCall.arguments.query : "";
  const latestUserTurn = latestRuntimeUserTurn(request);
  if (
    hasExplicitRelativeLocationAnchor(latestUserTurn) &&
    !hasDirectBrowserLocationText(latestUserTurn)
  ) {
    return false;
  }
  return isNearMeText(query) || isNearMeText(latestUserTurn);
}

function latestRuntimeUserTurn(request: AgentRuntimeRequest) {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function isNearMeText(value: string) {
  if (hasDirectBrowserLocationText(value)) {
    return true;
  }

  return (
    /\b(?:closest|nearest|nearby|close\s+by)\b/i.test(value) &&
    !hasExplicitRelativeLocationAnchor(value)
  );
}

function hasDirectBrowserLocationText(value: string) {
  return /\b(?:near\s+me|around\s+me|close\s+to\s+me|by\s+me|around\s+here|near\s+here|near\s+us|around\s+us|close\s+to\s+us)\b/i.test(
    value,
  );
}

function hasExplicitRelativeLocationAnchor(value: string) {
  return (
    /\b(?:closest|nearest|nearby|close\s+by)\b.{0,80}\b(?:to|from|near|around|by|in|at)\s+(?!me\b|us\b|here\b|my\b|our\b)[A-Za-z0-9]/i.test(
      value,
    ) ||
    /\b(?:nearby|close\s+by)\s+(?!me\b|us\b|here\b|my\b|our\b)(?:[A-Z][A-Za-z0-9'-]*|[A-Za-z]*\d[A-Za-z0-9'-]*)/u.test(
      value,
    )
  );
}

function summarizeToolContextForLogs(toolContext: AgentToolExecutionContext | undefined) {
  if (!toolContext?.googlePlaces && !toolContext?.surfSpotRanking) {
    return undefined;
  }
  return {
    ...(toolContext.googlePlaces
      ? {
          googlePlaces: {
            centerSource: toolContext.googlePlaces.centerSource,
            cacheMode: toolContext.googlePlaces.cacheMode,
            consentScope: toolContext.googlePlaces.consentScope,
          },
        }
      : {}),
    ...(toolContext.surfSpotRanking
      ? {
          surfSpotRanking: {
            centerSource: toolContext.surfSpotRanking.centerSource,
            consentScope: toolContext.surfSpotRanking.consentScope,
          },
        }
      : {}),
  };
}

function extractFunctionCalls(output: unknown): ParsedFunctionCall[] {
  if (!Array.isArray(output)) {
    return [];
  }

  const calls: ParsedFunctionCall[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call" || typeof item.name !== "string") {
      continue;
    }

    calls.push({
      callId: readString(item.call_id) ?? readString(item.id) ?? `call_${calls.length + 1}`,
      name: item.name,
      arguments: parseToolArguments(item.arguments),
    });
  }

  return calls;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeToolOutput(result: AgentToolResult) {
  return JSON.stringify({
    status: result.status,
    text: result.text,
    data: modelFacingToolData(result.data),
    errorCode: result.errorCode,
    sources: result.sources,
  });
}

function modelFacingDeterministicSignals(request: AgentRuntimeRequest) {
  if (!request.deterministicSignals) {
    return undefined;
  }

  const geolocation = request.clientContext?.geolocation;
  if (geolocation?.source !== "browser_geolocation") {
    return request.deterministicSignals;
  }

  return {
    ...request.deterministicSignals,
    clientContext: {
      geolocation: {
        status: geolocation.status,
        source: geolocation.source,
        consentScope: geolocation.consentScope,
        ...(geolocation.status === "available" ? { centerSource: "browser_geolocation" } : {}),
      },
    },
  };
}

function publicToolArguments(functionCall: ExecutableFunctionCall): Record<string, unknown> {
  if (
    functionCall.name === "rank_surf_spots_nearby" &&
    functionCall.toolContext?.surfSpotRanking?.centerSource === "browser_geolocation"
  ) {
    return {
      ...functionCall.arguments,
      center: browserGeolocationCenterReference(),
    };
  }

  if (
    functionCall.name !== "search_places" ||
    functionCall.toolContext?.googlePlaces?.centerSource !== "browser_geolocation"
  ) {
    return functionCall.arguments;
  }

  return {
    ...functionCall.arguments,
    center: browserGeolocationCenterReference(),
  };
}

function modelFacingToolData(data: AgentToolResult["data"]) {
  if (!isRecord(data) || data.centerSource !== "browser_geolocation") {
    return data;
  }

  if (Array.isArray(data.spots)) {
    return {
      ...data,
      center: browserGeolocationCenterReference(),
    };
  }

  const search = isRecord(data.search)
    ? {
        ...data.search,
        center: browserGeolocationCenterReference(),
      }
    : data.search;

  return {
    ...data,
    search,
  };
}

function browserGeolocationCenterReference() {
  return { source: "browser_geolocation" };
}

function collectUpstreamRequestId(requestId: string | undefined, upstreamRequestIds: string[]) {
  if (requestId) {
    upstreamRequestIds.push(requestId);
  }
}

function providerOperationForTool(name: string) {
  switch (name) {
    case "get_weather_forecast":
      return "open_meteo.forecast";
    case "get_marine_conditions":
      return "open_meteo.marine";
    case "get_tide_forecast":
      return "tide_forecast.page";
    case "get_condition_judgment":
      return "condition_judgment";
    case "search_places":
      return "google_places.search";
    case "get_place_details":
      return "google_places.details";
    case "search_local_guide":
      return "local_guide.search";
    case "rank_surf_spots_nearby":
      return "surf_spots.rank_nearby";
    case "plan_local_itinerary":
      return "local_itinerary.plan";
    case "describe_database_schema":
      return "local_data.schema";
    case "query_local_facts":
      return "local_data.query";
    case "get_source_evidence":
      return "local_data.evidence";
    case "describe_source_policy":
      return "source_policy.describe";
    case "load_agent_memory_file":
      return "agent_memory.load_file";
    case "search_agent_memory":
      return "agent_memory.search";
    default:
      return undefined;
  }
}

function sumDurations(toolCalls: readonly AgentToolCallAudit[]) {
  return toolCalls.reduce((total, toolCall) => total + toolCall.durationMs, 0);
}

function repeatedInvalidToolArgumentNames(toolCalls: readonly AgentToolCallAudit[]) {
  const invalidCountsByToolName = new Map<string, number>();
  for (const toolCall of toolCalls) {
    if (toolCall.errorCode !== "invalid_tool_arguments") {
      continue;
    }
    invalidCountsByToolName.set(
      toolCall.name,
      (invalidCountsByToolName.get(toolCall.name) ?? 0) + 1,
    );
  }
  const repeatedToolNames: string[] = [];
  for (const [toolName, count] of invalidCountsByToolName) {
    if (count >= 2) {
      repeatedToolNames.push(toolName);
    }
  }
  return repeatedToolNames;
}

function invalidToolArgumentsFinalAnswerInstruction(toolNames: readonly string[]) {
  const toolList = toolNames.join(", ");
  return [
    `Repeated invalid tool arguments were detected for: ${toolList}.`,
    "Do not call any more tools. Write the final traveler-facing answer now from successful checked tool evidence already in the conversation, loaded Ask Siargao memory, and explicit caveats for anything not checked.",
    "Do not claim public web research succeeded for tools that returned invalid_tool_arguments. If current web evidence is missing, say what was not checked instead of retrying.",
  ].join(" ");
}

function toolBudgetExhaustedFinalAnswerInstruction() {
  return [
    "The tool-call budget is exhausted, so do not call any more tools.",
    "Return the best final traveler-facing answer now using only successful checked evidence already present in the conversation.",
    "Omit claims and public artifacts that require a missing or failed check, and state practical uncertainty only when it matters to the traveler.",
  ].join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseJsonRecord(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return readString(current);
}

function readStringArrayFromPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return readStringArray(current) ?? [];
}

function readFileNamesFromArrayPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  if (!Array.isArray(current)) {
    return [];
  }
  const fileNames: string[] = [];
  for (const item of current) {
    if (!isRecord(item)) {
      continue;
    }
    const fileName = readString(item.fileName);
    if (typeof fileName === "string") {
      fileNames.push(fileName);
    }
  }
  return fileNames;
}

function readNumberPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "number" ? current : undefined;
}

function readBooleanPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "boolean" ? current : undefined;
}

function readStringArrayPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return Array.isArray(current)
    ? current.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readUnknownArrayPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return Array.isArray(current) ? current : [];
}

function isItineraryTransportMode(
  value: string | undefined,
): value is NonNullable<LocalItineraryRequest["transport_mode"]> {
  return value === "walk" || value === "scooter" || value === "tricycle" || value === "van";
}

function isConditionLocation(
  value: string | undefined,
): value is ConditionJudgmentRequest["location"] {
  return (
    value === "Siargao Island" ||
    value === "Cloud 9" ||
    value === "General Luna" ||
    value === "Del Carmen"
  );
}

function uniqueText(values: readonly string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalizedValue = value.replaceAll(/\s+/g, " ").trim();
        return normalizedValue ? [normalizedValue] : [];
      }),
    ),
  ];
}

function buildResponseContract({
  requireStructuredFinalOutput,
}: {
  requireStructuredFinalOutput: boolean;
}) {
  return {
    ...baseResponseContract,
    finalOutput: requireStructuredFinalOutput
      ? "Return the final response as a JSON object with answer, usedMemoryFiles, usedToolCallIds, displayCardIds, displayActionIds, displayItineraryIds, displayDecisionSummaryIds, and optional realityCheck. For an explicit reality-check request with enough context, realityCheck is required and must contain kind, verdict, subject, bestAction, basis, optional fallback/avoid/timing/area, and evidenceToolCallIds. Evidence IDs must be completed calls also listed in usedToolCallIds. Never provide source objects or invent artifact IDs in realityCheck. The answer field is the only traveler-facing prose. Display artifact ID arrays must include only cards, actions, itineraries, or decision summaries that should be shown publicly."
      : "Return the final response as normal traveler-facing Markdown/plain text. Do not wrap the answer in JSON or a code fence. Do not include artifact IDs or internal metadata in the traveler-facing answer.",
  };
}

const baseResponseContract = {
  tone: "practical local travel assistant",
  scope:
    "Answer only Siargao-related travel and local trip-planning questions. Politely decline unrelated questions.",
  sourceUse:
    "Use tool outputs as the only source for live weather, modelled marine conditions, Google Places, curated local guide, and source-policy claims.",
  deterministicSignals:
    "Treat deterministic signals as safe context and scope flags only. The model owns tool choice, query wording, and whether a prompt needs web, Places, weather, condition, memory, or no tools.",
  memoryRetrieval:
    "Use INDEX.md to choose and then load the smallest relevant Ask Siargao memory files with load_agent_memory_file, file_search, or search_agent_memory. Memory retrieval is not live evidence and does not create checked source labels.",
  caveats:
    "Do not mention internal verification gaps or tool boundaries to the traveler. Never say live-check, not checked, unchecked, source caveats, tool, API, evidence, artifact, overclaim, or user constraints preserved. Convert uncertainty into practical advice only when useful, such as keep the stop flexible, avoid exposed rides in heavy rain, or check conditions before swimming.",
  structuredAnswerQuality:
    "For any evidence-backed result returned to the traveler, synthesize the evidence into a structured answer. Use a compact table or tight option list for comparisons and multiple results; use a concise heading plus key details for single-result answers. Include concrete names, area, checked details, tradeoffs, caveats, and a clear next move when available. Do not ask whether the traveler wants details that are already present in tool output.",
  completion:
    "Every in-scope Siargao question must receive the best useful traveler-facing answer available. Never expose validation, repair, tool, or evidence-contract failures and never ask the traveler to retry because an internal response contract failed. If a current provider is unavailable, state only the practical limitation, use governed stable local guidance where relevant, and give a concrete next move.",
};

function buildAskSiargaoBaseInstructions({
  requireStructuredFinalOutput,
}: {
  requireStructuredFinalOutput: boolean;
}) {
  return [
    "You are Ask Siargao, a practical Siargao travel assistant.",
    "Answer the traveler's latest question directly and conversationally.",
    "Stay strictly scoped to Siargao Island, Siargao travel, and local trip-planning topics.",
    "If the latest question is unrelated to Siargao or plausible trip planning, politely decline and invite a Siargao-related question.",
    "Use the loaded INDEX.md to choose the smallest relevant memory files, then call load_agent_memory_file, file_search, or search_agent_memory before answering from Ask Siargao domain knowledge.",
    "You own tool choice and query formulation from the traveler's natural-language prompt. Do not wait for deterministic routing hints.",
    "For local service lookups such as scooter or motorbike rental in General Luna, call search_places with a natural-language service query; add research_web when public operator or directory evidence is useful. Do not substitute web research alone for map/card recommendations unless Google Places is unavailable.",
    "For an accommodation reality check, use Google Places search/details for the named property's identity and returned public details, governed local facts for area and route fit, and current web research only for current public claims such as price or availability. Apply the traveler's kids, budget, transport, quiet-sleep, accommodation, area, and date constraints from conversation and safe trip context.",
    "Separate accommodation conclusions into checked property facts, governed area fit, traveler-supplied constraints, and unknown property qualities. Ratings, generic reviews, area stereotypes, and absence of complaints do not prove recurring noise, flooding, internet or power reliability, room condition, availability, or safety. State those as unknown and advise direct confirmation; use needs_confirmation when an unknown is material to the verdict.",
    "For an itinerary feasibility check, call plan_local_itinerary with theme itinerary_review and a bounded transcription of at most seven traveler-supplied stops. Preserve the original order, day labels, explicit times, areas, transport mode, and constraints. Use its conflict analysis and revised action; do not silently invent missing days, times, reservations, opening hours, or availability.",
    "Treat itinerary travel times as non-live estimates unless a governed route source explicitly supports them. Complete required local route/area and weather checks before dependent Places enrichment. Return one concrete keep/change/avoid decision, the specific conflict, and a workable revised action or fallback.",
    "For an immediate today/tomorrow Reality Check, use the governed condition judgment or other current weather, marine, and tide evidence relevant to the named activity before a decisive verdict. Include when, where, and one practical fallback. Provider failures must remain unavailable or partial rather than checked.",
    "For a surf-session Reality Check, require the surfer's beginner/intermediate/advanced level plus a Siargao spot or area and today/tomorrow timing. Use get_condition_judgment with marine or tide evidence before any dependent surf ranking or place recommendation. Treat SURF.md and local guidance as planning context, not live safety evidence. Never guarantee safe-to-surf conditions; preserve local-coach, rip-current, lifeguard, and exact-break boundaries.",
    "For a disruption-recovery Reality Check, treat cancellation, closure, bad weather, illness, or lost transport only as traveler-reported conversation state. Check the proposed replacement at request time with the relevant condition, local itinerary, local guide, Places, or governed local-fact tools. Complete condition and local-fact checks before dependent replacement recommendations. Return one best replacement plus one bounded fallback or avoid instruction, and use needs_confirmation when current availability or conditions cannot be established.",
    "Never imply that Ask Siargao independently detected, monitored, tracked, or will notify about a disruption. Never claim operator contact, booking, reservation, or guaranteed availability.",
    "For any answer based on tool results, return a structured result rather than a thin paragraph. Use a compact markdown table or tight option list for multiple places, providers, events, routes, beaches, activities, weather windows, or other comparable results. Include practical checked details only when tool output supports them, then state the best first move.",
    "If one provider fails but another provider succeeds, use the successful evidence and caveat only the missing check when it matters.",
    "If deterministic signals say browser geolocation is the proximity anchor, do not say the traveler is near a named area unless user text or a tool result supports that named area.",
    "Do not answer from generic model knowledge when the loaded memory index lists a relevant file. If no loaded memory file covers the topic, say the Ask Siargao memory does not cover it and rely only on governed tools where appropriate.",
    "Use backend tools whenever the answer needs current weather, tide timing, modelled marine conditions, Google Places facts, curated guide facts, safe local database facts, source evidence, or source-label policy.",
    "Every final answer must be written by the AI from loaded memory and tool output; do not copy raw tool output as final prose.",
    requireStructuredFinalOutput
      ? "Return final answers as JSON with keys answer, usedMemoryFiles, usedToolCallIds, displayCardIds, displayActionIds, displayItineraryIds, displayDecisionSummaryIds, and optional realityCheck. For an explicit reality-check request with enough context, include realityCheck with kind, verdict, subject, bestAction, basis, optional fallback/avoid/timing/area, and evidenceToolCallIds. Use only completed toolCallIds also listed in usedToolCallIds; never invent sources or artifact IDs. Include only artifact IDs that should be displayed to the traveler."
      : "Return final answers as normal traveler-facing Markdown/plain text. Do not wrap the final answer in JSON or a code fence, and do not include artifact IDs or internal metadata.",
    "Do not invent live, provider-backed, or curated local facts. Memory retrieval is policy/reference context only, not live evidence.",
    "Do not write standalone source footer lines beginning with 'Checked:' or 'Not checked:'. Do not tell the traveler what was not checked or which internal tool should be used. Let the backend/cards display compact source labels.",
    "Keep answers concise and actionable.",
    "Do not frame Ask Siargao as a trip risk audit or paid report in chat answers.",
  ].join("\n");
}

function buildAskSiargaoAgentInstructions(
  memorySnapshot: AgentMemorySnapshot,
  {
    requireStructuredFinalOutput,
  }: {
    requireStructuredFinalOutput: boolean;
  },
) {
  return [
    buildAskSiargaoBaseInstructions({ requireStructuredFinalOutput }),
    renderAvailableAgentMemory(memorySnapshot),
    "The following Ask Siargao memory index is loaded. Use it to decide which detailed files to load dynamically.",
    memorySnapshot.instructionMarkdown,
  ].join("\n\n");
}

function createAgentMemoryMetadata(
  memorySnapshot: AgentMemorySnapshot,
  vectorStoreId: string | undefined,
): AgentMemoryMetadata {
  return {
    versionId: memorySnapshot.versionId,
    files: memorySnapshot.files.map((file) => ({
      id: file.id,
      title: file.title,
      fileName: file.fileName,
      relativePath: file.relativePath,
      role: file.role,
      checksum: file.checksum,
      byteLength: file.byteLength,
    })),
    ...(vectorStoreId ? { vectorStoreId } : {}),
  };
}

function summarizeMemoryForLogs(memory: AgentMemoryMetadata) {
  return {
    versionId: memory.versionId,
    ...(memory.vectorStoreId ? { vectorStoreId: memory.vectorStoreId } : {}),
    files: memory.files.map((file) => ({
      id: file.id,
      role: file.role,
      checksum: file.checksum,
      byteLength: file.byteLength,
    })),
  };
}

function summarizeMemoryForModel(memory: AgentMemoryMetadata): ModelFacingAgentMemoryMetadata {
  return {
    versionId: memory.versionId,
    files: memory.files.map((file) => ({
      id: file.id,
      role: file.role,
    })),
  };
}
