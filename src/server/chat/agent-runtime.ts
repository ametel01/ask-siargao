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

type AgentToolResultArtifactCarrier = AgentArtifactCarrier & {
  data?: AgentToolResult["data"];
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
  toolResults?: readonly AgentToolResultArtifactCarrier[];
  sources?: readonly AnswerSourceSummary[];
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
  itineraries?: readonly ItineraryPlan[];
}): AgentTurnResult {
  const sourceCarriers = toolResults ?? toolCalls;
  const artifactCarriers = toolResults ?? [];
  const mergedSources = sources ?? aggregateAgentSourceSummaries(sourceCarriers);
  const sourceReconciliation = itinerarySourceReconciliation(artifactCarriers, toolCalls);
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
  ]).map((itinerary) => reconcileItinerarySources(itinerary, mergedSources, sourceReconciliation));

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
  reconciliation: ItinerarySourceReconciliation,
): ItineraryPlan {
  const reconciledSources = itinerary.sources
    .map((source) => reconcileNotCheckedSource(source, reconciliation))
    .filter((source) => source.checked.length > 0 || source.notChecked.length > 0);
  const reconciledAggregateSources = aggregateSources
    .map((source) => reconcileNotCheckedSource(source, reconciliation))
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

type ItinerarySourceReconciliation = {
  hasPlacesIdentityCheck: boolean;
  hasPlacesOpenStatusCheck: boolean;
  hasWeatherCheck: boolean;
};

type RequiredPlacesCheck = {
  arguments: Record<string, unknown>;
  requiresOpenNow: boolean;
};

function itinerarySourceReconciliation(
  toolResults: readonly AgentToolResultArtifactCarrier[],
  toolCalls: readonly AgentToolCallAudit[],
): ItinerarySourceReconciliation {
  const requiredChecks = collectRequiredItineraryChecks(toolResults);
  return {
    hasWeatherCheck:
      requiredChecks.weather.length > 0 &&
      requiredChecks.weather.every((requiredArguments) =>
        hasSuccessfulRequiredToolCall(toolCalls, "get_weather_forecast", requiredArguments, [
          "weather_checked",
        ]),
      ),
    hasPlacesIdentityCheck:
      requiredChecks.places.length > 0 &&
      requiredChecks.places.every((requiredCheck) =>
        hasSuccessfulRequiredToolCall(toolCalls, "search_places", requiredCheck.arguments, [
          "live_checked",
          "fresh_cache",
        ]),
      ),
    hasPlacesOpenStatusCheck:
      requiredChecks.places.length > 0 &&
      requiredChecks.places.every((requiredCheck) =>
        requiredCheck.requiresOpenNow
          ? hasSuccessfulRequiredPlacesOpenStatusCall(toolCalls, requiredCheck)
          : true,
      ),
  };
}

function collectRequiredItineraryChecks(toolResults: readonly AgentToolResultArtifactCarrier[]) {
  const weather: Record<string, unknown>[] = [];
  const places: RequiredPlacesCheck[] = [];

  for (const result of toolResults) {
    if (!isRecord(result.data) || !isRecord(result.data.requiredToolChecks)) {
      continue;
    }

    const requiredToolChecks = result.data.requiredToolChecks;
    if (isRecord(requiredToolChecks.weather)) {
      weather.push({
        location: requiredToolChecks.weather.location,
        date_range: requiredToolChecks.weather.date_range,
      });
    }

    if (Array.isArray(requiredToolChecks.places)) {
      for (const check of requiredToolChecks.places) {
        if (!isRecord(check)) {
          continue;
        }
        const argumentsForCheck = {
          query: check.query,
          center: check.center,
          radius_meters: check.radius_meters,
          constraints: check.constraints,
        };
        places.push({
          arguments: argumentsForCheck,
          requiresOpenNow: isRecord(check.constraints) && check.constraints.open_now === true,
        });
      }
    }
  }

  return {
    weather: uniqueRequiredArguments(weather),
    places: uniqueRequiredPlacesChecks(places),
  };
}

function hasSuccessfulRequiredToolCall(
  toolCalls: readonly AgentToolCallAudit[],
  name: string,
  requiredArguments: Record<string, unknown>,
  acceptedSourceLabels: readonly AnswerSourceSummary["label"][],
) {
  const requiredKey = normalizeRequiredToolArguments(requiredArguments);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === name &&
      toolCall.status === "success" &&
      toolCall.sources.some((source) => acceptedSourceLabels.includes(source.label)) &&
      normalizeRequiredToolArguments(toolCall.arguments) === requiredKey,
  );
}

function hasSuccessfulRequiredPlacesOpenStatusCall(
  toolCalls: readonly AgentToolCallAudit[],
  requiredCheck: RequiredPlacesCheck,
) {
  const requiredKey = normalizeRequiredToolArguments(requiredCheck.arguments);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === "search_places" &&
      toolCall.status === "success" &&
      normalizeRequiredToolArguments(toolCall.arguments) === requiredKey &&
      toolCall.sources.some(
        (source) =>
          (source.label === "live_checked" || source.label === "fresh_cache") &&
          source.checked.some(isPlacesOpenStatusCheckedItem),
      ),
  );
}

function uniqueRequiredArguments(values: readonly Record<string, unknown>[]) {
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalizeRequiredToolArguments(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(value);
  }
  return results;
}

function uniqueRequiredPlacesChecks(values: readonly RequiredPlacesCheck[]) {
  const results: RequiredPlacesCheck[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalizeRequiredToolArguments(value.arguments);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(value);
  }
  return results;
}

function reconcileNotCheckedSource(
  source: AnswerSourceSummary,
  {
    hasPlacesIdentityCheck,
    hasPlacesOpenStatusCheck,
    hasWeatherCheck,
  }: {
    hasPlacesIdentityCheck: boolean;
    hasPlacesOpenStatusCheck: boolean;
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
        !(hasPlacesOpenStatusCheck && isPlacesOpenStatusNotCheckedItem(item)) &&
        !(hasPlacesIdentityCheck && isPlacesIdentityNotCheckedItem(item)),
    ),
  };
}

function isWeatherNotCheckedItem(value: string) {
  return /\b(weather|forecast)\b/i.test(value);
}

function isPlacesOpenStatusCheckedItem(value: string) {
  return /\b(open[- ]?now|opening[- ]?hours|open status|opening hours)\b/i.test(value);
}

function isPlacesOpenStatusNotCheckedItem(value: string) {
  return /\b(open[- ]?now|open status|opening|opening[- ]?hours|hours?)\b/i.test(value);
}

function isPlacesIdentityNotCheckedItem(value: string) {
  if (isPlacesOpenStatusNotCheckedItem(value)) {
    return false;
  }
  return /\b(google places|places|map link|place identity|current menus)\b/i.test(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}
