import { describe, expect, test } from "bun:test";

import type { Logger } from "pino";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentResponsesClient,
  AgentResponsesCreateResult,
  AgentToolExecutor,
  AgentToolResult,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { runAskSiargaoAgentTurn } from "@/server/chat/ask-siargao-agent";

describe("Ask Siargao Responses tool-loop runtime", () => {
  test("returns a no-tool Siargao answer from one model call", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_general",
        output_text: "For a first Siargao day, keep Cloud 9 and General Luna easy.",
        _request_id: "req_general",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_general",
      },
      { client, agentMemoryVectorStoreId: "", model: "gpt-test" },
    );

    expect(result.message).toContain("Cloud 9");
    expect(result.model).toBe("gpt-test");
    expect(result.requestId).toBe("agent_request_general");
    expect(result.upstreamRequestIds).toEqual(["req_general"]);
    expect(result.toolCalls).toEqual([]);
    expect(result.memory?.versionId).toMatch(/^agent-memory:[a-f0-9]{24}$/);
    expect(result.memory?.files.map((file) => file.fileName)).toContain(
      "ASK_SIARGAO_AGENT_SKILLS.md",
    );
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.store).toBe(false);
    expect(client.requests[0]?.tools).toBeArray();
    expect(client.requests[0]?.tools).toContainEqual(
      expect.objectContaining({ name: "search_agent_memory" }),
    );
    expect(String(client.requests[0]?.instructions)).toContain("Use the available tools");
    expect(String(client.requests[0]?.instructions)).toContain(
      "Every final answer must be written by the AI",
    );
    expect(parseFirstInput(client.requests[0]?.input).agentMemory?.versionId).toBe(
      result.memory?.versionId,
    );
    expect(parseFirstInput(client.requests[0]?.input).conversation?.[0]?.content).toContain(
      "first afternoon",
    );
  });

  test("registers hosted file search when a vector store is configured", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_general",
        output_text: "Use memory policy, then answer concisely.",
        _request_id: "req_general",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How do your source labels work?" }],
        requestId: "agent_request_file_search",
      },
      {
        client,
        agentMemoryVectorStoreId: "vs_memory",
        model: "gpt-test",
      },
    );

    expect(client.requests[0]?.tools).toContainEqual({
      type: "file_search",
      vector_store_ids: ["vs_memory"],
      max_num_results: 5,
    });
    expect(client.requests[0]?.tools).not.toContainEqual(
      expect.objectContaining({ name: "search_agent_memory" }),
    );
    expect(result.memory?.vectorStoreId).toBe("vs_memory");
  });

  test("executes a weather tool call and feeds the result back to the model", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_weather_call",
        requestId: "req_weather_call",
        callId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      {
        id: "resp_weather_final",
        output_text: "Plan the beach window early, then keep a covered fallback for showers.",
        _request_id: "req_weather_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded: showers possible in the afternoon.",
        sources: [weatherSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is today good for a beach plan?" }],
        requestId: "agent_request_weather",
      },
      {
        client,
        executeTool,
        model: "gpt-test",
        now: steppedClock(["2026-06-26T00:00:00.000Z", "2026-06-26T00:00:00.042Z"]),
      },
    );

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.previous_response_id).toBe("resp_weather_call");
    expect(client.requests[1]?.instructions).toBe(client.requests[0]?.instructions);
    expect(String(client.requests[1]?.instructions)).toContain(
      "Use backend tools for live, local, provider-backed, or curated Ask Siargao facts",
    );
    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_weather",
      }),
    ]);
    expect(parseToolOutput(client.requests[1]?.input, 0).text).toContain("Open-Meteo");
    expect(result.message).toContain("covered fallback");
    expect(result.upstreamRequestIds).toEqual(["req_weather_call", "req_weather_final"]);
    expect(result.toolCalls[0]).toMatchObject({
      toolCallId: "call_weather",
      name: "get_weather_forecast",
      status: "success",
      durationMs: 42,
      providerOperation: "open_meteo.forecast",
      sourceProfileIds: ["source_open_meteo"],
    });
    expect(result.sources).toEqual([weatherSourceSummary]);
  });

  test("executes Google Places search and details tool calls", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_places_search",
        requestId: "req_places_search",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "cafes near Cloud 9",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
        },
      }),
      responseWithToolCall({
        id: "resp_places_details",
        requestId: "req_places_details",
        callId: "call_details",
        name: "get_place_details",
        arguments: { place_id: "ChIJCloud9Cafe" },
      }),
      {
        id: "resp_places_final",
        output_text: "Try the cafe with the Maps link first, then verify opening hours.",
        _request_id: "req_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned a cafe shortlist.",
        sources: [placesSourceSummary],
      },
      get_place_details: {
        name: "get_place_details",
        status: "success",
        text: "Google Places details loaded for Cloud 9 Cafe. Maps: https://maps.example/cafe",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Find a cafe near Cloud 9 and check details." }],
        requestId: "agent_request_places",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(client.requests).toHaveLength(3);
    expect(result.message).toContain("Maps link");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "search_places",
      "get_place_details",
    ]);
    expect(result.toolCalls.map((toolCall) => toolCall.providerOperation)).toEqual([
      "google_places.search",
      "google_places.details",
    ]);
    expect(result.sources).toEqual([placesSourceSummary]);
  });

  test("executes a curated local guide tool call", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_local_call",
        requestId: "req_local_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: {
          query: "sandy swimming beaches within 30 minutes",
          filters: { beach_surface: "sand", swimming: true, max_ride_minutes: 30 },
        },
      }),
      {
        id: "resp_local_final",
        output_text: "Doot and Malinao fit best; tides and lifeguards were not checked.",
        _request_id: "req_local_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach and Malinao Beach.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_local",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Doot");
    expect(result.toolCalls[0]).toMatchObject({
      name: "search_local_guide",
      providerOperation: "local_guide.search",
      sourceProfileIds: [],
    });
    expect(result.sources).toEqual([localGuideSourceSummary]);
  });

  test("executes multiple tool calls from one model response", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_multi_call",
        _request_id: "req_multi_call",
        output: [
          {
            type: "function_call",
            call_id: "call_weather",
            name: "get_weather_forecast",
            arguments: JSON.stringify({ location: "Cloud 9", date_range: "today" }),
          },
          {
            type: "function_call",
            call_id: "call_local",
            name: "search_local_guide",
            arguments: JSON.stringify({ query: "rain fit activities" }),
          },
        ],
      },
      {
        id: "resp_multi_final",
        output_text: "Use the early weather window, then keep a short local fallback nearby.",
        _request_id: "req_multi_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Weather loaded.",
        sources: [weatherSourceSummary],
      },
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Local guide loaded.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan around rain near Cloud 9." }],
        requestId: "agent_request_multi",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(client.requests[1]?.input).toHaveLength(2);
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "get_weather_forecast",
      "search_local_guide",
    ]);
    expect(result.sources).toEqual([weatherSourceSummary, localGuideSourceSummary]);
  });

  test("continues the loop after a provider-failure tool output", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_call",
        requestId: "req_failed_places_call",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
          constraints: { open_now: true },
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text:
          "I could not check live Google Places open-now status, so verify before going.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places search failed: provider timeout.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
        requestId: "agent_request_provider_failure",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("could not check live Google Places");
    expect(result.toolCalls[0]).toMatchObject({
      status: "error",
      errorCode: "provider_unavailable",
    });
    expect(parseToolOutput(client.requests[1]?.input, 0).errorCode).toBe("provider_unavailable");
  });

  test("logs tool-loop metadata without raw tool output payloads", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_call",
        requestId: "req_failed_places_call",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text: "I could not check live Google Places open-now status.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const logs = captureLogger();

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
        requestId: "agent_request_logged_failure",
      },
      {
        client,
        logger: logs.logger,
        memorySnapshot: memorySnapshotFixture({
          instructionContent: "RAW_MEMORY_BODY_SECRET: never log this memory body.",
        }),
        executeTool: async (request) => ({
          name: request.name,
          status: "error",
          text: "Google Places search failed: raw provider payload SECRET_TOKEN.",
          data: { restrictedProviderPayload: "SECRET_TOKEN" },
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
        model: "gpt-test",
      },
    );

    const toolLog = logs.events.find(
      (event) => event.message === "Ask Siargao agent tool call completed.",
    );
    expect(logs.childBindings[0]?.requestId).toBe("agent_request_logged_failure");
    expect(toolLog?.payload).toMatchObject({
      toolCallId: "call_places",
      toolName: "search_places",
      status: "error",
      errorCode: "provider_unavailable",
      providerOperation: "google_places.search",
      sourceLabels: ["provider_unavailable"],
      sourceProfileIds: ["source_google_places"],
    });
    expect(JSON.stringify(toolLog?.payload)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(logs.events)).not.toContain("RAW_MEMORY_BODY_SECRET");
  });

  test("protects the loop from excessive tool calls", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_loop_first",
        requestId: "req_loop_first",
        callId: "call_weather_1",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      responseWithToolCall({
        id: "resp_loop_second",
        requestId: "req_loop_second",
        callId: "call_weather_2",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "Check weather until certain." }],
          requestId: "agent_request_loop",
        },
        {
          client,
          executeTool: fakeToolExecutor({
            get_weather_forecast: {
              name: "get_weather_forecast",
              status: "success",
              text: "Weather loaded.",
              sources: [weatherSourceSummary],
            },
          }),
          maxToolCalls: 1,
          model: "gpt-test",
        },
      ),
    ).rejects.toThrow("maximum tool-call count");
  });

  test("throws when a model response has neither final text nor tool calls", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_missing_output",
        output: [],
        _request_id: "req_missing_output",
      },
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "What is good today?" }],
          requestId: "agent_request_missing_output",
        },
        { client, model: "gpt-test" },
      ),
    ).rejects.toThrow("OpenAI response did not include output_text");
  });
});

