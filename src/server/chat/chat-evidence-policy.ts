import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
} from "@/server/chat/agent-runtime";
import {
  buildRequiredEvidencePlan,
  buildRequiredEvidenceRepair,
  finalPayloadSatisfiesRequiredEvidence,
  type RequiredEvidencePlan,
  requiredEvidencePlaceCardIds,
} from "@/server/chat/required-evidence";

export type ChatEvidencePolicy = {
  requiredEvidencePlan: RequiredEvidencePlan;
};

export function buildChatEvidencePolicy(request: AgentRuntimeRequest): ChatEvidencePolicy {
  return {
    requiredEvidencePlan: buildRequiredEvidencePlan(request),
  };
}

export function buildChatEvidenceRepair({
  policy,
  toolCalls,
  toolResults,
}: {
  policy: ChatEvidencePolicy;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults?: readonly AgentToolResult[];
}) {
  return buildRequiredEvidenceRepair({
    plan: policy.requiredEvidencePlan,
    toolCalls,
    toolResults,
  });
}

export function finalPayloadSatisfiesChatEvidencePolicy(
  policy: ChatEvidencePolicy,
  finalPayload: AgentFinalPayload | undefined,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  return finalPayloadSatisfiesRequiredEvidence(
    policy.requiredEvidencePlan,
    finalPayload,
    toolCalls,
    toolResults,
  );
}

export function applyChatEvidenceFinalPayloadPolicy({
  finalPayload,
  policy,
  request,
  toolCalls,
  toolResults,
}: {
  finalPayload: AgentFinalPayload | undefined;
  policy: ChatEvidencePolicy;
  request: AgentRuntimeRequest;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
}) {
  return ensureFinalPayloadUsesVehicleRentalEvidence(
    exposeRequiredEvidenceArtifacts(finalPayload, policy.requiredEvidencePlan, toolResults),
    request,
    toolCalls,
    toolResults,
  );
}

function exposeRequiredEvidenceArtifacts(
  finalPayload: AgentFinalPayload | undefined,
  requiredEvidencePlan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
) {
  const requiresPlaceEvidence = requiredEvidencePlan.requiredToolCalls.some(
    (requiredCall) => requiredCall.name === "search_places",
  );
  if (!finalPayload || !requiresPlaceEvidence) {
    return finalPayload;
  }

  const placeCardIds = requiredEvidencePlaceCardIds(requiredEvidencePlan, toolResults);
  const requiresNightlifeRouteEvidence = requiredEvidencePlan.requiredToolCalls.some(
    (requiredCall) => requiredCall.name === "search_nightlife_events",
  );
  const requiresResearchSelectedPlaces = requiredEvidencePlan.requiredToolCalls.some(
    (requiredCall) =>
      requiredCall.name === "search_places" &&
      requiredCall.dependsOn?.includes("research_web") === true,
  );
  if (
    (requiresNightlifeRouteEvidence || requiresResearchSelectedPlaces) &&
    placeCardIds.length > 0
  ) {
    return {
      ...finalPayload,
      displayCardIds: placeCardIds,
    };
  }

  if (
    placeCardIds.length === 0 ||
    finalPayload.displayCardIds.some((cardId) => placeCardIds.includes(cardId))
  ) {
    return finalPayload;
  }

  return {
    ...finalPayload,
    displayCardIds: uniqueText([...finalPayload.displayCardIds, ...placeCardIds]),
  };
}

function ensureFinalPayloadUsesVehicleRentalEvidence(
  finalPayload: AgentFinalPayload | undefined,
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  if (!finalPayload || !isVehicleRentalLookup(latestUserContent(request.messages))) {
    return finalPayload;
  }

  const evidenceToolCallIds = preferredVehicleRentalEvidenceToolCallIds(toolCalls, toolResults);
  if (
    evidenceToolCallIds.length === 0 ||
    finalPayload.usedToolCallIds.some((toolCallId) => evidenceToolCallIds.includes(toolCallId))
  ) {
    return finalPayload;
  }

  return {
    ...finalPayload,
    usedToolCallIds: evidenceToolCallIds,
  };
}

function preferredVehicleRentalEvidenceToolCallIds(
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  const ids: string[] = [];
  const latestAvailableResearch = [...toolResults].reverse().find(researchWebResultIsAvailable);
  if (latestAvailableResearch?.toolCallId) {
    ids.push(latestAvailableResearch.toolCallId);
  }

  const latestSuccessfulPlaces = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.name === "search_places" && toolCall.status === "success");
  if (latestSuccessfulPlaces?.toolCallId) {
    ids.push(latestSuccessfulPlaces.toolCallId);
  }

  return ids;
}

function researchWebResultIsAvailable(result: AgentToolResult) {
  return (
    result.name === "research_web" &&
    result.status === "success" &&
    isRecord(result.data) &&
    result.data.status === "available"
  );
}

function latestUserContent(messages: AgentRuntimeRequest["messages"]) {
  return messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

function isVehicleRentalLookup(content: string) {
  return (
    /\b(?:where\s+(?:can|should)\s+(?:i|we)\s+)?(?:rent|rental|rentals|hire|hiring)\b/iu.test(
      content,
    ) &&
    /\b(?:scooters?|motorbikes?|motor\s*bikes?)\b/iu.test(content) &&
    !/\b(?:safe|safety|rain|weather|roads?|flood|conditions?|ride\s+to|drive\s+to)\b/iu.test(
      content,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
