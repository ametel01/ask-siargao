import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

export type AskSiargaoAgentToolName =
  | "get_weather_forecast"
  | "get_marine_conditions"
  | "get_tide_forecast"
  | "get_condition_judgment"
  | "search_places"
  | "get_place_details"
  | "search_local_guide"
  | "rank_surf_spots_nearby"
  | "plan_local_itinerary"
  | "describe_database_schema"
  | "query_local_facts"
  | "get_source_evidence"
  | "describe_source_policy"
  | "load_agent_memory_file"
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
  sources?: readonly AnswerSourceSummary[];
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

export type ChatClientGeolocationConsentScope = "single_request" | "trip_session";

export type ChatClientGeolocationStatus =
  | "available"
  | "missing"
  | "out_of_area"
  | "stale"
  | "low_accuracy";

export type ChatClientGeolocationContext = {
  status: ChatClientGeolocationStatus;
  source: "browser_geolocation";
  consentScope?: ChatClientGeolocationConsentScope;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  capturedAt?: string;
};

export type ChatClientContext = {
  geolocation: ChatClientGeolocationContext;
};

export type GooglePlacesSearchCenterSource = "browser_geolocation" | "gazetteer" | "model_supplied";

export type AgentToolExecutionContext = {
  googlePlaces?: {
    centerSource: GooglePlacesSearchCenterSource;
    cacheMode?: "standard" | "no_store";
    consentScope?: ChatClientGeolocationConsentScope;
    center?: {
      latitude: number;
      longitude: number;
    };
  };
  surfSpotRanking?: {
    centerSource: "browser_geolocation";
    consentScope?: ChatClientGeolocationConsentScope;
    center: {
      latitude: number;
      longitude: number;
    };
  };
};

export type AgentRuntimeRequest = {
  messages: readonly AskSiargaoChatMessage[];
  requestId?: string;
  model?: string;
  clientContext?: ChatClientContext;
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
  clientContext?: ChatClientContext;
  toolContext?: AgentToolExecutionContext;
};

export type AgentToolExecutor = (request: AgentToolExecutionRequest) => Promise<AgentToolResult>;

export type AgentArtifactCarrier = {
  sources: readonly AnswerSourceSummary[];
  cards?: readonly RecommendationCard[];
  actions?: readonly ChatAction[];
  itineraries?: readonly ItineraryPlan[];
};