function fakeResponsesClient(responses: AgentResponsesCreateResult[]) {
  const pending = [...responses];
  const requests: Record<string, unknown>[] = [];
  const client = {
    requests,
    responses: {
      create: async (params: Record<string, unknown>) => {
        requests.push(params);
        const response = pending.shift();
        if (!response) {
          throw new Error("No fake model response queued.");
        }
        return response;
      },
    },
  } satisfies AgentResponsesClient & { requests: Record<string, unknown>[] };
  return client;
}

function responseWithToolCall({
  arguments: args,
  callId,
  id,
  name,
  requestId,
}: {
  id: string;
  requestId: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}): AgentResponsesCreateResult {
  return {
    id,
    _request_id: requestId,
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
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

function steppedClock(isoTimes: string[]) {
  const pending = [...isoTimes];
  return () => new Date(pending.shift() ?? isoTimes.at(-1) ?? "2026-06-26T00:00:00.000Z");
}

function parseFirstInput(input: unknown): {
  conversation?: Array<{ content?: string }>;
  agentMemory?: { versionId?: string };
} {
  return typeof input === "string" ? JSON.parse(input) : {};
}

function parseToolOutput(
  input: unknown,
  index: number,
): {
  text?: string;
  errorCode?: string;
} {
  if (!Array.isArray(input)) {
    return {};
  }

  const item = input[index];
  if (!isRecord(item) || typeof item.output !== "string") {
    return {};
  }

  return JSON.parse(item.output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureLogger() {
  const childBindings: Record<string, unknown>[] = [];
  const events: Array<{ level: string; payload: Record<string, unknown>; message: string }> = [];
  const logger = {
    child: (bindings: Record<string, unknown>) => {
      childBindings.push(bindings);
      return logger;
    },
    debug: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "debug", payload, message });
    },
    error: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "error", payload, message });
    },
    info: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "info", payload, message });
    },
    warn: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "warn", payload, message });
    },
  } as unknown as Logger;

  return { childBindings, events, logger };
}

function memorySnapshotFixture({
  instructionContent = "Every final answer must be written by the AI.",
}: {
  instructionContent?: string;
} = {}): AgentMemorySnapshot {
  return {
    versionId: "agent-memory:testmemory000000000000",
    files: [
      {
        id: "ask_siargao_agent_skills",
        title: "Ask Siargao Agent Skills",
        fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
        role: "instruction",
        checksum: "a".repeat(64),
        byteLength: instructionContent.length,
        content: instructionContent,
      },
      {
        id: "ask_siargao_source_policy",
        title: "Ask Siargao Source Policy",
        fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
        role: "reference",
        checksum: "b".repeat(64),
        byteLength: 32,
        content: "Never create source labels from memory retrieval alone.",
      },
    ],
    instructionMarkdown: instructionContent,
    referenceFiles: [
      {
        id: "ask_siargao_source_policy",
        title: "Ask Siargao Source Policy",
        fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
        role: "reference",
        checksum: "b".repeat(64),
        byteLength: 32,
        content: "Never create source labels from memory retrieval alone.",
      },
    ],
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
  checked: ["place identity", "map link"],
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
