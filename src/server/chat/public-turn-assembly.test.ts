import { describe, expect, test } from "bun:test";

import {
  type AgentToolCallAudit,
  type AgentTurnResult,
  createAgentTurnResult,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  assemblePublicChatTurn,
  displayReadyStoredChatTurn,
} from "@/server/chat/public-turn-assembly";

const missingBrowserGeolocation = {
  status: "missing",
  source: "browser_geolocation",
} as const;

describe("public chat turn assembly", () => {
  test("repairs malformed rendered source lines before returning public message", () => {
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result: agentTurnResult({
        message: [
          "Use the simple General Luna dinner plan.",
          "Checked: Mystery feed (mystery label) - unbacked source line.",
        ].join("\n"),
      }),
    });

    expect(turn.display.message).toBe("Use the simple General Luna dinner plan.");
    expect(turn.storage.message).toBe(turn.display.message);
    expect(turn.repair).toEqual({
      issueCount: 1,
      repairedLineCount: 1,
    });
  });

  test("projects stored history tool calls without raw arguments or result text", () => {
    const rawToolCall = toolCall({
      arguments: {
        latitude: 9.8116,
        longitude: 126.1651,
        query: "raw private nearby search",
      },
      resultText: "Raw provider payload should not be stored.",
    });
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result: agentTurnResult({
        message: "Two nearby options look good.",
        toolCalls: [rawToolCall],
      }),
    });

    expect(turn.display.toolCalls).toEqual([
      {
        id: "audit_search_places",
        toolCallId: "call_search_places",
        name: "search_places",
        status: "success",
        durationMs: 12,
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:00:00.012Z",
        sourceProfileIds: [],
        sources: [],
      },
    ]);
    expect(turn.storage.toolCalls).toEqual(turn.display.toolCalls);
    expect(JSON.stringify(turn.storage.toolCalls)).not.toContain("arguments");
    expect(JSON.stringify(turn.storage.toolCalls)).not.toContain("resultText");
    expect(JSON.stringify(turn.storage.toolCalls)).not.toContain("raw private nearby search");
    expect(JSON.stringify(turn.storage.toolCalls)).not.toContain("9.8116");
  });

  test("returns display-ready and storage-ready projections with sanitized artifacts", () => {
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result: agentTurnResult({
        message:
          "Try Shaka for the closest checked cafe. Not checked: table availability or menu changes.",
        publicSources: [placesSource, providerUnavailableSource],
        toolCalls: [
          toolCall({ sources: [placesSource] }),
          toolCall({
            errorCode: "provider_unavailable",
            sources: [providerUnavailableSource],
            status: "error",
          }),
        ],
        cards: [
          {
            id: "place_shaka",
            kind: "place",
            title: "Shaka Siargao",
            fitReasons: ["Closest checked cafe.", "Use search_places evidence before claiming."],
            caveats: [" Review text and bookings were not checked. ", "Bring cash."],
            sourceLabel: "Google Places - live checked",
            sources: [placesSource],
          },
        ],
        actions: [
          {
            id: "action_plan",
            label: "Plan this",
            prompt: "Make a plan.",
            metadata: { internalTraceId: "PRIVATE_TRACE_47" },
          },
        ],
        itineraries: [
          {
            id: "itinerary_checked",
            title: "Checked cafe stop",
            durationLabel: "1 hour",
            stops: [
              {
                title: "Shaka Siargao",
                kind: "meal",
                sequence: 1,
                rationale: "Closest checked cafe.",
                caveats: ["Opening status should be checked again.", "Bring cash."],
              },
            ],
            fallbackStops: [
              {
                title: "General Luna backup",
                kind: "meal",
                sequence: 2,
                rationale: "Use if Shaka is full.",
                caveats: ["Origin-specific route timing may change.", "Stay nearby."],
              },
            ],
            skip: ["Places evidence missing for other cafes.", "Far north detour."],
            sources: [placesSource, providerUnavailableSource],
          },
        ],
        decisionSummaries: [
          {
            id: "decision_shaka",
            bestAction: "Go now.",
            basis: "Google Places returned a checked cafe.",
            sources: [placesSource, providerUnavailableSource],
          },
        ],
      }),
    });

    expect(turn.display.message).toBe("Try Shaka for the closest checked cafe.");
    expect(turn.display.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(turn.display.cards).toEqual([]);
    expect(turn.display.actions[0]).toEqual({
      id: "action_plan",
      label: "Plan this",
      prompt: "Make a plan.",
    });
    expect(turn.display.itineraries[0]?.stops[0]?.caveats).toEqual(["Bring cash."]);
    expect(turn.display.itineraries[0]?.fallbackStops[0]?.caveats).toEqual(["Stay nearby."]);
    expect(turn.display.itineraries[0]?.skip).toEqual(["Far north detour."]);
    expect(turn.display.decisionSummaries[0]?.sources).toEqual([
      placesSource,
      providerUnavailableSource,
    ]);
    expect(turn.storage.message).toBe(turn.display.message);
    expect(turn.storage.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(turn.storage.cards).toEqual([]);
    expect(turn.storage.actions[0]).toEqual({
      id: "action_plan",
      label: "Plan this",
      prompt: "Make a plan.",
    });
    expect(turn.storage.itineraries[0]?.stops[0]?.caveats).toEqual([
      "Opening status should be checked again.",
      "Bring cash.",
    ]);
    expect(turn.storage.itineraries[0]?.fallbackStops[0]?.caveats).toEqual([
      "Origin-specific route timing may change.",
      "Stay nearby.",
    ]);
    expect(turn.storage.itineraries[0]?.skip).toEqual([
      "Places evidence missing for other cafes.",
      "Far north detour.",
    ]);
    expect(turn.storage.itineraries[0]?.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(turn.storage.decisionSummaries[0]?.sources).toEqual([
      placesSource,
      providerUnavailableSource,
    ]);
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_TRACE_47");
  });

  test("omits unselected, unknown, and disallowed mixed displayCardIds before projection", () => {
    const allowedSelectedCard = {
      id: "place_allowed",
      kind: "place" as const,
      title: "Allowed Cafe",
      fitReasons: ["Selected by the final payload."],
      caveats: ["Bring cash."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSource],
    };
    const disallowedSelectedCard = {
      id: "beach_private",
      kind: "beach" as const,
      title: "Private Beach",
      mapsUrl: "https://maps.google.com/?cid=private-beach",
      fitReasons: ["Should stay out of display."],
      caveats: ["PRIVATE_CARD_CAVEAT_47"],
      sourceLabel: "Private source",
      sources: [
        {
          ...providerUnavailableSource,
          sourceName: "Private unavailable source",
          notChecked: ["PRIVATE_SOURCE_BOUNDARY_47"],
        },
      ],
    };
    const unselectedCard = {
      id: "place_unselected",
      kind: "place" as const,
      title: "Unselected Cafe",
      mapsUrl: "https://maps.google.com/?cid=unselected-cafe",
      fitReasons: ["Mentioned in tool output but not selected."],
      caveats: ["PRIVATE_UNSELECTED_CARD_47"],
      sourceLabel: "Google Places - live checked",
      sources: [placesSource],
    };
    const result = createAgentTurnResult({
      message: "Use Allowed Cafe and ignore the rest.",
      requestId: "request_public_turn",
      model: "gpt-test",
      toolCalls: [
        toolCall({
          arguments: { query: "cafes" },
          sources: [placesSource],
        }),
        toolCall({
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSource],
          status: "error",
        }),
      ],
      toolResults: [
        {
          toolCallId: "call_search_places",
          name: "search_places",
          status: "success",
          sources: [placesSource],
          cards: [allowedSelectedCard, disallowedSelectedCard, unselectedCard],
        },
      ],
      finalPayload: {
        answer: "Use Allowed Cafe and ignore the rest.",
        usedMemoryFiles: [],
        usedToolCallIds: ["call_search_places"],
        displayCardIds: ["place_allowed", "beach_private", "missing_private_card"],
        displayActionIds: [],
        displayItineraryIds: [],
        displayDecisionSummaryIds: [],
      },
      allowedCardKinds: ["place"],
      artifactSelectionMode: "compatibility",
    });
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result,
    });

    expect(turn.display.cards.map((card) => card.id)).toEqual(["place_allowed"]);
    expect(turn.storage.cards.map((card) => card.id)).toEqual(["place_allowed"]);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 1,
      unknownCardIds: ["beach_private", "missing_private_card"],
      unselectedCardCount: 1,
    });
    expect(JSON.stringify(turn.display)).toContain("Allowed Cafe");
    expect(JSON.stringify(turn.display)).not.toContain("Private Beach");
    expect(JSON.stringify(turn.display)).not.toContain("Unselected Cafe");
    expect(JSON.stringify(turn.storage)).not.toContain("private-beach");
    expect(JSON.stringify(turn.storage)).not.toContain("unselected-cafe");
    expect(JSON.stringify(turn)).not.toContain("Private unavailable source");
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_SOURCE_BOUNDARY_47");
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_CARD_CAVEAT_47");
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_UNSELECTED_CARD_47");
  });

  test("omits all positive place cards when auto-selected sources include a terminal gap", () => {
    const checkedCard = {
      id: "place_checked",
      kind: "place" as const,
      title: "Checked Cafe",
      fitReasons: ["Selected by checked Places evidence."],
      caveats: ["Bring cash."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSource],
    };
    const gapBackedCard = {
      id: "place_gap",
      kind: "place" as const,
      title: "Gap Cafe",
      fitReasons: ["Should not display with terminal current research gaps."],
      caveats: ["CURRENT_RESEARCH_GAP_CARD_47"],
      sourceLabel: "Public web research - insufficient",
      sources: [insufficientWebEvidenceSource],
    };
    const result = createAgentTurnResult({
      message: "Use Checked Cafe. Gap Cafe needs verification.",
      requestId: "request_public_turn",
      model: "gpt-test",
      toolCalls: [
        toolCall({
          arguments: { query: "cafes" },
          sources: [placesSource],
        }),
        toolCall({
          arguments: { query: "current cafe evidence" },
          name: "research_web",
          sources: [insufficientWebEvidenceSource],
        }),
      ],
      toolResults: [
        {
          toolCallId: "call_search_places",
          name: "search_places",
          status: "success",
          sources: [placesSource],
          cards: [checkedCard],
        },
        {
          toolCallId: "call_research_web",
          name: "research_web",
          status: "success",
          sources: [insufficientWebEvidenceSource],
          cards: [gapBackedCard],
        },
      ],
      artifactSelectionMode: "compatibility",
    });
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result,
    });

    expect(turn.display.cards).toEqual([]);
    expect(turn.storage.cards).toEqual([]);
    expect(turn.display.sources).toEqual([placesSource, insufficientWebEvidenceSource]);
    expect(result.cards?.map((card) => card.id)).toEqual(["place_checked", "place_gap"]);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 2,
      unselectedCardCount: 0,
    });
    expect(JSON.stringify(turn)).not.toContain("CURRENT_RESEARCH_GAP_CARD_47");
  });

  test("omits all positive place cards when explicit displayCardIds include a terminal gap", () => {
    const allowedSelectedCard = {
      id: "place_allowed",
      kind: "place" as const,
      title: "Allowed Cafe",
      fitReasons: ["Selected by checked Places evidence."],
      caveats: ["Bring cash."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSource],
    };
    const blockedSelectedCard = {
      id: "place_blocked",
      kind: "place" as const,
      title: "Blocked Cafe",
      fitReasons: ["Should not display with failed current research."],
      caveats: ["PROVIDER_GAP_CARD_47"],
      sourceLabel: "Google Places - unavailable",
      sources: [providerUnavailableSource],
    };
    const result = createAgentTurnResult({
      message: "Use Allowed Cafe. Blocked Cafe was not verified.",
      requestId: "request_public_turn",
      model: "gpt-test",
      toolCalls: [
        toolCall({
          arguments: { query: "cafes" },
          sources: [placesSource],
        }),
        toolCall({
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSource],
          status: "error",
        }),
      ],
      toolResults: [
        {
          toolCallId: "call_search_places",
          name: "search_places",
          status: "success",
          sources: [placesSource],
          cards: [allowedSelectedCard, blockedSelectedCard],
        },
      ],
      finalPayload: {
        answer: "Use Allowed Cafe. Blocked Cafe was not verified.",
        usedMemoryFiles: [],
        usedToolCallIds: ["call_search_places"],
        displayCardIds: ["place_allowed", "place_blocked"],
        displayActionIds: [],
        displayItineraryIds: [],
        displayDecisionSummaryIds: [],
      },
      allowedCardKinds: ["place"],
      artifactSelectionMode: "compatibility",
    });
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result,
    });

    expect(turn.display.cards).toEqual([]);
    expect(turn.storage.cards).toEqual([]);
    expect(turn.display.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(result.cards?.map((card) => card.id)).toEqual(["place_allowed", "place_blocked"]);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 2,
      totalCardCount: 2,
      unselectedCardCount: 0,
    });
    expect(JSON.stringify(turn)).not.toContain("PROVIDER_GAP_CARD_47");
  });

  test("sanitizes stored chat rows before hydrated display", () => {
    const displayTurn = displayReadyStoredChatTurn({
      content:
        "Try a simple General Luna plan. Not checked: exact opening status or road conditions.",
      sources: [placesSource, providerUnavailableSource],
      cards: [
        {
          id: "place_shaka",
          kind: "place",
          title: "Shaka Siargao",
          fitReasons: ["A checked option."],
          caveats: ["Review text was not checked.", "Bring cash."],
          sourceLabel: "Google Places - live checked",
          sources: [placesSource],
        },
      ],
      actions: [],
      itineraries: [],
      decisionSummaries: [],
    });

    expect(displayTurn.message).toBe("Try a simple General Luna plan.");
    expect(displayTurn.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(displayTurn.cards).toEqual([]);
  });

  test("suppresses positive Places cards when a terminal gap is a separate source", () => {
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result: agentTurnResult({
        message: "Use the checked cafe for a quick breakfast.",
        publicSources: [placesSource, insufficientWebEvidenceSource],
        toolCalls: [
          toolCall({ sources: [placesSource] }),
          toolCall({
            name: "research_web",
            sources: [insufficientWebEvidenceSource],
          }),
        ],
        cards: [
          {
            id: "place_checked",
            kind: "place",
            title: "Checked Cafe",
            fitReasons: ["Selected by checked Places evidence."],
            caveats: ["Bring cash."],
            sourceLabel: "Google Places - live checked",
            sources: [placesSource],
          },
        ],
      }),
    });

    expect(turn.display.cards).toEqual([]);
    expect(turn.storage.cards).toEqual([]);
    expect(turn.display.sources).toEqual([placesSource, insufficientWebEvidenceSource]);
  });

  test("preserves non-positive cards and non-card artifacts when terminal gaps suppress positives", () => {
    const turn = assemblePublicChatTurn({
      browserGeolocation: missingBrowserGeolocation,
      result: agentTurnResult({
        message: "Use confirmation-only and fallback guidance instead of a positive place pick.",
        publicSources: [placesSource, providerUnavailableSource],
        toolCalls: [
          toolCall({ sources: [placesSource] }),
          toolCall({
            errorCode: "provider_unavailable",
            sources: [providerUnavailableSource],
            status: "error",
          }),
        ],
        cards: [
          {
            id: "place_positive",
            kind: "place",
            title: "Positive Cafe",
            fitReasons: ["Would normally be shown as a positive ranked place."],
            caveats: ["POSITIVE_CARD_CAVEAT_47"],
            sourceLabel: "Google Places - live checked",
            sources: [placesSource],
          },
          {
            id: "place_confirm",
            kind: "place",
            title: "Confirm First Cafe",
            decision: {
              label: "needs_confirmation",
              bestAction: "Call before going.",
            },
            fitReasons: ["Keep this as confirmation-only guidance."],
            caveats: ["Call first."],
            sourceLabel: "Google Places - live checked",
            sources: [placesSource],
          },
          {
            id: "place_avoid",
            kind: "place",
            title: "Avoid Today Cafe",
            decision: {
              label: "avoid_today",
              bestAction: "Skip today.",
            },
            fitReasons: ["Keep this as avoid guidance."],
            caveats: ["Provider gap remains."],
            sourceLabel: "Google Places - unavailable",
            sources: [providerUnavailableSource],
          },
          {
            id: "beach_positive",
            kind: "beach",
            title: "Beach Fallback",
            fitReasons: ["Non-place card should stay displayable."],
            caveats: ["Watch conditions."],
            sourceLabel: "Ask Siargao local guide",
            sources: [placesSource],
          },
        ],
        actions: [
          {
            id: "action_confirm",
            label: "Confirm first",
            prompt: "Help me confirm before going.",
            metadata: { internalTraceId: "PRIVATE_ACTION_TRACE_47" },
          },
        ],
        itineraries: [
          {
            id: "itinerary_confirm",
            title: "Confirmation-first fallback",
            durationLabel: "30 minutes",
            stops: [
              {
                title: "Message the venue",
                kind: "activity",
                sequence: 1,
                rationale: "Avoid relying on an unverified positive pick.",
                caveats: ["Use current contact details."],
              },
            ],
            fallbackStops: [],
            skip: ["Positive cafe card suppressed."],
            sources: [placesSource, providerUnavailableSource],
          },
        ],
        decisionSummaries: [
          {
            id: "decision_confirm",
            bestAction: "Confirm before going.",
            basis: "Places evidence exists, but a terminal gap is also present.",
            sources: [placesSource, providerUnavailableSource],
          },
        ],
      }),
    });

    expect(turn.display.cards.map((card) => card.id)).toEqual([
      "place_confirm",
      "place_avoid",
      "beach_positive",
    ]);
    expect(turn.storage.cards.map((card) => card.id)).toEqual([
      "place_confirm",
      "place_avoid",
      "beach_positive",
    ]);
    expect(turn.display.actions.map((action) => action.id)).toEqual(["action_confirm"]);
    expect(turn.display.itineraries.map((itinerary) => itinerary.id)).toEqual([
      "itinerary_confirm",
    ]);
    expect(turn.display.decisionSummaries.map((summary) => summary.id)).toEqual([
      "decision_confirm",
    ]);
    expect(JSON.stringify(turn)).not.toContain("POSITIVE_CARD_CAVEAT_47");
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_ACTION_TRACE_47");
  });
});

