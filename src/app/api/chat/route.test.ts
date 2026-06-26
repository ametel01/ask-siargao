import { describe, expect, test } from "bun:test";

import type { Logger } from "pino";

import {
  type ChatRouteDependencies,
  chatResponse,
  createDefaultChatRouteDependencies,
} from "@/app/api/chat/chat-route";
import type {
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentTurnResult,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

describe("chat route", () => {
  test("rejects malformed JSON request bodies before calling the agent", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(rawRequest("{"), dependencies);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("rejects requests without messages before calling the agent", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(jsonRequest({ messages: [] }), dependencies);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_chat_request");
    expect(body.issues[0].path).toBe("messages");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes ordinary valid Siargao chat through the agent runtime", async () => {
    const dependencies = chatDependencies({
      message: "For Cloud 9, start easy and keep dinner nearby.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9");
    expect(body.requestId).toBe(dependencies.requests[0]?.requestId);
    expect(body.model).toBe("gpt-test");
    expect(body.toolCalls).toEqual([]);
    expect(body.sources).toEqual([genericSourceSummary]);
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
    expect(dependencies.requests[0]?.metadata?.route).toBe("/api/chat");
  });

  test("sends unrelated valid prompts to the agent as decline instructions instead of hardcoding prose", async () => {
    const dependencies = chatDependencies({
      message: "I can help with Siargao travel, not stock bots.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Can you write Python code for a stock bot?" }],
      }),
      dependencies,
    );
    const body = await response.json();
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(body.message).toContain("Siargao travel");
    expect(dependencies.requests).toHaveLength(1);
    expect(signals?.scope.shouldDeclineNonSiargaoTopic).toBe(true);
  });

  test("sends missing-context prompts to the agent as clarification signals", async () => {
    const dependencies = chatDependencies({
      message: "Which Siargao place or area do you mean by there?",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What should I do there today?" }],
      }),
      dependencies,
    );
    const body = await response.json();
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(body.message).toContain("Which Siargao place");
    expect(dependencies.requests).toHaveLength(1);
    expect(signals?.scope.missingContext).toBe(true);
  });

  test("returns weather tool evidence from the agent runtime", async () => {
    const weatherToolCall = toolCall({
      name: "get_weather_forecast",
      status: "success",
      sources: [weatherSourceSummary],
    });
    const dependencies = chatDependencies({
      message: "The model-written forecast says keep a covered fallback.",
      toolCalls: [weatherToolCall],
      sources: [weatherSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      }),
      dependencies,
    );
    const body = await response.json();
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(body.message).toContain("model-written forecast");
    expect(body.toolCalls[0]).toMatchObject({ name: "get_weather_forecast" });
    expect(body.sources).toEqual([weatherSourceSummary]);
    expect(signals?.intent.weather).toBe(true);
  });

  test("returns Places tool evidence from the agent runtime", async () => {
    const dependencies = chatDependencies({
      message: "The model recommends a cafe and includes the Maps link.",
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [placesSourceSummary],
        }),
      ],
      sources: [placesSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near Cloud 9 that are open now." }],
      }),
      dependencies,
    );
    const body = await response.json();
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(body.toolCalls[0]).toMatchObject({ name: "search_places" });
    expect(body.sources).toEqual([placesSourceSummary]);
    expect(signals?.intent.placeIntent?.category).toBe("coffee");
  });

  test("returns curated local guide tool evidence from the agent runtime", async () => {
    const dependencies = chatDependencies({
      message: "The model says Doot and Malinao are the best close sandy options.",
      toolCalls: [
        toolCall({
          name: "search_local_guide",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
      sources: [localGuideSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Which sandy beaches can I reach within 30 min from General Luna?",
          },
        ],
      }),
      dependencies,
    );
    const body = await response.json();
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(body.message).toContain("Doot");
    expect(body.toolCalls[0]).toMatchObject({ name: "search_local_guide" });
    expect(signals?.intent.beach).toBe(true);
  });

  test("does not replace provider-failure tool outputs with preset route prose", async () => {
    const dependencies = chatDependencies({
      message: "The model says live Google Places open-now status could not be checked.",
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "error",
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
      ],
      sources: [providerUnavailableSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("model says");
    expect(body.error).toBeUndefined();
    expect(dependencies.requests).toHaveLength(1);
  });

  test("logs route metadata for tool calls and provider failures without restricted payloads", async () => {
    const logs = captureLogger();
    const failingToolCall = toolCall({
      name: "search_places",
      status: "error",
      errorCode: "provider_unavailable",
      sources: [providerUnavailableSourceSummary],
    });
    failingToolCall.arguments = { restrictedProviderPayload: "SECRET_TOKEN" };
    const dependencies = chatDependencies({
      message: "The model says live Google Places open-now status could not be checked.",
      toolCalls: [failingToolCall],
      sources: [providerUnavailableSourceSummary],
    });
    dependencies.logger = logs.logger;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
      }),
      dependencies,
    );
    const body = await response.json();
    const answeredLog = logs.events.find((event) => event.message === "Chat request answered.");

    expect(response.status).toBe(200);
    expect(logs.childBindings[0]?.requestId).toBe(body.requestId);
    expect(answeredLog?.payload).toMatchObject({
      branch: "agent_runtime",
      model: "gpt-test",
      providerFailure: true,
      sourceLabels: ["provider_unavailable"],
      toolCallCount: 1,
      toolCalls: [
        expect.objectContaining({
          name: "search_places",
          status: "error",
          errorCode: "provider_unavailable",
          sourceLabels: ["provider_unavailable"],
          sourceProfileIds: ["source_google_places"],
        }),
      ],
    });
    expect(JSON.stringify(answeredLog?.payload)).not.toContain("SECRET_TOKEN");
  });

  test("returns a controlled error when agent source labels are not tool-backed", async () => {
    const dependencies = chatDependencies({
      message: "The model claims live Places were checked.",
      sources: [placesSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find dinner near Cloud 9." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
    expect(dependencies.requests).toHaveLength(1);
  });

  test("returns stable unavailable response when the agent runtime is not configured", async () => {
    const response = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Hi" }] }),
      {
        runAskSiargaoAgentTurn: async () => {
          throw new Error("OPENAI_API_KEY is required for Ask Siargao agent chat.");
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("chat_not_configured");
  });

  test("default dependencies wire the agent runtime", () => {
    const dependencies = createDefaultChatRouteDependencies();

    expect(dependencies.runAskSiargaoAgentTurn).toBeDefined();
  });
});

type AgentSignals = {
  intent: {
    beach?: boolean;
    placeIntent?: { category?: string };
    weather?: boolean;
  };
  scope: {
    missingContext?: boolean;
    shouldDeclineNonSiargaoTopic?: boolean;
  };
};

function chatDependencies(
  result: Partial<AgentTurnResult> = {
    message: "Near Cloud 9, start with Kermit, Shaka, or Bravo depending on your budget.",
    sources: [genericSourceSummary],
  },
) {
  const requests: AgentRuntimeRequest[] = [];
  const dependencies: ChatRouteDependencies & {
    requests: typeof requests;
  } = {
    runAskSiargaoAgentTurn: async (request) => {
      requests.push(request);
      return {
        message: result.message ?? "Agent response.",
        requestId: request.requestId ?? "route_request_test",
        upstreamRequestIds: result.upstreamRequestIds ?? ["req_agent_test"],
        model: result.model ?? request.model ?? "gpt-test",
        toolCalls: result.toolCalls ?? [],
        sources: result.sources ?? [],
        ...(result.cards ? { cards: result.cards } : {}),
        ...(result.actions ? { actions: result.actions } : {}),
      };
    },
    requests,
  };

  return dependencies;
}

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string) {
  return new Request("https://siargao.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
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
    durationMs: 12,
    startedAt: "2026-06-26T00:00:00.000Z",
    completedAt: "2026-06-26T00:00:00.012Z",
    ...(errorCode ? { errorCode } : {}),
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Generic model reasoning",
  checked: [],
  notChecked: ["live Google Places", "Open-Meteo weather forecast"],
};

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
  checked: ["place listings", "map links"],
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
