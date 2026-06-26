import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

export type AskSiargaoAgentToolName =
  | "get_weather_forecast"
  | "search_places"
  | "get_place_details"
  | "search_local_guide"
  | "describe_source_policy"
  | "search_agent_memory";

export type AgentToolCallStatus = "success" | "error";

export type AgentToolResult = {
  toolCallId?: string;
  name: string;
  status: AgentToolCallStatus;
  text: string;
  data?: Record<string, unknown> | readonly unknown[];
  errorCode?: string;
  sources: readonly AnswerSourceSummary[];
};

export type AgentToolCallAudit = {
  id: string;
  toolCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  status: AgentToolCallStatus;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  resultText?: string;
  errorCode?: string;
  providerOperation?: string;
  sourceProfileIds: readonly string[];
  sources: readonly AnswerSourceSummary[];
};

export type RecommendationCard = {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  href?: string;
  metadata?: Record<string, unknown>;
};

export type ChatAction = {
  id: string;
  label: string;
  type: "link" | "prompt" | "navigation";
  href?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
};

export type AgentMemoryFileMetadata = {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  role: "instruction" | "reference";
  checksum: string;
  byteLength: number;
};

export type AgentMemoryMetadata = {
  versionId: string;
  files: readonly AgentMemoryFileMetadata[];
  vectorStoreId?: string;
};

export type AgentTurnResult = {
  message: string;
  requestId: string;
  upstreamRequestIds?: readonly string[];
  model: string;
  toolCalls: readonly AgentToolCallAudit[];
  sources: readonly AnswerSourceSummary[];
  memory?: AgentMemoryMetadata;
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
};

export type AgentRuntimeRequest = {
  messages: readonly AskSiargaoChatMessage[];
  requestId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  deterministicSignals?: Record<string, unknown>;
};

export type ResolvedAgentRuntimeRequest = AgentRuntimeRequest & {
  requestId: string;
  model: string;
};

export type AgentResponsesCreateResult = {
  id?: string;
  output_text?: string;
  _request_id?: string;
  output?: unknown;
};

export type AgentResponsesClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<AgentResponsesCreateResult>;
  };
};

export type AgentToolExecutionRequest = {
  toolCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  requestId: string;
};

export type AgentToolExecutor = (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;

export type AgentRuntimeDependencies = {
  client?: AgentResponsesClient;
  executeTool?: AgentToolExecutor;
  logger?: Logger;
  memorySnapshot?: AgentMemorySnapshot;
  createRequestId?: () => string;
  model?: string;
  maxToolCalls?: number;
  maxTurns?: number;
};

export function resolveAgentRuntimeRequest(
  request: AgentRuntimeRequest,
  dependencies: Pick<AgentRuntimeDependencies, "createRequestId" | "model"> = {},
): ResolvedAgentRuntimeRequest {
  return {
    ...request,
    requestId: request.requestId ?? dependencies.createRequestId?.() ?? randomUUID(),
    model: request.model ?? dependencies.model ?? process.env.OPENAI_MODEL ?? "gpt-5.5",
  };
}

export function createAgentToolCallAudit({
  auditId,
  arguments: toolArguments,
  completedAt,
  name,
  providerOperation,
  result,
  startedAt,
  toolCallId,
}: {
  auditId?: string;
  toolCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  result: AgentToolResult;
  startedAt: Date;
  completedAt: Date;
  providerOperation?: string;
}): AgentToolCallAudit {
  return {
    id: auditId ?? randomUUID(),
    ...(toolCallId ? { toolCallId } : {}),
    name,
    arguments: toolArguments,
    status: result.status,
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    ...(result.text ? { resultText: result.text } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(providerOperation ? { providerOperation } : {}),
    sourceProfileIds: extractSourceProfileIds(result.sources),
    sources: result.sources,
  };
}

export function createAgentTurnResult({
  actions,
  cards,
  message,
  model,
  memory,
  requestId,
  sources,
  toolCalls = [],
  upstreamRequestIds,
}: {
  message: string;
  requestId: string;
  model: string;
  memory?: AgentMemoryMetadata;
  upstreamRequestIds?: readonly string[];
  toolCalls?: readonly AgentToolCallAudit[];
  sources?: readonly AnswerSourceSummary[];
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
}): AgentTurnResult {
  return {
    message,
    requestId,
    ...(upstreamRequestIds?.length ? { upstreamRequestIds: unique(upstreamRequestIds) } : {}),
    model,
    toolCalls,
    sources: sources ?? aggregateAgentSourceSummaries(toolCalls),
    ...(memory ? { memory } : {}),
    ...(cards?.length ? { cards } : {}),
    ...(actions?.length ? { actions } : {}),
  };
}

export function aggregateAgentSourceSummaries(
  results: readonly { sources: readonly AnswerSourceSummary[] }[],
): AnswerSourceSummary[] {
  const summaries: AnswerSourceSummary[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const summary of result.sources) {
      const key = sourceSummaryKey(summary);
      if (seen.has(key)) {
        continue;
      }
      summaries.push(summary);
      seen.add(key);
    }
  }

  return summaries;
}

function extractSourceProfileIds(sources: readonly AnswerSourceSummary[]) {
  return unique(
    sources.flatMap((source) => (source.sourceProfileId ? [source.sourceProfileId] : [])),
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function sourceSummaryKey(summary: AnswerSourceSummary) {
  return JSON.stringify({
    label: summary.label,
    sourceName: normalizeText(summary.sourceName),
    sourceProfileId: summary.sourceProfileId,
    fetchedAt: summary.fetchedAt,
    confidence: summary.confidence,
    checked: normalizeList(summary.checked),
    notChecked: normalizeList(summary.notChecked),
  });
}

function normalizeList(values: readonly string[]) {
  return values.map(normalizeText).filter(Boolean);
}

function normalizeText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}
