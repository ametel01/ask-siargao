import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  RecommendationCard,
  RecommendationCardKind,
} from "@/server/chat/agent-runtime";
import type { NightlifeEventInterest } from "@/server/chat/nightlife-events";
import { buildPlaceSearchPlan, inferIncludedType } from "@/server/chat/place-search-plan";

export type RequiredEvidencePlan = {
  requiredToolCalls: readonly RequiredEvidenceToolCall[];
  allowedCardKinds?: readonly RecommendationCardKind[];
};

type RequiredEvidenceToolCallBase = {
  arguments: Record<string, unknown>;
  acceptedSourceLabels: readonly string[];
  dependsOn?: readonly string[];
  runBefore?: readonly string[];
  terminalSourceLabels: readonly string[];
  purpose: string;
};

export type RequiredEvidenceToolCall =
  | RequiredWebResearchEvidenceToolCall
  | RequiredPlaceEvidenceToolCall
  | RequiredWeatherEvidenceToolCall
  | RequiredNightlifeEventEvidenceToolCall;

export type RequiredWebResearchEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "research_web";
};

export type RequiredPlaceEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "search_places";
  requiresOpenNow: boolean;
};

export type RequiredWeatherEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "get_weather_forecast";
};

export type RequiredNightlifeEventEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "search_nightlife_events";
};

type PlaceIntentSignal = {
  category?: string;
  liveNeeds?: readonly unknown[];
  meal?: string | null;
  location?: string | null;
  radiusMeters?: number;
  constraints?: readonly unknown[];
  avoid?: readonly unknown[];
  areaScope?: string | null;
  latestUserTurn?: string;
  recentUserContext?: string;
  tripContext?: {
    temporaryModifiers?: readonly unknown[];
  };
};

const gazetteer = {
  "general luna": { latitude: 9.8006, longitude: 126.1586 },
  "cloud 9": { latitude: 9.8116, longitude: 126.1651 },
  dapa: { latitude: 9.7594, longitude: 125.9761 },
  "del carmen": { latitude: 9.869, longitude: 125.969 },
  "del carmen port": { latitude: 9.8722, longitude: 125.9698 },
  "sugba lagoon": { latitude: 9.8184, longitude: 125.9531 },
  "siargao island": { latitude: 9.8482, longitude: 126.0458 },
} as const;

