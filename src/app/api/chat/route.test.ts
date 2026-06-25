import { describe, expect, test } from "bun:test";

import {
  type ChatRouteDependencies,
  chatResponse,
  createDefaultChatRouteDependencies,
} from "@/app/api/chat/chat-route";
import type { OpenMeteoForecastLocation } from "@/server/providers/open-meteo";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

describe("chat route", () => {
  test("rejects malformed JSON request bodies", async () => {
    const response = await chatResponse(rawRequest("{"), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  test("rejects requests without messages", async () => {
    const response = await chatResponse(jsonRequest({ messages: [] }), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_chat_request");
    expect(body.issues[0].path).toBe("messages");
  });

  test("politely declines clearly unrelated questions without calling the model", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Can you write Python code for a stock bot?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("I can only help with Siargao");
    expect(dependencies.requests).toHaveLength(0);
    expect(dependencies.weatherRequests).toBe(0);
  });

  test("returns an Ask Siargao model response", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9");
    expect(body.model).toBeUndefined();
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
  });

  test("uses recommendation agent before generic model for place requests", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return {
          status: "answered",
          message: "Best verified options I found:\n1. Dapa Grill\nMaps: https://maps.example/dapa",
          model: "gpt-5.5",
        };
      },
    };

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "where can I stop to eat on the way to Sugba Lagoon?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Dapa Grill");
    expect(body.model).toBeUndefined();
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("does not fall back to generic chat when recommendation agent fails", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        throw new Error("planner returned invalid JSON");
      },
    };

    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "suggest me good restaurant to eat near Dapa" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("recommendation_failed");
    expect(body.message).toContain("could not search local places");
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("default dependencies wire the recommendation agent", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:password@localhost:5432/siargao_portal";

    try {
      const dependencies = createDefaultChatRouteDependencies();

      expect(dependencies.recommendationAgent).toBeDefined();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  test("passes the Siargao weather snapshot to weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests[0]?.weatherContext?.sourceProfileId).toBe("source_open_meteo");
    expect(dependencies.requests[0]?.weatherContext?.summary).toContain("Open-Meteo");
  });

  test("uses the Del Carmen forecast location for Del Carmen weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "What's the weather today in Siargao Del Carmen area?" },
        ],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.weatherLocations[0]?.id).toBe("siargao_del_carmen");
    expect(dependencies.weatherLocations[0]?.name).toContain("Del Carmen");
  });

  test("does not fetch weather context for non-weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(0);
    expect(dependencies.requests[0]?.weatherContext).toBeUndefined();
  });

  test("does not call recommendation agent for ordinary chat", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return { status: "unsupported", message: "", model: "gpt-5.5" };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "How many nights should we stay in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(agentCalls).toBe(0);
  });

  test("returns stable unavailable response when OpenAI is not configured", async () => {
    const response = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Hi" }] }),
      {
        generateAskSiargaoChatResponse: async () => {
          throw new Error("OPENAI_API_KEY is required for Ask Siargao chat.");
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("chat_not_configured");
  });
});

function chatDependencies() {
  const requests: Parameters<ChatRouteDependencies["generateAskSiargaoChatResponse"]>[0][] = [];
  const dependencies: ChatRouteDependencies & {
    requests: typeof requests;
    weatherLocations: OpenMeteoForecastLocation[];
    weatherRequests: number;
  } = {
    generateAskSiargaoChatResponse: async (request) => {
      requests.push(request);
      return {
        message: "Near Cloud 9, start with Kermit, Shaka, or Bravo depending on your budget.",
        model: request.model ?? "gpt-5.5",
        requestId: "req_chat_test",
      };
    },
    getLatestSiargaoWeatherSnapshot: async (options) => {
      dependencies.weatherRequests += 1;
      if (options?.location) {
        dependencies.weatherLocations.push(options.location);
      }
      return fallbackWeatherSnapshot;
    },
    requests,
    weatherLocations: [],
    weatherRequests: 0,
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
