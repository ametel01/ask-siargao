import { z } from "zod";

import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

export const realityCheckExecutionMode = "on_demand" as const;

export const realityCheckKinds = [
  "accommodation",
  "itinerary",
  "immediate_plan",
  "surf_session",
  "disruption_recovery",
] as const;

export type RealityCheckKind = (typeof realityCheckKinds)[number];

export const realityCheckVerdicts = ["keep", "change", "avoid", "needs_confirmation"] as const;

export type RealityCheckVerdict = (typeof realityCheckVerdicts)[number];

export type RealityCheckMissingContext = "subject" | "plan" | "activity" | "disruption";

export type RealityCheckRecognition = {
  explicit: boolean;
  kind?: RealityCheckKind;
  missingContext: readonly RealityCheckMissingContext[];
};

export type RealityCheckRecognitionInput = {
  latestUserTurn: string;
  recentUserContext?: string;
};

export type RealityCheckProposal = {
  kind: RealityCheckKind;
  verdict: RealityCheckVerdict;
  subject: string;
  bestAction: string;
  basis: string;
  fallback?: string;
  avoid?: string;
  timing?: string;
  area?: string;
  evidenceToolCallIds: readonly string[];
};

export type RealityCheckEvidenceCall = {
  toolCallId?: string;
  name: string;
  status: "success" | "error";
  sources: readonly AnswerSourceSummary[];
};

export type RealityCheckSourceState = "checked" | "partial" | "unavailable";

export type ValidatedRealityCheck = {
  proposal: RealityCheckProposal;
  sources: readonly AnswerSourceSummary[];
  sourceState: RealityCheckSourceState;
};

export type RealityCheckValidationReason =
  | "kind_mismatch"
  | "missing_evidence"
  | "unknown_evidence_tool_call"
  | "unused_evidence_tool_call"
  | "incomplete_evidence_tool_call"
  | "insufficient_source_evidence"
  | "missing_current_evidence"
  | "missing_property_evidence"
  | "unsupported_accommodation_claim";

export type RealityCheckValidationResult =
  | { status: "valid"; value: ValidatedRealityCheck }
  | {
      status: "invalid";
      reason: RealityCheckValidationReason;
      fallback?: ValidatedRealityCheck;
    };

const optionalNullableText = (maxLength: number) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).max(maxLength).optional(),
  );

const realityCheckProposalSchema = z.strictObject({
  kind: z.enum(realityCheckKinds),
  verdict: z.enum(realityCheckVerdicts),
  subject: z.string().trim().min(1).max(160),
  bestAction: z.string().trim().min(1).max(320),
  basis: z.string().trim().min(1).max(600),
  fallback: optionalNullableText(320),
  avoid: optionalNullableText(320),
  timing: optionalNullableText(120),
  area: optionalNullableText(160),
  evidenceToolCallIds: z.array(z.string().trim().min(1).max(160)).max(12),
});

export function parseRealityCheckProposal(value: unknown): RealityCheckProposal | undefined {
  const result = realityCheckProposalSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  return {
    ...result.data,
    evidenceToolCallIds: uniqueText(result.data.evidenceToolCallIds),
  };
}

