import type {
  AgentFinalPayload,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentToolResult,
  DecisionSummary,
  RecommendationCard,
  RecommendationCardKind,
} from "@/server/chat/agent-runtime";
import {
  conditionJudgmentRepairCall,
  conditionJudgmentRepairInstruction,
} from "@/server/chat/condition-tools";
import {
  inspectRealityCheckRequest,
  type RealityCheckAccommodationContext,
  type RealityCheckLifecycleArtifacts,
  realityCheckDecisionToolNames,
  resolveRealityCheckLifecycle,
  type ValidatedRealityCheck,
} from "@/server/chat/reality-check";

export type RequiredEvidencePlan = {
  requiredToolCalls: readonly RequiredEvidenceToolCall[];
  allowedCardKinds?: readonly RecommendationCardKind[];
  allowedPlaceNames?: readonly string[];
};

export type RequiredEvidenceRepair = {
  functionCalls: readonly RequiredEvidenceRepairFunctionCall[];
  instruction: string;
};

export type RequiredEvidenceRepairFunctionCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type RequiredEvidenceExecutionOptions<TOutput> = {
  plan: RequiredEvidencePlan;
  functionCalls: readonly RequiredEvidenceRepairFunctionCall[];
  toolResults: readonly AgentToolResult[];
  execute: (functionCall: RequiredEvidenceRepairFunctionCall) => Promise<TOutput>;
  resultOf: (output: TOutput) => AgentToolResult;
  skip: (
    functionCall: RequiredEvidenceRepairFunctionCall,
    result: AgentToolResult,
  ) => TOutput | Promise<TOutput>;
  now?: () => Date;
};

export type RequiredEvidenceAdmissibleEvidence = {
  toolResults: readonly AgentToolResult[];
  allowedCardKinds?: readonly RecommendationCardKind[];
  allowedCardIds?: readonly string[];
};

export type RequiredEvidenceExecutionResult<TOutput> = {
  outputs: readonly TOutput[];
  admissibleEvidence: RequiredEvidenceAdmissibleEvidence;
};

export type RequiredEvidencePolicy = {
  requiredToolNames: readonly RequiredEvidenceToolCall["name"][];
  execute<TOutput>(
    options: Omit<RequiredEvidenceExecutionOptions<TOutput>, "plan">,
  ): Promise<RequiredEvidenceExecutionResult<TOutput>>;
  repair(
    toolCalls: readonly AgentToolCallAudit[],
    toolResults?: readonly AgentToolResult[],
  ): RequiredEvidenceRepair | undefined;
  applyFinalPayload(
    finalPayload: AgentFinalPayload | undefined,
    toolCalls: readonly AgentToolCallAudit[],
    toolResults: readonly AgentToolResult[],
  ): AgentFinalPayload | undefined;
  finalPayloadSatisfies(
    finalPayload: AgentFinalPayload | undefined,
    toolCalls: readonly AgentToolCallAudit[],
    toolResults: readonly AgentToolResult[],
  ): boolean;
  admit(toolResults: readonly AgentToolResult[]): RequiredEvidenceAdmissibleEvidence;
};

export type EvidenceLifecycle = {
  requiredToolNames: readonly RequiredEvidenceToolCall["name"][];
  execute<TOutput>(
    options: Omit<RequiredEvidenceExecutionOptions<TOutput>, "plan">,
  ): Promise<RequiredEvidenceExecutionResult<TOutput>>;
  repairTools(input: {
    toolCalls: readonly AgentToolCallAudit[];
    toolResults: readonly AgentToolResult[];
  }): EvidenceLifecycleToolRepair | undefined;
  repairFinalPayload(input: {
    finalPayload: AgentFinalPayload | undefined;
    toolCalls: readonly AgentToolCallAudit[];
    toolResults: readonly AgentToolResult[];
  }): EvidenceLifecycleRetryRepair | undefined;
  finalize(input: {
    finalPayload: AgentFinalPayload | undefined;
    toolCalls: readonly AgentToolCallAudit[];
    toolResults: readonly AgentToolResult[];
  }): EvidenceLifecycleFinalization;
};

export type EvidenceLifecycleToolRepair = {
  type: "tool";
  functionCalls: readonly RequiredEvidenceRepairFunctionCall[];
  instruction: string;
  payloadKey: "automaticRequiredEvidence" | "validationRepairConditionJudgment";
  payloadMode: "all" | "single";
};

export type EvidenceLifecycleRetryRepair = {
  type: "retry";
  instruction: string;
  payload: unknown;
  payloadKey: "validationRepairRealityCheck" | "validationRepairRequiredEvidence";
};

export type EvidenceLifecycleFinalization = {
  allowedCardIds: readonly string[] | undefined;
  allowedCardKinds: readonly RecommendationCardKind[] | undefined;
  allowedItineraryIds: readonly string[] | undefined;
  answer: string | undefined;
  decisionSummaries: readonly DecisionSummary[];
  finalPayload: AgentFinalPayload | undefined;
  realityCheck: ValidatedRealityCheck | undefined;
  satisfiesRequiredEvidence: boolean;
};

type EvidenceLifecycleRealityCheckOutcome = {
  explicit: boolean;
  answer?: string;
  artifacts?: RealityCheckLifecycleArtifacts;
  summary?: DecisionSummary;
  validated?: ValidatedRealityCheck;
};

type RequiredEvidenceToolCallBase = {
  arguments: Record<string, unknown>;
  acceptedSourceLabels: readonly string[];
  dependsOn?: readonly string[];
  runAfterTerminal?: readonly string[];
  runBefore?: readonly string[];
  terminalSourceLabels: readonly string[];
  purpose: string;
};

