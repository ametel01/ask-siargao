import OpenAI from "openai";
import type { Logger } from "pino";

import {
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
  renderAvailableAgentMemory,
} from "@/server/chat/agent-memory";
import {
  type AgentFinalPayload,
  type AgentMemoryMetadata,
  type AgentResponsesClient,
  type AgentRuntimeDependencies,
  type AgentRuntimeRequest,
  type AgentToolCallAudit,
  type AgentToolExecutionContext,
  type AgentToolExecutionRequest,
  type AgentToolResult,
  type AgentTurnResult,
  type ChatClientGeolocationContext,
  createAgentToolCallAudit,
  createAgentTurnResult,
  resolveAgentRuntimeRequest,
} from "@/server/chat/agent-runtime";
import {
  type AgentToolDependencies,
  buildAgentResponseTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
import { type ConditionJudgmentRequest, conditionActivities } from "@/server/chat/condition-tools";
import type {
  ItineraryRequiredToolChecks,
  LocalItineraryRequest,
} from "@/server/chat/itinerary-tools";
import { createComponentLogger } from "@/server/observability/logger";

export type AskSiargaoAgentDependencies = AgentRuntimeDependencies &
  AgentToolDependencies & {
    agentMemoryVectorStoreId?: string;
    forceAgentMemorySearchFallback?: boolean;
    includeAgentMemoryFallbackWithFileSearch?: boolean;
    loadMemorySnapshot?: () => AgentMemorySnapshot;
    now?: () => Date;
    requireStructuredFinalOutput?: boolean;
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

const defaultMaxToolCalls = 8;
const defaultMaxTurns = 6;
const maxConversationMessages = 10;
const agentLogger = createComponentLogger("chat_agent");

function createOpenAIAgentClient(apiKey = process.env.OPENAI_API_KEY): AgentResponsesClient {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Ask Siargao agent chat.");
  }

  return new OpenAI({ apiKey, timeout: 30_000 }) as AgentResponsesClient;
}

export async function runAskSiargaoAgentTurn(
  request: AgentRuntimeRequest,
  dependencies: AskSiargaoAgentDependencies = {},
): Promise<AgentTurnResult> {
  const resolved = resolveAgentRuntimeRequest(request, dependencies);
  const client = dependencies.client ?? createOpenAIAgentClient();
  const memorySnapshot =
    dependencies.memorySnapshot ?? dependencies.loadMemorySnapshot?.() ?? loadAgentMemorySnapshot();
  const toolDependencies: AgentToolDependencies = { ...dependencies, memorySnapshot };
  const executeTool =
    dependencies.executeTool ??
    ((toolRequest: AgentToolExecutionRequest) => executeAgentTool(toolRequest, toolDependencies));
  const logger = (dependencies.logger ?? agentLogger).child({ requestId: resolved.requestId });
  const upstreamRequestIds: string[] = [];
  const toolCalls: AgentToolCallAudit[] = [];
  const toolResults: AgentToolResult[] = [];
  const hostedMemoryFileNames = new Set<string>();
  const maxToolCalls = dependencies.maxToolCalls ?? defaultMaxToolCalls;
  const maxTurns = dependencies.maxTurns ?? defaultMaxTurns;
  const agentMemoryVectorStoreId =
    dependencies.agentMemoryVectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID;
  const memory = createAgentMemoryMetadata(memorySnapshot, agentMemoryVectorStoreId);
  const instructions = buildAskSiargaoAgentInstructions(memorySnapshot);
  const tools = buildAgentResponseTools(memorySnapshot, {
    vectorStoreId: agentMemoryVectorStoreId,
    forceMemoryFallback: dependencies.forceAgentMemorySearchFallback,
    includeMemoryFallbackWithFileSearch: dependencies.includeAgentMemoryFallbackWithFileSearch,
  });
  const responseInclude = agentMemoryVectorStoreId ? ["file_search_call.results"] : undefined;

  logger.info(
    {
      model: resolved.model,
      messageCount: resolved.messages.length,
      maxToolCalls,
      maxTurns,
      agentMemory: summarizeMemoryForLogs(memory),
    },
    "Ask Siargao agent turn started.",
  );

  let responseInput: ResponseInputItem[] = [
    userInputMessage({
      product: "Ask Siargao",
      conversation: resolved.messages.slice(-maxConversationMessages),
      requestMetadata: resolved.metadata,
      deterministicSignals: modelFacingDeterministicSignals(resolved),
      agentMemory: summarizeMemoryForModel(memory),
      responseContract: responseContract,
    }),
  ];
  let response = await client.responses.create({
    model: resolved.model,
    store: false,
    max_output_tokens: 1_000,
    instructions,
    tools,
    ...(responseInclude ? { include: responseInclude } : {}),
    input: responseInput,
  });
  collectUpstreamRequestId(response._request_id, upstreamRequestIds);
  collectHostedFileSearchMemoryFileNames(response.output, memorySnapshot, hostedMemoryFileNames);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const finalText = response.output_text?.trim();
    if (finalText) {
      const itineraryPlanRepairCall = missingInitialItineraryPlanRepairCall(
        resolved,
        toolCalls,
        toolResults,
      );
      if (itineraryPlanRepairCall) {
        if (toolCalls.length + 1 > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        // Validation repair only: the model should choose plan_local_itinerary first. If it
        // tries final itinerary prose anyway, the runtime repairs the missing contract evidence.
        const automaticPlanOutput = await executeAndAuditTool({
          executeTool,
          functionCall: itineraryPlanRepairCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        });
        toolCalls.push(automaticPlanOutput.audit);
        toolResults.push(automaticPlanOutput.result);

        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            product: "Ask Siargao",
            instruction:
              "Validation repair: you attempted a final itinerary answer before choosing plan_local_itinerary as required. Use this runtime-repaired itinerary artifact as planning evidence, preserve its caveats, and continue with any required follow-up checks before the final traveler-facing answer.",
            validationRepairItineraryPlan: {
              toolCallId: automaticPlanOutput.functionCall.callId,
              name: automaticPlanOutput.functionCall.name,
              arguments: publicToolArguments(automaticPlanOutput.functionCall),
              result: JSON.parse(serializeToolOutput(automaticPlanOutput.result)),
            },
            responseContract,
          }),
        ];
        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(responseInclude ? { include: responseInclude } : {}),
          input: responseInput,
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }

      const conditionJudgmentRepairCall = missingConditionJudgmentRepairCall(
        resolved,
        toolCalls,
        toolResults,
      );
      if (conditionJudgmentRepairCall) {
        if (toolCalls.length + 1 > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        // Validation repair only: the model should choose get_condition_judgment for condition
        // prompts. If it tries final prose anyway, the runtime repairs the missing evidence.
        const automaticConditionOutput = await executeAndAuditTool({
          executeTool,
          functionCall: conditionJudgmentRepairCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        });
        toolCalls.push(automaticConditionOutput.audit);
        toolResults.push(automaticConditionOutput.result);

        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            product: "Ask Siargao",
            instruction: conditionJudgmentRepairInstruction(
              automaticConditionOutput.functionCall.arguments,
            ),
            validationRepairConditionJudgment: {
              toolCallId: automaticConditionOutput.functionCall.callId,
              name: automaticConditionOutput.functionCall.name,
              arguments: publicToolArguments(automaticConditionOutput.functionCall),
              result: JSON.parse(serializeToolOutput(automaticConditionOutput.result)),
            },
            responseContract,
          }),
        ];
        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(responseInclude ? { include: responseInclude } : {}),
          input: responseInput,
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }

      const surfSpotRankingRepairCall = missingSurfSpotRankingRepairCall(
        resolved,
        toolCalls,
        toolResults,
      );
      if (surfSpotRankingRepairCall) {
        if (toolCalls.length + 1 > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        const automaticSurfSpotRankingOutput = await executeAndAuditTool({
          executeTool,
          functionCall: surfSpotRankingRepairCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        });
        toolCalls.push(automaticSurfSpotRankingOutput.audit);
        toolResults.push(automaticSurfSpotRankingOutput.result);

        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            product: "Ask Siargao",
            instruction:
              "Validation repair: the user asked for closest surf spots near their shared location. Use this ranked surf-spot output for the nearest list, include approximate km distances, do not infer a named base area from memory alone, and preserve the distance and live-condition caveats.",
            validationRepairSurfSpotRanking: {
              toolCallId: automaticSurfSpotRankingOutput.functionCall.callId,
              name: automaticSurfSpotRankingOutput.functionCall.name,
              arguments: publicToolArguments(automaticSurfSpotRankingOutput.functionCall),
              result: JSON.parse(serializeToolOutput(automaticSurfSpotRankingOutput.result)),
            },
            responseContract,
          }),
        ];
        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(responseInclude ? { include: responseInclude } : {}),
          input: responseInput,
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }

      const missingRequiredChecks = missingRequiredItineraryChecks(toolResults, toolCalls);
      if (missingRequiredChecks.length > 0) {
        if (toolCalls.length + missingRequiredChecks.length > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        const automaticToolOutputs = await Promise.all(
          missingRequiredChecks.map((functionCall) =>
            executeAndAuditTool({
              executeTool,
              functionCall,
              logger,
              now: dependencies.now ?? (() => new Date()),
              runtimeRequest: resolved,
              requestId: resolved.requestId,
            }),
          ),
        );
        toolCalls.push(...automaticToolOutputs.map((output) => output.audit));
        toolResults.push(...automaticToolOutputs.map((output) => output.result));

        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            product: "Ask Siargao",
            instruction:
              "You attempted a final itinerary answer before required follow-up checks completed. Use these automatically executed safe tool outputs, preserve provider failures as caveats, and write the final traveler-facing answer now.",
            automaticRequiredToolChecks: automaticToolOutputs.map((output) => ({
              toolCallId: output.functionCall.callId,
              name: output.functionCall.name,
              arguments: publicToolArguments(output.functionCall),
              result: JSON.parse(serializeToolOutput(output.result)),
            })),
            responseContract,
          }),
        ];
        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(responseInclude ? { include: responseInclude } : {}),
          input: responseInput,
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }

      const memoryRepairCall = missingClearMemoryLoadRepairCall(
        finalText,
        resolved,
        toolCalls,
        toolResults,
        hostedMemoryFileNames,
      );
      if (memoryRepairCall) {
        if (toolCalls.length + 1 > maxToolCalls) {
          throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
        }

        const automaticMemoryOutput = await executeAndAuditTool({
          executeTool,
          functionCall: memoryRepairCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        });
        toolCalls.push(automaticMemoryOutput.audit);
        toolResults.push(automaticMemoryOutput.result);

        responseInput = [
          ...responseInput,
          ...responseOutputItems(response.output),
          userInputMessage({
            product: "Ask Siargao",
            instruction:
              "Validation repair: you attempted a final answer for a topic covered by the loaded INDEX.md before loading the exact memory file. Use this loaded memory file as reference context, keep memory separate from live evidence, and return the final traveler-facing JSON payload now.",
            validationRepairMemoryLoad: {
              toolCallId: automaticMemoryOutput.functionCall.callId,
              name: automaticMemoryOutput.functionCall.name,
              arguments: publicToolArguments(automaticMemoryOutput.functionCall),
              result: JSON.parse(serializeToolOutput(automaticMemoryOutput.result)),
            },
            responseContract,
          }),
        ];
        response = await client.responses.create({
          model: resolved.model,
          store: false,
          max_output_tokens: 1_000,
          instructions,
          tools,
          ...(responseInclude ? { include: responseInclude } : {}),
          input: responseInput,
        });
        collectUpstreamRequestId(response._request_id, upstreamRequestIds);
        collectHostedFileSearchMemoryFileNames(
          response.output,
          memorySnapshot,
          hostedMemoryFileNames,
        );
        continue;
      }

      logger.info(
        {
          durationMs: sumDurations(toolCalls),
          model: resolved.model,
          toolCallCount: toolCalls.length,
          upstreamRequestCount: upstreamRequestIds.length,
          agentMemoryVersionId: memory.versionId,
        },
        "Ask Siargao agent turn completed.",
      );
      const finalPayload = parseFinalPayloadOrLegacyText(finalText, {
        logger,
        requireStructuredFinalOutput: dependencies.requireStructuredFinalOutput === true,
        hostedMemoryFileNames,
        toolCalls,
        toolResults,
      });
      return createAgentTurnResult({
        message: finalPayload?.answer ?? finalText,
        requestId: resolved.requestId,
        model: resolved.model,
        memory,
        upstreamRequestIds,
        toolCalls,
        toolResults,
        ...(finalPayload ? { finalPayload } : {}),
        artifactSelectionMode:
          dependencies.requireStructuredFinalOutput === true ? "strict" : "compatibility",
      });
    }

    const functionCalls = extractFunctionCalls(response.output);
    if (functionCalls.length === 0) {
      throw new Error("OpenAI response did not include output_text.");
    }

    if (toolCalls.length + functionCalls.length > maxToolCalls) {
      throw new Error("Ask Siargao agent exceeded the maximum tool-call count.");
    }

    const toolOutputs = await Promise.all(
      functionCalls.map((functionCall) =>
        executeAndAuditTool({
          executeTool,
          functionCall,
          logger,
          now: dependencies.now ?? (() => new Date()),
          runtimeRequest: resolved,
          requestId: resolved.requestId,
        }),
      ),
    );
    toolCalls.push(...toolOutputs.map((output) => output.audit));
    toolResults.push(...toolOutputs.map((output) => output.result));

    responseInput = [
      ...responseInput,
      ...responseOutputItems(response.output),
      ...toolOutputs.map((output) => ({
        type: "function_call_output",
        call_id: output.functionCall.callId,
        output: serializeToolOutput(output.result),
      })),
    ];
    response = await client.responses.create({
      model: resolved.model,
      store: false,
      max_output_tokens: 1_000,
      instructions,
      tools,
      ...(responseInclude ? { include: responseInclude } : {}),
      input: responseInput,
    });
    collectUpstreamRequestId(response._request_id, upstreamRequestIds);
    collectHostedFileSearchMemoryFileNames(response.output, memorySnapshot, hostedMemoryFileNames);
  }

  throw new Error("Ask Siargao agent exceeded the maximum turn count.");
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
  if (
    !usedMemoryFiles ||
    !usedToolCallIds ||
    !displayCardIds ||
    !displayActionIds ||
    !displayItineraryIds
  ) {
    return undefined;
  }

  return {
    answer,
    usedMemoryFiles,
    usedToolCallIds,
    displayCardIds,
    displayActionIds,
    displayItineraryIds,
  };
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
  const usedToolCallIds = uniqueText(payload.usedToolCallIds);
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
    displayCardIds: uniqueText(payload.displayCardIds),
    displayActionIds: uniqueText(payload.displayActionIds),
    displayItineraryIds: uniqueText(payload.displayItineraryIds),
  };
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
  if (hasSuccessfulConditionJudgment(toolCalls, toolResults, argumentsForCondition)) {
    return undefined;
  }

  return {
    callId: "auto_required_condition_judgment_1",
    name: "get_condition_judgment",
    arguments: argumentsForCondition,
  };
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
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === "load_agent_memory_file" &&
      readStringArrayFromPath(toolCall.arguments, ["documents"]).includes(fileName),
  );
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
  const hasSurfSignal =
    readStringPath(request.deterministicSignals, ["intent", "conditionActivity"]) === "surfing" ||
    /\bsurf(?:ing|er|s|ed)?\b/i.test(latestUserTurn);
  const hasNearMeSignal =
    readBooleanPath(request.deterministicSignals, ["intent", "nearMeUsesBrowserGeolocation"]) ===
      true || hasDirectBrowserLocationText(latestUserTurn);
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

  const signalActivity = readStringPath(request.deterministicSignals, [
    "intent",
    "conditionActivity",
  ]);
  if (!isConditionActivity(signalActivity)) {
    return undefined;
  }

  const priorUserContext = userTurns.slice(0, -1).join(" ");
  const inheritedPlaceContext = latestTurnHasConditionPlace(latestUserTurn) ? "" : priorUserContext;
  const conditionContext = [latestUserTurn, inheritedPlaceContext].filter(Boolean).join(" ");
  const activity = inferConditionRepairActivity(
    signalActivity,
    latestUserTurn,
    inheritedPlaceContext,
  );
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
  if (!isItineraryPlanningRequest(latestUserTurn, request.deterministicSignals)) {
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
    ...(needsWeatherCheck(userContext, request.deterministicSignals)
      ? { needs_weather_check: true }
      : {}),
    ...(needsOpenNowCheck(theme, userContext) ? { needs_open_now: true } : {}),
    ...(mealPreference ? { meal_preference: mealPreference } : {}),
    ...(constraints.length ? { constraints } : {}),
  } satisfies Partial<LocalItineraryRequest>;
}

