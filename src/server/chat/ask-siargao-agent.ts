import OpenAI from "openai";

import { type AgentMemorySnapshot, loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import {
  type AgentMemoryMetadata,
  type AgentResponsesClient,
  type AgentRuntimeDependencies,
  type AgentRuntimeRequest,
  type AgentToolCallAudit,
  type AgentToolExecutionRequest,
  type AgentToolResult,
  type AgentTurnResult,
  createAgentToolCallAudit,
  createAgentTurnResult,
  resolveAgentRuntimeRequest,
} from "@/server/chat/agent-runtime";
import {
  type AgentToolDependencies,
  buildAgentResponseTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
import { createComponentLogger } from "@/server/observability/logger";

export type AskSiargaoAgentDependencies = AgentRuntimeDependencies &
  AgentToolDependencies & {
    agentMemoryVectorStoreId?: string;
    forceAgentMemorySearchFallback?: boolean;
    includeAgentMemoryFallbackWithFileSearch?: boolean;
    loadMemorySnapshot?: () => AgentMemorySnapshot;
    now?: () => Date;
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

  let response = await client.responses.create({
    model: resolved.model,
    store: false,
    max_output_tokens: 1_000,
    instructions,
    tools,
    input: JSON.stringify({
      product: "Ask Siargao",
      conversation: resolved.messages.slice(-maxConversationMessages),
      requestMetadata: resolved.metadata,
      deterministicSignals: resolved.deterministicSignals,
      agentMemory: summarizeMemoryForModel(memory),
      responseContract: responseContract,
    }),
  });
  collectUpstreamRequestId(response._request_id, upstreamRequestIds);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const finalText = response.output_text?.trim();
    if (finalText) {
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
      return createAgentTurnResult({
        message: finalText,
        requestId: resolved.requestId,
        model: resolved.model,
        memory,
        upstreamRequestIds,
        toolCalls,
        toolResults,
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
          requestId: resolved.requestId,
        }),
      ),
    );
    toolCalls.push(...toolOutputs.map((output) => output.audit));
    toolResults.push(...toolOutputs.map((output) => output.result));

    response = await client.responses.create({
      model: resolved.model,
      store: false,
      max_output_tokens: 1_000,
      instructions,
      tools,
      previous_response_id: response.id,
      input: toolOutputs.map((output) => ({
        type: "function_call_output",
        call_id: output.functionCall.callId,
        output: serializeToolOutput(output.result),
      })),
    });
    collectUpstreamRequestId(response._request_id, upstreamRequestIds);
  }

  throw new Error("Ask Siargao agent exceeded the maximum turn count.");
}

async function executeAndAuditTool({
  executeTool,
  functionCall,
  logger,
  now,
  requestId,
}: {
  executeTool: (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;
  functionCall: ParsedFunctionCall;
  logger: ReturnType<typeof createComponentLogger>;
  now: () => Date;
  requestId: string;
}) {
  const startedAt = now();
  const result = await executeTool({
    requestId,
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: functionCall.arguments,
  });
  const completedAt = now();
  const audit = createAgentToolCallAudit({
    toolCallId: functionCall.callId,
    name: functionCall.name,
    arguments: functionCall.arguments,
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
    "Ask Siargao agent tool call completed.",
  );

  return { audit, functionCall, result };
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
    data: result.data,
    errorCode: result.errorCode,
    sources: result.sources,
  });
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
    case "search_places":
      return "google_places.search";
    case "get_place_details":
      return "google_places.details";
    case "search_local_guide":
      return "local_guide.search";
    case "describe_database_schema":
      return "local_data.schema";
    case "query_local_facts":
      return "local_data.query";
    case "get_source_evidence":
      return "local_data.evidence";
    case "describe_source_policy":
      return "source_policy.describe";
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

const responseContract = {
  tone: "practical local travel assistant",
  scope:
    "Answer only Siargao-related travel and local trip-planning questions. Politely decline unrelated questions.",
  sourceUse:
    "Use tool outputs as the only source for live weather, Google Places, curated local guide, and source-policy claims.",
  memoryRetrieval:
    "Use file_search or search_agent_memory for durable Ask Siargao policy/reference context. Memory retrieval is not live evidence and does not create checked source labels.",
  caveats:
    "Mention material unchecked fields from tool sources. Do not imply ratings, hours, tides, surf, bookings, availability, safety, or road conditions were checked unless a tool output says so.",
};

const askSiargaoBaseInstructions = [
  "You are Ask Siargao, a practical Siargao travel assistant.",
  "Answer the traveler's latest question directly and conversationally.",
  "Stay strictly scoped to Siargao Island, Siargao travel, and local trip-planning topics.",
  "If the latest question is unrelated to Siargao or plausible trip planning, politely decline and invite a Siargao-related question.",
  "Use the available tools whenever the answer needs current weather, Google Places facts, curated beach/local guide facts, safe local database facts, source evidence, or source-label policy.",
  "Do not invent live, provider-backed, or curated local facts. If a tool fails, explain what could not be checked and still give bounded practical guidance when possible.",
  "Treat Google Places ordering as provider relevance, not an independent quality ranking.",
  "Every Google Places place mentioned from tool output should include its raw Google Maps URL when present.",
  "For weather-sensitive or safety-sensitive plans, mention missing surf, swell, tides, road flooding, closures, and local safety checks when the tool did not check them.",
  "Keep answers concise and actionable.",
  "Do not frame Ask Siargao as a trip risk audit or paid report in chat answers.",
].join("\n");

function buildAskSiargaoAgentInstructions(memorySnapshot: AgentMemorySnapshot) {
  return [
    askSiargaoBaseInstructions,
    "Use the following loaded Ask Siargao agent memory as product behavior instructions.",
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
