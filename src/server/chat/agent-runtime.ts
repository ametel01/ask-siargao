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
  | "plan_local_itinerary"
  | "describe_database_schema"
  | "query_local_facts"
  | "get_source_evidence"
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
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
  itineraries?: readonly ItineraryPlan[];
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

export type RecommendationCardKind = "place" | "beach";

export type RecommendationCard = {
  id: string;
  kind: RecommendationCardKind;
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: readonly string[];
  caveats: readonly string[];
  sourceLabel: string;
};

export type ChatAction = {
  id: string;
  label: string;
  type?: "link" | "prompt" | "navigation";
  href?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
};

export type ItineraryStopKind = "place" | "beach" | "activity" | "meal" | "transfer";

export type ItineraryStop = {
  title: string;
  kind: ItineraryStopKind;
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: readonly string[];
};

export type ItineraryPlan = {
  title: string;
  durationLabel: string;
  stops: readonly ItineraryStop[];
  fallbackStops: readonly ItineraryStop[];
  skip: readonly string[];
  sources: readonly AnswerSourceSummary[];
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
  itineraries?: readonly ItineraryPlan[];
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

export type AgentArtifactCarrier = {
  sources: readonly AnswerSourceSummary[];
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
  itineraries?: readonly ItineraryPlan[];
};

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
  itineraries,
  message,
  model,
  memory,
  requestId,
  sources,
  toolCalls = [],
  toolResults,
  upstreamRequestIds,
}: {
  message: string;
  requestId: string;
  model: string;
  memory?: AgentMemoryMetadata;
  upstreamRequestIds?: readonly string[];
  toolCalls?: readonly AgentToolCallAudit[];
  toolResults?: readonly AgentArtifactCarrier[];
  sources?: readonly AnswerSourceSummary[];
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
  itineraries?: readonly ItineraryPlan[];
}): AgentTurnResult {
  const sourceCarriers = toolResults ?? toolCalls;
  const artifactCarriers = toolResults ?? [];
  const mergedSources = sources ?? aggregateAgentSourceSummaries(sourceCarriers);
  const mergedCards = dedupeById([
    ...(cards ?? []),
    ...artifactCarriers.flatMap((result) => result.cards ?? []),
  ]);
  const mergedActions = dedupeById([
    ...(actions ?? []),
    ...artifactCarriers.flatMap((result) => result.actions ?? []),
  ]);
  const mergedItineraries = dedupeItineraries([
    ...(itineraries ?? []),
    ...artifactCarriers.flatMap((result) => result.itineraries ?? []),
  ]).map((itinerary) => reconcileItinerarySources(itinerary, mergedSources));

  return {
    message,
    requestId,
    ...(upstreamRequestIds?.length ? { upstreamRequestIds: unique(upstreamRequestIds) } : {}),
    model,
    toolCalls,
    sources: mergedSources,
    ...(memory ? { memory } : {}),
    ...(mergedCards.length ? { cards: mergedCards } : {}),
    ...(mergedActions.length ? { actions: mergedActions } : {}),
    ...(mergedItineraries.length ? { itineraries: mergedItineraries } : {}),
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

function reconcileItinerarySources(
  itinerary: ItineraryPlan,
  aggregateSources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const hasWeatherCheck = aggregateSources.some((source) => source.label === "weather_checked");
  const hasPlacesCheck = aggregateSources.some(
    (source) => source.label === "live_checked" || source.label === "fresh_cache",
  );
  const reconciledSources = itinerary.sources
    .map((source) => reconcileNotCheckedSource(source, { hasPlacesCheck, hasWeatherCheck }))
    .filter((source) => source.checked.length > 0 || source.notChecked.length > 0);
  const reconciledAggregateSources = aggregateSources
    .map((source) => reconcileNotCheckedSource(source, { hasPlacesCheck, hasWeatherCheck }))
    .filter((source) => source.checked.length > 0 || source.notChecked.length > 0);
  const addedSources = reconciledAggregateSources.filter(
    (source) =>
      !reconciledSources.some(
        (existingSource) => sourceSummaryKey(existingSource) === sourceSummaryKey(source),
      ),
  );

  return {
    ...itinerary,
    sources: [...reconciledSources, ...addedSources],
  };
}

function reconcileNotCheckedSource(
  source: AnswerSourceSummary,
  {
    hasPlacesCheck,
    hasWeatherCheck,
  }: {
    hasPlacesCheck: boolean;
    hasWeatherCheck: boolean;
  },
): AnswerSourceSummary {
  if (source.label !== "not_verified") {
    return source;
  }

  return {
    ...source,
    notChecked: source.notChecked.filter(
      (item) =>
        !(hasWeatherCheck && isWeatherNotCheckedItem(item)) &&
        !(hasPlacesCheck && isPlacesNotCheckedItem(item)),
    ),
  };
}

function isWeatherNotCheckedItem(value: string) {
  return /\b(weather|forecast)\b/i.test(value);
}

function isPlacesNotCheckedItem(value: string) {
  return /\b(google places|places|open[- ]?now|open status|opening|map link|place identity|current menus)\b/i.test(
    value,
  );
}

function extractSourceProfileIds(sources: readonly AnswerSourceSummary[]) {
  return unique(
    sources.flatMap((source) => (source.sourceProfileId ? [source.sourceProfileId] : [])),
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function dedupeById<T extends { id: string }>(values: readonly T[]) {
  const results: T[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value.id)) {
      continue;
    }
    results.push(value);
    seen.add(value.id);
  }

  return results;
}

function dedupeItineraries(values: readonly ItineraryPlan[]) {
  const results: ItineraryPlan[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = normalizeText(`${value.title} ${value.durationLabel}`).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    results.push(value);
    seen.add(key);
  }

  return results;
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
