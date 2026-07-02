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
        toolCalls: [toolCall({ sources: [placesSource] })],
        cards: [
          {
            id: "place_shaka",
            kind: "place",
            title: "Shaka Siargao",
            fitReasons: ["Closest checked cafe.", "Use search_places evidence before claiming."],
            caveats: [" Review text and bookings were not checked. ", "Bring cash."],
            sourceLabel: "Google Places - live checked",
            sources: [placesSource, providerUnavailableSource],
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
    expect(turn.display.sources).toEqual([placesSource]);
    expect(turn.display.cards[0]?.caveats).toEqual(["Bring cash."]);
    expect(turn.display.cards[0]?.fitReasons).toEqual(["Closest checked cafe."]);
    expect(turn.display.cards[0]?.sources).toEqual([placesSource]);
    expect(turn.display.actions[0]).toEqual({
      id: "action_plan",
      label: "Plan this",
      prompt: "Make a plan.",
    });
    expect(turn.display.itineraries[0]?.stops[0]?.caveats).toEqual(["Bring cash."]);
    expect(turn.display.itineraries[0]?.fallbackStops[0]?.caveats).toEqual(["Stay nearby."]);
    expect(turn.display.itineraries[0]?.skip).toEqual(["Far north detour."]);
    expect(turn.display.decisionSummaries[0]?.sources).toEqual([placesSource]);
    expect(turn.storage.message).toBe(turn.display.message);
    expect(turn.storage.sources).toEqual([placesSource, providerUnavailableSource]);
    expect(turn.storage.cards[0]?.caveats).toEqual([
      "Review text and bookings were not checked.",
      "Bring cash.",
    ]);
    expect(turn.storage.cards[0]?.fitReasons).toEqual([
      "Closest checked cafe.",
      "Use search_places evidence before claiming.",
    ]);
    expect(turn.storage.cards[0]?.sources).toEqual([placesSource, providerUnavailableSource]);
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
      fitReasons: ["Should stay out of display."],
      caveats: ["PRIVATE_CARD_CAVEAT_47"],
      sourceLabel: "Private source",
      sources: [providerUnavailableSource],
    };
    const unselectedCard = {
      id: "place_unselected",
      kind: "place" as const,
      title: "Unselected Cafe",
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
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_CARD_CAVEAT_47");
    expect(JSON.stringify(turn)).not.toContain("PRIVATE_UNSELECTED_CARD_47");
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
          sources: [placesSource, providerUnavailableSource],
        },
      ],
      actions: [],
      itineraries: [],
      decisionSummaries: [],
    });

    expect(displayTurn.message).toBe("Try a simple General Luna plan.");
    expect(displayTurn.sources).toEqual([placesSource]);
    expect(displayTurn.cards[0]?.caveats).toEqual(["Bring cash."]);
    expect(displayTurn.cards[0]?.sources).toEqual([placesSource]);
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
  resultText,
  sources = [],
}: {
  arguments?: Record<string, unknown>;
  resultText?: string;
  sources?: readonly AnswerSourceSummary[];
}): AgentToolCallAudit {
  return {
    id: "audit_search_places",
    toolCallId: "call_search_places",
    name: "search_places",
    arguments: toolArguments ?? {},
    status: "success",
    durationMs: 12,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:00.012Z",
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