type AgentToolResultArtifactCarrier = AgentArtifactCarrier & {
  toolCallId?: AgentToolResult["toolCallId"];
  name?: AgentToolResult["name"];
  status?: AgentToolResult["status"];
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
  const reconciledSources = reconcileSourceSummaries(mergedSources, sourceReconciliation);
  const liveItineraryEvidence = itineraryLiveEvidence(artifactCarriers, toolCalls);
  const mergedCards = dedupeCardsById([
    ...(cards ?? []),
    ...artifactCarriers.flatMap((result) => cardsWithCarrierSources(result)),
  ]);
  const mergedActions = dedupeById([
    ...(actions ?? []),
    ...artifactCarriers.flatMap((result) => result.actions ?? []),
  ]);
  const mergedItineraries = dedupeItineraries([
    ...(itineraries ?? []),
    ...artifactCarriers.flatMap((result) => result.itineraries ?? []),
  ]).map((itinerary) =>
    reconcileItinerarySources(
      refreshItineraryArtifact(itinerary, liveItineraryEvidence),
      reconciledSources,
      sourceReconciliation,
    ),
  );

  return {
    message,
    requestId,
    ...(upstreamRequestIds?.length ? { upstreamRequestIds: unique(upstreamRequestIds) } : {}),
    model,
    toolCalls,
    sources: reconciledSources,
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
  const reconciledSources = itinerary.sources.flatMap((source) => {
    const reconciledSource = reconcileNotCheckedSource(source, reconciliation);
    return reconciledSource.checked.length > 0 || reconciledSource.notChecked.length > 0
      ? [reconciledSource]
      : [];
  });
  const reconciledAggregateSources = aggregateSources.flatMap((source) => {
    const reconciledSource = reconcileNotCheckedSource(source, reconciliation);
    return reconciledSource.checked.length > 0 || reconciledSource.notChecked.length > 0
      ? [reconciledSource]
      : [];
  });
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

function reconcileSourceSummaries(
  sources: readonly AnswerSourceSummary[],
  reconciliation: ItinerarySourceReconciliation,
) {
  return sources.flatMap((source) => {
    const reconciledSource = reconcileNotCheckedSource(source, reconciliation);
    return reconciledSource.checked.length > 0 || reconciledSource.notChecked.length > 0
      ? [reconciledSource]
      : [];
  });
}

type ItineraryLiveEvidence = {
  highWeatherRisk: boolean;
  weatherSummary?: string;
  places: readonly LivePlaceCandidate[];
};

type LivePlaceCandidate = {
  title: string;
  includedType?: string;
  mapsUrl?: string;
  area?: string;
  openStatusLabel?: string;
  fitReasons: readonly string[];
  caveats: readonly string[];
};

function itineraryLiveEvidence(
  toolResults: readonly AgentToolResultArtifactCarrier[],
  toolCalls: readonly AgentToolCallAudit[],
): ItineraryLiveEvidence {
  const places: LivePlaceCandidate[] = [];
  let highWeatherRisk = false;
  let weatherSummary: string | undefined;
  const requiredWeatherCalls = requiredWeatherChecksBySuccessfulToolCallId(toolResults, toolCalls);
  const requiredPlacesCalls = requiredPlacesChecksBySuccessfulToolCallId(toolResults, toolCalls);

  for (const result of toolResults) {
    if (result.status === "error") {
      continue;
    }

    if (result.name === "get_weather_forecast") {
      const requiredArguments = result.toolCallId
        ? requiredWeatherCalls.get(result.toolCallId)
        : undefined;
      if (requiredArguments) {
        const level = readStringPath(result.data, ["today", "level"]);
        if (level === "high") {
          highWeatherRisk = true;
        }
        weatherSummary = readStringPath(result.data, ["summary"]) ?? weatherSummary;
      }
    }

    if (isPlacesEvidenceResult(result)) {
      const requiredCheck = result.toolCallId
        ? requiredPlacesCalls.get(result.toolCallId)
        : undefined;
      if (requiredCheck) {
        places.push(...livePlaceCandidatesFromResult(result));
      }
    }
  }

  return {
    highWeatherRisk,
    ...(weatherSummary ? { weatherSummary } : {}),
    places: dedupeLivePlaceCandidates(places),
  };
}

function requiredWeatherChecksBySuccessfulToolCallId(
  toolResults: readonly AgentToolResultArtifactCarrier[],
  toolCalls: readonly AgentToolCallAudit[],
) {
  const requiredChecks = collectRequiredItineraryChecks(toolResults);
  const requiredWeatherByKey = new Map(
    requiredChecks.weather.map((argumentsForCheck) => [
      normalizeRequiredToolArguments(argumentsForCheck),
      argumentsForCheck,
    ]),
  );
  const results = new Map<string, Record<string, unknown>>();

  for (const toolCall of toolCalls) {
    if (!toolCall.toolCallId) {
      continue;
    }
    const requiredArguments = requiredWeatherByKey.get(
      normalizeRequiredToolArguments(toolCall.arguments),
    );
    if (requiredArguments) {
      if (isSuccessfulRequiredWeatherToolCall(toolCall, requiredArguments)) {
        results.set(toolCall.toolCallId, requiredArguments);
      }
    }
  }

  return results;
}

function requiredPlacesChecksBySuccessfulToolCallId(
  toolResults: readonly AgentToolResultArtifactCarrier[],
  toolCalls: readonly AgentToolCallAudit[],
) {
  const requiredChecks = collectRequiredItineraryChecks(toolResults);
  const requiredPlacesByKey = new Map(
    requiredChecks.places.map((check) => [normalizeRequiredToolArguments(check.arguments), check]),
  );
  const results = new Map<string, RequiredPlacesCheck>();

  for (const toolCall of toolCalls) {
    if (!toolCall.toolCallId) {
      continue;
    }
    const requiredCheck = requiredPlacesByKey.get(
      normalizeRequiredToolArguments(toolCall.arguments),
    );
    if (requiredCheck) {
      if (isSuccessfulRequiredPlacesToolCall(toolCall, requiredCheck)) {
        results.set(toolCall.toolCallId, requiredCheck);
      }
    }
  }

  return results;
}

function isPlacesEvidenceResult(result: AgentToolResultArtifactCarrier) {
  return (
    result.name === "search_places" ||
    result.sources.some(
      (source) =>
        source.sourceProfileId === "source_google_places" &&
        (source.label === "live_checked" || source.label === "fresh_cache"),
    )
  );
}

function livePlaceCandidatesFromResult(
  result: AgentToolResultArtifactCarrier,
): LivePlaceCandidate[] {
  const includedType = readStringPath(result.data, ["search", "includedType"]);
  const candidates = (result.cards ?? []).flatMap((card): LivePlaceCandidate[] => {
    if (card.kind !== "place") {
      return [];
    }
    const candidate = {
      title: card.title,
      ...(includedType ? { includedType } : {}),
      ...(card.mapsUrl ? { mapsUrl: card.mapsUrl } : {}),
      ...(card.subtitle ? { area: card.subtitle } : {}),
      ...(card.openStatusLabel ? { openStatusLabel: card.openStatusLabel } : {}),
      fitReasons: card.fitReasons,
      caveats: card.caveats,
    };
    return isOpenLivePlaceCandidate(candidate) ? [candidate] : [];
  });

  if (candidates.length > 0) {
    return candidates;
  }

  const places =
    isRecord(result.data) && Array.isArray(result.data.places) ? result.data.places : [];
  return places.flatMap((place): LivePlaceCandidate[] => {
    if (!isRecord(place)) {
      return [];
    }
    const title = readString(place.displayName);
    if (!title) {
      return [];
    }
    const candidate = {
      title,
      ...(includedType ? { includedType } : {}),
      ...(readString(place.googleMapsUri) ? { mapsUrl: readString(place.googleMapsUri) } : {}),
      ...(readString(place.formattedAddress) ? { area: readString(place.formattedAddress) } : {}),
      ...(isRecord(place.currentOpeningHours) &&
      typeof place.currentOpeningHours.openNow === "boolean"
        ? {
            openStatusLabel: place.currentOpeningHours.openNow
              ? "Open now according to Google Places."
              : "Not open now according to Google Places.",
          }
        : {}),
      fitReasons: ["Returned by Google Places for the itinerary follow-up check."],
      caveats: [],
    };
    return isOpenLivePlaceCandidate(candidate) ? [candidate] : [];
  });
}

function isOpenLivePlaceCandidate(candidate: LivePlaceCandidate) {
  return !candidate.openStatusLabel || !/^not open now\b/i.test(candidate.openStatusLabel);
}

function dedupeLivePlaceCandidates(candidates: readonly LivePlaceCandidate[]) {
  const results: LivePlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizeText(candidate.title).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(candidate);
  }
  return results;
}

function refreshItineraryArtifact(
  itinerary: ItineraryPlan,
  evidence: ItineraryLiveEvidence,
): ItineraryPlan {
  const weatherAdjusted = applyWeatherEvidenceToItinerary(itinerary, evidence);
  return applyPlacesEvidenceToItinerary(weatherAdjusted, evidence.places);
}

function applyWeatherEvidenceToItinerary(
  itinerary: ItineraryPlan,
  evidence: ItineraryLiveEvidence,
): ItineraryPlan {
  if (!evidence.highWeatherRisk || itinerary.fallbackStops.length === 0) {
    return itinerary;
  }

  const promotedFallbacks = itinerary.fallbackStops.flatMap((stop): ItineraryStop[] => {
    if (!isWeatherShelterStop(stop)) {
      return [];
    }
    return [
      {
        ...stop,
        rationale: weatherAdjustedRationale(stop.rationale, evidence.weatherSummary),
        caveats: uniqueText([
          ...stop.caveats.filter((caveat) => !isWeatherNotCheckedItem(caveat)),
          "Promoted from fallback after live weather showed high weather risk.",
        ]),
      },
    ];
  });
  const remainingFallbacks = itinerary.fallbackStops.flatMap((stop): ItineraryStop[] => {
    if (isWeatherShelterStop(stop)) {
      return [];
    }
    return [
      {
        ...stop,
        caveats: uniqueText([
          ...stop.caveats.filter((caveat) => !isWeatherNotCheckedItem(caveat)),
          "Keep this as a dry-break fallback only; do not use it during active heavy rain.",
        ]),
      },
    ];
  });
  const promotedFallbackTitles = new Set(
    promotedFallbacks.map((fallback) => normalizeText(fallback.title)),
  );
  const remainingStops = itinerary.stops.flatMap((stop): ItineraryStop[] => {
    if (promotedFallbackTitles.has(normalizeText(stop.title))) {
      return [];
    }
    return [
      {
        ...stop,
        caveats: uniqueText([
          ...stop.caveats.filter((caveat) => !isWeatherNotCheckedItem(caveat)),
          ...(isOutdoorItineraryStop(stop)
            ? ["Keep this optional unless the live weather window is comfortable."]
            : []),
        ]),
      },
    ];
  });

  return {
    ...itinerary,
    stops: resequenceItineraryStops([...promotedFallbacks, ...remainingStops]),
    fallbackStops: remainingFallbacks,
    skip: uniqueText([
      ...itinerary.skip,
      "Outdoor stops during high weather-risk windows unless conditions visibly improve",
    ]),
  };
}

function isWeatherShelterStop(stop: ItineraryStop) {
  const haystack = `${stop.title} ${stop.area ?? ""} ${stop.rationale} ${stop.caveats.join(" ")}`;
  return (
    stop.kind === "meal" ||
    /\b(covered|indoor|inside|cafe|restaurant|coffee|shelter)\b/i.test(haystack)
  );
}

function applyPlacesEvidenceToItinerary(
  itinerary: ItineraryPlan,
  candidates: readonly LivePlaceCandidate[],
): ItineraryPlan {
  if (candidates.length === 0) {
    return itinerary;
  }

  const usedCandidateTitles = new Set<string>();
  return {
    ...itinerary,
    stops: itinerary.stops.map((stop) =>
      applyPlaceCandidateToStop(stop, candidates, usedCandidateTitles),
    ),
    fallbackStops: itinerary.fallbackStops.map((stop) =>
      applyPlaceCandidateToStop(stop, candidates, usedCandidateTitles),
    ),
  };
}

function applyPlaceCandidateToStop(
  stop: ItineraryStop,
  candidates: readonly LivePlaceCandidate[],
  usedCandidateTitles: Set<string>,
): ItineraryStop {
  if (!shouldHydrateStopWithPlaces(stop)) {
    return stop;
  }

  const candidate = choosePlaceCandidateForStop(stop, candidates, usedCandidateTitles);
  if (!candidate) {
    return stop;
  }

  usedCandidateTitles.add(normalizeText(candidate.title).toLowerCase());
  return {
    ...stop,
    title: candidate.title,
    ...(candidate.area ? { area: stop.area ?? candidate.area } : {}),
    ...(candidate.mapsUrl ? { mapsUrl: candidate.mapsUrl } : {}),
    rationale: placeAdjustedRationale(stop.rationale, candidate),
    caveats: uniqueText([
      ...stop.caveats.filter((caveat) => !isPlacesNotCheckedCaveat(caveat)),
      ...candidate.caveats,
    ]),
  };
}

function choosePlaceCandidateForStop(
  stop: ItineraryStop,
  candidates: readonly LivePlaceCandidate[],
  usedCandidateTitles: Set<string>,
) {
  const unused = candidates.filter(
    (candidate) => !usedCandidateTitles.has(normalizeText(candidate.title).toLowerCase()),
  );
  const preferredType = preferredPlaceTypeForStop(stop);
  if (preferredType) {
    return unused.find((candidate) => candidate.includedType === preferredType);
  }
  return unused[0];
}

function preferredPlaceTypeForStop(stop: ItineraryStop) {
  const haystack = normalizeText(`${stop.title} ${stop.rationale} ${stop.caveats.join(" ")}`);
  if (/\b(cafe|coffee|dessert|covered)\b/i.test(haystack)) {
    return "cafe";
  }
  if (/\b(dinner|restaurant|food|meal|lunch|breakfast)\b/i.test(haystack)) {
    return "restaurant";
  }
  return undefined;
}

function shouldHydrateStopWithPlaces(stop: ItineraryStop) {
  if (stop.kind === "meal" || stop.kind === "place") {
    return true;
  }
  const titleAndCaveats = normalizeText(`${stop.title} ${stop.caveats.join(" ")}`);
  return /\b(places|google places|open status|open-now|opening|hours|maps?|venue|cafe|restaurant|food|dessert)\b/i.test(
    titleAndCaveats,
  );
}

function isPlacesNotCheckedCaveat(value: string) {
  return /\b(places|google places|open status|open[- ]?now|opening|hours?|maps?|venue|venues?|ratings?)\b/i.test(
    value,
  );
}

function isOutdoorItineraryStop(stop: ItineraryStop) {
  if (stop.kind === "meal") {
    return false;
  }
  return /\b(beach|boardwalk|sunset|outdoor|surf|walk)\b/i.test(
    `${stop.title} ${stop.area ?? ""} ${stop.rationale}`,
  );
}

function placeAdjustedRationale(stopRationale: string, candidate: LivePlaceCandidate) {
  return uniqueText([
    stopRationale,
    `Updated from the required Places check with ${candidate.title}${
      candidate.openStatusLabel ? ` (${candidate.openStatusLabel})` : ""
    }.`,
  ]).join(" ");
}

function weatherAdjustedRationale(stopRationale: string, weatherSummary: string | undefined) {
  return uniqueText([
    stopRationale,
    weatherSummary
      ? `Live weather check reported high risk: ${weatherSummary}`
      : "Live weather check reported high weather risk.",
  ]).join(" ");
}

function resequenceItineraryStops(stops: readonly ItineraryStop[]) {
  return stops.map((stop, index) => ({
    ...stop,
    sequence: index + 1,
    ...(index === 0 ? { travelTimeFromPreviousMinutes: undefined } : {}),
  }));
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

function isSuccessfulRequiredWeatherToolCall(
  toolCall: AgentToolCallAudit,
  requiredArguments: Record<string, unknown>,
) {
  return (
    toolCall.name === "get_weather_forecast" &&
    toolCall.status === "success" &&
    normalizeRequiredToolArguments(toolCall.arguments) ===
      normalizeRequiredToolArguments(requiredArguments) &&
    toolCall.sources.some((source) => source.label === "weather_checked")
  );
}

function hasSuccessfulRequiredPlacesOpenStatusCall(
  toolCalls: readonly AgentToolCallAudit[],
  requiredCheck: RequiredPlacesCheck,
) {
  return toolCalls.some((toolCall) => isSuccessfulRequiredPlacesToolCall(toolCall, requiredCheck));
}

function isSuccessfulRequiredPlacesToolCall(
  toolCall: AgentToolCallAudit,
  requiredCheck: RequiredPlacesCheck,
) {
  const requiredKey = normalizeRequiredToolArguments(requiredCheck.arguments);
  return (
    toolCall.name === "search_places" &&
    toolCall.status === "success" &&
    normalizeRequiredToolArguments(toolCall.arguments) === requiredKey &&
    toolCall.sources.some(
      (source) =>
        (source.label === "live_checked" || source.label === "fresh_cache") &&
        (!requiredCheck.requiresOpenNow || source.checked.some(isPlacesOpenNowCheckedItem)),
    )
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

function isPlacesOpenNowCheckedItem(value: string) {
  return /\bopen[- ]?now signal\b/i.test(value);
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

function uniqueText(values: readonly string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalizedValue = normalizeText(value);
        return normalizedValue ? [normalizedValue] : [];
      }),
    ),
  ];
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

function cardsWithCarrierSources(result: AgentToolResultArtifactCarrier): RecommendationCard[] {
  return (result.cards ?? []).map((card) =>
    card.sources?.length ? card : { ...card, sources: result.sources },
  );
}

function dedupeCardsById(values: readonly RecommendationCard[]) {
  const results: RecommendationCard[] = [];
  const indexesById = new Map<string, number>();

  for (const value of values) {
    const existingIndex = indexesById.get(value.id);
    if (existingIndex === undefined) {
      indexesById.set(value.id, results.length);
      results.push(value);
      continue;
    }

    const existing = results[existingIndex];
    if (existing && !existing.sources?.length && value.sources?.length) {
      results[existingIndex] = { ...existing, sources: value.sources };
    }
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
  return values.flatMap((value) => {
    const normalizedValue = normalizeText(value);
    return normalizedValue ? [normalizedValue] : [];
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}