export type RequiredEvidenceToolCall =
  | RequiredWebResearchEvidenceToolCall
  | RequiredPlaceEvidenceToolCall
  | RequiredWeatherEvidenceToolCall
  | RequiredNightlifeEventEvidenceToolCall
  | RequiredLocalFactsEvidenceToolCall;

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

export type RequiredLocalFactsEvidenceToolCall = RequiredEvidenceToolCallBase & {
  name: "query_local_facts";
};

export function buildRequiredEvidencePlan(request: AgentRuntimeRequest): RequiredEvidencePlan {
  const latestContent = latestUserContent(request);
  const accommodationContext = inspectRealityCheckRequest(request).accommodation;
  if (accommodationContext) {
    return buildAccommodationRealityCheckEvidencePlan(accommodationContext);
  }
  if (isCurrentGeneralLunaDinnerLookup(latestContent)) {
    return buildCurrentGeneralLunaDinnerEvidencePlan();
  }
  if (isVehicleRentalLookup(latestContent)) {
    return buildVehicleRentalEvidencePlan(latestContent);
  }

  return { requiredToolCalls: [] };
}

export function buildRequiredEvidencePolicy(request: AgentRuntimeRequest): RequiredEvidencePolicy {
  const plan = buildRequiredEvidencePlan(request);
  return {
    requiredToolNames: [...new Set(plan.requiredToolCalls.map((call) => call.name))],
    execute: (options) => executeRequiredEvidence({ plan, ...options }),
    repair: (toolCalls, toolResults = []) =>
      buildRequiredEvidenceRepair({ plan, toolCalls, toolResults }),
    applyFinalPayload: (finalPayload, toolCalls, toolResults) =>
      ensureFinalPayloadUsesVehicleRentalEvidence(finalPayload, request, toolCalls, toolResults),
    finalPayloadSatisfies: (finalPayload, toolCalls, toolResults) =>
      finalPayloadSatisfiesRequiredEvidence(plan, finalPayload, toolCalls, toolResults),
    admit: (toolResults) => admissibleRequiredEvidence(plan, toolResults),
  };
}

export function buildEvidenceLifecycle(
  request: AgentRuntimeRequest,
  options: { enableRealityCheck?: boolean } = {},
): EvidenceLifecycle {
  const requiredEvidence = buildRequiredEvidencePolicy(request);
  const inspectedRealityCheck = inspectRealityCheckRequest(request);
  const realityCheck =
    (options.enableRealityCheck ?? true)
      ? inspectedRealityCheck
      : {
          recognition: { explicit: false as const, missingContext: [] },
          requiresClarification: false,
        };
  const finalize = ({
    finalPayload,
    toolCalls,
    toolResults,
  }: {
    finalPayload: AgentFinalPayload | undefined;
    toolCalls: readonly AgentToolCallAudit[];
    toolResults: readonly AgentToolResult[];
  }): EvidenceLifecycleFinalization => {
    const admissibleEvidence = requiredEvidence.admit(toolResults);
    const allowedCardIdSet = admissibleEvidence.allowedCardIds
      ? new Set(admissibleEvidence.allowedCardIds)
      : undefined;
    const appliedFinalPayload = requiredEvidence.applyFinalPayload(
      finalPayload,
      toolCalls,
      toolResults,
    );
    const admittedFinalPayload =
      appliedFinalPayload && admissibleEvidence.allowedCardIds
        ? {
            ...appliedFinalPayload,
            displayCardIds: appliedFinalPayload.displayCardIds.filter((cardId) =>
              allowedCardIdSet?.has(cardId),
            ),
          }
        : appliedFinalPayload;
    const realityCheckOutcome = resolveEvidenceLifecycleRealityCheck({
      finalPayload: admittedFinalPayload,
      recognition: realityCheck.recognition,
      requestId: request.requestId ?? "reality_check",
      requiredEvidenceAllowedCardIds: admissibleEvidence.allowedCardIds,
      toolCalls,
      toolResults,
    });
    const realityCheckFinalPayload = admittedFinalPayload
      ? {
          ...admittedFinalPayload,
          displayDecisionSummaryIds: realityCheckOutcome.explicit
            ? realityCheckOutcome.summary
              ? [realityCheckOutcome.summary.id]
              : []
            : admittedFinalPayload.displayDecisionSummaryIds,
          ...(realityCheckOutcome.artifacts
            ? {
                displayCardIds: realityCheckOutcome.artifacts.displayCardIds,
                displayItineraryIds: realityCheckOutcome.artifacts.displayItineraryIds,
              }
            : {}),
        }
      : admittedFinalPayload;
    return {
      allowedCardIds:
        realityCheckOutcome.artifacts?.allowedCardIds ?? admissibleEvidence.allowedCardIds,
      allowedCardKinds: admissibleEvidence.allowedCardKinds,
      allowedItineraryIds: realityCheckOutcome.artifacts?.allowedItineraryIds,
      answer: realityCheckOutcome.answer ?? realityCheckFinalPayload?.answer,
      decisionSummaries: realityCheckOutcome.summary ? [realityCheckOutcome.summary] : [],
      finalPayload: realityCheckFinalPayload,
      realityCheck: realityCheckOutcome.validated,
      satisfiesRequiredEvidence: requiredEvidence.finalPayloadSatisfies(
        realityCheckFinalPayload,
        toolCalls,
        toolResults,
      ),
    };
  };
  return {
    requiredToolNames: requiredEvidence.requiredToolNames,
    execute: (options) =>
      executeEvidenceLifecycle({
        request,
        requiredEvidence,
        ...options,
      }),
    repairTools: ({ toolCalls, toolResults }) => {
      if (!realityCheck.requiresClarification) {
        const conditionCall = conditionJudgmentRepairCall(request, toolCalls);
        if (conditionCall) {
          return {
            type: "tool",
            functionCalls: [conditionCall],
            instruction: conditionJudgmentRepairInstruction(conditionCall.arguments),
            payloadKey: "validationRepairConditionJudgment",
            payloadMode: "single",
          };
        }
      }

      const repair = requiredEvidence.repair(toolCalls, toolResults);
      if (repair) {
        return {
          type: "tool",
          functionCalls: repair.functionCalls,
          instruction: repair.instruction,
          payloadKey: "automaticRequiredEvidence",
          payloadMode: "all",
        };
      }
      return undefined;
    },
    repairFinalPayload: ({ finalPayload, toolCalls, toolResults }) => {
      const finalization = finalize({ finalPayload, toolCalls, toolResults });
      if (!finalization.satisfiesRequiredEvidence) {
        return {
          type: "retry",
          payloadKey: "validationRepairRequiredEvidence",
          payload: { issue: "required_evidence_contract_unsatisfied" },
          instruction:
            "Validation repair: your final payload did not satisfy the required evidence contract. If the required provider check succeeded, use the successful checked tool evidence and select only matching public artifacts. If the required provider check was unavailable, revise to a caveated final JSON answer with no checked/live claims and no place cards or checked source claims from the failed provider output.",
        };
      }

      const realityCheckLifecycle = resolveRealityCheckLifecycle({
        requestId: request.requestId ?? "reality_check_repair",
        recognition: realityCheck.recognition,
        finalPayload: finalization.finalPayload,
        toolCalls,
        toolResults,
      });
      if (realityCheckLifecycle.repair) {
        return {
          type: "retry",
          payloadKey: "validationRepairRealityCheck",
          payload: realityCheckLifecycle.repair,
          instruction:
            "Validation repair: this is an explicit on-demand reality check, but the final payload omitted or could not support its realityCheck proposal. Return final JSON with a realityCheck object matching the response contract. Reference only completed toolCallIds that also appear in usedToolCallIds. A keep, change, or avoid verdict needs successful source-backed evidence; current plan and surf verdicts need successful current-condition evidence. If the required provider check failed, use needs_confirmation and a concrete safe next action. Do not invent source objects or artifact IDs.",
        };
      }
      return undefined;
    },
    finalize,
  };
}