export function buildRequiredEvidencePlan(request: AgentRuntimeRequest): RequiredEvidencePlan {
  const intent = readIntentSignal(request.deterministicSignals);
  const placeIntent = readPlaceIntentSignal(intent?.placeIntent);
  const researchIntent = readResearchIntentSignal(intent?.researchIntent);
  const requiredToolCalls: RequiredEvidenceToolCall[] = [];
  let allowedCardKinds: RequiredEvidencePlan["allowedCardKinds"];

  if (researchIntent) {
    requiredToolCalls.push({
      name: "research_web",
      purpose: "current_public_web_research",
      arguments: {
        query: researchIntent.query,
        intent: researchIntent.intent,
        ...(researchIntent.location ? { location: researchIntent.location } : {}),
        ...(researchIntent.dateContext ? { dateContext: researchIntent.dateContext } : {}),
        ...(researchIntent.sourceTypes ? { sourceTypes: researchIntent.sourceTypes } : {}),
        ...(researchIntent.requiredFreshness
          ? { requiredFreshness: researchIntent.requiredFreshness }
          : {}),
        maxSources: 6,
      },
      acceptedSourceLabels: [
        "official_checked",
        "directory_checked",
        "web_researched",
        "community_signal",
      ],
      terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
      runBefore: ["search_places", "get_weather_forecast", "search_nightlife_events"],
    });
  }

  if (requiresNightlifeEventEvidence(intent)) {
    allowedCardKinds = ["place"];
    requiredToolCalls.push({
      name: "search_nightlife_events",
      purpose: "nightlife_event_schedule",
      arguments: {
        location: "General Luna",
        date: "tonight",
        interests: nightlifeInterests(intent),
      },
      acceptedSourceLabels: ["event_checked"],
      terminalSourceLabels: ["no_current_event_facts", "provider_unavailable"],
      ...(researchIntent ? { dependsOn: ["research_web"] } : {}),
    });
    requiredToolCalls.push({
      name: "search_places",
      purpose: "nightlife_venue_enrichment",
      arguments: {
        query: "selected General Luna nightlife event route venues Siargao",
        center: gazetteer["general luna"],
        radius_meters: 6_000,
        constraints: {
          included_type: "bar",
          open_now: true,
          page_size: 8,
        },
      },
      acceptedSourceLabels: ["live_checked", "fresh_cache"],
      terminalSourceLabels: ["provider_unavailable"],
      ...(researchIntent ? { dependsOn: ["research_web", "search_nightlife_events"] } : {}),
      requiresOpenNow: true,
    });
    requiredToolCalls.push({
      name: "get_weather_forecast",
      purpose: "nightlife_route_weather",
      arguments: {
        location: "General Luna",
        date_range: "today",
      },
      acceptedSourceLabels: ["weather_checked"],
      terminalSourceLabels: ["provider_unavailable"],
      ...(researchIntent ? { dependsOn: ["research_web"] } : {}),
    });
  }

  if (
    placeIntent &&
    !requiresNightlifeEventEvidence(intent) &&
    intent?.activityPlan !== true &&
    intent?.tripAdvice !== true &&
    requiresPlacesEvidence(placeIntent)
  ) {
    const center = placesSearchCenter(request, placeIntent);
    allowedCardKinds = ["place"];
    if (center) {
      const includedType = includedTypeForPlaceIntent(placeIntent);
      const requiresOpenNow = requiresOpenNowEvidence(placeIntent);
      requiredToolCalls.push({
        name: "search_places",
        purpose: "place_recommendation",
        arguments: {
          query: placesSearchQuery(placeIntent),
          center,
          radius_meters: placeIntent.radiusMeters ?? 12_000,
          constraints: {
            ...(includedType ? { included_type: includedType } : {}),
            open_now: requiresOpenNow,
            page_size: 8,
          },
        },
        acceptedSourceLabels: ["live_checked", "fresh_cache"],
        terminalSourceLabels: ["provider_unavailable"],
        ...(researchIntent ? { dependsOn: ["research_web"] } : {}),
        requiresOpenNow,
      });
    }
  }

  if (requiresWeatherEvidence(intent)) {
    requiredToolCalls.push({
      name: "get_weather_forecast",
      purpose: "weather_forecast",
      arguments: {
        location: weatherLocation(intent),
        date_range: weatherDateRange(request),
      },
      acceptedSourceLabels: ["weather_checked"],
      terminalSourceLabels: ["provider_unavailable"],
      ...(researchIntent ? { dependsOn: ["research_web"] } : {}),
    });
  }

  return {
    requiredToolCalls,
    ...(allowedCardKinds ? { allowedCardKinds } : {}),
  };
}

export function missingRequiredEvidenceToolCalls(
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[] = [],
): RequiredEvidenceToolCall[] {
  return plan.requiredToolCalls.filter(
    (requiredCall) =>
      !researchPlacesEnrichmentIsUnavailable(requiredCall, plan, toolResults) &&
      !nightlifePlacesEnrichmentIsUnavailable(requiredCall, plan, toolResults) &&
      !dependencyHasTerminalEvidence(requiredCall, plan, toolCalls) &&
      dependenciesHaveSatisfyingEvidence(requiredCall, plan, toolCalls) &&
      !hasCompletedToolCall(requiredCall, toolCalls),
  );
}

export function finalPayloadSatisfiesRequiredEvidence(
  plan: RequiredEvidencePlan,
  finalPayload: AgentFinalPayload | undefined,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  if (plan.requiredToolCalls.length === 0) {
    return true;
  }
  if (
    !plan.requiredToolCalls.every(
      (requiredCall) =>
        hasCompletedToolCall(requiredCall, toolCalls) ||
        dependencyHasTerminalEvidence(requiredCall, plan, toolCalls),
    )
  ) {
    return false;
  }
  const unsatisfiedRequiredCalls = plan.requiredToolCalls.filter(
    (requiredCall) =>
      !dependencyHasTerminalEvidence(requiredCall, plan, toolCalls) &&
      !hasSatisfyingToolCall(requiredCall, toolCalls),
  );
  if (unsatisfiedRequiredCalls.length > 0) {
    return terminalOnlyFinalPayloadIsCaveated(finalPayload, unsatisfiedRequiredCalls);
  }
  const placeRequiredCalls = plan.requiredToolCalls.filter(
    (requiredCall): requiredCall is RequiredPlaceEvidenceToolCall =>
      requiredCall.name === "search_places",
  );
  if (placeRequiredCalls.length === 0) {
    return true;
  }
  if (!finalPayload) {
    return requiredEvidencePlaceCardIds(plan, toolResults).length > 0;
  }
  const placeCardIds = new Set(requiredEvidencePlaceCardIds(plan, toolResults));
  return finalPayload.displayCardIds.some((id) => placeCardIds.has(id));
}