function agentTurnResult({
  message,
  publicSources = [],
  cards = [],
  actions = [],
  itineraries = [],
  decisionSummaries = [],
  toolCalls = [],
}: {
  message: string;
  publicSources?: AgentTurnResult["publicSources"];
  cards?: AgentTurnResult["cards"];
  actions?: AgentTurnResult["actions"];
  itineraries?: AgentTurnResult["itineraries"];
  decisionSummaries?: AgentTurnResult["decisionSummaries"];
  toolCalls?: readonly AgentToolCallAudit[];
}): Parameters<typeof assemblePublicChatTurn>[0]["result"] {
  return {
    message,
    requestId: "request_public_turn",
    model: "gpt-test",
    toolCalls,
    sources: [],
    publicSources,
    ...(cards.length ? { cards } : {}),
    ...(actions.length ? { actions } : {}),
    ...(itineraries.length ? { itineraries } : {}),
    ...(decisionSummaries.length ? { decisionSummaries } : {}),
  };
}

function toolCall({
  arguments: toolArguments,
  errorCode,
  name = "search_places",
  resultText,
  sources = [],
  status = "success",
}: {
  arguments?: Record<string, unknown>;
  errorCode?: string;
  name?: string;
  resultText?: string;
  sources?: readonly AnswerSourceSummary[];
  status?: AgentToolCallAudit["status"];
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    toolCallId: `call_${name}`,
    name,
    arguments: toolArguments ?? {},
    status,
    durationMs: 12,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:00.012Z",
    ...(errorCode ? { errorCode } : {}),
    ...(resultText ? { resultText } : {}),
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

const placesSource: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "high",
  checked: ["open-now result"],
  notChecked: ["review text"],
};

const providerUnavailableSource: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};

const insufficientWebEvidenceSource: AnswerSourceSummary = {
  label: "insufficient_web_evidence",
  sourceName: "Public web research",
  sourceProfileId: "source_web_research",
  confidence: "low",
  checked: [],
  notChecked: ["current cafe listing evidence"],
};
