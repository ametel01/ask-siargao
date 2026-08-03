import { describe, expect, test } from "bun:test";

import {
  parseRealityCheckProposal,
  realityCheckExecutionMode,
  realityCheckKinds,
  realityCheckVerdicts,
  recognizeRealityCheckRequest,
  validateRealityCheckProposal,
} from "@/server/chat/reality-check";

const checkedSource = {
  label: "weather_checked" as const,
  sourceName: "Open-Meteo weather API",
  checked: ["forecast"],
  notChecked: [],
};

const unavailableSource = {
  label: "provider_unavailable" as const,
  sourceName: "Open-Meteo weather API",
  checked: [],
  notChecked: ["forecast"],
};

const baseProposal = {
  kind: "immediate_plan" as const,
  verdict: "keep" as const,
  subject: "Cloud 9 sunset today",
  bestAction: "Keep the stop flexible.",
  basis: "The checked forecast supports the planned window.",
  evidenceToolCallIds: ["call_weather"],
};

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

  test("accepts a source-backed current verdict and derives sources from completed calls", () => {
    expect(
      validateRealityCheckProposal({
        expectedKind: "immediate_plan",
        proposal: baseProposal,
        usedToolCallIds: ["call_weather"],
        toolCalls: [
          {
            toolCallId: "call_weather",
            name: "get_weather_forecast",
            status: "success",
            sources: [],
          },
        ],
        toolResults: [
          {
            toolCallId: "call_weather",
            name: "get_weather_forecast",
            status: "success",
            sources: [checkedSource],
          },
        ],
      }),
    ).toEqual({
      status: "valid",
      value: {
        proposal: baseProposal,
        sources: [checkedSource],
        sourceState: "checked",
      },
    });
  });

  test.each([
    {
      name: "a mismatched kind",
      expectedKind: "surf_session" as const,
      proposal: baseProposal,
      usedToolCallIds: ["call_weather"],
      reason: "kind_mismatch",
    },
    {
      name: "an evidence call omitted from used calls",
      expectedKind: "immediate_plan" as const,
      proposal: baseProposal,
      usedToolCallIds: [],
      reason: "unused_evidence_tool_call",
    },
    {
      name: "an unknown evidence call",
      expectedKind: "immediate_plan" as const,
      proposal: { ...baseProposal, evidenceToolCallIds: ["call_unknown"] },
      usedToolCallIds: ["call_unknown"],
      reason: "unknown_evidence_tool_call",
    },
  ])("rejects $name", ({ expectedKind, proposal, usedToolCallIds, reason }) => {
    expect(
      validateRealityCheckProposal({
        expectedKind,
        proposal,
        usedToolCallIds,
        toolCalls: [
          {
            toolCallId: "call_weather",
            name: "get_weather_forecast",
            status: "success",
            sources: [],
          },
        ],
        toolResults: [
          {
            toolCallId: "call_weather",
            name: "get_weather_forecast",
            status: "success",
            sources: [checkedSource],
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason });
  });

  test("rejects a current verdict backed only by non-current local guidance", () => {
    const result = validateRealityCheckProposal({
      expectedKind: "immediate_plan",
      proposal: baseProposal,
      usedToolCallIds: ["call_weather"],
      toolCalls: [
        {
          toolCallId: "call_weather",
          name: "search_local_guide",
          status: "success",
          sources: [],
        },
      ],
      toolResults: [
        {
          toolCallId: "call_weather",
          name: "search_local_guide",
          status: "success",
          sources: [{ ...checkedSource, label: "curated_local_guide" }],
        },
      ],
    });

    expect(result).toEqual({ status: "invalid", reason: "missing_current_evidence" });
  });

  test("does not publish an evidence-free needs-confirmation summary", () => {
    expect(
      validateRealityCheckProposal({
        expectedKind: "accommodation",
        proposal: {
          kind: "accommodation",
          verdict: "needs_confirmation",
          subject: "Unnamed hotel",
          bestAction: "Confirm the listing.",
          basis: "No checks were completed.",
          evidenceToolCallIds: [],
        },
        usedToolCallIds: [],
        toolCalls: [],
        toolResults: [],
      }),
    ).toEqual({ status: "invalid", reason: "missing_evidence" });

    expect(
      validateRealityCheckProposal({
        expectedKind: "accommodation",
        proposal: {
          kind: "accommodation",
          verdict: "needs_confirmation",
          subject: "Unnamed hotel",
          bestAction: "Confirm the listing.",
          basis: "The local query returned no governed evidence.",
          evidenceToolCallIds: ["call_empty"],
        },
        usedToolCallIds: ["call_empty"],
        toolCalls: [
          {
            toolCallId: "call_empty",
            name: "query_local_facts",
            status: "success",
            sources: [],
          },
        ],
        toolResults: [
          {
            toolCallId: "call_empty",
            name: "query_local_facts",
            status: "success",
            sources: [],
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason: "missing_evidence" });
  });

  test("requires property evidence for a decisive named-accommodation verdict", () => {
    const localAreaSource = {
      label: "curated_local_guide" as const,
      sourceName: "Ask Siargao local facts",
      checked: ["General Luna area fit"],
      notChecked: ["property identity", "room noise"],
    };
    const proposal = {
      kind: "accommodation" as const,
      verdict: "keep" as const,
      subject: "Bravo Beach Resort",
      bestAction: "Keep Bravo Beach Resort on the shortlist.",
      basis: "The checked General Luna area fit matches the trip constraints.",
      evidenceToolCallIds: ["call_area"],
    };

    expect(
      validateRealityCheckProposal({
        expectedKind: "accommodation",
        proposal,
        usedToolCallIds: ["call_area"],
        toolCalls: [
          {
            toolCallId: "call_area",
            name: "query_local_facts",
            status: "success",
            sources: [],
          },
        ],
        toolResults: [
          {
            toolCallId: "call_area",
            name: "query_local_facts",
            status: "success",
            sources: [localAreaSource],
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason: "missing_property_evidence" });
  });

  test("rejects unsupported accommodation qualities and accepts explicit uncertainty", () => {
    const propertySource = {
      label: "live_checked" as const,
      sourceName: "Google Places",
      checked: ["property identity", "map link"],
      notChecked: ["room noise", "Wi-Fi reliability"],
    };
    const proposal = {
      kind: "accommodation" as const,
      verdict: "keep" as const,
      subject: "Bravo Beach Resort",
      bestAction: "Book it for quiet rooms and reliable Wi-Fi.",
      basis: "The checked listing confirms the property identity.",
      evidenceToolCallIds: ["call_places"],
    };
    const validationInput = {
      expectedKind: "accommodation" as const,
      usedToolCallIds: ["call_places"],
      toolCalls: [
        {
          toolCallId: "call_places",
          name: "search_places",
          status: "success" as const,
          sources: [],
        },
      ],
      toolResults: [
        {
          toolCallId: "call_places",
          name: "search_places",
          status: "success" as const,
          sources: [propertySource],
        },
      ],
    };

    expect(validateRealityCheckProposal({ ...validationInput, proposal })).toEqual({
      status: "invalid",
      reason: "unsupported_accommodation_claim",
    });
    expect(
      validateRealityCheckProposal({
        ...validationInput,
        proposal: {
          ...proposal,
          bestAction: "Keep it on the shortlist. Room noise and Wi-Fi are not confirmed.",
        },
      }),
    ).toMatchObject({ status: "valid", value: { sourceState: "checked" } });
  });

  test("downgrades a decisive verdict only when failed-provider evidence supports uncertainty", () => {
    const result = validateRealityCheckProposal({
      expectedKind: "immediate_plan",
      proposal: baseProposal,
      usedToolCallIds: ["call_weather"],
      toolCalls: [
        {
          toolCallId: "call_weather",
          name: "get_weather_forecast",
          status: "error",
          sources: [unavailableSource],
        },
      ],
      toolResults: [
        {
          toolCallId: "call_weather",
          name: "get_weather_forecast",
          status: "error",
          sources: [unavailableSource],
        },
      ],
    });

    expect(result.status).toBe("invalid");
    expect(result).toMatchObject({
      reason: "insufficient_source_evidence",
      fallback: {
        proposal: {
          kind: "immediate_plan",
          verdict: "needs_confirmation",
          subject: "Cloud 9 sunset today",
        },
        sources: [unavailableSource],
        sourceState: "unavailable",
      },
    });
  });
});
