import { describe, expect, test } from "bun:test";

import type { AgentToolCallAudit, AgentTurnResult } from "@/server/chat/agent-runtime";
import { assemblePublicChatTurn } from "@/server/chat/public-turn-assembly";

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

    expect(turn.message).toBe("Use the simple General Luna dinner plan.");
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

    expect(turn.toolCalls).toEqual([
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
    expect(turn.storedHistory.toolCalls).toEqual(turn.toolCalls);
    expect(JSON.stringify(turn.storedHistory.toolCalls)).not.toContain("arguments");
    expect(JSON.stringify(turn.storedHistory.toolCalls)).not.toContain("resultText");
    expect(JSON.stringify(turn.storedHistory.toolCalls)).not.toContain("raw private nearby search");
    expect(JSON.stringify(turn.storedHistory.toolCalls)).not.toContain("9.8116");
  });
});

function agentTurnResult({
  message,
  toolCalls = [],
}: {
  message: string;
  toolCalls?: readonly AgentToolCallAudit[];
}): AgentTurnResult {
  return {
    message,
    requestId: "request_public_turn",
    model: "gpt-test",
    toolCalls,
    sources: [],
    publicSources: [],
  };
}

function toolCall({
  arguments: toolArguments,
  resultText,
}: {
  arguments: Record<string, unknown>;
  resultText?: string;
}): AgentToolCallAudit {
  return {
    id: "audit_search_places",
    toolCallId: "call_search_places",
    name: "search_places",
    arguments: toolArguments,
    status: "success",
    durationMs: 12,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:00.012Z",
    ...(resultText ? { resultText } : {}),
    sourceProfileIds: [],
    sources: [],
  };
}
