import type { LiveConditionDecision } from "@/features/chat/live-condition-decision";
import type { TripContextDraft } from "@/features/chat/trip-context-draft";

export type SuggestedPromptInput = {
  context: TripContextDraft;
  surfDecision: LiveConditionDecision;
  weatherDecision: LiveConditionDecision;
};

const maxSuggestedPromptCount = 4;

const onboardingPrompts = [
  "Help me choose a Siargao area to stay.",
  "What trip details should I share first?",
  "Plan my Siargao day around my accommodation.",
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
    prompts.push(`Plan a day ${areaPlanSuffix} without relying on a scooter.`);
  }
  if (hasKids) {
    prompts.push(`What kid-friendly plan works ${areaScope} with easy fallback stops?`);
  }
  if (needsQuietSleep) {
    prompts.push(`How can we keep quiet sleep in mind ${areaScope}?`);
  }
  if (isRainSensitive) {
    prompts.push(`What should we do ${areaScope} if rain changes the plan?`);
  }

  if (prompts.length < maxSuggestedPromptCount && area) {
    prompts.push(`What should I plan ${areaScope} with checks before I go?`);
  }
  if (prompts.length < maxSuggestedPromptCount && context.accommodation) {
    prompts.push(`What is practical to do from ${context.accommodation}?`);
  }
  if (prompts.length < maxSuggestedPromptCount && context.dateRange) {
    prompts.push(`Help me plan around my ${context.dateRange} dates.`);
  }
  if (prompts.length < maxSuggestedPromptCount && hasConditionSignals(weatherDecision)) {
    prompts.push(`How should the checked forecast affect my plan ${areaPlanSuffix}?`);
  }
  if (prompts.length < maxSuggestedPromptCount && surfDecision.state === "partial") {
    prompts.push(`What surf plan makes sense ${areaScope} if some condition signals are missing?`);
  }
  if (prompts.length < maxSuggestedPromptCount && hasConditionSignals(surfDecision)) {
    prompts.push(`What should I check before a surf plan ${areaScope}?`);
  }
  if (prompts.length < maxSuggestedPromptCount) {
    prompts.push(`Help me make a flexible plan ${areaScope}.`);
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