export function requiredEvidencePlaceCardIds(
  plan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
) {
  const nightlifeVenueNames = selectedNightlifeEventVenueNames(toolResults);
  const researchEntityNames = selectedResearchEntityNames(toolResults);
  return uniqueText(
    toolResults.flatMap((result) =>
      isCheckedPlacesEvidenceResult(result)
        ? (result.cards ?? []).flatMap((card) =>
            card.kind === "place" &&
            requiredEvidenceAcceptsPlaceCard(plan, card, nightlifeVenueNames, researchEntityNames)
              ? [card.id]
              : [],
          )
        : [],
    ),
  );
}

export function selectedNightlifeEventVenueNames(
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  const routeVenueNames = uniqueText(
    toolResults.flatMap((result) =>
      result.name === "search_nightlife_events" && result.status === "success"
        ? readNightlifeRouteVenueNames(result.data)
        : [],
    ),
  );
  if (routeVenueNames.length > 0) {
    return routeVenueNames;
  }

  return uniqueText(
    toolResults.flatMap((result) =>
      result.name === "search_nightlife_events" && result.status === "success"
        ? readNightlifeCandidateVenueNames(result.data)
        : [],
    ),
  );
}

export function selectedResearchEntityNames(
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  return uniqueText(
    toolResults.flatMap((result) =>
      result.name === "research_web" && result.status === "success"
        ? readResearchEntityNames(result.data)
        : [],
    ),
  );
}

function terminalOnlyFinalPayloadIsCaveated(
  finalPayload: AgentFinalPayload | undefined,
  unsatisfiedRequiredCalls: readonly RequiredEvidenceToolCall[],
) {
  if (!finalPayload) {
    return false;
  }
  const hasUnsatisfiedNightlifeCheck = unsatisfiedRequiredCalls.some(
    (requiredCall) => requiredCall.name === "search_nightlife_events",
  );
  if (hasUnsatisfiedNightlifeCheck && finalPayload.displayCardIds.length > 0) {
    return false;
  }
  const hasUnsatisfiedPlacesCheck = unsatisfiedRequiredCalls.some(
    (requiredCall) => requiredCall.name === "search_places",
  );
  if (hasUnsatisfiedPlacesCheck && finalPayload.displayCardIds.length > 0) {
    return false;
  }
  return !hasCheckedEvidenceOverclaim(finalPayload.answer, unsatisfiedRequiredCalls);
}

function hasCheckedEvidenceOverclaim(
  answer: string,
  unsatisfiedRequiredCalls: readonly RequiredEvidenceToolCall[],
) {
  const normalizedAnswer = stripNegatedCheckedClaims(answer.toLowerCase().replace(/\s+/g, " "));
  return unsatisfiedRequiredCalls.some((requiredCall) => {
    if (requiredCall.name === "search_places") {
      return hasPlacesCheckedClaim(normalizedAnswer);
    }
    if (requiredCall.name === "search_nightlife_events") {
      return hasNightlifeEventCheckedClaim(normalizedAnswer);
    }
    if (requiredCall.name === "research_web") {
      return hasWebResearchCheckedClaim(normalizedAnswer);
    }
    return hasWeatherCheckedClaim(normalizedAnswer);
  });
}

function stripNegatedCheckedClaims(value: string) {
  return value.replaceAll(
    /\b(?:not|cannot|can't|could not|couldn't|unable to|no|without|unavailable,?\s+so)\s+[^.?!]{0,120}\b(?:check|checked|verify|verified|confirm|confirmed|live[-\s]?checked|checked\s+live)\b/giu,
    "",
  );
}

function hasPlacesCheckedClaim(value: string) {
  return /\b(?:live[-\s]?checked|checked\s+live|live\s+check(?:ed)?(?:\s+says)?|checked\s+(?:google\s+places|places|open[-\s]?now|open status|map link|place identity)|(?:google\s+places|places)\s+(?:was|were)?\s*(?:checked|verified|confirmed)|according to google\s+places|open now according to google\s+places)\b/iu.test(
    value,
  );
}