function isItineraryPlanningRequest(
  latestUserTurn: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  if (latestUserTurn.trim().length === 0) {
    return false;
  }
  if (isExcludedItineraryRepairRequest(latestUserTurn)) {
    return false;
  }
  const hasActivityPlanSignal =
    readBooleanPath(deterministicSignals, ["intent", "activityPlan"]) === true;
  const hasInitialThemeLanguage =
    /\b(rainy\s+cloud\s*9|sunset\s+(?:plus|and)\s+dinner|dinner\s+(?:after|plus|and)\s+sunset|food\s+crawl|(?:non[-\s]?surfer|not\s+surfing|sandy\s+beach|beach)\s+half[-\s]?day|half[-\s]?day\s+(?:non[-\s]?surfer|not\s+surfing|sandy\s+)?beach)\b/i.test(
      latestUserTurn,
    );
  const hasScopedDuration =
    /\b(?:two|three|four|2|3|4)[-\s]?(?:hour|hr)s?\b/i.test(latestUserTurn) ||
    /\bhalf[-\s]?day\b/i.test(latestUserTurn);
  const hasRouteWithStops =
    /\b(?:route|sequence)\b/i.test(latestUserTurn) && /\bstops?\b/i.test(latestUserTurn);
  const hasScopedItineraryLanguage =
    hasInitialThemeLanguage ||
    (hasScopedDuration &&
      /\b(itinerary|plan|route|sequence|stops?|things?\s+to\s+do|activities?)\b/i.test(
        latestUserTurn,
      )) ||
    hasRouteWithStops;

  return hasInitialThemeLanguage || (hasActivityPlanSignal && hasScopedItineraryLanguage);
}