export function validateRealityCheckProposal(input: {
  expectedKind: RealityCheckKind;
  proposal: RealityCheckProposal;
  usedToolCallIds: readonly string[];
  toolCalls: readonly RealityCheckEvidenceCall[];
  toolResults: readonly RealityCheckEvidenceCall[];
}): RealityCheckValidationResult {
  if (input.proposal.kind !== input.expectedKind) {
    return { status: "invalid", reason: "kind_mismatch" };
  }

  const evidenceIds = input.proposal.evidenceToolCallIds;
  if (evidenceIds.length === 0) {
    return { status: "invalid", reason: "missing_evidence" };
  }

  const usedToolCallIds = new Set(input.usedToolCallIds);
  if (evidenceIds.some((id) => !usedToolCallIds.has(id))) {
    return { status: "invalid", reason: "unused_evidence_tool_call" };
  }

  const callsById = evidenceByToolCallId(input.toolCalls);
  const resultsById = evidenceByToolCallId(input.toolResults);
  if (evidenceIds.some((id) => !callsById.has(id) || !resultsById.has(id))) {
    return { status: "invalid", reason: "unknown_evidence_tool_call" };
  }

  const evidenceCalls = evidenceIds.flatMap((id) => {
    const call = callsById.get(id);
    const result = resultsById.get(id);
    return call && result ? [{ call, result }] : [];
  });
  if (
    evidenceCalls.some(
      ({ call, result }) => call.status !== result.status || call.name !== result.name,
    )
  ) {
    return { status: "invalid", reason: "incomplete_evidence_tool_call" };
  }

  const successfulResults = evidenceCalls
    .map(({ result }) => result)
    .filter((result) => result.status === "success");
  const failedResults = evidenceCalls
    .map(({ result }) => result)
    .filter((result) => result.status === "error");
  const sources = dedupeSources(evidenceCalls.flatMap(({ result }) => result.sources));
  const sourceState = realityCheckSourceState(successfulResults, failedResults);

  if (
    input.expectedKind === "accommodation" &&
    hasUnsupportedAccommodationQualityClaim(input.proposal, sources)
  ) {
    return invalidWithUnavailableFallback({
      proposal: input.proposal,
      sources,
      sourceState,
      reason: "unsupported_accommodation_claim",
    });
  }

  if (input.proposal.verdict === "needs_confirmation") {
    if (sources.length === 0) {
      return { status: "invalid", reason: "missing_evidence" };
    }
    return {
      status: "valid",
      value: { proposal: input.proposal, sources, sourceState },
    };
  }

  const successfulSources = dedupeSources(
    successfulResults
      .flatMap((result) => result.sources)
      .filter((source) => verifyingSourceLabels.has(source.label)),
  );
  if (successfulSources.length === 0) {
    return invalidWithUnavailableFallback({
      proposal: input.proposal,
      sources,
      sourceState,
      reason: "insufficient_source_evidence",
    });
  }

  if (
    requiresCurrentEvidence(input.expectedKind) &&
    !successfulResults.some((result) => currentEvidenceToolNames.has(result.name))
  ) {
    return invalidWithUnavailableFallback({
      proposal: input.proposal,
      sources,
      sourceState,
      reason: "missing_current_evidence",
    });
  }

  if (
    input.expectedKind === "accommodation" &&
    !accommodationSubjectIsAreaOnly(input.proposal.subject) &&
    !successfulResults.some(
      (result) => result.name === "search_places" || result.name === "get_place_details",
    )
  ) {
    return invalidWithUnavailableFallback({
      proposal: input.proposal,
      sources,
      sourceState,
      reason: "missing_property_evidence",
    });
  }

  return {
    status: "valid",
    value: { proposal: input.proposal, sources, sourceState },
  };
}

const currentEvidenceToolNames = new Set([
  "get_condition_judgment",
  "get_weather_forecast",
  "get_marine_conditions",
  "get_tide_forecast",
]);

const verifyingSourceLabels = new Set([
  "live_checked",
  "fresh_cache",
  "event_checked",
  "venue_checked",
  "curated_local_guide",
  "weather_checked",
  "marine_checked",
  "tide_forecast_checked",
  "community_signal",
  "web_researched",
  "official_checked",
  "directory_checked",
]);

function requiresCurrentEvidence(kind: RealityCheckKind) {
  return kind === "immediate_plan" || kind === "surf_session";
}

function evidenceByToolCallId(calls: readonly RealityCheckEvidenceCall[]) {
  return new Map(
    calls.flatMap((call) => (call.toolCallId ? [[call.toolCallId, call] as const] : [])),
  );
}

function realityCheckSourceState(
  successfulResults: readonly RealityCheckEvidenceCall[],
  failedResults: readonly RealityCheckEvidenceCall[],
): RealityCheckSourceState {
  if (successfulResults.length > 0 && failedResults.length > 0) {
    return "partial";
  }
  return successfulResults.length > 0 ? "checked" : "unavailable";
}

function invalidWithUnavailableFallback(input: {
  proposal: RealityCheckProposal;
  sources: readonly AnswerSourceSummary[];
  sourceState: RealityCheckSourceState;
  reason: Extract<
    RealityCheckValidationReason,
    | "insufficient_source_evidence"
    | "missing_current_evidence"
    | "missing_property_evidence"
    | "unsupported_accommodation_claim"
  >;
}): RealityCheckValidationResult {
  if (!hasTerminalUnavailableSource(input.sources)) {
    return { status: "invalid", reason: input.reason };
  }
  return {
    status: "invalid",
    reason: input.reason,
    fallback: {
      proposal: {
        ...input.proposal,
        verdict: "needs_confirmation",
        bestAction: `Confirm ${input.proposal.subject} before committing.`,
        basis:
          "A required check was unavailable, so a reliable keep, change, or avoid verdict is not supported yet.",
      },
      sources: input.sources,
      sourceState: input.sourceState,
    },
  };
}

