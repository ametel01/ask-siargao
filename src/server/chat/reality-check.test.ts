import { describe, expect, test } from "bun:test";

import {
  parseRealityCheckProposal,
  realityCheckExecutionMode,
  realityCheckKinds,
  realityCheckVerdicts,
  recognizeRealityCheckRequest,
} from "@/server/chat/reality-check";

describe("reality check contract", () => {
  test("defines only on-demand execution and the bounded product vocabulary", () => {
    expect(realityCheckExecutionMode).toBe("on_demand");
    expect(realityCheckKinds).toEqual([
      "accommodation",
      "itinerary",
      "immediate_plan",
      "surf_session",
      "disruption_recovery",
    ]);
    expect(realityCheckVerdicts).toEqual(["keep", "change", "avoid", "needs_confirmation"]);
  });

  test.each([
    ["Reality-check this hotel before I book.", "accommodation", ["subject"]],
    ["Is this four-day itinerary actually feasible?", "itinerary", ["plan"]],
    ["Given today's weather and tide, should we still go to Cloud 9?", "immediate_plan", []],
    [
      "Beginner surf in Pacifico tomorrow morning: does the tide make it worth booking?",
      "surf_session",
      [],
    ],
    ["Our island tour was cancelled. Give us a workable replacement.", "disruption_recovery", []],
  ] as const)("recognizes %s as %s", (latestUserTurn, kind, missingContext) => {
    expect(recognizeRealityCheckRequest({ latestUserTurn })).toEqual({
      explicit: true,
      kind,
      missingContext,
    });
  });

  test("uses bounded recent context only to resolve a referenced subject or plan", () => {
    expect(
      recognizeRealityCheckRequest({
        latestUserTurn: "Reality-check this hotel before I book.",
        recentUserContext: "We are considering Bravo Beach Resort in General Luna.",
      }),
    ).toEqual({ explicit: true, kind: "accommodation", missingContext: [] });
    expect(
      recognizeRealityCheckRequest({
        latestUserTurn: "Is this itinerary feasible?",
        recentUserContext: "Day one is Cloud 9, Pacifico, then dinner in Dapa.",
      }),
    ).toEqual({ explicit: true, kind: "itinerary", missingContext: [] });
  });

  test.each([
    "Where should we eat near Cloud 9?",
    "What is Siargao known for?",
    "Plan a generic beach day.",
    "Show me hotels in General Luna.",
    "What is the weather tomorrow?",
  ])("does not force an ordinary Siargao question into a reality check: %s", (latestUserTurn) => {
    expect(recognizeRealityCheckRequest({ latestUserTurn })).toEqual({
      explicit: false,
      missingContext: [],
    });
  });

  test("requests focused context instead of inventing a decision target", () => {
    expect(recognizeRealityCheckRequest({ latestUserTurn: "Should we still go?" })).toEqual({
      explicit: true,
      kind: "immediate_plan",
      missingContext: ["activity"],
    });
    expect(
      recognizeRealityCheckRequest({ latestUserTurn: "Our plan was cancelled. What now?" }),
    ).toEqual({
      explicit: true,
      kind: "disruption_recovery",
      missingContext: ["disruption"],
    });
  });

  test("parses one strict normalized proposal", () => {
    expect(
      parseRealityCheckProposal({
        kind: "accommodation",
        verdict: "change",
        subject: "  Bravo Beach Resort  ",
        bestAction: "  Choose a room away from the road.  ",
        basis: "  The supplied quiet-sleep constraint changes the room choice.  ",
        fallback: null,
        avoid: "A road-facing room",
        timing: null,
        area: "General Luna",
        evidenceToolCallIds: [" call_places ", "call_local_facts"],
      }),
    ).toEqual({
      kind: "accommodation",
      verdict: "change",
      subject: "Bravo Beach Resort",
      bestAction: "Choose a room away from the road.",
      basis: "The supplied quiet-sleep constraint changes the room choice.",
      avoid: "A road-facing room",
      area: "General Luna",
      evidenceToolCallIds: ["call_places", "call_local_facts"],
    });
  });

  test.each([
    {
      kind: "accommodation",
      verdict: "keep",
      subject: "Hotel",
      bestAction: "Book it.",
      basis: "It fits.",
      evidenceToolCallIds: [],
      scheduler: "nightly",
    },
    {
      kind: "background_monitor",
      verdict: "keep",
      subject: "Hotel",
      bestAction: "Book it.",
      basis: "It fits.",
      evidenceToolCallIds: [],
    },
    {
      kind: "accommodation",
      verdict: "maybe",
      subject: "Hotel",
      bestAction: "Book it.",
      basis: "It fits.",
      evidenceToolCallIds: [],
    },
    {
      kind: "accommodation",
      verdict: "keep",
      subject: "x".repeat(161),
      bestAction: "Book it.",
      basis: "It fits.",
      evidenceToolCallIds: [],
    },
    {
      kind: "accommodation",
      verdict: "keep",
      subject: "Hotel",
      bestAction: "Book it.",
      basis: "It fits.",
      evidenceToolCallIds: Array.from({ length: 13 }, (_, index) => `call_${index}`),
    },
  ])("rejects unsupported or unbounded proposal fields", (proposal) => {
    expect(parseRealityCheckProposal(proposal)).toBeUndefined();
  });
});
