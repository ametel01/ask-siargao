import { describe, expect, test } from "bun:test";

import type { LiveConditionDecision } from "@/features/chat/live-condition-decision";
import { buildSuggestedPrompts } from "@/features/chat/suggested-prompts";
import type { TripContextDraft } from "@/features/chat/trip-context-draft";

describe("suggested prompt generation", () => {
  test("returns concise onboarding prompts when no trip context exists", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext(),
      surfDecision: decision("surf", "loading"),
      weatherDecision: decision("weather", "loading"),
    });

    expect(prompts).toEqual([
      "Reality-check a hotel before I book.",
      "Review my four-day itinerary for feasibility.",
      "Should we still go to Cloud 9 today?",
      "Island tour cancelled—give us a replacement.",
    ]);
    expect(prompts).toHaveLength(4);
  });

  test("uses partial context without inventing dates, area, or live facts", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext({ accommodation: "Pilar homestay" }),
      surfDecision: decision("surf", "unavailable"),
      weatherDecision: decision("weather", "unavailable"),
    });

    expect(prompts).toEqual([
      "Reality-check Pilar homestay before we book.",
      "Reality-check our Siargao plan.",
    ]);
    expect(JSON.stringify(prompts)).not.toContain("Cloud 9");
    expect(JSON.stringify(prompts)).not.toContain("open now");
    expect(JSON.stringify(prompts)).not.toContain("sunny");
  });

  test("includes area-specific and condition-availability prompts without claiming outcomes", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext({ nearbyArea: "Dapa" }),
      surfDecision: decision("surf", "partial"),
      weatherDecision: decision("weather", "live"),
    });

    expect(prompts).toEqual([
      "Reality-check today's plan around Dapa before we go.",
      "Given today's conditions, should we keep our plan around Dapa?",
      "Reality-check a beginner surf session around Dapa for tomorrow morning.",
      "Should an intermediate surfer paddle out around Dapa today?",
    ]);
    expect(prompts.every((prompt) => prompt.includes("Dapa"))).toBe(true);
    expect(prompts.join(" ")).not.toMatch(/\b(?:open now|safe today|raining now|good now)\b/i);
  });

  test("prioritizes no-scooter, kids, quiet-sleep, and rain-sensitive context within four prompts", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext({
        nearbyArea: "General Luna",
        travelerType: "Family with kids, no scooter, quiet sleep, rain-sensitive",
      }),
      surfDecision: decision("surf", "live"),
      weatherDecision: decision("weather", "live"),
    });

    expect(prompts).toEqual([
      "Reality-check our day around General Luna: we have no scooter.",
      "What is wrong with our General Luna plan if we have kids?",
      "Reality-check where we should stay around General Luna for quiet sleep.",
      "Given today's weather, should we keep our plan around General Luna?",
    ]);
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts.map((prompt) => prompt.toLocaleLowerCase())).size).toBe(prompts.length);
  });

  test("uses date-only partial context and stays bounded", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext({ dateRange: "Aug 1 - 6" }),
      surfDecision: decision("surf", "loading"),
      weatherDecision: decision("weather", "loading"),
    });

    expect(prompts).toEqual([
      "Is our Aug 1 - 6 Siargao itinerary actually feasible?",
      "Reality-check our Siargao plan.",
    ]);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts.length).toBeLessThanOrEqual(4);
  });

  test("keeps traveler-type-only context within the two-to-four prompt contract", () => {
    const soloPrompts = buildSuggestedPrompts({
      context: tripContext({ travelerType: "Solo traveler" }),
      surfDecision: decision("surf", "loading"),
      weatherDecision: decision("weather", "unavailable"),
    });
    const unclassifiedPrompts = buildSuggestedPrompts({
      context: tripContext({ travelerType: "Another traveler" }),
      surfDecision: decision("surf", "loading"),
      weatherDecision: decision("weather", "unavailable"),
    });

    expect(soloPrompts).toEqual([
      "What should I prioritize for Solo traveler in Siargao?",
      "Reality-check our Siargao plan.",
    ]);
    expect(unclassifiedPrompts).toEqual([
      "What should I prioritize for Another traveler in Siargao?",
      "Reality-check our Siargao plan.",
    ]);
    expect(soloPrompts).toHaveLength(2);
    expect(unclassifiedPrompts).toHaveLength(2);
    expect(soloPrompts.join(" ")).not.toMatch(/\b(?:open now|safe today|sunny|good now)\b/i);
    expect(unclassifiedPrompts.join(" ")).not.toMatch(
      /\b(?:open now|safe today|sunny|good now)\b/i,
    );
  });
});

function tripContext(context: Partial<TripContextDraft> = {}): TripContextDraft {
  return {
    accommodation: "",
    dateRange: "",
    travelerType: "",
    nearbyArea: "Siargao Island",
    ...context,
  };
}

function decision(
  kind: LiveConditionDecision["kind"],
  state: LiveConditionDecision["state"],
): LiveConditionDecision {
  return {
    kind,
    state,
    action: "Keep the plan flexible.",
    basis: "Signals are bounded.",
    fallback: "Keep a fallback ready.",
    supportingMetrics: [],
    checked: [],
    notChecked: [],
    isPrior: false,
  };
}
