import { describe, expect, test } from "bun:test";

import { deriveTripContext } from "@/server/chat/intent";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

describe("deriveTripContext", () => {
  test("inherits Cloud 9 context for rainy follow-ups", () => {
    const context = deriveTripContext([
      { role: "user", content: "What should I do near Cloud 9 today?" },
      { role: "assistant", content: "Try the boardwalk and nearby cafes." },
      { role: "user", content: "what if it rains?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context).toMatchObject({
      activeGoal: "rain_plan",
      currentArea: "General Luna",
      currentLocation: {
        label: "Cloud 9",
        area: "General Luna",
        source: "user",
      },
    });
    expect(context.temporaryModifiers).toContain("rainy_day");
  });

  test("lets sunset override stale swimming modifiers while keeping beach suitability context", () => {
    const context = deriveTripContext([
      {
        role: "user",
        content: "Which sandy beaches within 30 min ride from General Luna are best for swimming?",
      },
      {
        role: "assistant",
        content: "For swimming, Malinao and Doot are the easiest close sandy options.",
      },
      { role: "user", content: "what about sunset?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context).toMatchObject({
      activeGoal: "beach_sunset",
      currentLocation: {
        label: "General Luna",
      },
      rideTimeLimitMinutes: 30,
      travelerProfile: {
        avoidsRockyBeach: true,
      },
    });
    expect(context.temporaryModifiers).toContain("sunset");
    expect(context.temporaryModifiers).not.toContain("swimming");
    expect(context.durableConstraints).toContain("avoid_rocky_beach");
  });

  test("keeps no-scooter and kids signals as stable context", () => {
    const context = deriveTripContext([
      {
        role: "user",
        content: "We are with kids near General Luna and have no scooter.",
      },
      { role: "assistant", content: "Stay close and keep routes simple." },
      { role: "user", content: "What can we do nearby today?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context.transportMode).toBe("walk");
    expect(context.travelerProfile.withKids).toBe(true);
    expect(context.durableConstraints).toContain("with_kids");
    expect(context.durableConstraints).toContain("no_scooter");
  });

  test("treats cheaper as only a latest-turn budget modifier", () => {
    const context = deriveTripContext([
      { role: "user", content: "Where should we get dinner near Cloud 9?" },
      { role: "assistant", content: "Here are some dinner options." },
      { role: "user", content: "anything cheaper?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context).toMatchObject({
      activeGoal: "food",
      currentLocation: {
        label: "Cloud 9",
      },
    });
    expect(context.travelerProfile.budget).toBeUndefined();
    expect(context.temporaryModifiers).toContain("cheaper");
    expect(context.durableConstraints).not.toContain("budget_cheap");
  });

  test("keeps multi-need stay advice broad instead of collapsing to food", () => {
    const context = deriveTripContext([
      {
        role: "user",
        content:
          "I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants, and easy airport transfer. What should we know?",
      },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context).toMatchObject({
      activeGoal: "trip_advice",
      currentLocation: {
        label: "Cloud 9",
      },
      transportMode: "van",
    });
  });

  test("keeps explicit budget language as durable context", () => {
    const context = deriveTripContext([
      { role: "user", content: "We're on a budget near Cloud 9." },
      { role: "assistant", content: "I will keep options practical." },
      { role: "user", content: "where should we eat?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context.travelerProfile.budget).toBe("cheap");
    expect(context.durableConstraints).toContain("budget_cheap");
  });

  test("resolves there and nearby from prior location context", () => {
    const thereContext = deriveTripContext([
      { role: "user", content: "I am staying near Cloud 9." },
      { role: "assistant", content: "That keeps you close to Catangnan." },
      { role: "user", content: "what is good there if it rains?" },
    ] satisfies AskSiargaoChatMessage[]);
    const nearbyContext = deriveTripContext([
      { role: "user", content: "I am staying near Cloud 9." },
      { role: "assistant", content: "That keeps you close to Catangnan." },
      { role: "user", content: "what cafes are nearby?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(thereContext.currentLocation?.label).toBe("Cloud 9");
    expect(thereContext.unresolvedReference).toBeUndefined();
    expect(nearbyContext.currentLocation?.label).toBe("Cloud 9");
  });

  test("marks there as unresolved when no prior location exists", () => {
    const context = deriveTripContext([{ role: "user", content: "what is good there?" }]);

    expect(context.currentLocation).toBeUndefined();
    expect(context.unresolvedReference).toBe("there");
  });

  test("does not treat existential there as a missing location reference", () => {
    const context = deriveTripContext([
      { role: "user", content: "Are there cafes nearby that are open now?" },
    ]);

    expect(context.currentLocation?.label).toBe("General Luna");
    expect(context.unresolvedReference).toBeUndefined();
    expect(context.temporaryModifiers).toContain("open_now");
  });

  test("does not create Siargao trip context for unrelated generic prompts", () => {
    const context = deriveTripContext([{ role: "user", content: "Who won the NBA finals?" }]);

    expect(context.currentLocation).toBeUndefined();
    expect(context.currentArea).toBeUndefined();
    expect(context.activeGoal).toBeUndefined();
    expect(context.temporaryModifiers).toEqual([]);
    expect(context.durableConstraints).toEqual([]);
  });
});
