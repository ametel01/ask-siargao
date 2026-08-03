import { z } from "zod";

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
    /\b(?:reality[-\s]?check|worth\s+(?:booking|going)|should\s+(?:i|we)|good\s+(?:idea|fit)|safe\s+to)\b/i.test(
      value,
    )
  );
}

function isAccommodationCheck(value: string) {
  return (
    /\b(?:hotel|hostel|resort|homestay|villa|accommodation|place\s+to\s+stay|stay\s+at)\b/i.test(
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
      /\b(?:should\s+(?:i|we)|worth\s+(?:going|doing|booking)|keep|change|avoid|still\s+go)\b/i.test(
        value,
      ))
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
