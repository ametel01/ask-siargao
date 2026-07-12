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
      "Help me choose a Siargao area to stay.",
      "What trip details should I share first?",
      "Plan my Siargao day around my accommodation.",
    ]);
    expect(prompts).toHaveLength(3);
  });

  test("uses partial context without inventing dates, area, or live facts", () => {
    const prompts = buildSuggestedPrompts({
      context: tripContext({ accommodation: "Pilar homestay" }),
      surfDecision: decision("surf", "unavailable"),
      weatherDecision: decision("weather", "unavailable"),
    });

    expect(prompts).toEqual([
      "What is practical to do from Pilar homestay?",
      "Help me make a flexible plan around Siargao.",
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
      "What should I plan around Dapa with checks before I go?",
      "How should the checked forecast affect my plan around Dapa?",
      "What surf plan makes sense around Dapa if some condition signals are missing?",
      "What should I check before a surf plan around Dapa?",
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
      "Plan a day around General Luna without relying on a scooter.",
      "What kid-friendly plan works around General Luna with easy fallback stops?",
      "How can we keep quiet sleep in mind around General Luna?",
      "What should we do around General Luna if rain changes the plan?",
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
      "Help me plan around my Aug 1 - 6 dates.",
      "Help me make a flexible plan around Siargao.",
    ]);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts.length).toBeLessThanOrEqual(4);
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
