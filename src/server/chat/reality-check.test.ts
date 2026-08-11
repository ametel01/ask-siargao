import { describe, expect, test } from "bun:test";

import {
  inspectRealityCheckRequest,
  parseRealityCheckProposal,
  realityCheckExecutionMode,
  realityCheckKinds,
  realityCheckVerdicts,
  recognizeRealityCheckRequest,
  resolveRealityCheckLifecycle,
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

const marineSource = {
  label: "marine_checked" as const,
  sourceName: "Open-Meteo Marine API",
  checked: ["modelled waves and swell"],
  notChecked: ["exact-break safety"],
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

  test("assembles one ready request context for every Reality Check caller", () => {
    expect(
      inspectRealityCheckRequest({
        messages: [
          {
            role: "user",
            content: "We are considering Bravo Beach Resort in General Luna.",
          },
          { role: "assistant", content: "What would you like checked?" },
          {
            role: "user",
            content: "Reality-check this hotel's current price and availability before I book.",
          },
        ],
        deterministicSignals: {
          context: { tripContext: { accommodation: "Bravo Beach Resort" } },
        },
      }),
    ).toEqual({
      recognition: { explicit: true, kind: "accommodation", missingContext: [] },
      latestUserTurn: "Reality-check this hotel's current price and availability before I book.",
      recentUserContext: "We are considering Bravo Beach Resort in General Luna.",
      content:
        "We are considering Bravo Beach Resort in General Luna. Reality-check this hotel's current price and availability before I book.",
      requiresClarification: false,
      requiresConditionJudgment: false,
      accommodation: {
        areas: ["General Luna"],
        content:
          "We are considering Bravo Beach Resort in General Luna. Reality-check this hotel's current price and availability before I book.",
        propertyName: "Bravo Beach Resort",
        needsCurrentWebEvidence: true,
      },
    });
  });

  test.each([
    "Heavy rain ruined our island day. Give us an alternative instead.",
    "I am too sick for our surf lesson. What should we do instead?",
    "We lost our ride to Pacifico. Give us a backup activity.",
    "We have no scooter now. What should we do instead in General Luna?",
  ])("recognizes traveler-reported disruption state: %s", (latestUserTurn) => {
    expect(recognizeRealityCheckRequest({ latestUserTurn })).toEqual({
      explicit: true,
      kind: "disruption_recovery",
      missingContext: [],
    });
  });

  test("recognizes an inline itinerary with explicit timing as reviewable context", () => {
    expect(
      recognizeRealityCheckRequest({
        latestUserTurn: "Review my plan: Day 1 Cloud 9, then an 8 AM Dapa ferry.",
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
    expect(
      recognizeRealityCheckRequest({
        latestUserTurn: "Should we surf tomorrow?",
      }),
    ).toEqual({
      explicit: true,
      kind: "surf_session",
      missingContext: ["skill_level", "location"],
    });
    expect(
      recognizeRealityCheckRequest({
        latestUserTurn: "As an intermediate surfer, should I paddle out at Cloud 9?",
      }),
    ).toEqual({
      explicit: true,
      kind: "surf_session",
      missingContext: ["timing"],
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

  test("resolves one public summary and governs mixed artifact selections without writing prose", () => {
    const recognition = recognizeRealityCheckRequest({
      latestUserTurn: "Should we still go to Cloud 9 today?",
    });
    const result = resolveRealityCheckLifecycle({
      requestId: "request_reality_check",
      recognition,
      finalPayload: {
        usedToolCallIds: ["call_weather", "call_allowed", "call_unrelated"],
        displayCardIds: ["card_current", "card_unrelated"],
        displayItineraryIds: [],
        realityCheck: baseProposal,
      },
      toolCalls: [
        {
          toolCallId: "call_weather",
          name: "get_weather_forecast",
          status: "success",
          sources: [],
        },
        {
          toolCallId: "call_allowed",
          name: "search_local_guide",
          status: "success",
          sources: [],
        },
        {
          toolCallId: "call_unrelated",
          name: "plan_local_itinerary",
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
        {
          toolCallId: "call_allowed",
          name: "search_local_guide",
          status: "success",
          sources: [checkedSource],
          cards: [
            {
              id: "card_current",
              kind: "place",
              title: "Current option",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
          ],
        },
        {
          toolCallId: "call_unrelated",
          name: "plan_local_itinerary",
          status: "success",
          sources: [checkedSource],
          cards: [
            {
              id: "card_unrelated",
              kind: "place",
              title: "Unrelated option",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      state: "resolved",
      summary: {
        id: expect.stringMatching(/^reality_check:immediate_plan:[a-f0-9]{16}$/),
        kind: "immediate_plan",
        verdict: "keep",
        subject: "Cloud 9 sunset today",
        sources: [checkedSource],
      },
      artifacts: {
        displayCardIds: ["card_current"],
        displayItineraryIds: [],
        allowedCardIds: ["card_current"],
        allowedItineraryIds: [],
      },
    });
    expect(result).not.toHaveProperty("answer");
  });

  test("classifies one repair while accepting a provider-failure fallback", () => {
    const result = resolveRealityCheckLifecycle({
      requestId: "request_provider_failure",
      recognition: recognizeRealityCheckRequest({
        latestUserTurn: "Should we still go to Cloud 9 today?",
      }),
      finalPayload: {
        usedToolCallIds: ["call_weather"],
        displayCardIds: [],
        displayItineraryIds: [],
        realityCheck: baseProposal,
      },
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

    expect(result).toMatchObject({
      state: "resolved",
      repair: {
        expectedKind: "immediate_plan",
        reason: "insufficient_source_evidence",
      },
      validated: {
        proposal: { verdict: "needs_confirmation" },
        sourceState: "unavailable",
      },
      summary: { verdict: "needs_confirmation", sources: [unavailableSource] },
    });
  });

  test("derives the governed condition fallback inside the recognized lifecycle", () => {
    const result = resolveRealityCheckLifecycle({
      requestId: "request_condition_fallback",
      recognition: recognizeRealityCheckRequest({
        latestUserTurn: "Should we still go to Cloud 9 today?",
      }),
      finalPayload: {
        usedToolCallIds: ["call_condition"],
        displayCardIds: [],
        displayItineraryIds: [],
      },
      toolCalls: [
        {
          toolCallId: "call_condition",
          name: "get_condition_judgment",
          status: "success",
          sources: [],
        },
      ],
      toolResults: [
        {
          toolCallId: "call_condition",
          name: "get_condition_judgment",
          status: "success",
          sources: [checkedSource],
          data: { judgment: { recommendation: "flexible" } },
          decisionSummaries: [
            {
              id: "condition_decision:visit:cloud_9:today",
              bestAction: "Keep the Cloud 9 visit flexible.",
              basis: "Checked conditions are mixed.",
              fallback: "Keep a covered stop nearby.",
              timing: "today",
              area: "Cloud 9",
              sources: [checkedSource],
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      state: "resolved",
      recognition: { kind: "immediate_plan" },
      repair: { expectedKind: "immediate_plan", reason: "missing_reality_check" },
      validated: {
        proposal: {
          kind: "immediate_plan",
          verdict: "change",
          subject: "Cloud 9 today",
          evidenceToolCallIds: ["call_condition"],
        },
      },
      summary: { kind: "immediate_plan", verdict: "change", subject: "Cloud 9 today" },
    });
  });

  test("does not auto-select eligible or ineligible artifacts when display IDs are omitted", () => {
    const result = resolveRealityCheckLifecycle({
      requestId: "request_omitted_artifacts",
      recognition: recognizeRealityCheckRequest({
        latestUserTurn: "Should we still go to Cloud 9 today?",
      }),
      finalPayload: {
        usedToolCallIds: ["call_weather", "call_guide", "call_itinerary"],
        displayCardIds: [],
        displayItineraryIds: [],
        realityCheck: baseProposal,
      },
      toolCalls: [
        {
          toolCallId: "call_weather",
          name: "get_weather_forecast",
          status: "success",
          sources: [],
        },
        {
          toolCallId: "call_guide",
          name: "search_local_guide",
          status: "success",
          sources: [],
        },
        {
          toolCallId: "call_itinerary",
          name: "plan_local_itinerary",
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
        {
          toolCallId: "call_guide",
          name: "search_local_guide",
          status: "success",
          sources: [checkedSource],
          cards: [
            {
              id: "card_eligible",
              kind: "place",
              title: "Eligible fallback",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
          ],
        },
        {
          toolCallId: "call_itinerary",
          name: "plan_local_itinerary",
          status: "success",
          sources: [checkedSource],
          cards: [
            {
              id: "card_ineligible",
              kind: "place",
              title: "Ineligible plan card",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
          ],
          itineraries: [
            {
              id: "itinerary_ineligible",
              title: "Ineligible itinerary",
              durationLabel: "Half day",
              stops: [],
              fallbackStops: [],
              skip: [],
              sources: [checkedSource],
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      state: "resolved",
      artifacts: {
        displayCardIds: [],
        displayItineraryIds: [],
        allowedCardIds: ["card_eligible"],
        allowedItineraryIds: [],
      },
    });
  });

  test("filters adversarial mixed accommodation cards at the lifecycle boundary", () => {
    const placesSource = {
      label: "live_checked" as const,
      sourceName: "Google Places",
      checked: ["property identity"],
      notChecked: ["room quality"],
    };
    const result = resolveRealityCheckLifecycle({
      requestId: "request_accommodation_cards",
      recognition: {
        explicit: true,
        kind: "accommodation",
        missingContext: [],
      },
      finalPayload: {
        usedToolCallIds: ["call_places"],
        displayCardIds: ["card_bravo", "card_unrelated"],
        displayItineraryIds: [],
        realityCheck: {
          kind: "accommodation",
          verdict: "keep",
          subject: "Bravo Beach Resort",
          bestAction: "Keep Bravo Beach Resort on the shortlist.",
          basis: "The checked listing confirms the property identity.",
          evidenceToolCallIds: ["call_places"],
        },
      },
      toolCalls: [
        {
          toolCallId: "call_places",
          name: "search_places",
          status: "success",
          sources: [],
        },
      ],
      toolResults: [
        {
          toolCallId: "call_places",
          name: "search_places",
          status: "success",
          sources: [placesSource],
          cards: [
            {
              id: "card_bravo",
              kind: "place",
              title: "Bravo Beach Resort",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
            {
              id: "card_unrelated",
              kind: "place",
              title: "Unrelated Resort",
              fitReasons: [],
              caveats: [],
              sourceLabel: "checked",
            },
          ],
        },
      ],
      requiredEvidenceAllowedCardIds: ["card_bravo"],
    });

    expect(result).toMatchObject({
      state: "resolved",
      artifacts: {
        displayCardIds: ["card_bravo"],
        allowedCardIds: ["card_bravo"],
        displayItineraryIds: [],
        allowedItineraryIds: [],
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

  test("requires a governed condition judgment and marine or tide evidence for surf verdicts", () => {
    const surfProposal = {
      kind: "surf_session" as const,
      verdict: "change" as const,
      subject: "Pacifico beginner surf tomorrow morning",
      bestAction: "Use a coach-confirmed beginner window.",
      basis: "The modelled sea conditions support keeping the session conditional.",
      evidenceToolCallIds: ["call_condition"],
    };
    const call = {
      toolCallId: "call_condition",
      name: "get_condition_judgment",
      status: "success" as const,
      sources: [],
    };

    expect(
      validateRealityCheckProposal({
        expectedKind: "surf_session",
        proposal: surfProposal,
        usedToolCallIds: ["call_condition"],
        toolCalls: [call],
        toolResults: [{ ...call, sources: [checkedSource] }],
      }),
    ).toEqual({ status: "invalid", reason: "missing_surf_evidence" });

    expect(
      validateRealityCheckProposal({
        expectedKind: "surf_session",
        proposal: surfProposal,
        usedToolCallIds: ["call_condition"],
        toolCalls: [call],
        toolResults: [{ ...call, sources: [checkedSource, marineSource] }],
      }),
    ).toMatchObject({
      status: "valid",
      value: {
        sourceState: "checked",
        sources: [checkedSource, marineSource],
      },
    });

    expect(
      validateRealityCheckProposal({
        expectedKind: "surf_session",
        proposal: { ...surfProposal, evidenceToolCallIds: ["call_tide"] },
        usedToolCallIds: ["call_tide"],
        toolCalls: [{ ...call, toolCallId: "call_tide", name: "get_tide_forecast" }],
        toolResults: [
          {
            ...call,
            toolCallId: "call_tide",
            name: "get_tide_forecast",
            sources: [marineSource],
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason: "missing_condition_judgment" });
  });

  test("rejects a surf safety guarantee and preserves partial current source state", () => {
    const surfProposal = {
      kind: "surf_session" as const,
      verdict: "keep" as const,
      subject: "Cloud 9 intermediate surf today",
      bestAction: "It is safe to surf at Cloud 9 today.",
      basis: "The modelled sea conditions are favorable.",
      evidenceToolCallIds: ["call_condition"],
    };
    const call = {
      toolCallId: "call_condition",
      name: "get_condition_judgment",
      status: "success" as const,
      sources: [],
    };
    const partialSources = [checkedSource, marineSource, unavailableSource];

    expect(
      validateRealityCheckProposal({
        expectedKind: "surf_session",
        proposal: surfProposal,
        usedToolCallIds: ["call_condition"],
        toolCalls: [call],
        toolResults: [{ ...call, sources: partialSources }],
      }),
    ).toMatchObject({ status: "invalid", reason: "unsupported_surf_safety_claim" });

    expect(
      validateRealityCheckProposal({
        expectedKind: "surf_session",
        proposal: {
          ...surfProposal,
          bestAction: "Surf only with local-coach confirmation; this does not guarantee safety.",
        },
        usedToolCallIds: ["call_condition"],
        toolCalls: [call],
        toolResults: [{ ...call, sources: partialSources }],
      }),
    ).toMatchObject({ status: "valid", value: { sourceState: "partial" } });
  });

  test("rejects monitoring, operator-action, and availability guarantees in disruption recovery", () => {
    const disruptionCall = {
      toolCallId: "call_replacement",
      name: "search_local_guide",
      status: "success" as const,
      sources: [],
    };
    const disruptionProposal = {
      kind: "disruption_recovery" as const,
      verdict: "change" as const,
      subject: "Traveler-reported cancelled island tour",
      bestAction: "Use the covered General Luna replacement.",
      basis: "The curated local guide supports a land-based fallback.",
      fallback: "Ask Siargao will monitor the operator and notify you.",
      evidenceToolCallIds: ["call_replacement"],
    };

    expect(
      validateRealityCheckProposal({
        expectedKind: "disruption_recovery",
        proposal: disruptionProposal,
        usedToolCallIds: ["call_replacement"],
        toolCalls: [disruptionCall],
        toolResults: [
          {
            ...disruptionCall,
            sources: [{ ...checkedSource, label: "curated_local_guide" }],
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason: "unsupported_disruption_claim" });

    expect(
      validateRealityCheckProposal({
        expectedKind: "disruption_recovery",
        proposal: {
          ...disruptionProposal,
          fallback: "Confirm current opening and availability directly before leaving.",
        },
        usedToolCallIds: ["call_replacement"],
        toolCalls: [disruptionCall],
        toolResults: [
          {
            ...disruptionCall,
            sources: [{ ...checkedSource, label: "curated_local_guide" }],
          },
        ],
      }),
    ).toMatchObject({ status: "valid" });
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