function isExcludedItineraryRepairRequest(content: string) {
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
    ...readStringArrayPath(deterministicSignals, ["intent", "tripContext", "durableConstraints"]),
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
    "intent",
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
    "intent",
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
    readStringPath(deterministicSignals, ["intent", "locationLabel"]) ??
    readStringPath(deterministicSignals, ["intent", "tripContext", "currentArea"]);
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
    readStringPath(deterministicSignals, ["intent", "locationLabel"]) ??
    readStringPath(deterministicSignals, ["intent", "tripContext", "currentArea"]);
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
  if (/\bdel\s+carmen|sugba\s+lagoon|sugba\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  return undefined;
}

function inferConditionRepairActivity(
  signalActivity: ConditionJudgmentRequest["activity"],
  latestContent: string,
  inheritedPlaceContext: string,
): ConditionJudgmentRequest["activity"] {
  if (signalActivity !== "boat_trip" && hasBoatTripConditionContent(latestContent)) {
    return "boat_trip";
  }
  if (
    signalActivity === "scooter" &&
    isBareRideBoatFollowUp(latestContent, inheritedPlaceContext)
  ) {
    return "boat_trip";
  }
  return signalActivity;
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

function needsWeatherCheck(
  content: string,
  deterministicSignals: Record<string, unknown> | undefined,
) {
  return (
    readBooleanPath(deterministicSignals, ["intent", "weatherSensitive"]) === true ||
    /\brainy|rain(?:ing)?|showers?|storm|weather|today|this\s+(?:morning|afternoon|evening)|sunset\b/i.test(
      content,
    )
  );
}

function needsOpenNowCheck(theme: LocalItineraryRequest["theme"], content: string) {
  return (
    theme === "food_crawl" ||
    theme === "sunset_plus_dinner" ||
    /\b(food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|drinks?|bars?|open(?:[-\s]?now)?|hours?)\b/i.test(
      content,
    )
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
}) {
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
  if (functionCall.name === "rank_surf_spots_nearby") {
    const geolocation = usableBrowserGeolocation(request);
    if (!geolocation) {
      return functionCall;
    }

    return {
      ...functionCall,
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

  if (functionCall.name !== "search_places") {
    return functionCall;
  }

  const geolocation = usableBrowserGeolocation(request);
  if (!geolocation || !shouldUseBrowserGeolocationForPlaces(functionCall, request)) {
    return functionCall;
  }

  const center = {
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
  };

  return {
    ...functionCall,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
  return current
    .flatMap((item) => (isRecord(item) ? [readString(item.fileName)] : []))
    .filter((fileName): fileName is string => typeof fileName === "string");
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

function isItineraryTransportMode(
  value: string | undefined,
): value is NonNullable<LocalItineraryRequest["transport_mode"]> {
  return value === "walk" || value === "scooter" || value === "tricycle" || value === "van";
}

function isConditionActivity(
  value: string | undefined,
): value is ConditionJudgmentRequest["activity"] {
  return conditionActivities.some((activity) => activity === value);
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

const responseContract = {
  tone: "practical local travel assistant",
  scope:
    "Answer only Siargao-related travel and local trip-planning questions. Politely decline unrelated questions.",
  finalOutput:
    "Return the final response as a JSON object with answer, usedMemoryFiles, usedToolCallIds, displayCardIds, displayActionIds, and displayItineraryIds. The answer field is the only traveler-facing prose. Display artifact ID arrays must include only cards, actions, or itineraries that should be shown publicly.",
  sourceUse:
    "Use tool outputs as the only source for live weather, modelled marine conditions, Google Places, curated local guide, and source-policy claims.",
  deterministicSignals:
    "Treat deterministic intent as routing and evidence hints, not as a complete answer plan. Do not collapse multi-need trip questions to a single detected category.",
  memoryRetrieval:
    "Use INDEX.md to choose and then load the smallest relevant Ask Siargao memory files with load_agent_memory_file, file_search, or search_agent_memory. Memory retrieval is not live evidence and does not create checked source labels.",
  caveats:
    "Mention material unchecked fields in natural traveler language. Do not write standalone Checked: or Not checked: source footer lines. Do not imply ratings, hours, tides, surf, marine conditions, bookings, availability, safety, or road conditions were checked unless a tool output says so.",
};

const askSiargaoBaseInstructions = [
  "You are Ask Siargao, a practical Siargao travel assistant.",
  "Answer the traveler's latest question directly and conversationally.",
  "Stay strictly scoped to Siargao Island, Siargao travel, and local trip-planning topics.",
  "If the latest question is unrelated to Siargao or plausible trip planning, politely decline and invite a Siargao-related question.",
  "Use the loaded INDEX.md to choose the smallest relevant memory files, then call load_agent_memory_file, file_search, or search_agent_memory before answering from Ask Siargao domain knowledge.",
  "If deterministic signals say browser geolocation is the proximity anchor, do not say the traveler is near a named area unless user text or a tool result supports that named area.",
  "Do not answer from generic model knowledge when the loaded memory index lists a relevant file. If no loaded memory file covers the topic, say the Ask Siargao memory does not cover it and rely only on governed tools where appropriate.",
  "Use backend tools whenever the answer needs current weather, tide timing, modelled marine conditions, Google Places facts, curated guide facts, safe local database facts, source evidence, or source-label policy.",
  "Every final answer must be written by the AI from loaded memory and tool output; do not copy raw tool output as final prose.",
  "Return final answers as JSON with keys answer, usedMemoryFiles, usedToolCallIds, displayCardIds, displayActionIds, and displayItineraryIds. Include only artifact IDs that should be displayed to the traveler.",
  "Do not invent live, provider-backed, or curated local facts. Memory retrieval is policy/reference context only, not live evidence.",
  "Do not write standalone source footer lines beginning with 'Checked:' or 'Not checked:'. Put caveats into normal prose and let the backend/cards display formal source labels.",
  "Keep answers concise and actionable.",
  "Do not frame Ask Siargao as a trip risk audit or paid report in chat answers.",
].join("\n");

function buildAskSiargaoAgentInstructions(memorySnapshot: AgentMemorySnapshot) {
  return [
    askSiargaoBaseInstructions,
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
