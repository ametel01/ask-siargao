import { describe, expect, test } from "bun:test";

import type { AgentToolCallAudit } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { renderAnswerSourceLines } from "@/server/chat/answer-source-summary";
import {
  assertChatAnswerSourceConsistency,
  SourceConsistencyError,
  validateChatAnswerSourceConsistency,
} from "@/server/chat/source-consistency";

describe("chat source consistency", () => {
  test("accepts valid checked weather sources backed by the weather tool", () => {
    const message = withSourceLines("Beach early, keep a covered fallback.", [
      weatherSourceSummary,
    ]);
    const result = validateChatAnswerSourceConsistency({
      message,
      sources: [weatherSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts valid checked Places sources for live and fresh-cache outputs", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use the Maps link and verify hours.", [
        livePlacesSourceSummary,
        freshCachePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary, freshCachePlacesSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
        toolCall({
          name: "get_place_details",
          status: "success",
          sources: [freshCachePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("accepts valid curated local guide sources", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Doot and Malinao fit best.", [localGuideSourceSummary]),
      sources: [localGuideSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_local_guide",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("accepts curated itinerary sources backed by the itinerary planning tool", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use the sequenced itinerary and keep the caveats visible.", [
        localGuideSourceSummary,
      ]),
      sources: [localGuideSourceSummary],
      toolCalls: [
        toolCall({
          name: "plan_local_itinerary",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("accepts curated and fresh-cache local data sources from safe local data tools", () => {
    const localFreshCacheSummary: AnswerSourceSummary = {
      label: "fresh_cache",
      sourceName: "Local public directory",
      sourceProfileId: "source_local_public",
      confidence: "medium",
      checked: ["service fact: Backup generator service"],
      notChecked: ["private audit records"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Doot is curated and the service fact came from cache.", [
        localGuideSourceSummary,
        localFreshCacheSummary,
      ]),
      sources: [localGuideSourceSummary, localFreshCacheSummary],
      toolCalls: [
        toolCall({
          name: "query_local_facts",
          status: "success",
          sources: [localGuideSourceSummary, localFreshCacheSummary],
        }),
        toolCall({
          name: "get_source_evidence",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("keeps generic model reasoning as not verified without requiring tool output", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("A relaxed General Luna afternoon is reasonable.", [
        genericSourceSummary,
      ]),
      sources: [genericSourceSummary],
      toolCalls: [],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects fabricated checked labels without matching tool output", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Google Places says this is live checked.", [
        livePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary],
      toolCalls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "structured_source_not_tool_backed",
      "rendered_checked_line_not_verifiable",
      "rendered_checked_line_not_verifiable",
    ]);
  });

  test("rejects rendered checked source claims even when structured sources are omitted", () => {
    const result = validateChatAnswerSourceConsistency({
      message:
        "This was checked.\n\nChecked: Google Places (live checked; high confidence; profile source_google_places) - open-now status.",
      sources: [],
      toolCalls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rendered_checked_line_not_verifiable",
        label: "live_checked",
      }),
    ]);
  });

  test("rejects generic model reasoning mislabeled as a live check", () => {
    const mislabeledGeneric: AnswerSourceSummary = {
      ...genericSourceSummary,
      label: "live_checked",
      checked: ["generic recommendation"],
    };

    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("This answer is not backed by a tool.", [mislabeledGeneric]),
      sources: [mislabeledGeneric],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.every((issue) => issue.code === "generic_reasoning_mislabeled")).toBe(
      true,
    );
  });

  test("accepts provider-unavailable claims only when a tool produced failure evidence", () => {
    const valid = validateChatAnswerSourceConsistency({
      message: withSourceLines("I could not check live open-now status.", [
        providerUnavailableSourceSummary,
      ]),
      sources: [providerUnavailableSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "error",
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
      ],
    });
    const invalid = validateChatAnswerSourceConsistency({
      message: withSourceLines("I could not check live open-now status.", [
        providerUnavailableSourceSummary,
      ]),
      sources: [providerUnavailableSourceSummary],
      toolCalls: [],
    });

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual([
      "provider_unavailable_without_tool_failure",
      "provider_unavailable_without_tool_failure",
    ]);
  });

  test("throws a controlled source consistency error for route enforcement", () => {
    expect(() =>
      assertChatAnswerSourceConsistency({
        sources: [weatherSourceSummary],
        toolCalls: [],
      }),
    ).toThrow(SourceConsistencyError);

    try {
      assertChatAnswerSourceConsistency({
        sources: [weatherSourceSummary],
        toolCalls: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SourceConsistencyError);
      expect((error as SourceConsistencyError).statusCode).toBe(502);
      expect((error as SourceConsistencyError).code).toBe("source_consistency_failed");
    }
  });
});

function withSourceLines(message: string, sources: readonly AnswerSourceSummary[]) {
  return [message, "", ...renderAnswerSourceLines(sources)].join("\n");
}

function toolCall({
  errorCode,
  name,
  sources,
  status,
}: {
  name: string;
  status: "success" | "error";
  sources: readonly AnswerSourceSummary[];
  errorCode?: string;
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: {},
    status,
    durationMs: 10,
    startedAt: "2026-06-26T00:00:00.000Z",
    completedAt: "2026-06-26T00:00:00.010Z",
    ...(errorCode ? { errorCode } : {}),
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

const weatherSourceSummary: AnswerSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["forecast for Siargao Island"],
  notChecked: ["surf reports"],
};

const livePlacesSourceSummary: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "high",
  checked: ["place listings", "map links"],
  notChecked: ["review text", "bookings"],
};

const freshCachePlacesSourceSummary: AnswerSourceSummary = {
  label: "fresh_cache",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["fresh cached place fields"],
  notChecked: ["live open-now status"],
};

const localGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach surface notes", "ride-time notes"],
  notChecked: ["live tide", "lifeguard status"],
};

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Generic model reasoning",
  checked: [],
  notChecked: ["live Google Places", "weather forecast"],
};

const providerUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};
