import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  RecommendationCard,
  RecommendationCardKind,
} from "@/server/chat/agent-runtime";

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

export function buildRequiredEvidencePlan(request: AgentRuntimeRequest): RequiredEvidencePlan {
  void request;
  return { requiredToolCalls: [] };
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
    if (
      unsatisfiedRequiredCalls.some((requiredCall) => requiredCall.name === "research_web") &&
      !finalPayloadUsesResearchToolCall(finalPayload, toolResults)
    ) {
      return false;
    }
    return terminalOnlyFinalPayloadIsCaveated(finalPayload, unsatisfiedRequiredCalls);
  }
  if (!finalPayloadUsesAvailableResearchEvidence(plan, finalPayload, toolResults)) {
    return false;
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
  const hasUnsatisfiedResearchCheck = unsatisfiedRequiredCalls.some(
    (requiredCall) => requiredCall.name === "research_web",
  );
  if (hasUnsatisfiedResearchCheck) {
    return (
      finalPayload.displayCardIds.length === 0 && hasResearchFailureCaveat(finalPayload.answer)
    );
  }
  return !hasCheckedEvidenceOverclaim(finalPayload.answer, unsatisfiedRequiredCalls);
}

function finalPayloadUsesAvailableResearchEvidence(
  plan: RequiredEvidencePlan,
  finalPayload: AgentFinalPayload | undefined,
  toolResults: readonly AgentToolResult[],
) {
  if (!plan.requiredToolCalls.some((requiredCall) => requiredCall.name === "research_web")) {
    return true;
  }
  const availableResearchResults = toolResults.filter(isAvailableResearchResult);
  if (availableResearchResults.length === 0) {
    return true;
  }
  if (!finalPayloadUsesResearchToolCall(finalPayload, availableResearchResults)) {
    return false;
  }
  const anchors = selectedResearchAnswerAnchorTexts(availableResearchResults);
  if (anchors.length === 0) {
    return true;
  }
  return anchors.some((anchor) => normalizedIncludes(finalPayload?.answer ?? "", anchor));
}

function finalPayloadUsesResearchToolCall(
  finalPayload: AgentFinalPayload | undefined,
  toolResults: readonly Pick<AgentToolResult, "name" | "toolCallId">[],
) {
  if (!finalPayload) {
    return false;
  }
  const researchToolCallIds = new Set(
    toolResults.flatMap((result) =>
      result.name === "research_web" && result.toolCallId ? [result.toolCallId] : [],
    ),
  );
  if (researchToolCallIds.size === 0) {
    return true;
  }
  return finalPayload.usedToolCallIds.some((toolCallId) => researchToolCallIds.has(toolCallId));
}

function isAvailableResearchResult(result: AgentToolResult) {
  return (
    result.name === "research_web" &&
    result.status === "success" &&
    isRecord(result.data) &&
    result.data.status === "available"
  );
}

function selectedResearchAnswerAnchorTexts(toolResults: readonly AgentToolResult[]) {
  return uniqueText(
    toolResults.flatMap((result) => [
      ...readResearchAllEntityNames(result.data),
      ...readPrimaryResearchFindingAnchors(result.data),
    ]),
  ).filter((anchor) => anchor.length >= 4);
}

function hasResearchFailureCaveat(answer: string) {
  const normalizedAnswer = answer.toLowerCase().replace(/\s+/g, " ");
  return /\b(?:could not|couldn't|cannot|can't|unable to|not able to|did not)\s+(?:verify|confirm|check|find)\b[^.?!]{0,120}\b(?:current|public web|web|online|source|evidence|event|schedule|availability|price|rate)\b/iu.test(
    normalizedAnswer,
  );
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

function readResearchAllEntityNames(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !Array.isArray(data.entities)) {
    return [];
  }
  return data.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.name === "string" ? [entity.name] : [],
  );
}

function readPrimaryResearchFindingAnchors(data: AgentToolResult["data"]) {
  if (!isRecord(data) || !Array.isArray(data.findings)) {
    return [];
  }
  return data.findings.flatMap((finding) => {
    if (
      !isRecord(finding) ||
      typeof finding.claim !== "string" ||
      (finding.answerRole !== "primary" && finding.answerRole !== "supporting")
    ) {
      return [];
    }
    const claim = finding.claim.replaceAll(/\s+/g, " ").trim();
    if (claim.length < 12 || claim.length > 180) {
      return [];
    }
    return [claim];
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

function normalizedIncludes(value: string, expected: string) {
  return normalizeLookupKey(value).includes(normalizeLookupKey(expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
