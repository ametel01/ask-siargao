import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  RecommendationCardKind,
} from "@/server/chat/agent-runtime";
import { buildPlaceSearchPlan, inferIncludedType } from "@/server/chat/place-search-plan";

export type RequiredEvidencePlan = {
  requiredToolCalls: readonly RequiredEvidenceToolCall[];
  allowedCardKinds?: readonly RecommendationCardKind[];
};

type RequiredEvidenceToolCallBase = {
  arguments: Record<string, unknown>;
  acceptedSourceLabels: readonly string[];
  terminalSourceLabels: readonly string[];
  purpose: string;
};

export type RequiredEvidenceToolCall =
  | RequiredPlaceEvidenceToolCall
  | RequiredWeatherEvidenceToolCall;

export type RequiredPlaceEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "search_places";
  requiresOpenNow: boolean;
};

export type RequiredWeatherEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "get_weather_forecast";
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
  const requiredToolCalls: RequiredEvidenceToolCall[] = [];
  let allowedCardKinds: RequiredEvidencePlan["allowedCardKinds"];

  if (
    placeIntent &&
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
): RequiredEvidenceToolCall[] {
  return plan.requiredToolCalls.filter(
    (requiredCall) => !hasCompletedToolCall(requiredCall, toolCalls),
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
    !plan.requiredToolCalls.every((requiredCall) => hasCompletedToolCall(requiredCall, toolCalls))
  ) {
    return false;
  }
  const unsatisfiedRequiredCalls = plan.requiredToolCalls.filter(
    (requiredCall) => !hasSatisfyingToolCall(requiredCall, toolCalls),
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
    return toolResults.some((result) => result.cards?.some((card) => card.kind === "place"));
  }
  const placeCardIds = new Set(
    toolResults.flatMap((result) =>
      (result.cards ?? []).flatMap((card) => (card.kind === "place" ? [card.id] : [])),
    ),
  );
  return finalPayload.displayCardIds.some((id) => placeCardIds.has(id));
}

function terminalOnlyFinalPayloadIsCaveated(
  finalPayload: AgentFinalPayload | undefined,
  unsatisfiedRequiredCalls: readonly RequiredEvidenceToolCall[],
) {
  if (!finalPayload) {
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

function requiresWeatherEvidence(intent: Record<string, unknown> | undefined) {
  return (
    intent?.weather === true &&
    intent.conditionActivity === undefined &&
    intent.activityPlan !== true &&
    intent.tripAdvice !== true
  );
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

function normalizeLookupKey(value: string) {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