function hasWeatherCheckedClaim(value: string) {
  return /\b(?:weather[-\s]?checked|checked\s+live|live\s+check(?:ed)?(?:\s+says)?|checked\s+(?:weather|forecast|open[-\s]?meteo|rain|wind)|(?:weather|forecast|open[-\s]?meteo)\s+(?:was|were)?\s*(?:checked|verified|confirmed)|according to open[-\s]?meteo)\b/iu.test(
    value,
  );
}

function hasNightlifeEventCheckedClaim(value: string) {
  return /\b(?:event[-\s]?(?:schedule|facts?|evidence)\s+(?:was|were)?\s*(?:checked|verified|confirmed)|checked\s+(?:event|nightlife|party)\s+(?:schedule|facts?|evidence)|according\s+to\s+(?:approved\s+)?(?:event|nightlife|party)\s+(?:schedule|facts?|evidence)|schedule[-\s]?checked|event[-\s]?checked)\b/iu.test(
    value,
  );
}

function hasWebResearchCheckedClaim(value: string) {
  return /\b(?:web[-\s]?researched|official[-\s]?checked|directory[-\s]?checked|checked\s+(?:official|directory|public\s+web|web)\s+(?:sources?|evidence)|according\s+to\s+(?:official|public\s+web|directory)\s+(?:sources?|evidence))\b/iu.test(
    value,
  );
}

function readIntentSignal(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  return isRecord(value.intent) ? value.intent : value;
}

function readPlaceIntentSignal(value: unknown): PlaceIntentSignal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    category: readString(value.category),
    liveNeeds: Array.isArray(value.liveNeeds) ? value.liveNeeds : [],
    meal: readString(value.meal),
    location: readString(value.location),
    radiusMeters: typeof value.radiusMeters === "number" ? value.radiusMeters : undefined,
    constraints: Array.isArray(value.constraints) ? value.constraints : [],
    avoid: Array.isArray(value.avoid) ? value.avoid : [],
    areaScope: readString(value.areaScope),
    latestUserTurn: readString(value.latestUserTurn),
    recentUserContext: readString(value.recentUserContext),
    tripContext: isRecord(value.tripContext)
      ? {
          temporaryModifiers: Array.isArray(value.tripContext.temporaryModifiers)
            ? value.tripContext.temporaryModifiers
            : [],
        }
      : undefined,
  };
}

function readResearchIntentSignal(value: unknown) {
  if (!isRecord(value) || value.required !== true) {
    return undefined;
  }
  const query = readString(value.query);
  const intent = readString(value.intent);
  if (!query || !intent) {
    return undefined;
  }
  return {
    query,
    intent,
    location: readString(value.location),
    dateContext: readString(value.dateContext),
    sourceTypes: Array.isArray(value.sourceTypes)
      ? value.sourceTypes.filter((item): item is string => typeof item === "string")
      : undefined,
    requiredFreshness: readString(value.requiredFreshness),
  };
}

function requiresWeatherEvidence(intent: Record<string, unknown> | undefined) {
  return (
    intent?.weather === true &&
    intent?.nightlifePlan !== true &&
    intent.conditionActivity === undefined &&
    intent.activityPlan !== true &&
    intent.tripAdvice !== true
  );
}

function requiresNightlifeEventEvidence(intent: Record<string, unknown> | undefined) {
  return intent?.nightlifePlan === true;
}

function nightlifeInterests(intent: Record<string, unknown> | undefined): NightlifeEventInterest[] {
  const latestUserTurn = readString(intent?.latestUserTurn) ?? "";
  const interests = new Set<NightlifeEventInterest>();
  if (/\bpub\s*quiz|quiz\b/i.test(latestUserTurn)) {
    interests.add("pub_quiz");
  }
  if (/\btrivia\b/i.test(latestUserTurn)) {
    interests.add("trivia");
  }
  if (/\bfoam\b/i.test(latestUserTurn)) {
    interests.add("foam_party");
  }
  if (/\bdj\b/i.test(latestUserTurn)) {
    interests.add("dj");
  }
  if (/\blive\s*music|band\b/i.test(latestUserTurn)) {
    interests.add("live_music");
  }
  if (/\bbar[-\s]?hopp?ing|bar\s+crawl\b/i.test(latestUserTurn)) {
    interests.add("bar_hopping");
  }
  if (/\bdrinks?|cocktails?|beers?\b/i.test(latestUserTurn)) {
    interests.add("drinks");
  }
  if (interests.size === 0 || /\bparty|nightlife|where\s+.*go\s+out\b/i.test(latestUserTurn)) {
    interests.add("party");
  }
  return [...interests];
}