function hasTerminalUnavailableSource(sources: readonly AnswerSourceSummary[]) {
  return sources.some(
    (source) =>
      source.label === "provider_unavailable" || source.label === "insufficient_web_evidence",
  );
}

const accommodationAreaNames = new Set([
  "general luna",
  "cloud 9",
  "malinao",
  "pacifico",
  "dapa",
  "del carmen",
  "alegria",
]);

function accommodationSubjectIsAreaOnly(subject: string) {
  const parts = subject
    .toLowerCase()
    .split(/\s+(?:vs\.?|versus|or)\s+|\s*\/\s*/u)
    .map((part) => part.trim());
  return parts.length > 0 && parts.every((part) => accommodationAreaNames.has(part));
}

const unsupportedAccommodationQualities = [
  /\bquiet(?:ness)?\b|\bnoise|noisy\b/iu,
  /\bflood(?:ing|ed)?\b/iu,
  /\b(?:wi[-\s]?fi|internet|signal)\b/iu,
  /\b(?:power|electricity|brownouts?|generator)\b/iu,
  /\b(?:room\s+condition|clean(?:liness)?|mold|maintenance)\b/iu,
  /\b(?:available|availability|vacancy|vacancies)\b/iu,
] as const;

function hasUnsupportedAccommodationQualityClaim(
  proposal: RealityCheckProposal,
  sources: readonly AnswerSourceSummary[],
) {
  const checkedText = sources.flatMap((source) => source.checked).join(" ");
  const proposalText = [proposal.bestAction, proposal.basis, proposal.fallback, proposal.avoid]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return unsupportedAccommodationQualities.some((qualityPattern) => {
    if (!qualityPattern.test(proposalText) || qualityPattern.test(checkedText)) {
      return false;
    }
    const sentences = proposalText.split(/(?<=[.!?])\s+/u);
    return sentences.some(
      (sentence) =>
        qualityPattern.test(sentence) &&
        !/\b(?:unknown|not\s+checked|not\s+confirmed|unverified|cannot\s+(?:confirm|verify)|could\s+not\s+(?:confirm|verify)|confirm\s+(?:directly|before)|ask\s+the\s+(?:hotel|property)|do\s+not\s+assume|no\s+reliable\s+evidence)\b/iu.test(
          sentence,
        ),
    );
  });
}

