import type { LiveConditionDecision } from "@/features/chat/live-condition-decision";
import type { TripContextDraft } from "@/features/chat/trip-context-draft";

export type SuggestedPromptInput = {
  context: TripContextDraft;
  surfDecision: LiveConditionDecision;
  weatherDecision: LiveConditionDecision;
};

const maxSuggestedPromptCount = 4;

const onboardingPrompts = [
  "Reality-check a hotel before I book.",
  "Review my four-day itinerary for feasibility.",
  "Should we still go to Cloud 9 today?",
  "Island tour cancelled—give us a replacement.",
] as const;

export function buildSuggestedPrompts({
  context,
  surfDecision,
  weatherDecision,
}: SuggestedPromptInput): string[] {
  const prompts: string[] = [];
  const area = context.nearbyArea === "Siargao Island" ? "" : context.nearbyArea;
  const areaScope = area ? `around ${area}` : "around Siargao";
  const areaPlanSuffix = area ? `around ${area}` : "around Siargao";
  const areaPlan = area ? `${area} plan` : "Siargao plan";
  const hasContext = Boolean(
    area || context.accommodation || context.dateRange || context.travelerType,
  );

  if (!hasContext) {
    return dedupeBoundedPrompts(onboardingPrompts);
  }

  const contextText = [context.accommodation, context.dateRange, context.travelerType, area].join(
    " ",
  );
  const needsNoScooterPlan =
    /\b(?:no|without|avoid|not)\s+(?:a\s+)?(?:scooters?|motorbikes?)\b/i.test(contextText) ||
    /\b(?:do\s+not|don't|cannot|can't)\s+(?:ride|use|drive)\s+(?:a\s+)?(?:scooters?|motorbikes?)\b/i.test(
      contextText,
    );
  const hasKids = /\b(?:kid|kids|child|children|family|families|toddler|baby)\b/i.test(contextText);
  const needsQuietSleep = /\b(?:quiet|sleep|noise|rest)\b/i.test(contextText);
  const isRainSensitive = /\b(?:rain|rainy|wet|storm|covered|indoor|inside)\b/i.test(contextText);

  if (needsNoScooterPlan) {
    prompts.push(`Reality-check our day ${areaPlanSuffix}: we have no scooter.`);
  }
  if (hasKids) {
    prompts.push(`What is wrong with our ${areaPlan} if we have kids?`);
  }
  if (needsQuietSleep) {
    prompts.push(
      context.accommodation
        ? `Reality-check ${context.accommodation} for quiet sleep before we commit.`
        : `Reality-check where we should stay ${areaScope} for quiet sleep.`,
    );
  }
  if (isRainSensitive) {
    prompts.push(`Given today's weather, should we keep our plan ${areaScope}?`);
  }

  if (prompts.length < maxSuggestedPromptCount && area) {
    prompts.push(`Reality-check today's plan ${areaScope} before we go.`);
  }
  if (prompts.length < maxSuggestedPromptCount && context.accommodation) {
    prompts.push(`Reality-check ${context.accommodation} before we book.`);
  }
  if (prompts.length < maxSuggestedPromptCount && context.dateRange) {
    prompts.push(`Is our ${context.dateRange} Siargao itinerary actually feasible?`);
  }
  if (prompts.length < maxSuggestedPromptCount && context.travelerType) {
    prompts.push(`What should I prioritize for ${context.travelerType} in Siargao?`);
  }
  if (prompts.length < maxSuggestedPromptCount && hasConditionSignals(weatherDecision)) {
    prompts.push(`Given today's conditions, should we keep our plan ${areaPlanSuffix}?`);
  }
  if (prompts.length < maxSuggestedPromptCount && surfDecision.state === "partial") {
    prompts.push(`Reality-check a beginner surf session ${areaScope} for tomorrow morning.`);
  }
  if (prompts.length < maxSuggestedPromptCount && hasConditionSignals(surfDecision)) {
    prompts.push(`Should an intermediate surfer paddle out ${areaScope} today?`);
  }
  if (prompts.length < maxSuggestedPromptCount) {
    prompts.push(
      area ? `Reality-check our Siargao plan ${areaScope}.` : "Reality-check our Siargao plan.",
    );
  }

  return dedupeBoundedPrompts(prompts);
}

function hasConditionSignals(decision: LiveConditionDecision) {
  return !["loading", "unavailable"].includes(decision.state);
}

function dedupeBoundedPrompts(prompts: readonly string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const prompt of prompts) {
    const trimmedPrompt = prompt.trim().replace(/\s+/g, " ");
    const key = trimmedPrompt.toLocaleLowerCase();
    if (!trimmedPrompt || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trimmedPrompt);
    if (deduped.length >= maxSuggestedPromptCount) {
      break;
    }
  }

  return deduped;
}