function weatherLocation(intent: Record<string, unknown> | undefined) {
  const locationLabel = readString(intent?.locationLabel);
  if (
    locationLabel === "Cloud 9" ||
    locationLabel === "General Luna" ||
    locationLabel === "Del Carmen" ||
    locationLabel === "Siargao Island"
  ) {
    return locationLabel;
  }
  return "Siargao Island";
}

function weatherDateRange(request: AgentRuntimeRequest) {
  const latestUserTurn = request.messages
    .filter((message) => message.role === "user")
    .at(-1)?.content;
  return latestUserTurn &&
    /\b(tomorrow|tmrw|next\s+7\s+days?|next\s+seven\s+days?|this\s+week|next\s+week|weekend|later\s+this\s+week|in\s+(?:[2-7]|two|three|four|five|six|seven)\s+days?)\b/i.test(
      latestUserTurn,
    )
    ? "next_7_days"
    : "today";
}

function requiresPlacesEvidence(placeIntent: PlaceIntentSignal) {
  return (
    placeIntent.category === "food" ||
    placeIntent.category === "coffee" ||
    placeIntent.category === "bar" ||
    placeIntent.category === "activity_place" ||
    placeIntent.category === "specific_place" ||
    placeIntent.category === "service"
  );
}

function placesSearchCenter(request: AgentRuntimeRequest, placeIntent: PlaceIntentSignal) {
  const geolocation = request.clientContext?.geolocation;
  if (
    placeIntent.areaScope === "nearby" &&
    geolocation?.status === "available" &&
    geolocation.source === "browser_geolocation" &&
    typeof geolocation.latitude === "number" &&
    typeof geolocation.longitude === "number"
  ) {
    return { latitude: geolocation.latitude, longitude: geolocation.longitude };
  }

  const location = normalizeLookupKey(placeIntent.location ?? "General Luna");
  return gazetteer[location as keyof typeof gazetteer] ?? gazetteer["general luna"];
}

function includedTypeForPlaceIntent(placeIntent: PlaceIntentSignal) {
  if (placeIntent.category === "service" || placeIntent.category === "activity_place") {
    return inferIncludedType(buildPlaceSearchPlan(placeIntent).searchTerm);
  }
  if (placeIntent.category === "specific_place") {
    return undefined;
  }
  if (placeIntent.category === "coffee") {
    return "cafe";
  }
  if (placeIntent.category === "bar") {
    return "bar";
  }
  if (placeIntent.category === "food") {
    return "restaurant";
  }
  return undefined;
}

function requiresOpenNowEvidence(placeIntent: PlaceIntentSignal) {
  const liveNeeds = new Set(
    placeIntent.liveNeeds?.filter((item): item is string => typeof item === "string"),
  );
  return liveNeeds.has("open_now") || liveNeeds.has("hours") || placeIntent.meal === "dinner";
}

function placesSearchQuery(placeIntent: PlaceIntentSignal) {
  const location = placeIntent.location ?? "General Luna";
  if (placeIntent.category === "service" || placeIntent.category === "activity_place") {
    return buildPlaceSearchPlan(placeIntent).query;
  }
  if (placeIntent.category === "coffee") {
    return `cafes near ${location} Siargao`;
  }
  if (placeIntent.category === "bar") {
    return `bars near ${location} Siargao`;
  }
  if (placeIntent.meal === "dinner") {
    return `restaurants and dinner spots in ${location}, Siargao`;
  }
  if (placeIntent.meal) {
    return `${placeIntent.meal} restaurants in ${location}, Siargao`;
  }
  return `restaurants and places to eat in ${location}, Siargao`;
}

function hasSatisfyingToolCall(
  requiredCall: RequiredEvidenceToolCall,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      toolCall.status === "success" &&
      toolCall.sources.some(
        (source) =>
          requiredCall.acceptedSourceLabels.includes(source.label) &&
          (requiredCall.name !== "search_places" ||
            !requiredCall.requiresOpenNow ||
            source.checked.some((item) => /\bopen[- ]?now signal\b/i.test(item))),
      ),
  );
}

function hasCompletedToolCall(
  requiredCall: RequiredEvidenceToolCall,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      toolCall.sources.some(
        (source) =>
          requiredCall.acceptedSourceLabels.includes(source.label) ||
          requiredCall.terminalSourceLabels.includes(source.label),
      ),
  );
}