function resolveEvidenceLifecycleRealityCheck(input: {
  finalPayload: AgentFinalPayload | undefined;
  recognition: ReturnType<typeof inspectRealityCheckRequest>["recognition"];
  requestId: string;
  requiredEvidenceAllowedCardIds: readonly string[] | undefined;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
}): EvidenceLifecycleRealityCheckOutcome {
  const lifecycle = resolveRealityCheckLifecycle({
    requestId: input.requestId,
    recognition: input.recognition,
    finalPayload: input.finalPayload,
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    requiredEvidenceAllowedCardIds: input.requiredEvidenceAllowedCardIds,
  });

  if (lifecycle.state === "not_requested") {
    return { explicit: false };
  }
  if (lifecycle.state === "needs_context") {
    return { explicit: true };
  }
  if (lifecycle.state === "unresolved" || !lifecycle.validated || !lifecycle.summary) {
    return {
      explicit: true,
      ...(lifecycle.artifacts ? { artifacts: lifecycle.artifacts } : {}),
    };
  }

  return {
    explicit: true,
    ...(lifecycle.repair
      ? { answer: renderRealityCheckFallbackAnswer(lifecycle.validated.proposal) }
      : {}),
    artifacts: lifecycle.artifacts,
    summary: lifecycle.summary,
    validated: lifecycle.validated,
  };
}

function renderRealityCheckFallbackAnswer(proposal: ValidatedRealityCheck["proposal"]) {
  const verdictLabel = proposal.verdict.replaceAll("_", " ");
  return [
    `**${verdictLabel}: ${proposal.subject}**`,
    proposal.bestAction,
    proposal.basis,
    ...(proposal.fallback ? [`Fallback: ${proposal.fallback}`] : []),
    ...(proposal.avoid ? [`Avoid: ${proposal.avoid}`] : []),
    ...(proposal.timing ? [`Timing: ${proposal.timing}`] : []),
    ...(proposal.area ? [`Area: ${proposal.area}`] : []),
  ].join("\n\n");
}

async function executeEvidenceLifecycle<TOutput>({
  request,
  requiredEvidence,
  functionCalls,
  toolResults,
  execute,
  resultOf,
  skip,
  now,
}: Omit<RequiredEvidenceExecutionOptions<TOutput>, "plan"> & {
  request: AgentRuntimeRequest;
  requiredEvidence: RequiredEvidencePolicy;
}): Promise<RequiredEvidenceExecutionResult<TOutput>> {
  const dependencyPlan = currentConditionDependencyPlan({
    functionCalls,
    request,
    toolResults,
  });
  if (!dependencyPlan) {
    return requiredEvidence.execute({
      functionCalls,
      toolResults,
      execute,
      resultOf,
      skip,
      now,
    });
  }

  const upstreamOutputs = await Promise.all(dependencyPlan.upstreamCalls.map(execute));
  const downstream = await executeEvidenceLifecycle({
    request,
    requiredEvidence,
    functionCalls: dependencyPlan.downstreamCalls,
    toolResults: [...toolResults, ...upstreamOutputs.map(resultOf)],
    execute,
    resultOf,
    skip,
    now,
  });
  return {
    outputs: [...upstreamOutputs, ...downstream.outputs],
    admissibleEvidence: downstream.admissibleEvidence,
  };
}

