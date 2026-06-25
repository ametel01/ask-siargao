import { describe, expect, test } from "bun:test";

import { type ChatRouteDependencies, chatResponse } from "@/app/api/chat/chat-route";
import type { AnswerContext, AnswerContextRequest } from "@/server/chat/answer-context-store";
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
    expect(dependencies.answerContextRequests).toHaveLength(0);
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
    expect(body.model).toBe("gpt-5.5");
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
  });

  test("passes DB-first answer context to restaurant recommendation questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "find me the best restaurant around cloud9" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.answerContextRequests).toHaveLength(1);
    expect(dependencies.answerContextRequests[0]?.userMessageId).toMatch(/^request_user_message_/);
    expect(dependencies.requests[0]?.answerContext?.sourceFreshness[0]?.sourceName).toBe(
      "Google Places",
    );
    expect(dependencies.requests[0]?.answerContext?.facts[0]?.claim).toContain("Kermit");
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

  test("does not fetch answer context for ordinary chat", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "How many nights should we stay in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.answerContextRequests).toHaveLength(0);
    expect(dependencies.requests[0]?.answerContext).toBeUndefined();
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
    answerContextRequests: AnswerContextRequest[];
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
    answerContextStore: {
      getOrRefresh: async (request) => {
        dependencies.answerContextRequests.push(request);
        return answerContextFixture;
      },
    },
    requests,
    answerContextRequests: [],
    weatherLocations: [],
    weatherRequests: 0,
  };

  return dependencies;
}

const answerContextFixture: AnswerContext = {
  facts: [
    {
      id: "answer_fact_place_kermit_place",
      type: "place_candidate",
      claim: "Kermit Surf Resort and Restaurant is a Google Places candidate for this request.",
      sourceRecordIds: ["record_google_places_chat_place_kermit"],
      requiresGoogleAttribution: true,
    },
  ],
  evidence: [],
  gaps: [],
  sourceFreshness: [
    {
      sourceName: "Google Places",
      status: "fresh",
      fetchedAt: "2026-06-24T00:00:00.000Z",
      staleAt: "2026-07-01T00:00:00.000Z",
      retentionExpiresAt: "2026-07-24T00:00:00.000Z",
    },
  ],
  liveRefreshCount: 0,
  estimatedProviderCostUsd: 0,
};

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