function hasTerminalToolCall(
  requiredCall: RequiredEvidenceToolCall,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      toolCall.sources.some((source) => requiredCall.terminalSourceLabels.includes(source.label)),
  );
}

function dependenciesHaveSatisfyingEvidence(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return (requiredCall.dependsOn ?? []).every((dependencyName) => {
    const dependencyCall = plan.requiredToolCalls.find((call) => call.name === dependencyName);
    return dependencyCall ? hasSatisfyingToolCall(dependencyCall, toolCalls) : true;
  });
}

function dependencyHasTerminalEvidence(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return (requiredCall.dependsOn ?? []).some((dependencyName) => {
    const dependencyCall = plan.requiredToolCalls.find((call) => call.name === dependencyName);
    return dependencyCall ? hasTerminalToolCall(dependencyCall, toolCalls) : false;
  });
}

export function nightlifePlacesEnrichmentIsUnavailable(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  return (
    requiredCall.name === "search_places" &&
    plan.requiredToolCalls.some((call) => call.name === "search_nightlife_events") &&
    nightlifeEventLookupCompleted(toolResults) &&
    selectedNightlifeEventVenueNames(toolResults).length === 0
  );
}

export function researchPlacesEnrichmentIsUnavailable(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  return (
    requiredCall.name === "search_places" &&
    requiredCall.dependsOn?.includes("research_web") === true &&
    plan.requiredToolCalls.some((call) => call.name === "research_web") &&
    researchLookupCompleted(toolResults) &&
    selectedResearchEntityNames(toolResults).length === 0
  );
}

function nightlifeEventLookupCompleted(
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  return toolResults.some((result) => result.name === "search_nightlife_events");
}

function researchLookupCompleted(
  toolResults: readonly Pick<AgentToolResult, "name" | "status" | "data">[],
) {
  return toolResults.some((result) => result.name === "research_web");
}

function isCheckedPlacesEvidenceResult(result: AgentToolResult) {
  return (
    result.name === "search_places" &&
    result.status === "success" &&
    result.sources.some(
      (source) => source.label === "live_checked" || source.label === "fresh_cache",
    )
  );
}

function requiredEvidenceAcceptsPlaceCard(
  plan: RequiredEvidencePlan,
  card: RecommendationCard,
  nightlifeVenueNames: readonly string[],
  researchEntityNames: readonly string[],
) {
  const requiresResearchSelectedEntities = plan.requiredToolCalls.some(
    (requiredCall) =>
      requiredCall.name === "search_places" &&
      requiredCall.dependsOn?.includes("research_web") === true,
  );
  if (requiresResearchSelectedEntities) {
    return researchEntityNames.some((entityName) => placeCardMatchesVenue(card, entityName));
  }
  if (
    !plan.requiredToolCalls.some((requiredCall) => requiredCall.name === "search_nightlife_events")
  ) {
    return true;
  }
  return nightlifeVenueNames.some((venueName) => placeCardMatchesVenue(card, venueName));
}

function placeCardMatchesVenue(card: RecommendationCard, venueName: string) {
  const title = normalizeCardVenueText(card.title);
  const venue = normalizeCardVenueText(venueName);
  return title === venue || title.includes(venue) || venue.includes(title);
}

function readNightlifeRouteVenueNames(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !isRecord(data.route)) {
    return [];
  }
  return Object.values(data.route).flatMap((candidate) => readCandidateVenueName(candidate));
}

function readNightlifeCandidateVenueNames(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !Array.isArray(data.candidates)) {
    return [];
  }
  return data.candidates.flatMap((candidate) => readCandidateVenueName(candidate));
}

function readCandidateVenueName(value: unknown) {
  return isRecord(value) && typeof value.venueName === "string" ? [value.venueName] : [];
}

function readResearchEntityNames(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !Array.isArray(data.entities)) {
    return [];
  }
  return data.entities.flatMap((entity) => {
    if (!isRecord(entity) || typeof entity.name !== "string") {
      return [];
    }
    if (entity.needsPlacesEnrichment === false) {
      return [];
    }
    if (
      typeof entity.kind === "string" &&
      !["place", "operator", "event", "service", "activity"].includes(entity.kind)
    ) {
      return [];
    }
    return [entity.name];
  });
}

function normalizeCardVenueText(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/&/g, "and")
    .replaceAll(/[^a-z0-9]+/gi, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values)];
}

function normalizeLookupKey(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