const currentConditionUpstreamToolNames = new Set([
  "get_condition_judgment",
  "get_weather_forecast",
  "get_marine_conditions",
  "get_tide_forecast",
]);

const disruptionUpstreamToolNames = new Set([
  ...currentConditionUpstreamToolNames,
  "query_local_facts",
]);

function currentConditionDependencyPlan(input: {
  functionCalls: readonly RequiredEvidenceRepairFunctionCall[];
  request: AgentRuntimeRequest;
  toolResults: readonly AgentToolResult[];
}) {
  const recognition = inspectRealityCheckRequest(input.request).recognition;
  if (recognition.kind === "disruption_recovery" && recognition.missingContext.length === 0) {
    const upstreamCalls = input.functionCalls.filter((functionCall) =>
      disruptionUpstreamToolNames.has(functionCall.name),
    );
    const hasDependentCall = input.functionCalls.some(
      (functionCall) =>
        realityCheckDecisionToolNames("disruption_recovery").has(functionCall.name) &&
        !disruptionUpstreamToolNames.has(functionCall.name),
    );
    if (upstreamCalls.length > 0 && hasDependentCall) {
      return {
        upstreamCalls,
        downstreamCalls: input.functionCalls.filter(
          (functionCall) => !disruptionUpstreamToolNames.has(functionCall.name),
        ),
      };
    }
  }

  const currentConditionKind =
    recognition.kind === "immediate_plan" || recognition.kind === "surf_session"
      ? recognition.kind
      : undefined;
  if (
    !currentConditionKind ||
    recognition.missingContext.length > 0 ||
    input.toolResults.some((result) => {
      if (result.status !== "success") {
        return false;
      }
      return currentConditionKind === "surf_session"
        ? result.name === "get_condition_judgment"
        : currentConditionUpstreamToolNames.has(result.name);
    })
  ) {
    return undefined;
  }

  const upstreamCalls = input.functionCalls.filter((functionCall) =>
    currentConditionUpstreamToolNames.has(functionCall.name),
  );
  const hasDependentCall = input.functionCalls.some((functionCall) =>
    realityCheckDecisionToolNames(currentConditionKind).has(functionCall.name),
  );
  if (upstreamCalls.length === 0 || !hasDependentCall) {
    return undefined;
  }

  return {
    upstreamCalls,
    downstreamCalls: input.functionCalls.filter(
      (functionCall) => !currentConditionUpstreamToolNames.has(functionCall.name),
    ),
  };
}

export async function executeRequiredEvidence<TOutput>({
  plan,
  functionCalls,
  toolResults,
  execute,
  resultOf,
  skip,
  now = () => new Date(),
}: RequiredEvidenceExecutionOptions<TOutput>): Promise<RequiredEvidenceExecutionResult<TOutput>> {
  const outputs = await executeRequiredEvidenceOutputs({
    plan,
    functionCalls,
    toolResults,
    execute,
    resultOf,
    skip,
    now,
  });
  return {
    outputs,
    admissibleEvidence: admissibleRequiredEvidence(plan, [
      ...toolResults,
      ...outputs.map(resultOf),
    ]),
  };
}

async function executeRequiredEvidenceOutputs<TOutput>({
  plan,
  functionCalls,
  toolResults,
  execute,
  resultOf,
  skip,
  now = () => new Date(),
}: RequiredEvidenceExecutionOptions<TOutput>): Promise<TOutput[]> {
  const dependencyIndex = firstRequiredDependencyIndex(functionCalls, plan);
  if (dependencyIndex >= 0) {
    const dependencyCall = functionCalls[dependencyIndex];
    if (!dependencyCall) {
      return [];
    }
    const dependencyOutput = await execute(dependencyCall);
    const remainingOutputs = await executeRequiredEvidenceOutputs({
      plan,
      functionCalls: functionCalls.filter((_, index) => index !== dependencyIndex),
      toolResults: [...toolResults, resultOf(dependencyOutput)],
      execute,
      resultOf,
      skip,
      now,
    });
    return [dependencyOutput, ...remainingOutputs];
  }

  return Promise.all(
    functionCalls.map(async (functionCall) => {
      const execution = requiredEvidenceFunctionCall(functionCall, plan, toolResults, now);
      return execution.kind === "execute"
        ? execute(execution.functionCall)
        : skip(execution.functionCall, execution.result);
    }),
  );
}

