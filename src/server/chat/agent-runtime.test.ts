import { describe, expect, test } from "bun:test";

import {
  type AgentResponsesClient,
  type AgentToolExecutor,
  type AgentToolResult,
  aggregateAgentSourceSummaries,
  createAgentToolCallAudit,
  createAgentTurnResult,
  resolveAgentRuntimeRequest,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

describe("agent runtime contracts", () => {
  test("resolves request IDs and model defaults without changing route behavior", () => {
    const request = resolveAgentRuntimeRequest(
      {
        messages: [{ role: "user", content: "What should I do near Cloud 9 today?" }],
      },
      {
        createRequestId: () => "agent_request_1",
        model: "gpt-test",
      },
    );

    expect(request.requestId).toBe("agent_request_1");
    expect(request.model).toBe("gpt-test");
    expect(request.messages[0]?.content).toContain("Cloud 9");
  });

  test("preserves explicit request IDs and per-call model overrides", () => {
    const request = resolveAgentRuntimeRequest(
      {
        messages: [{ role: "user", content: "Siargao beach day?" }],
        model: "gpt-override",
        requestId: "route_request_1",
      },
      {
        createRequestId: () => "unused_request",
        model: "gpt-default",
      },
    );

    expect(request.requestId).toBe("route_request_1");
    expect(request.model).toBe("gpt-override");
  });

  test("shapes successful tool audits with timing and source profile IDs", () => {
    const result: AgentToolResult = {
      name: "get_weather_forecast",
      status: "success",
      text: "Weather forecast loaded.",
      sources: [weatherSourceSummary],
    };

    const audit = createAgentToolCallAudit({
      auditId: "audit_1",
      toolCallId: "call_weather",
      name: "get_weather_forecast",
      arguments: { location: "Cloud 9", date_range: "today" },
      result,
      providerOperation: "open_meteo.forecast",
      startedAt: new Date("2026-06-26T00:00:00.000Z"),
      completedAt: new Date("2026-06-26T00:00:00.125Z"),
    });

    expect(audit).toMatchObject({
      id: "audit_1",
      toolCallId: "call_weather",
      name: "get_weather_forecast",
      arguments: { location: "Cloud 9", date_range: "today" },
      status: "success",
      durationMs: 125,
      providerOperation: "open_meteo.forecast",
      resultText: "Weather forecast loaded.",
      sourceProfileIds: ["source_open_meteo"],
    });
  });

  test("shapes provider failure audits as returned tool outputs", () => {
    const result: AgentToolResult = {
      name: "search_places",
      status: "error",
      text: "Google Places lookup failed.",
      errorCode: "provider_unavailable",
      sources: [providerUnavailableSourceSummary],
    };

    const audit = createAgentToolCallAudit({
      auditId: "audit_2",
      toolCallId: "call_places",
      name: "search_places",
      arguments: { query: "cafes near General Luna" },
      result,
      startedAt: new Date("2026-06-26T00:00:01.000Z"),
      completedAt: new Date("2026-06-26T00:00:01.050Z"),
    });

    expect(audit.status).toBe("error");
    expect(audit.errorCode).toBe("provider_unavailable");
    expect(audit.sources[0]?.label).toBe("provider_unavailable");
    expect(audit.resultText).toContain("Google Places");
  });

  test("aggregates source summaries from audited tool calls without duplicates", () => {
    const first = createAgentToolCallAudit({
      auditId: "audit_weather_1",
      name: "get_weather_forecast",
      arguments: {},
      result: {
        name: "get_weather_forecast",
        status: "success",
        text: "Weather loaded.",
        sources: [weatherSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.000Z"),
      completedAt: new Date("2026-06-26T00:00:00.010Z"),
    });
    const duplicate = createAgentToolCallAudit({
      auditId: "audit_weather_2",
      name: "get_weather_forecast",
      arguments: {},
      result: {
        name: "get_weather_forecast",
        status: "success",
        text: "Weather loaded again.",
        sources: [{ ...weatherSourceSummary, sourceName: " Open-Meteo weather API " }],
      },
      startedAt: new Date("2026-06-26T00:00:00.020Z"),
      completedAt: new Date("2026-06-26T00:00:00.030Z"),
    });
    const places = createAgentToolCallAudit({
      auditId: "audit_places",
      name: "search_places",
      arguments: {},
      result: {
        name: "search_places",
        status: "success",
        text: "Places loaded.",
        sources: [placesSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.040Z"),
      completedAt: new Date("2026-06-26T00:00:00.050Z"),
    });

    expect(aggregateAgentSourceSummaries([first, duplicate, places])).toEqual([
      weatherSourceSummary,
      placesSourceSummary,
    ]);
  });

  test("creates turn results with source aggregation and structured UI artifacts", () => {
    const toolCall = createAgentToolCallAudit({
      auditId: "audit_3",
      name: "search_local_guide",
      arguments: { query: "sandy beaches within 30 min" },
      result: {
        name: "search_local_guide",
        status: "success",
        text: "Local beach guide loaded.",
        sources: [localGuideSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.000Z"),
      completedAt: new Date("2026-06-26T00:00:00.010Z"),
    });

    const turn = createAgentTurnResult({
      message: "Doot and Malinao fit best.",
      requestId: "agent_request_2",
      upstreamRequestIds: ["req_model_1", "req_model_1"],
      model: "gpt-test",
      toolCalls: [toolCall],
      cards: [
        {
          id: "card_doot",
          kind: "beach",
          title: "Doot Beach",
          subtitle: "General Luna-side sandy beach",
          mapsUrl: "https://www.google.com/maps/search/?api=1&query=Doot%20Beach%20Siargao",
          distanceLabel: "About 20 minutes by tricycle from General Luna",
          fitReasons: ["Sandy shore", "Works for a quieter beach stop"],
          caveats: ["Check tide and road conditions before leaving"],
          sourceLabel: "Ask Siargao curated local beach guide",
        },
      ],
      actions: [{ id: "ask_weather", label: "Check weather", prompt: "Weather?" }],
    });

    expect(turn.sources).toEqual([localGuideSourceSummary]);
    expect(turn.upstreamRequestIds).toEqual(["req_model_1"]);
    expect(turn.cards?.[0]?.title).toBe("Doot Beach");
    expect(turn.cards?.[0]?.kind).toBe("beach");
    expect(turn.cards?.[0]?.mapsUrl).toContain("google.com/maps");
    expect(turn.cards?.[0]?.fitReasons).toContain("Sandy shore");
    expect(turn.actions?.[0]).toEqual({
      id: "ask_weather",
      label: "Check weather",
      prompt: "Weather?",
    });
  });

  test("supports fake Responses clients and tool executors for network-free tests", async () => {
    const client = fakeResponsesClient([
      { output_text: "Use the weather tool first.", _request_id: "req_tool_choice" },
      { output_text: "It looks workable with a covered fallback.", _request_id: "req_final" },
    ]);
    const executeTool = fakeToolExecutor({
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Partly cloudy; light rain possible.",
        sources: [weatherSourceSummary],
      },
    });

    const firstModelResponse = await client.responses.create({ model: "gpt-test" });
    const toolResult = await executeTool({
      requestId: "agent_request_3",
      toolCallId: "call_weather",
      name: "get_weather_forecast",
      arguments: { location: "Siargao Island", date_range: "today" },
    });
    const finalModelResponse = await client.responses.create({ model: "gpt-test" });

    expect(firstModelResponse._request_id).toBe("req_tool_choice");
    expect(toolResult.text).toContain("Partly cloudy");
    expect(finalModelResponse.output_text).toContain("covered fallback");
  });
});

function fakeResponsesClient(responses: Array<{ output_text: string; _request_id: string }>) {
  const pending = [...responses];
  const client: AgentResponsesClient = {
    responses: {
      create: async () => {
        const response = pending.shift();
        if (!response) {
          throw new Error("No fake model response queued.");
        }
        return response;
      },
    },
  };
  return client;
}

function fakeToolExecutor(
  results: Partial<Record<AgentToolResult["name"], AgentToolResult>>,
): AgentToolExecutor {
  return async (request) => {
    const result = results[request.name];
    if (!result) {
      return {
        name: request.name,
        status: "error",
        text: `No fake result queued for ${request.name}.`,
        errorCode: "fake_tool_missing",
        sources: [],
      };
    }
    return {
      ...result,
      toolCallId: request.toolCallId,
    };
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

const placesSourceSummary: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "high",
  checked: ["place identity", "opening-hours status"],
  notChecked: ["review text", "bookings"],
};

const localGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach surface notes", "ride-time notes"],
  notChecked: ["live tide", "lifeguard status"],
};

const providerUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};