function dedupeSources(sources: readonly AnswerSourceSummary[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify(source);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function recognizeRealityCheckRequest(
  input: RealityCheckRecognitionInput,
): RealityCheckRecognition {
  const latestUserTurn = normalizedRecognitionText(input.latestUserTurn, 2_000);
  const recentUserContext = normalizedRecognitionText(input.recentUserContext ?? "", 4_000);
  const context = [recentUserContext, latestUserTurn].filter(Boolean).join(" ");
  const kind = recognizeRealityCheckKind(latestUserTurn);
  if (!kind) {
    return { explicit: false, missingContext: [] };
  }

  return {
    explicit: true,
    kind,
    missingContext: missingRealityCheckContext(kind, latestUserTurn, context, recentUserContext),
  };
}

function recognizeRealityCheckKind(latestUserTurn: string): RealityCheckKind | undefined {
  if (isDisruptionRecoveryRequest(latestUserTurn)) {
    return "disruption_recovery";
  }
  if (isSurfSessionCheck(latestUserTurn)) {
    return "surf_session";
  }
  if (isAccommodationCheck(latestUserTurn)) {
    return "accommodation";
  }
  if (isItineraryCheck(latestUserTurn)) {
    return "itinerary";
  }
  if (isImmediatePlanCheck(latestUserTurn)) {
    return "immediate_plan";
  }
  return undefined;
}

function isDisruptionRecoveryRequest(value: string) {
  return (
    /\b(?:cancelled|canceled|closed|stranded|called\s+off|not\s+running|unavailable)\b/i.test(
      value,
    ) &&
    /\b(?:replacement|alternative|instead|what\s+now|what\s+should\s+we\s+do|new\s+plan|backup)\b/i.test(
      value,
    )
  );
}

function isSurfSessionCheck(value: string) {
  return (
    /\b(?:surf|surfing|paddle\s+out|break)\b/i.test(value) &&
    /\b(?:reality[-\s]?check|worth\s+(?:booking|going)|should\s+(?:i|we)\s+(?:surf|go\s+surfing|paddle\s+out|book)|good\s+(?:idea|fit)|safe\s+to)\b/i.test(
      value,
    )
  );
}

function isAccommodationCheck(value: string) {
  return (
    /\b(?:hotel|hostel|resort|homestay|villa|accommodation|place\s+to\s+stay|stay\s+(?:at|in))\b/i.test(
      value,
    ) &&
    /\b(?:reality[-\s]?check|before\s+(?:i|we)\s+book|should\s+(?:i|we)\s+(?:book|stay)|is\s+.+\s+(?:a\s+)?good\s+(?:fit|choice))\b/i.test(
      value,
    )
  );
}

function isItineraryCheck(value: string) {
  return (
    /\b(?:itinerary|day[-\s]?by[-\s]?day|\d+[-\s]?day\s+plan|four[-\s]?day\s+plan|this\s+plan)\b/i.test(
      value,
    ) &&
    /\b(?:reality[-\s]?check|feasible|workable|realistic|review|critique|what(?:'s|\s+is)\s+wrong|does\s+(?:it|this)\s+work)\b/i.test(
      value,
    )
  );
}

function isImmediatePlanCheck(value: string) {
  return (
    /\bshould\s+(?:i|we)\s+still\b/i.test(value) ||
    (/\b(?:today|tonight|tomorrow|right\s+now|this\s+(?:morning|afternoon|evening))\b/i.test(
      value,
    ) &&
      /\b(?:worth\s+(?:going|doing|booking)|keep|change|avoid|still\s+go)\b/i.test(value))
  );
}

function missingRealityCheckContext(
  kind: RealityCheckKind,
  latestUserTurn: string,
  context: string,
  recentUserContext: string,
): RealityCheckMissingContext[] {
  switch (kind) {
    case "accommodation":
      return referencesUnresolvedAccommodation(latestUserTurn, recentUserContext)
        ? ["subject"]
        : [];
    case "itinerary":
      return referencesUnresolvedItinerary(latestUserTurn, recentUserContext) ? ["plan"] : [];
    case "immediate_plan":
      return hasDecisionActivityContext(context) ? [] : ["activity"];
    case "surf_session":
      return [];
    case "disruption_recovery":
      return hasNamedDisruption(latestUserTurn) ? [] : ["disruption"];
  }
}

function referencesUnresolvedAccommodation(latestUserTurn: string, recentUserContext: string) {
  const usesReference = /\b(?:this|the)\s+(?:hotel|hostel|resort|villa|accommodation)\b/i.test(
    latestUserTurn,
  );
  return usesReference && !hasNamedAccommodationContext(recentUserContext);
}

function hasNamedAccommodationContext(value: string) {
  return (
    /\b(?:hotel|hostel|resort|homestay|villa|accommodation)\b/i.test(value) &&
    value.split(" ").length >= 4
  );
}

function referencesUnresolvedItinerary(latestUserTurn: string, recentUserContext: string) {
  const usesReference = /\b(?:this|my|our)\s+(?:\w+[-\s]day\s+)?(?:itinerary|plan)\b/i.test(
    latestUserTurn,
  );
  return usesReference && !hasItineraryDetails(recentUserContext);
}

function hasItineraryDetails(value: string) {
  return /\b(?:day\s*(?:one|two|three|four|five|six|seven|\d+)|then|morning|afternoon|evening|ferry|airport)\b/i.test(
    value,
  );
}

function hasDecisionActivityContext(value: string) {
  return /\b(?:cloud\s*9|beach|island|tour|boat|ferry|surf|swim|sunset|sugba|magpupungko|pacifico|dapa|general\s+luna|restaurant|dinner|ride|trip)\b/i.test(
    value,
  );
}

function hasNamedDisruption(value: string) {
  return /\b(?:island\s+tour|boat|ferry|flight|lesson|surf|restaurant|venue|transfer|ride|reservation|booking|activity)\b/i.test(
    value,
  );
}

function normalizedRecognitionText(value: string, maxLength: number) {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values)];
}