function buildAccommodationRealityCheckEvidencePlan(
  context: RealityCheckAccommodationContext,
): RequiredEvidencePlan {
  const requiredToolCalls: RequiredEvidenceToolCall[] = [];
  if (context.propertyName) {
    const location = inferPlacesRepairLocation(context.content);
    requiredToolCalls.push({
      name: "search_places",
      purpose: "accommodation_property_identity",
      arguments: {
        query: `${context.propertyName} accommodation Siargao`,
        center: location.center,
        radius_meters: Math.max(location.radiusMeters, 12_000),
        constraints: { included_type: "lodging", open_now: null, page_size: 5 },
      },
      acceptedSourceLabels: ["live_checked", "fresh_cache"],
      terminalSourceLabels: ["not_verified", "provider_unavailable"],
      requiresOpenNow: false,
    });
  }

  for (const area of context.areas) {
    requiredToolCalls.push({
      name: "query_local_facts",
      purpose: "accommodation_area_fit",
      arguments: {
        entityTypes: ["area", "route"],
        area: area.toLowerCase(),
        text: area,
        limit: 5,
      },
      acceptedSourceLabels: ["curated_local_guide", "fresh_cache", "live_checked"],
      terminalSourceLabels: ["not_verified", "provider_unavailable"],
    });
  }

  if (context.needsCurrentWebEvidence) {
    requiredToolCalls.push({
      name: "research_web",
      purpose: "accommodation_current_public_claims",
      arguments: {
        query: `${context.propertyName ?? context.areas.join(" versus ")} Siargao current availability price booking details`,
        intent: "availability",
        location: context.areas[0] ?? "Siargao",
        dateContext: "none",
        sourceTypes: ["official", "local_directory", "maps"],
        requiredFreshness: "same_day",
        maxSources: 6,
      },
      acceptedSourceLabels: ["official_checked", "directory_checked", "web_researched"],
      terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
    });
  }

  return {
    requiredToolCalls,
    ...(context.propertyName
      ? { allowedCardKinds: ["place"], allowedPlaceNames: [context.propertyName] }
      : {}),
  };
}

export function missingRequiredEvidenceToolCalls(
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[] = [],
): RequiredEvidenceToolCall[] {
  return plan.requiredToolCalls.filter(
    (requiredCall) =>
      requiredEvidenceToolCallApplies(requiredCall, plan, toolCalls) &&
      !researchPlacesEnrichmentIsUnavailable(requiredCall, plan, toolResults) &&
      !nightlifePlacesEnrichmentIsUnavailable(requiredCall, plan, toolResults) &&
      !dependencyHasTerminalEvidence(requiredCall, plan, toolCalls) &&
      dependenciesHaveSatisfyingEvidence(requiredCall, plan, toolCalls) &&
      !hasCompletedToolCall(requiredCall, toolCalls),
  );
}

export function buildRequiredEvidenceRepair({
  plan,
  toolCalls,
  toolResults = [],
}: {
  plan: RequiredEvidencePlan;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults?: readonly AgentToolResult[];
}): RequiredEvidenceRepair | undefined {
  const missingToolCalls = missingRequiredEvidenceToolCalls(plan, toolCalls, toolResults);
  if (missingToolCalls.length === 0) {
    return undefined;
  }

  return {
    functionCalls: missingToolCalls.map((requiredCall, index) => ({
      callId: `auto_required_evidence_${requiredCall.name}_${index + 1}`,
      name: requiredCall.name,
      arguments: requiredCall.arguments,
    })),
    instruction: requiredEvidenceRepairInstruction(missingToolCalls),
  };
}

