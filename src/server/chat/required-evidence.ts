import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  RecommendationCardKind,
} from "@/server/chat/agent-runtime";

export type RequiredEvidencePlan = {
  requiredToolCalls: readonly RequiredEvidenceToolCall[];
  allowedCardKinds?: readonly RecommendationCardKind[];
};

export type RequiredEvidenceToolCall = {
  name: "search_places";
  arguments: Record<string, unknown>;
  acceptedSourceLabels: readonly string[];
  requiresOpenNow: boolean;
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
  if (
    !placeIntent ||
    intent?.activityPlan === true ||
    intent?.tripAdvice === true ||
    !requiresPlacesEvidence(placeIntent)
  ) {
    return { requiredToolCalls: [] };
  }

  const center = placesSearchCenter(request, placeIntent);
  if (!center) {
    return { requiredToolCalls: [], allowedCardKinds: ["place"] };
  }

  const includedType = includedTypeForPlaceCategory(placeIntent.category);
  const requiresOpenNow = requiresOpenNowEvidence(placeIntent);
  return {
    requiredToolCalls: [
      {
        name: "search_places",
        arguments: {
          query: placesSearchQuery(placeIntent),
          center,
          radius_meters: placeIntent.radiusMeters ?? 12_000,
          constraints: {
            included_type: includedType,
            open_now: requiresOpenNow,
            page_size: 8,
          },
        },
        acceptedSourceLabels: ["live_checked", "fresh_cache"],
        requiresOpenNow,
      },
    ],
    allowedCardKinds: ["place"],
  };
}

export function missingRequiredEvidenceToolCalls(
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
): RequiredEvidenceToolCall[] {
  return plan.requiredToolCalls.filter(
    (requiredCall) => !hasSatisfyingToolCall(requiredCall, toolCalls),
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
    !plan.requiredToolCalls.every((requiredCall) => hasSatisfyingToolCall(requiredCall, toolCalls))
  ) {
    return false;
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
  };
}

function requiresPlacesEvidence(placeIntent: PlaceIntentSignal) {
  return (
    placeIntent.category === "food" ||
    placeIntent.category === "coffee" ||
    placeIntent.category === "bar" ||
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

function includedTypeForPlaceCategory(category: string | undefined) {
  if (category === "coffee") {
    return "cafe";
  }
  if (category === "bar") {
    return "bar";
  }
  if (category === "food") {
    return "restaurant";
  }
  return null;
}

function requiresOpenNowEvidence(placeIntent: PlaceIntentSignal) {
  const liveNeeds = new Set(
    placeIntent.liveNeeds?.filter((item): item is string => typeof item === "string"),
  );
  return liveNeeds.has("open_now") || liveNeeds.has("hours") || placeIntent.meal === "dinner";
}

function placesSearchQuery(placeIntent: PlaceIntentSignal) {
  const location = placeIntent.location ?? "General Luna";
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
  if (placeIntent.category === "service") {
    return `services near ${location} Siargao`;
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
          (!requiredCall.requiresOpenNow ||
            source.checked.some((item) => /\bopen[- ]?now signal\b/i.test(item))),
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