export function finalPayloadSatisfiesRequiredEvidence(
  plan: RequiredEvidencePlan,
  finalPayload: AgentFinalPayload | undefined,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  const requiredToolCalls = plan.requiredToolCalls.filter((requiredCall) =>
    requiredEvidenceToolCallApplies(requiredCall, plan, toolCalls),
  );
  if (requiredToolCalls.length === 0) {
    return true;
  }
  if (
    !requiredToolCalls.every(
      (requiredCall) =>
        hasCompletedToolCall(requiredCall, toolCalls) ||
        dependencyHasTerminalEvidence(requiredCall, plan, toolCalls),
    )
  ) {
    return false;
  }
  const unsatisfiedRequiredCalls = requiredToolCalls.filter(
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
  if (!finalPayloadUsesAvailableResearchEvidence(plan, finalPayload, toolCalls, toolResults)) {
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
  if (placeCardIds.size === 0) {
    return true;
  }
  return finalPayload.displayCardIds.some((id) => placeCardIds.has(id));
}

function requiredEvidenceRepairInstruction(missingToolCalls: readonly RequiredEvidenceToolCall[]) {
  const purposes = uniqueText(missingToolCalls.map((call) => call.purpose)).join(", ");
  const purposeClause = purposes ? ` Missing policy purpose(s): ${purposes}.` : "";
  return `Validation repair: required evidence was missing for this answer.${purposeClause} Use these automatically executed required-evidence outputs before the final answer. If a required provider check succeeded, use its checked evidence and select only matching public artifacts. If a required provider check was unavailable or insufficient, keep the answer caveated and avoid checked/live claims from that provider.`;
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

function admissibleRequiredEvidence(
  plan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
): RequiredEvidenceAdmissibleEvidence {
  const hasRequiredPlaces = plan.requiredToolCalls.some(
    (requiredCall) => requiredCall.name === "search_places",
  );
  return {
    toolResults,
    ...(plan.allowedCardKinds ? { allowedCardKinds: plan.allowedCardKinds } : {}),
    ...(hasRequiredPlaces
      ? { allowedCardIds: requiredEvidencePlaceCardIds(plan, toolResults) }
      : {}),
  };
}

function ensureFinalPayloadUsesVehicleRentalEvidence(
  finalPayload: AgentFinalPayload | undefined,
  request: AgentRuntimeRequest,
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  if (!finalPayload || !isVehicleRentalLookup(latestUserContent(request))) {
    return finalPayload;
  }

  const evidenceToolCallIds = preferredVehicleRentalEvidenceToolCallIds(toolCalls, toolResults);
  const evidenceToolCallIdSet = new Set(evidenceToolCallIds);
  if (
    evidenceToolCallIds.length === 0 ||
    finalPayload.usedToolCallIds.some((toolCallId) => evidenceToolCallIdSet.has(toolCallId))
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
  toolCalls: readonly AgentToolCallAudit[],
  toolResults: readonly AgentToolResult[],
) {
  if (
    !plan.requiredToolCalls.some(
      (requiredCall) =>
        requiredCall.name === "research_web" &&
        requiredEvidenceToolCallApplies(requiredCall, plan, toolCalls),
    )
  ) {
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

function buildCurrentGeneralLunaDinnerEvidencePlan(): RequiredEvidencePlan {
  return {
    requiredToolCalls: [
      {
        name: "research_web",
        purpose: "current_public_web_research",
        arguments: {
          query: "what is the current dinner pop-up in General Luna tonight",
          intent: "recommendation",
          location: "General Luna",
          dateContext: "tonight",
          sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
          requiredFreshness: "same_day",
          maxSources: 6,
        },
        acceptedSourceLabels: [
          "official_checked",
          "directory_checked",
          "web_researched",
          "community_signal",
        ],
        terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
        runBefore: ["search_places"],
      },
      {
        name: "search_places",
        purpose: "place_recommendation",
        arguments: {
          query: "research-selected dinner place details in General Luna Siargao",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 12_000,
          constraints: {
            included_type: "restaurant",
            open_now: true,
            page_size: 8,
          },
        },
        acceptedSourceLabels: ["live_checked", "fresh_cache"],
        terminalSourceLabels: ["provider_unavailable"],
        dependsOn: ["research_web"],
        requiresOpenNow: true,
      },
    ],
    allowedCardKinds: ["place"],
  };
}

function buildVehicleRentalEvidencePlan(content: string): RequiredEvidencePlan {
  const location = inferPlacesRepairLocation(content);
  const vehicle = /\bmotor\s*bikes?|motorbikes?\b/iu.test(content) ? "motorbike" : "scooter";

  return {
    requiredToolCalls: [
      {
        name: "search_places",
        purpose: "local_service_places_lookup",
        arguments: {
          query: `${vehicle} rental in ${location.queryLabel} Siargao`,
          center: location.center,
          radius_meters: location.radiusMeters,
          constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
        },
        acceptedSourceLabels: ["live_checked", "fresh_cache"],
        terminalSourceLabels: ["provider_unavailable"],
        requiresOpenNow: false,
      },
      {
        name: "research_web",
        purpose: "local_service_web_fallback",
        arguments: {
          query: `${vehicle} rental in ${location.queryLabel} Siargao Golden Bell Morenta Siargao Motorbike Rentals rates contact WhatsApp deposit helmet delivery`,
          intent: "recommendation",
          location: location.queryLabel,
          dateContext: "none",
          sourceTypes: ["official", "local_directory", "maps", "guide"],
          requiredFreshness: "stable",
          maxSources: 6,
        },
        acceptedSourceLabels: [
          "official_checked",
          "directory_checked",
          "web_researched",
          "community_signal",
        ],
        terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
        runAfterTerminal: ["search_places"],
      },
    ],
    allowedCardKinds: ["place"],
  };
}

type RequiredEvidenceFunctionCallExecution =
  | {
      kind: "execute";
      functionCall: RequiredEvidenceRepairFunctionCall;
    }
  | {
      kind: "skip";
      functionCall: RequiredEvidenceRepairFunctionCall;
      result: AgentToolResult;
    };

function firstRequiredDependencyIndex(
  functionCalls: readonly RequiredEvidenceRepairFunctionCall[],
  plan: RequiredEvidencePlan,
) {
  return functionCalls.findIndex((functionCall) =>
    functionCalls.some((candidateDependentCall) =>
      plan.requiredToolCalls.some(
        (requiredCall) =>
          requiredCall.name === candidateDependentCall.name &&
          (requiredCall.dependsOn?.includes(functionCall.name) === true ||
            requiredCall.runAfterTerminal?.includes(functionCall.name) === true ||
            plan.requiredToolCalls.some(
              (candidatePrerequisite) =>
                candidatePrerequisite.name === functionCall.name &&
                candidatePrerequisite.runBefore?.includes(requiredCall.name) === true,
            )),
      ),
    ),
  );
}

function requiredEvidenceFunctionCall(
  functionCall: RequiredEvidenceRepairFunctionCall,
  plan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
  now: () => Date,
): RequiredEvidenceFunctionCallExecution {
  const terminalDependentCall = plan.requiredToolCalls.find(
    (requiredCall) =>
      requiredCall.name === functionCall.name && requiredCall.runAfterTerminal?.length,
  );
  const terminalDependencyState = terminalDependentCall
    ? terminalDependenciesEvidenceState(terminalDependentCall, plan, toolResults)
    : undefined;
  if (terminalDependentCall && terminalDependencyState === "missing") {
    const prerequisiteName = terminalDependentCall.runAfterTerminal?.[0];
    const prerequisiteCall = plan.requiredToolCalls.find(
      (requiredCall) => requiredCall.name === prerequisiteName,
    );
    if (prerequisiteCall) {
      return {
        kind: "execute",
        functionCall: {
          callId: functionCall.callId,
          name: prerequisiteCall.name,
          arguments: prerequisiteCall.arguments,
        },
      };
    }
  }
  if (terminalDependentCall && terminalDependencyState === "non_terminal") {
    return {
      kind: "skip",
      functionCall,
      result: {
        name: functionCall.name,
        toolCallId: functionCall.callId,
        status: "error",
        errorCode: "not_applicable",
        text: "Skipped terminal-only fallback because its prerequisite did not end in terminal evidence.",
        data: { status: "not_applicable" },
        sources: [],
      },
    };
  }

  if (functionCall.name !== "search_places") {
    return { kind: "execute", functionCall };
  }

  const requiredPlacesCall = plan.requiredToolCalls.find(
    (requiredCall) => requiredCall.name === "search_places",
  );
  if (!requiredPlacesCall) {
    return { kind: "execute", functionCall };
  }

  const researchEntityNames = selectedResearchEntityNames(toolResults);
  if (researchPlacesEnrichmentIsUnavailable(requiredPlacesCall, plan, toolResults)) {
    return skippedPlacesExecution(
      functionCall,
      now,
      "Skipped Google Places enrichment because public web research did not select entities for place-detail lookup.",
      "Google Places research-selected entity enrichment",
      [
        "venue identity, map links, opening-hour signals, ratings, and review counts for research-selected entities",
      ],
    );
  }
  if (researchEntityNames.length > 0) {
    return entityBackedPlacesExecution(
      functionCall,
      requiredPlacesCall.arguments,
      researchEntityNames,
      "Siargao place details",
    );
  }

  if (
    !plan.requiredToolCalls.some((requiredCall) => requiredCall.name === "search_nightlife_events")
  ) {
    return { kind: "execute", functionCall };
  }

  const venueNames = selectedNightlifeEventVenueNames(toolResults);
  if (nightlifePlacesEnrichmentIsUnavailable(requiredPlacesCall, plan, toolResults)) {
    return skippedPlacesExecution(
      functionCall,
      now,
      "Skipped Google Places nightlife enrichment because no selected event-route venues were available.",
      "Google Places nightlife venue enrichment",
      [
        "venue identity, map links, opening-hour signals, ratings, and review counts for selected event-route venues",
      ],
    );
  }
  if (venueNames.length === 0) {
    return { kind: "execute", functionCall };
  }

  return entityBackedPlacesExecution(
    functionCall,
    requiredPlacesCall.arguments,
    venueNames,
    "General Luna Siargao nightlife venues",
  );
}

function terminalDependenciesEvidenceState(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolResults: readonly AgentToolResult[],
): "missing" | "terminal" | "non_terminal" {
  let hasMissingDependency = false;
  const allTerminal = (requiredCall.runAfterTerminal ?? []).every((dependencyName) => {
    const dependencyCall = plan.requiredToolCalls.find((call) => call.name === dependencyName);
    if (!dependencyCall) {
      return false;
    }
    const dependencyResults = toolResults.filter((result) => result.name === dependencyName);
    if (dependencyResults.length === 0) {
      hasMissingDependency = true;
      return false;
    }
    const terminalLabels = new Set(dependencyCall.terminalSourceLabels);
    return dependencyResults.some((result) =>
      result.sources.some((source) => terminalLabels.has(source.label)),
    );
  });
  if (allTerminal) {
    return "terminal";
  }
  return hasMissingDependency ? "missing" : "non_terminal";
}

function entityBackedPlacesExecution(
  functionCall: RequiredEvidenceRepairFunctionCall,
  requiredArguments: Record<string, unknown>,
  entityNames: readonly string[],
  querySuffix: string,
): RequiredEvidenceFunctionCallExecution {
  const requiredConstraints = isRecord(requiredArguments.constraints)
    ? requiredArguments.constraints
    : {};
  return {
    kind: "execute",
    functionCall: {
      ...functionCall,
      arguments: {
        ...requiredArguments,
        ...functionCall.arguments,
        query: `${entityNames.join(" ")} ${querySuffix}`,
        center: isRecord(functionCall.arguments.center)
          ? functionCall.arguments.center
          : requiredArguments.center,
        radius_meters:
          typeof functionCall.arguments.radius_meters === "number"
            ? functionCall.arguments.radius_meters
            : requiredArguments.radius_meters,
        constraints: {
          ...requiredConstraints,
          ...(isRecord(functionCall.arguments.constraints)
            ? functionCall.arguments.constraints
            : {}),
          page_size: Math.min(Math.max(entityNames.length, 1), 8),
        },
      },
    },
  };
}

function skippedPlacesExecution(
  functionCall: RequiredEvidenceRepairFunctionCall,
  now: () => Date,
  reason: string,
  sourceName: string,
  notChecked: readonly string[],
): RequiredEvidenceFunctionCallExecution {
  return {
    kind: "skip",
    functionCall,
    result: {
      name: "search_places",
      toolCallId: functionCall.callId,
      status: "error",
      errorCode: "provider_unavailable",
      text: reason,
      sources: [
        {
          label: "provider_unavailable",
          sourceName,
          sourceProfileId: "source_google_places",
          fetchedAt: now().toISOString(),
          confidence: "low",
          checked: [],
          notChecked: [...notChecked],
        },
      ],
    },
  };
}

function requiredEvidenceToolCallApplies(
  requiredCall: RequiredEvidenceToolCall,
  plan: RequiredEvidencePlan,
  toolCalls: readonly AgentToolCallAudit[],
) {
  return (requiredCall.runAfterTerminal ?? []).every((dependencyName) => {
    const dependencyCall = plan.requiredToolCalls.find((call) => call.name === dependencyName);
    return dependencyCall ? hasTerminalToolCall(dependencyCall, toolCalls) : false;
  });
}

function latestUserContent(request: AgentRuntimeRequest) {
  return request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
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

function isCurrentGeneralLunaDinnerLookup(content: string) {
  return (
    /\bgeneral\s+luna\b/iu.test(content) &&
    /\b(?:current|right\s+now|pop[-\s]?up)\b/iu.test(content) &&
    /\b(?:dinner|pop[-\s]?up|restaurant|food)\b/iu.test(content)
  );
}

function inferPlacesRepairLocation(content: string): {
  queryLabel: string;
  center: { latitude: number; longitude: number };
  radiusMeters: number;
} {
  if (/\bcloud\s*9|cloud9|catangnan\b/iu.test(content)) {
    return {
      queryLabel: "Cloud 9 General Luna",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 6_000,
    };
  }
  if (/\bdel\s+carmen|sugba\b/iu.test(content)) {
    return {
      queryLabel: "Del Carmen",
      center: { latitude: 9.872, longitude: 125.97 },
      radiusMeters: 12_000,
    };
  }
  if (/\bdapa\b/iu.test(content)) {
    return {
      queryLabel: "Dapa",
      center: { latitude: 9.759, longitude: 125.974 },
      radiusMeters: 12_000,
    };
  }
  if (/\bsiargao\b/iu.test(content) && !/\bgeneral\s+luna|\bgl\b/iu.test(content)) {
    return {
      queryLabel: "Siargao",
      center: { latitude: 9.848, longitude: 126.045 },
      radiusMeters: 20_000,
    };
  }
  return {
    queryLabel: "General Luna",
    center: { latitude: 9.784, longitude: 126.158 },
    radiusMeters: 8_000,
  };
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
    if (requiredCall.name === "query_local_facts") {
      return hasLocalFactsCheckedClaim(normalizedAnswer);
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

function hasLocalFactsCheckedClaim(value: string) {
  return /\b(?:local[-\s]?(?:guide|facts?)\s+(?:was|were)?\s*(?:checked|verified|confirmed)|checked\s+(?:local|area|route)\s+(?:guide|facts?|fit)|according\s+to\s+(?:the\s+)?(?:local|area)\s+(?:guide|facts?))\b/iu.test(
    value,
  );
}

function hasSatisfyingToolCall(
  requiredCall: RequiredEvidenceToolCall,
  toolCalls: readonly AgentToolCallAudit[],
) {
  const acceptedSourceLabelSet = new Set(requiredCall.acceptedSourceLabels);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      requiredEvidenceArgumentsMatch(requiredCall, toolCall.arguments) &&
      toolCall.status === "success" &&
      toolCall.sources.some(
        (source) =>
          acceptedSourceLabelSet.has(source.label) &&
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
  const acceptedSourceLabelSet = new Set(requiredCall.acceptedSourceLabels);
  const terminalSourceLabelSet = new Set(requiredCall.terminalSourceLabels);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      requiredEvidenceArgumentsMatch(requiredCall, toolCall.arguments) &&
      (toolCall.sources.some(
        (source) =>
          acceptedSourceLabelSet.has(source.label) || terminalSourceLabelSet.has(source.label),
      ) ||
        (requiredCall.name === "query_local_facts" && toolCall.status === "success")),
  );
}

function hasTerminalToolCall(
  requiredCall: RequiredEvidenceToolCall,
  toolCalls: readonly AgentToolCallAudit[],
) {
  const terminalSourceLabelSet = new Set(requiredCall.terminalSourceLabels);
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === requiredCall.name &&
      requiredEvidenceArgumentsMatch(requiredCall, toolCall.arguments) &&
      toolCall.sources.some((source) => terminalSourceLabelSet.has(source.label)),
  );
}

function requiredEvidenceArgumentsMatch(
  requiredCall: RequiredEvidenceToolCall,
  actualArguments: Record<string, unknown>,
) {
  if (requiredCall.name === "research_web") {
    return requiredWebEvidenceArgumentsMatch(requiredCall, actualArguments);
  }
  if (requiredCall.name === "query_local_facts") {
    const expectedArea =
      typeof requiredCall.arguments.area === "string" ? requiredCall.arguments.area : undefined;
    const actualArea = typeof actualArguments.area === "string" ? actualArguments.area : undefined;
    const entityTypes = Array.isArray(actualArguments.entityTypes)
      ? actualArguments.entityTypes
      : [];
    return (
      (!expectedArea ||
        normalizeLookupKey(actualArea ?? "") === normalizeLookupKey(expectedArea)) &&
      entityTypes.includes("area")
    );
  }
  if (
    requiredCall.name !== "search_places" ||
    requiredCall.purpose !== "local_service_places_lookup"
  ) {
    return true;
  }

  const query = typeof actualArguments.query === "string" ? actualArguments.query : "";
  if (
    !/\b(?:scooters?|motorbikes?|motor\s*bikes?)\b/iu.test(query) ||
    !/\b(?:rent|rental|rentals|hire|hiring)\b/iu.test(query)
  ) {
    return false;
  }
  const constraints = isRecord(actualArguments.constraints) ? actualArguments.constraints : {};
  const includedType =
    typeof constraints.included_type === "string" ? constraints.included_type : undefined;
  return includedType === undefined || includedType === "car_rental";
}

function requiredWebEvidenceArgumentsMatch(
  requiredCall: RequiredWebResearchEvidenceToolCall,
  actualArguments: Record<string, unknown>,
) {
  if (requiredCall.purpose !== "local_service_web_fallback") {
    return true;
  }

  const query = typeof actualArguments.query === "string" ? actualArguments.query : "";
  return (
    /\b(?:scooters?|motorbikes?|motor\s*bikes?)\b/iu.test(query) &&
    /\b(?:rent|rental|rentals|hire|hiring)\b/iu.test(query) &&
    /\b(?:golden\s+bell|morenta|siargao\s+motorbike\s+rentals?)\b/iu.test(query)
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
  if (plan.allowedPlaceNames?.length) {
    return plan.allowedPlaceNames.some((placeName) => placeCardMatchesVenue(card, placeName));
  }
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
