import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import type { Logger } from "pino";

import {
  type ChatRouteDependencies,
  chatResponse,
  createDefaultChatRouteDependencies,
} from "@/app/api/chat/chat-route";
import type {
  AgentMemoryMetadata,
  AgentRuntimeRequest,
  AgentToolCallAudit,
  AgentTurnResult,
  DecisionSummary,
  ItineraryPlan,
  PublicAgentToolCall,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { createChatThread } from "@/server/chat/chat-history-store";
import { runInitialMigration } from "@/server/db/test-database";

describe("chat route", () => {
  test("rejects malformed JSON request bodies before calling the agent", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(rawRequest("{"), dependencies);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("rejects oversized content-length before reading or parsing the body", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      rawRequest("{}", { headers: { "content-length": "32769" } }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toBe("request_too_large");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("rejects streamed request bodies that exceed the chat byte limit", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      rawRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "x".repeat(33_000) }],
        }),
      ),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toBe("request_too_large");
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
      memory: memoryMetadata,
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
    expect(body.memory).toEqual(publicMemoryMetadata);
    expect(JSON.stringify(body.memory)).not.toContain("vs_route_memory");
    expect(JSON.stringify(body.memory)).not.toContain("checksum");
    expect(JSON.stringify(body.memory)).not.toContain("byteLength");
    expect(JSON.stringify(body.memory)).not.toContain("relativePath");
    expect(body.toolCalls).toEqual([]);
    expect(body.sources).toEqual([genericSourceSummary]);
    expect(body.cards).toBeUndefined();
    expect(body.actions).toBeUndefined();
    expect(body.itineraries).toBeUndefined();
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
    expect(dependencies.requests[0]?.metadata?.route).toBe("/api/chat");
  });

  test("persists authenticated chat turns with public artifacts and redacted context", async () => {
    const db = await openChatRouteTestDatabase();
    const rawProviderPhrase = "PRIVATE_PROVIDER_TIMEOUT_ROUTE_4815";
    const rawToolCall = toolCall({
      name: "search_google_places",
      status: "error",
      errorCode: "provider_unavailable",
      sources: [providerUnavailableSourceSummary],
      arguments: {
        latitude: 9.8116,
        longitude: 126.1651,
        query: "distinctive raw cafes near me papaya 4815",
      },
    });
    rawToolCall.resultText = `Google Places search failed: ${rawProviderPhrase}`;
    const dependencies = chatDependencies({
      message: "Two nearby options look good.",
      sources: [genericSourceSummary],
      cards: [genericRecommendationCard],
      toolCalls: [rawToolCall],
    });
    dependencies.db = db;
    dependencies.auth = async () => ({
      userId: "user_chat",
      sessionClaims: { email: "chat@example.com" },
    });
    dependencies.createId = deterministicIds();
    const geolocation = validGeolocation();

    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What cafes are open near me?" }],
        clientContext: { geolocation },
      }),
      dependencies,
    );
    const body = await response.json();
    const threads = await db.query<{ id: string; user_id: string }>(
      "select id, user_id from chat_threads",
    );
    const messages = await db.query<{
      role: string;
      content: string;
      sources_json: unknown;
      cards_json: unknown;
      decision_summaries_json: unknown;
      tool_calls_json: unknown;
      context_summary_json: unknown;
    }>(
      "select role, content, sources_json, cards_json, decision_summaries_json, tool_calls_json, context_summary_json from chat_messages order by created_at, id",
    );
    const serializedMessages = JSON.stringify(messages.rows);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      threadId: "chat_thread_1",
      userMessageId: "chat_message_2",
      assistantMessageId: "chat_message_3",
    });
    expect(threads.rows).toEqual([{ id: "chat_thread_1", user_id: "user_chat" }]);
    expect(messages.rows.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages.rows[0]?.content).toBe("What cafes are open near me?");
    expect(messages.rows[1]?.content).toBe("Two nearby options look good.");
    expect(body.cards).toEqual([genericRecommendationCard]);
    expect(body.toolCalls).toEqual([publicToolCall(rawToolCall)]);
    expect(messages.rows[1]?.cards_json).toEqual([genericRecommendationCard]);
    expect(messages.rows[1]?.decision_summaries_json).toEqual([]);
    expect(messages.rows[1]?.tool_calls_json).toEqual([publicToolCall(rawToolCall)]);
    expect(JSON.stringify(body.toolCalls)).not.toContain("arguments");
    expect(JSON.stringify(body.toolCalls)).not.toContain("resultText");
    expect(serializedMessages).not.toContain(String(geolocation.latitude));
    expect(serializedMessages).not.toContain(String(geolocation.longitude));
    expect(serializedMessages).toContain("usedAsProximityAnchor");
    expect(serializedMessages).not.toContain("distinctive raw cafes near me papaya 4815");
    expect(serializedMessages).not.toContain(rawProviderPhrase);
    expect(JSON.stringify(body)).not.toContain("distinctive raw cafes near me papaya 4815");
    expect(JSON.stringify(body)).not.toContain(rawProviderPhrase);

    await db.close();
  });

  test("appends authenticated chat to an owned thread", async () => {
    const db = await openChatRouteTestDatabase();
    const dependencies = chatDependencies({
      message: "Continue the same plan.",
      sources: [genericSourceSummary],
    });
    dependencies.db = db;
    dependencies.auth = async () => ({
      userId: "user_append",
      sessionClaims: { email: "append@example.com" },
    });
    dependencies.createId = deterministicIds();

    const firstResponse = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Plan lunch near Cloud 9" }] }),
      dependencies,
    );
    const firstBody = await firstResponse.json();
    const secondResponse = await chatResponse(
      jsonRequest({
        threadId: firstBody.threadId,
        messages: [{ role: "user", content: "Add a coffee stop" }],
      }),
      dependencies,
    );
    const secondBody = await secondResponse.json();
    const threads = await db.query<{ count: number }>(
      "select count(*)::int as count from chat_threads",
    );
    const messages = await db.query<{ role: string }>(
      "select role from chat_messages order by created_at, id",
    );

    expect(secondResponse.status).toBe(200);
    expect(secondBody.threadId).toBe(firstBody.threadId);
    expect(threads.rows[0]?.count).toBe(1);
    expect(messages.rows.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    await db.close();
  });

  test("returns 404 for authenticated chat thread access owned by another user", async () => {
    const db = await openChatRouteTestDatabase();
    await insertUser(db, "user_owner", "owner@example.com");
    await createChatThread(db, {
      id: "thread_other_user",
      userId: "user_owner",
      title: "Private thread",
      now: new Date("2026-06-29T05:00:00.000Z"),
    });
    const dependencies = chatDependencies();
    dependencies.db = db;
    dependencies.auth = async () => ({
      userId: "user_intruder",
      sessionClaims: { email: "intruder@example.com" },
    });

    const response = await chatResponse(
      jsonRequest({
        threadId: "thread_other_user",
        messages: [{ role: "user", content: "Continue this thread" }],
      }),
      dependencies,
    );
    const body = await response.json();
    const messages = await db.query<{ count: number }>(
      "select count(*)::int as count from chat_messages",
    );

    expect(response.status).toBe(404);
    expect(body.error).toBe("chat_thread_not_found");
    expect(messages.rows[0]?.count).toBe(0);

    await db.close();
  });

  test("keeps anonymous chat stateless even when a threadId is sent", async () => {
    const dependencies = chatDependencies({
      message: "Anonymous chat still works.",
      sources: [genericSourceSummary],
    });

    const response = await chatResponse(
      jsonRequest({
        threadId: "thread_ignored_for_anonymous",
        messages: [{ role: "user", content: "Where should I eat?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Anonymous chat still works.");
    expect(body.threadId).toBeUndefined();
    expect(body.userMessageId).toBeUndefined();
    expect(body.assistantMessageId).toBeUndefined();
  });

  test("accepts valid Siargao geolocation client context as deterministic browser context", async () => {
    const dependencies = chatDependencies({
      message: "The model uses browser location as optional context.",
      sources: [genericSourceSummary],
    });
    const geolocation = validGeolocation();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What is open near me?" }],
        clientContext: { geolocation },
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(dependencies.requests[0]?.clientContext?.geolocation).toEqual({
      status: "available",
      source: "browser_geolocation",
      consentScope: "single_request",
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      accuracyMeters: geolocation.accuracyMeters,
      capturedAt: geolocation.capturedAt,
    });
    expect(signals?.clientContext.geolocation).toEqual({
      status: "available",
      source: "browser_geolocation",
      consentScope: "single_request",
      centerSource: "browser_geolocation",
    });
    expect(JSON.stringify(signals?.clientContext)).not.toContain(String(geolocation.latitude));
    expect(JSON.stringify(signals?.clientContext)).not.toContain(String(geolocation.longitude));
    expect(dependencies.requests[0]?.metadata?.clientContext).toEqual({
      geolocation: {
        status: "available",
        source: "browser_geolocation",
        consentScope: "single_request",
      },
    });
    expect(JSON.stringify(dependencies.requests[0]?.metadata)).not.toContain(
      String(geolocation.latitude),
    );
    expect(JSON.stringify(dependencies.requests[0]?.metadata)).not.toContain(
      String(geolocation.longitude),
    );
  });

  test("uses browser geolocation instead of the General Luna default for near-me surf prompts", async () => {
    const dependencies = chatDependencies({
      message: "The model should use shared browser location as the proximity anchor.",
      sources: [genericSourceSummary],
    });
    const geolocation = validGeolocation();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "I want to go surfing today, what are the closest spots near me?",
          },
        ],
        clientContext: { geolocation },
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("surfing");
    expect(signals?.intent.nearby).toBe(true);
    expect(signals?.intent.nearMeUsesBrowserGeolocation).toBe(true);
    expect(signals?.intent.locationLabel).toBeUndefined();
    expect(signals?.intent.tripContext?.currentLocation).toBeUndefined();
    expect(signals?.intent.browserGeolocation).toMatchObject({
      useAsProximityAnchor: true,
      source: "browser_geolocation",
      exactCoordinatesHidden: true,
    });
    expect(JSON.stringify(signals)).not.toContain("General Luna");
    expect(JSON.stringify(signals)).not.toContain(String(geolocation.latitude));
    expect(JSON.stringify(signals)).not.toContain(String(geolocation.longitude));
  });

  test("treats missing optional geolocation as accepted missing browser context", async () => {
    const dependencies = chatDependencies({
      message: "The model continues without browser location.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What is open in General Luna?" }],
        clientContext: {},
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.clientContext.geolocation).toEqual({
      status: "missing",
      source: "browser_geolocation",
    });
  });

  test("rejects malformed geolocation schema before calling the agent", async () => {
    for (const scenario of [
      {
        name: "impossible latitude",
        geolocation: { ...validGeolocation(), latitude: 100 },
        path: "clientContext.geolocation.latitude",
      },
      {
        name: "malformed capturedAt",
        geolocation: { ...validGeolocation(), capturedAt: "not-a-date" },
        path: "clientContext.geolocation.capturedAt",
      },
      {
        name: "invalid consent scope",
        geolocation: { ...validGeolocation(), consentScope: "forever" },
        path: "clientContext.geolocation.consentScope",
      },
    ]) {
      const dependencies = chatDependencies();
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: "What is open near me?" }],
          clientContext: { geolocation: scenario.geolocation },
        }),
        dependencies,
      );
      const body = await response.json();

      expect(response.status, scenario.name).toBe(400);
      expect(body.error, scenario.name).toBe("invalid_chat_request");
      expect(
        body.issues.map((issue: { path: string }) => issue.path),
        scenario.name,
      ).toContain(scenario.path);
      expect(dependencies.requests, scenario.name).toHaveLength(0);
    }
  });

  test("ignores out-of-area geolocation without exposing coordinates to agent tools", async () => {
    const dependencies = chatDependencies({
      message: "The model asks the user to type a Siargao area.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What is open near me?" }],
        clientContext: {
          geolocation: {
            ...validGeolocation(),
            latitude: 14.5995,
            longitude: 120.9842,
          },
        },
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.clientContext.geolocation).toEqual({
      status: "out_of_area",
      source: "browser_geolocation",
      consentScope: "single_request",
    });
    expect(JSON.stringify(signals?.clientContext.geolocation)).not.toContain("14.5995");
    expect(JSON.stringify(signals?.clientContext.geolocation)).not.toContain("120.9842");
  });

  test("marks stale and low-accuracy geolocation as unusable browser context", async () => {
    for (const scenario of [
      {
        name: "stale",
        geolocation: { ...validGeolocation(), capturedAt: "2026-01-01T00:00:00.000Z" },
        status: "stale",
      },
      {
        name: "low accuracy",
        geolocation: { ...validGeolocation(), accuracyMeters: 4_000 },
        status: "low_accuracy",
      },
    ]) {
      const dependencies = chatDependencies({
        message: "The model continues without a usable browser center.",
        sources: [genericSourceSummary],
      });
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: "What is open near me?" }],
          clientContext: { geolocation: scenario.geolocation },
        }),
        dependencies,
      );
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status, scenario.name).toBe(200);
      expect(signals?.clientContext.geolocation, scenario.name).toEqual({
        status: scenario.status,
        source: "browser_geolocation",
        consentScope: "single_request",
      });
    }
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

  test("passes condition hints for swimming prompts without forcing an itinerary", async () => {
    const dependencies = chatDependencies({
      message: "The model should use condition evidence before advising on swimming.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Is Malinao good for swimming today?" }],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("swimming");
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.weatherSensitive).toBe(true);
    expect(signals?.intent.activityPlan).toBe(false);
  });

  test("passes condition hints for mixed scooter and boat prompts", async () => {
    const dependencies = chatDependencies({
      message: "The model should judge road and marine conditions with tools.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Is it okay to scooter to Del Carmen before a Sugba boat trip today?",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("boat_trip");
    expect(signals?.intent.roadCondition).toBe(true);
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.weatherSensitive).toBe(true);
    expect(signals?.intent.activityPlan).toBe(false);
  });

  test("does not classify land or scooter tour prompts as boat trips", async () => {
    for (const prompt of ["Is a land tour okay today?", "Can I scooter tour Siargao today?"]) {
      const dependencies = chatDependencies({
        message: "The model should judge road and exposure conditions with tools.",
        sources: [genericSourceSummary],
      });
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: prompt }],
        }),
        dependencies,
      );
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status).toBe(200);
      expect(signals?.intent.conditionActivity).toBe("scooter");
      expect(signals?.intent.roadCondition).toBe(true);
      expect(signals?.intent.marineCondition).toBe(false);
      expect(signals?.intent.weatherSensitive).toBe(true);
    }
  });

  test("classifies boat ride prompts as boat condition judgments", async () => {
    const dependencies = chatDependencies({
      message: "The model should judge boat and marine conditions with tools.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Is the boat ride to Sugba okay today?" }],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("boat_trip");
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.roadCondition).toBe(false);
    expect(signals?.intent.weatherSensitive).toBe(true);
  });

  test("inherits boat context for bare ride follow-ups", async () => {
    const dependencies = chatDependencies({
      message: "The model should judge tomorrow boat and marine conditions with tools.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Is the boat ride to Sugba okay today?" },
          { role: "assistant", content: "Check condition evidence before deciding." },
          { role: "user", content: "Can I ride tomorrow?" },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("boat_trip");
    expect(signals?.intent.locationLabel).toBe("Del Carmen");
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.roadCondition).toBe(false);
    expect(signals?.intent.weatherSensitive).toBe(true);
  });

  test("classifies wave questions for Sugba boats as boat condition judgments", async () => {
    const dependencies = chatDependencies({
      message: "The model should judge boat and marine conditions with tools.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Are the waves okay for the boat to Sugba?" }],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("boat_trip");
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.weatherSensitive).toBe(true);
  });

  test("inherits condition intent for temporal follow-ups", async () => {
    const dependencies = chatDependencies({
      message: "The model should check tomorrow condition evidence.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Is Malinao good for swimming today?" },
          { role: "assistant", content: "Use condition evidence before deciding." },
          { role: "user", content: "What about tomorrow?" },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.conditionActivity).toBe("swimming");
    expect(signals?.intent.marineCondition).toBe(true);
    expect(signals?.intent.weatherSensitive).toBe(true);
  });

  for (const scenario of [
    {
      prompt: "Is Malinao good for swimming today?",
      expectedActivity: "swimming",
      message: "The model says swimming is flexible after checking weather.",
    },
    {
      prompt: "What should I avoid on a rainy day in General Luna?",
      expectedActivity: "rain_plan",
      message: "The model says avoid exposed rides and use covered stops.",
    },
    {
      prompt: "Is it okay to scooter to Pacifico today?",
      expectedActivity: "scooter",
      message: "The model says scooter conditions need a short low-exposure fallback.",
    },
    {
      prompt: "Is Cloud 9 sunset worth it today?",
      expectedActivity: "sunset",
      message: "The model says sunset is flexible if the weather window holds.",
    },
    {
      prompt: "Is a Sugba boat trip sensible today?",
      expectedActivity: "boat_trip",
      message: "The model says the boat trip needs local marine confirmation.",
    },
  ]) {
    test(`returns condition judgment evidence for ${scenario.expectedActivity} prompts`, async () => {
      const conditionToolCall = toolCall({
        name: "get_condition_judgment",
        status: "success",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      });
      const dependencies = chatDependencies({
        message: scenario.message,
        toolCalls: [conditionToolCall],
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      });
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: scenario.prompt }],
        }),
        dependencies,
      );
      const body = await response.json();
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status).toBe(200);
      expect(body.message).toBe(scenario.message);
      expect(body.toolCalls[0]).toMatchObject({ name: "get_condition_judgment" });
      expect(body.sources).toEqual([weatherSourceSummary, conditionMarineSourceSummary]);
      expect(signals?.intent.conditionActivity).toBe(scenario.expectedActivity);
      expect(signals?.intent.weatherSensitive).toBe(true);
    });
  }

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

  test("returns browser-location Places source metadata when tool-backed", async () => {
    const placesToolCall = toolCall({
      name: "search_places",
      status: "success",
      arguments: {
        query: "cafes near me",
        center: { latitude: 9.8116, longitude: 126.1651 },
      },
      sources: [browserLocationPlacesSourceSummary],
    });
    const dependencies = chatDependencies({
      message: "The model recommends a cafe near your shared location.",
      toolCalls: [placesToolCall],
      sources: [browserLocationPlacesSourceSummary],
      cards: [
        {
          ...placeRecommendationCard,
          caveats: [
            ...placeRecommendationCard.caveats,
            "Search center came from consented browser geolocation; exact coordinates are not displayed.",
          ],
        },
      ],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near me that are open now." }],
        clientContext: { geolocation: validGeolocation() },
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sources).toEqual([browserLocationPlacesSourceSummary]);
    expect(body.sources[0].checked).toContain("browser geolocation search center");
    expect(body.toolCalls[0]).toEqual(publicToolCall(placesToolCall));
    expect(body.cards[0].caveats.join(" ")).toContain("browser geolocation");
    expect(JSON.stringify(body.toolCalls)).not.toContain("9.8116");
    expect(JSON.stringify(body.toolCalls)).not.toContain("126.1651");
    expect(JSON.stringify(body.cards)).not.toContain("9.8116");
    expect(JSON.stringify(body.cards)).not.toContain("126.1651");
  });

  test("rejects final answers that render exact browser-location coordinates", async () => {
    const dependencies = chatDependencies({
      message: "I used your location at 9.8116, 126.1651 to search nearby cafes.",
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          arguments: {
            query: "cafes near me",
            center: { latitude: 9.8116, longitude: 126.1651 },
          },
          sources: [browserLocationPlacesSourceSummary],
        }),
      ],
      sources: [browserLocationPlacesSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near me that are open now." }],
        clientContext: { geolocation: validGeolocation() },
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
  });

  test("returns structured cards and actions while preserving the markdown message", async () => {
    const dependencies = chatDependencies({
      message: "The model-written answer still recommends Shaka in markdown.",
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [placesSourceSummary],
        }),
      ],
      sources: [placesSourceSummary],
      cards: [placeRecommendationCard],
      actions: [promptAction],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near Cloud 9 that are open now." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("The model-written answer still recommends Shaka in markdown.");
    expect(body.requestId).toBe(dependencies.requests[0]?.requestId);
    expect(body.sources).toEqual([placesSourceSummary]);
    expect(body.cards).toEqual([placeRecommendationCard]);
    expect(body.actions).toEqual([promptAction]);
  });

  test("logs selected and unselected artifact counts without exposing selection metadata", async () => {
    const logs = captureLogger();
    const dependencies = chatDependencies({
      message: "The model-written answer still recommends Shaka in markdown.",
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [placesSourceSummary],
        }),
      ],
      sources: [placesSourceSummary],
      cards: [placeRecommendationCard],
      actions: [promptAction],
      artifactSelection: {
        mode: "strict",
        structuredFinalPayload: true,
        totalCardCount: 2,
        totalActionCount: 2,
        totalItineraryCount: 0,
        totalDecisionSummaryCount: 0,
        selectedCardCount: 1,
        selectedActionCount: 1,
        selectedItineraryCount: 0,
        selectedDecisionSummaryCount: 0,
        unselectedCardCount: 1,
        unselectedActionCount: 1,
        unselectedItineraryCount: 0,
        unselectedDecisionSummaryCount: 0,
        unknownCardIds: ["missing_card"],
        unknownActionIds: ["missing_action"],
        unknownItineraryIds: [],
        unknownDecisionSummaryIds: [],
      },
    });
    dependencies.logger = logs.logger;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near Cloud 9 that are open now." }],
      }),
      dependencies,
    );
    const body = await response.json();
    const answeredLog = logs.events.find((event) => event.message === "Chat request answered.");

    expect(response.status).toBe(200);
    expect(body.cards).toEqual([placeRecommendationCard]);
    expect(body.actions).toEqual([promptAction]);
    expect(body.artifactSelection).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("unselected");
    expect(answeredLog?.payload).toMatchObject({
      cardCount: 1,
      actionCount: 1,
      itineraryCount: 0,
      artifactSelection: {
        mode: "strict",
        structuredFinalPayload: true,
        totalCardCount: 2,
        selectedCardCount: 1,
        unselectedCardCount: 1,
        totalActionCount: 2,
        selectedActionCount: 1,
        unselectedActionCount: 1,
        totalDecisionSummaryCount: 0,
        selectedDecisionSummaryCount: 0,
        unselectedDecisionSummaryCount: 0,
        unknownCardIds: ["missing_card"],
        unknownActionIds: ["missing_action"],
      },
    });
    expect(JSON.stringify(answeredLog?.payload)).not.toContain("place_shaka");
  });

  test("returns public sources while logging aggregate source counts", async () => {
    const logs = captureLogger();
    const dependencies = chatDependencies({
      message: "The model-written answer uses the Places-backed breakfast source.",
      toolCalls: [
        toolCall({
          name: "search_local_guide",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
        toolCall({
          name: "search_places",
          status: "success",
          sources: [placesSourceSummary],
        }),
      ],
      sources: [localGuideSourceSummary, placesSourceSummary],
      publicSources: [placesSourceSummary],
    });
    dependencies.logger = logs.logger;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find breakfast near Cloud 9." }],
      }),
      dependencies,
    );
    const body = await response.json();
    const answeredLog = logs.events.find((event) => event.message === "Chat request answered.");

    expect(response.status).toBe(200);
    expect(body.sources).toEqual([placesSourceSummary]);
    expect(answeredLog?.payload).toMatchObject({
      sourceCount: 2,
      publicSourceCount: 1,
      sourceLabels: ["curated_local_guide", "live_checked"],
      publicSourceLabels: ["live_checked"],
    });
  });

  test("rejects rendered source lines that are only backed by aggregate internal sources", async () => {
    const dependencies = chatDependencies({
      message:
        "The model-written answer cites internal local-guide evidence.\n\nChecked: Ask Siargao curated local beach guide (curated local guide; medium confidence) - beach surface notes and ride-time notes.",
      toolCalls: [
        toolCall({
          name: "search_local_guide",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
        toolCall({
          name: "search_places",
          status: "success",
          sources: [placesSourceSummary],
        }),
      ],
      sources: [localGuideSourceSummary, placesSourceSummary],
      publicSources: [placesSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find breakfast near Cloud 9." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
  });

  test("validates selected card sources before returning them", async () => {
    const dependencies = chatDependencies({
      message: "The model-written answer recommends Shaka from a public card.",
      sources: [],
      cards: [{ ...placeRecommendationCard, sources: [placesSourceSummary] }],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Find cafes near Cloud 9 that are open now." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
  });

  test("returns itinerary artifacts with markdown, metadata, tool calls, and sources", async () => {
    const itineraryToolCall = toolCall({
      name: "plan_local_itinerary",
      status: "success",
      sources: [localGuideSourceSummary],
    });
    const dependencies = chatDependencies({
      message: "Here is the model-written itinerary answer.",
      toolCalls: [itineraryToolCall],
      sources: [localGuideSourceSummary],
      itineraries: [rainyCloud9Itinerary],
      memory: memoryMetadata,
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 afternoon for 3 hours." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Here is the model-written itinerary answer.");
    expect(body.requestId).toBe(dependencies.requests[0]?.requestId);
    expect(body.model).toBe("gpt-test");
    expect(body.toolCalls).toEqual([publicToolCall(itineraryToolCall)]);
    expect(body.sources).toEqual([localGuideSourceSummary]);
    expect(body.memory).toEqual(publicMemoryMetadata);
    expect(body.itineraries).toEqual([rainyCloud9Itinerary]);
  });

  test("validates itinerary artifact sources before returning them", async () => {
    const dependencies = chatDependencies({
      message: "Here is an itinerary with an invalid checked artifact source.",
      toolCalls: [],
      sources: [genericSourceSummary],
      itineraries: [
        {
          ...rainyCloud9Itinerary,
          sources: [weatherSourceSummary],
        },
      ],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 afternoon for 3 hours." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
  });

  test("returns selected decision summaries with governed sources", async () => {
    const logs = captureLogger();
    const weatherToolCall = toolCall({
      name: "get_condition_judgment",
      status: "success",
      sources: [weatherSourceSummary],
    });
    const dependencies = chatDependencies({
      message: "Keep the swim flexible and confirm the beach locally.",
      toolCalls: [weatherToolCall],
      sources: [weatherSourceSummary],
      publicSources: [weatherSourceSummary],
      decisionSummaries: [swimmingDecisionSummary],
      artifactSelection: {
        mode: "strict",
        structuredFinalPayload: true,
        totalCardCount: 0,
        totalActionCount: 0,
        totalItineraryCount: 0,
        totalDecisionSummaryCount: 2,
        selectedCardCount: 0,
        selectedActionCount: 0,
        selectedItineraryCount: 0,
        selectedDecisionSummaryCount: 1,
        unselectedCardCount: 0,
        unselectedActionCount: 0,
        unselectedItineraryCount: 0,
        unselectedDecisionSummaryCount: 1,
        unknownCardIds: [],
        unknownActionIds: [],
        unknownItineraryIds: [],
        unknownDecisionSummaryIds: [],
      },
    });
    dependencies.logger = logs.logger;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Should I swim at Cloud 9 today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.decisionSummaries).toEqual([swimmingDecisionSummary]);
    expect(body.sources).toEqual([weatherSourceSummary]);
    const answeredLog = logs.events.find((event) => event.message === "Chat request answered.");
    expect(answeredLog?.payload).toMatchObject({
      decisionSummaryCount: 1,
      artifactSelection: {
        totalDecisionSummaryCount: 2,
        selectedDecisionSummaryCount: 1,
        unselectedDecisionSummaryCount: 1,
      },
    });
  });

  test("returns cross-request public artifacts without internal selection diagnostics", async () => {
    for (const scenario of routeAnswerQualityScenarios()) {
      const dependencies = chatDependencies(scenario.agentResult);
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: scenario.prompt }],
        }),
        dependencies,
      );
      const body = await response.json();
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status, scenario.name).toBe(200);
      expect(body.message, scenario.name).toStartWith(scenario.expectedOpening);
      assertRouteTravelerProseHasNoInternalMechanics(body.message);
      expect(body.sources, scenario.name).toEqual(scenario.expectedSources);
      expect(body.cards?.map((card: { id: string }) => card.id) ?? [], scenario.name).toEqual(
        scenario.expectedCardIds,
      );
      expect(
        body.decisionSummaries?.map((summary: { id: string }) => summary.id) ?? [],
        scenario.name,
      ).toEqual(scenario.expectedDecisionSummaryIds);
      expect(body.itineraries?.map((itinerary: { id?: string }) => itinerary.id) ?? []).toEqual(
        scenario.expectedItineraryIds,
      );
      expect(body.artifactSelection, scenario.name).toBeUndefined();
      expect(JSON.stringify(body), scenario.name).not.toContain("unselected");
      expect(JSON.stringify(body), scenario.name).not.toContain("artifactSelection");
      scenario.assertSignals(signals);
    }
  });

  test("validates selected decision summary sources before returning them", async () => {
    const dependencies = chatDependencies({
      message: "Here is a decision summary with an invalid checked source.",
      toolCalls: [],
      sources: [genericSourceSummary],
      publicSources: [genericSourceSummary],
      decisionSummaries: [swimmingDecisionSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Should I swim at Cloud 9 today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
  });

  test("omits itinerary artifacts when the agent returns none", async () => {
    const dependencies = chatDependencies({
      message: "No structured itinerary needed.",
      sources: [genericSourceSummary],
      itineraries: [],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Give me one quick Siargao tip." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.itineraries).toBeUndefined();
  });

  for (const scenario of [
    {
      name: "rainy Cloud 9 afternoon",
      prompt: "Plan a rainy Cloud 9 afternoon for 3 hours.",
      itinerary: () => rainyCloud9Itinerary,
      assertSignals: (signals: AgentSignals | undefined) => {
        expect(signals?.intent.activityPlan).toBe(true);
        expect(signals?.intent.weatherSensitive).toBe(true);
      },
    },
    {
      name: "sunset plus dinner",
      prompt: "Plan sunset plus dinner in General Luna tonight.",
      itinerary: () => sunsetDinnerItinerary,
      assertSignals: (signals: AgentSignals | undefined) => {
        expect(signals?.intent.activityPlan).toBe(true);
        expect(signals?.intent.placeIntent?.category).toBe("food");
      },
    },
    {
      name: "sandy beach half-day",
      prompt: "Plan a sandy beach half-day within 30 minutes from General Luna.",
      itinerary: () => sandyBeachItinerary,
      assertSignals: (signals: AgentSignals | undefined) => {
        expect(signals?.intent.activityPlan).toBe(true);
        expect(signals?.intent.beach).toBe(true);
      },
    },
    {
      name: "food crawl",
      prompt: "Plan a three-hour food crawl in General Luna.",
      itinerary: () => foodCrawlItinerary,
      assertSignals: (signals: AgentSignals | undefined) => {
        expect(signals?.intent.activityPlan).toBe(true);
        expect(signals?.intent.placeIntent?.category).toBe("food");
      },
    },
  ]) {
    test(`returns itinerary artifacts for ${scenario.name} prompts`, async () => {
      const itinerary = scenario.itinerary();
      const dependencies = chatDependencies({
        message: `Model-written ${scenario.name} itinerary.`,
        toolCalls: [
          toolCall({
            name: "plan_local_itinerary",
            status: "success",
            sources: [localGuideSourceSummary],
          }),
        ],
        sources: [localGuideSourceSummary],
        itineraries: [itinerary],
      });
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: scenario.prompt }],
        }),
        dependencies,
      );
      const body = await response.json();
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status).toBe(200);
      expect(body.message).toContain("Model-written");
      expect(body.itineraries).toEqual([itinerary]);
      scenario.assertSignals(signals);
    });
  }

  test("marks sandy beach half-day prompts as activity plans without explicit plan verbs", async () => {
    const dependencies = chatDependencies({
      message: "The model writes a sandy half-day answer.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Sandy beach half-day from General Luna." }],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.activityPlan).toBe(true);
    expect(signals?.intent.beach).toBe(true);
    expect(signals?.intent.locationLabel).toBe("General Luna");
  });

  test("marks scoped half-day prompts by van as activity plans", async () => {
    const dependencies = chatDependencies({
      message: "The model writes a van-based half-day answer.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Plan a 3-hour non-surfer half-day by van from General Luna.",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.activityPlan).toBe(true);
    expect(signals?.intent.locationLabel).toBe("General Luna");
  });

  test("marks scoped food-crawl prompts before ferry transfer as activity plans", async () => {
    const dependencies = chatDependencies({
      message: "The model writes a ferry-timed food crawl answer.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Plan a 3-hour food crawl before my ferry transfer in General Luna.",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.activityPlan).toBe(true);
    expect(signals?.intent.placeIntent?.category).toBe("food");
    expect(signals?.intent.locationLabel).toBe("General Luna");
  });

  test("marks scoped half-day route before airport pickup as an activity plan", async () => {
    const dependencies = chatDependencies({
      message: "The model writes an airport-timed half-day answer.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Half-day non-surfer route before airport pickup from General Luna.",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.activityPlan).toBe(true);
    expect(signals?.intent.locationLabel).toBe("General Luna");
  });

  test("does not mark not-surfing food prompts as activity plans", async () => {
    const dependencies = chatDependencies({
      message: "The model answers the food question without an itinerary artifact.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "I'm not surfing today, where should I eat in General Luna?",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.activityPlan).toBe(false);
    expect(signals?.intent.placeIntent?.category).toBe("food");
    expect(signals?.intent.locationLabel).toBe("General Luna");
  });

  test("marks multi-need Cloud 9 stay prompts as broad trip advice", async () => {
    const dependencies = chatDependencies({
      message:
        "For 10 days near Cloud 9, treat sleep, surf, food, and transfer as separate planning needs.",
      sources: [genericSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content:
              "I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants, and easy airport transfer. What should we know?",
          },
        ],
      }),
      dependencies,
    );
    const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

    expect(response.status).toBe(200);
    expect(signals?.intent.tripAdvice).toBe(true);
    expect(signals?.intent.activityPlan).toBe(false);
    expect(signals?.intent.tripContext?.activeGoal).toBe("trip_advice");
    expect(signals?.intent.placeIntent?.category).toBe("food");
    expect(signals?.intent.conditionActivity).toBe("surfing");
    expect(signals?.intent.locationLabel).toBe("Cloud 9");
  });

  for (const prompt of [
    "Can you plan my airport transfer to General Luna?",
    "Can you plan my 2-hour airport transfer from General Luna?",
    "Can you plan my ferry transfer to General Luna?",
    "Can you critique my itinerary for tomorrow?",
    "Can you plan my trip to Siargao?",
  ]) {
    test(`does not mark non-itinerary plan prompt as an activity plan: ${prompt}`, async () => {
      const dependencies = chatDependencies({
        message: "The model answers without a structured itinerary repair.",
        sources: [genericSourceSummary],
      });
      const response = await chatResponse(
        jsonRequest({
          messages: [{ role: "user", content: prompt }],
        }),
        dependencies,
      );
      const signals = dependencies.requests[0]?.deterministicSignals as AgentSignals | undefined;

      expect(response.status).toBe(200);
      expect(signals?.intent.activityPlan).toBe(false);
    });
  }

  test("allows not-verified card source labels without checked tool evidence", async () => {
    const dependencies = chatDependencies({
      message: "This is a model-written answer with generic reasoning only.",
      sources: [genericSourceSummary],
      cards: [genericRecommendationCard],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Give me a simple Siargao arrival tip." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("generic reasoning");
    expect(body.cards).toEqual([genericRecommendationCard]);
    expect(body.actions).toBeUndefined();
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
      memory: memoryMetadata,
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

  test("allows source-policy descriptions without treating policy labels as answer evidence", async () => {
    const dependencies = chatDependencies({
      message: "The source policy says live_checked is a label for successful live Places checks.",
      toolCalls: [
        toolCall({
          name: "describe_source_policy",
          status: "success",
          sources: [],
        }),
      ],
      sources: [],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What do your source labels mean?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("live_checked");
    expect(body.sources).toEqual([]);
    expect(body.toolCalls[0]).toMatchObject({
      name: "describe_source_policy",
      status: "success",
      sources: [],
    });
  });

  test("logs route metadata for tool calls and provider failures without restricted payloads", async () => {
    const logs = captureLogger();
    const sensitivePhrase = "private card phrase pineapple vault 4242";
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
      memory: memoryMetadata,
    });
    dependencies.logger = logs.logger;
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: sensitivePhrase }],
        clientContext: { geolocation: validGeolocation() },
      }),
      dependencies,
    );
    const body = await response.json();
    const receivedLog = logs.events.find((event) => event.message === "Chat request received.");
    const answeredLog = logs.events.find((event) => event.message === "Chat request answered.");

    expect(response.status).toBe(200);
    expect(logs.childBindings[0]?.requestId).toBe(body.requestId);
    expect(answeredLog?.payload).toMatchObject({
      branch: "agent_runtime",
      model: "gpt-test",
      agentMemoryVersionId: memoryMetadata.versionId,
      providerFailure: true,
      sourceLabels: ["provider_unavailable"],
      itineraryCount: 0,
      toolCallCount: 1,
      geolocation: {
        status: "available",
        source: "browser_geolocation",
        consentScope: "single_request",
      },
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
    expect(receivedLog?.payload.geolocation).toEqual({
      status: "available",
      source: "browser_geolocation",
      consentScope: "single_request",
    });
    expect(receivedLog?.payload.latestUserMessage).toEqual({
      length: sensitivePhrase.length,
      hash: truncatedSha256(sensitivePhrase),
    });
    expect(JSON.stringify(answeredLog?.payload)).not.toContain("SECRET_TOKEN");
    expect(
      JSON.stringify({ childBindings: logs.childBindings, events: logs.events }),
    ).not.toContain(sensitivePhrase);
    expect(JSON.stringify(logs.events)).not.toContain("9.8116");
    expect(JSON.stringify(logs.events)).not.toContain("126.1651");
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

  test("repairs malformed rendered source footers when structured tool evidence is valid", async () => {
    const dependencies = chatDependencies({
      message:
        "Lost In Siargao is a practical nearby dinner option.\n\nChecked: these are **open now** via Google Places.\nNot checked: table availability, current wait times, or menu changes.",
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
        messages: [{ role: "user", content: "Find dinner near Cloud 9." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Lost In Siargao is a practical nearby dinner option.");
    expect(body.message).not.toContain("Checked:");
    expect(body.message).not.toContain("Not checked:");
  });

  test("removes internal unchecked prose before returning the assistant answer", async () => {
    const dependencies = chatDependencies({
      message:
        "Here is a quiet Siargao plan: start at Doot, add a General Luna cafe, then keep Malinao optional. I didn’t live-check tide, crowd levels, road conditions, or cafe opening status, so keep it flexible.",
      toolCalls: [
        toolCall({
          name: "plan_local_itinerary",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
      sources: [localGuideSourceSummary],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Help me plan a quiet Siargao day." }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe(
      "Here is a quiet Siargao plan: start at Doot, add a General Luna cafe, then keep Malinao optional.",
    );
    expect(body.message).not.toContain("live-check");
    expect(body.message).not.toContain("not checked");
  });

  test("rejects rendered checked claims that do not match the tool-backed source text", async () => {
    const dependencies = chatDependencies({
      message:
        "The model overclaims the checked source line.\n\nChecked: Google Places (live checked; high confidence; profile source_google_places) - bookings.",
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
        messages: [{ role: "user", content: "Can I book this restaurant tonight?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
  });

  test("rejects checked tide and surf labels at the route boundary", async () => {
    const checkedMarineSource: AnswerSourceSummary = {
      label: "weather_checked",
      sourceName: "Tide and surf condition provider",
      confidence: "medium",
      checked: ["tide", "surf"],
      notChecked: [],
    };
    const dependencies = chatDependencies({
      message: "The model claims tide and surf were checked.",
      toolCalls: [
        toolCall({
          name: "get_condition_judgment",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
      sources: [checkedMarineSource],
    });
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Are tides and surf okay for swimming?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("source_consistency_failed");
    expect(body.message).toContain("verify the answer sources");
  });

  test("returns stable unavailable response when the agent runtime is not configured", async () => {
    const response = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Hi" }] }),
      {
        auth: null,
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

type RouteAnswerQualityScenario = {
  name: string;
  prompt: string;
  agentResult: Partial<AgentTurnResult>;
  expectedOpening: string;
  expectedSources: readonly AnswerSourceSummary[];
  expectedCardIds: readonly string[];
  expectedDecisionSummaryIds: readonly string[];
  expectedItineraryIds: readonly string[];
  assertSignals: (signals: AgentSignals | undefined) => void;
};

function routeAnswerQualityScenarios(): RouteAnswerQualityScenario[] {
  const dapaBreakfastCard = {
    id: "place_dapa_breakfast_house",
    kind: "place" as const,
    title: "Dapa Breakfast House",
    subtitle: "Breakfast in Dapa",
    mapsUrl: "https://maps.example/dapa-breakfast-house",
    fitReasons: ["Fits Dapa before-ferry breakfast without a General Luna detour."],
    caveats: ["Table availability was not confirmed."],
    sourceLabel: "Google Places - live checked",
    sources: [placesSourceSummary],
  };
  const weatherUnavailableSourceSummary: AnswerSourceSummary = {
    label: "provider_unavailable",
    sourceName: "Open-Meteo weather API",
    sourceProfileId: "source_open_meteo",
    confidence: "low",
    checked: [],
    notChecked: ["weather forecast"],
  };
  const weatherDecisionSummary: DecisionSummary = {
    id: "decision:cloud_9_sunset:hold_for_confirmation",
    bestAction: "Keep Cloud 9 sunset optional.",
    basis: "The forecast could not be checked for the rain window.",
    fallback: "Use a covered General Luna stop until the sky is locally clear.",
    timing: "today",
    area: "Cloud 9",
    sources: [weatherUnavailableSourceSummary],
  };
  const reviewDecisionSummary: DecisionSummary = {
    id: "decision:review:dapa_ferry",
    bestAction: "Keep Cloud 9, move dinner closer to Dapa.",
    basis: "Pacifico dinner adds too much travel before an early ferry.",
    avoid: "Avoid the far-north dinner leg that night.",
    timing: "tomorrow night",
    area: "General Luna / Dapa",
    sources: [localGuideSourceSummary],
  };

  return [
    {
      name: "Dapa breakfast place card",
      prompt: "I'm in Dapa before the ferry. Where should we get budget breakfast?",
      agentResult: {
        message:
          "Go to Dapa Breakfast House before the ferry; it keeps breakfast cheap and avoids a General Luna detour.",
        toolCalls: [
          toolCall({
            name: "search_places",
            status: "success",
            sources: [placesSourceSummary],
          }),
        ],
        sources: [placesSourceSummary],
        publicSources: [placesSourceSummary],
        cards: [dapaBreakfastCard],
        artifactSelection: routeArtifactSelection({
          totalCardCount: 2,
          selectedCardCount: 1,
          unselectedCardCount: 1,
        }),
      },
      expectedOpening: "Go to Dapa Breakfast House",
      expectedSources: [placesSourceSummary],
      expectedCardIds: [dapaBreakfastCard.id],
      expectedDecisionSummaryIds: [],
      expectedItineraryIds: [],
      assertSignals: (signals) => {
        expect(signals?.intent.placeIntent?.category).toBe("food");
        expect(signals?.intent.activityPlan).toBe(false);
      },
    },
    {
      name: "Cloud 9 weather decision summary",
      prompt: "Is Cloud 9 sunset still worth it today if rain is coming?",
      agentResult: {
        message:
          "Keep Cloud 9 sunset optional today; use a covered General Luna stop until the sky is locally clear.",
        toolCalls: [
          toolCall({
            name: "get_condition_judgment",
            status: "error",
            errorCode: "provider_unavailable",
            sources: [weatherUnavailableSourceSummary],
          }),
        ],
        sources: [weatherUnavailableSourceSummary],
        publicSources: [weatherUnavailableSourceSummary],
        decisionSummaries: [weatherDecisionSummary],
        artifactSelection: routeArtifactSelection({
          totalDecisionSummaryCount: 1,
          selectedDecisionSummaryCount: 1,
        }),
      },
      expectedOpening: "Keep Cloud 9 sunset optional today",
      expectedSources: [weatherUnavailableSourceSummary],
      expectedCardIds: [],
      expectedDecisionSummaryIds: [weatherDecisionSummary.id],
      expectedItineraryIds: [],
      assertSignals: (signals) => {
        expect(signals?.intent.conditionActivity).toBe("sunset");
        expect(signals?.intent.weatherSensitive).toBe(true);
      },
    },
    {
      name: "Malinao swim decision summary",
      prompt: "Is Malinao a good beach for swimming with kids today?",
      agentResult: {
        message:
          "Use Malinao as a cautious kids swim stop today, and switch plans if the water looks rough.",
        toolCalls: [
          toolCall({
            name: "get_condition_judgment",
            status: "success",
            sources: [weatherSourceSummary, conditionMarineSourceSummary],
          }),
        ],
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
        publicSources: [weatherSourceSummary, conditionMarineSourceSummary],
        decisionSummaries: [swimmingDecisionSummary],
        artifactSelection: routeArtifactSelection({
          totalDecisionSummaryCount: 2,
          selectedDecisionSummaryCount: 1,
          unselectedDecisionSummaryCount: 1,
        }),
      },
      expectedOpening: "Use Malinao as a cautious kids swim stop today",
      expectedSources: [weatherSourceSummary, conditionMarineSourceSummary],
      expectedCardIds: [],
      expectedDecisionSummaryIds: [swimmingDecisionSummary.id],
      expectedItineraryIds: [],
      assertSignals: (signals) => {
        expect(signals?.intent.conditionActivity).toBe("swimming");
        expect(signals?.intent.marineCondition).toBe(true);
        expect(signals?.intent.activityPlan).toBe(false);
      },
    },
    {
      name: "itinerary review decision summary",
      prompt:
        "Can you critique my itinerary: Cloud 9 sunset, Pacifico dinner, then an 8 AM Dapa ferry?",
      agentResult: {
        message:
          "Keep Cloud 9 sunset, but move dinner closer to General Luna or Dapa before the 8 AM ferry.",
        toolCalls: [
          toolCall({
            name: "plan_local_itinerary",
            status: "success",
            sources: [localGuideSourceSummary],
          }),
        ],
        sources: [localGuideSourceSummary],
        publicSources: [localGuideSourceSummary],
        decisionSummaries: [reviewDecisionSummary],
        artifactSelection: routeArtifactSelection({
          totalItineraryCount: 1,
          selectedItineraryCount: 0,
          unselectedItineraryCount: 1,
          totalDecisionSummaryCount: 1,
          selectedDecisionSummaryCount: 1,
        }),
      },
      expectedOpening: "Keep Cloud 9 sunset",
      expectedSources: [localGuideSourceSummary],
      expectedCardIds: [],
      expectedDecisionSummaryIds: [reviewDecisionSummary.id],
      expectedItineraryIds: [],
      assertSignals: (signals) => {
        expect(signals?.intent.activityPlan).toBe(false);
      },
    },
  ];
}

function routeArtifactSelection(
  overrides: Partial<NonNullable<AgentTurnResult["artifactSelection"]>>,
): NonNullable<AgentTurnResult["artifactSelection"]> {
  return {
    mode: "strict",
    structuredFinalPayload: true,
    totalCardCount: 0,
    totalActionCount: 0,
    totalItineraryCount: 0,
    totalDecisionSummaryCount: 0,
    selectedCardCount: 0,
    selectedActionCount: 0,
    selectedItineraryCount: 0,
    selectedDecisionSummaryCount: 0,
    unselectedCardCount: 0,
    unselectedActionCount: 0,
    unselectedItineraryCount: 0,
    unselectedDecisionSummaryCount: 0,
    unknownCardIds: [],
    unknownActionIds: [],
    unknownItineraryIds: [],
    unknownDecisionSummaryIds: [],
    ...overrides,
  };
}

function assertRouteTravelerProseHasNoInternalMechanics(message: string) {
  const normalizedMessage = message.toLowerCase();
  for (const bannedTerm of [
    " tool",
    "api",
    "artifact",
    "required check",
    "fallback promotion",
    "source caveat",
    "live_checked",
    "not_checked",
    "not checked",
    "not verified",
    "source-profile",
    "source profile",
    "vector-store",
    "vector store",
    "validation",
    "repair",
  ]) {
    expect(normalizedMessage).not.toContain(bannedTerm);
  }
}

type AgentSignals = {
  clientContext: {
    geolocation: {
      status: string;
      source: "browser_geolocation";
      consentScope?: string;
      centerSource?: "browser_geolocation";
    };
  };
  intent: {
    activityPlan?: boolean;
    beach?: boolean;
    browserGeolocation?: {
      exactCoordinatesHidden?: boolean;
      source?: "browser_geolocation";
      useAsProximityAnchor?: boolean;
    };
    conditionActivity?: string;
    locationLabel?: string;
    marineCondition?: boolean;
    nearMeUsesBrowserGeolocation?: boolean;
    nearby?: boolean;
    placeIntent?: { category?: string };
    roadCondition?: boolean;
    tripAdvice?: boolean;
    tripContext?: { activeGoal?: string; currentLocation?: unknown };
    weatherSensitive?: boolean;
    weather?: boolean;
  };
  scope: {
    missingContext?: boolean;
    shouldDeclineNonSiargaoTopic?: boolean;
  };
};

function validGeolocation() {
  return {
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    capturedAt: new Date().toISOString(),
    consentScope: "single_request",
  };
}

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
    auth: null,
    runAskSiargaoAgentTurn: async (request) => {
      requests.push(request);
      return {
        message: result.message ?? "Agent response.",
        requestId: request.requestId ?? "route_request_test",
        upstreamRequestIds: result.upstreamRequestIds ?? ["req_agent_test"],
        model: result.model ?? request.model ?? "gpt-test",
        toolCalls: result.toolCalls ?? [],
        sources: result.sources ?? [],
        publicSources: result.publicSources ?? result.sources ?? [],
        ...(result.memory ? { memory: result.memory } : {}),
        ...(result.cards ? { cards: result.cards } : {}),
        ...(result.actions ? { actions: result.actions } : {}),
        ...(result.itineraries ? { itineraries: result.itineraries } : {}),
        ...(result.decisionSummaries ? { decisionSummaries: result.decisionSummaries } : {}),
        ...(result.artifactSelection ? { artifactSelection: result.artifactSelection } : {}),
      };
    },
    requests,
  };

  return dependencies;
}

async function openChatRouteTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

async function insertUser(db: PGlite, userId: string, email: string) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, now(), now())
    `,
    [userId, email],
  );
}

function deterministicIds() {
  let nextId = 0;
  return (prefix: string) => {
    nextId += 1;
    return `${prefix}_${nextId}`;
  };
}

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string, init: RequestInit = {}) {
  return new Request("https://siargao.test/api/chat", {
    method: "POST",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
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

function truncatedSha256(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function toolCall({
  arguments: args = {},
  errorCode,
  name,
  sources,
  status,
}: {
  arguments?: Record<string, unknown>;
  name: string;
  status: "success" | "error";
  sources: readonly AnswerSourceSummary[];
  errorCode?: string;
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: args,
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

function publicToolCall(toolCall: AgentToolCallAudit): PublicAgentToolCall {
  return {
    id: toolCall.id,
    ...(toolCall.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
    name: toolCall.name,
    status: toolCall.status,
    durationMs: toolCall.durationMs,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    ...(toolCall.errorCode ? { errorCode: toolCall.errorCode } : {}),
    ...(toolCall.providerOperation ? { providerOperation: toolCall.providerOperation } : {}),
    sourceProfileIds: toolCall.sourceProfileIds,
    sources: toolCall.sources,
  };
}

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Generic model reasoning",
  checked: [],
  notChecked: ["live Google Places", "Open-Meteo weather forecast"],
};

const placeRecommendationCard = {
  id: "place_shaka",
  kind: "place" as const,
  title: "Shaka Siargao",
  subtitle: "Cafe - Cloud 9, General Luna - Google rating 4.6 from 900 ratings",
  mapsUrl: "https://maps.google.com/?cid=shaka",
  distanceLabel: "About 50 m from search center.",
  openStatusLabel: "Open now according to Google Places.",
  fitReasons: ["A top Google Places match for the request."],
  caveats: ["Review text and bookings were not checked."],
  sourceLabel: "Google Places - live checked",
  decision: {
    label: "good_now" as const,
    bestAction: "Go now if you want the closest checked cafe option.",
  },
};

const genericRecommendationCard = {
  id: "generic_arrival_tip",
  kind: "place" as const,
  title: "General Luna arrival area",
  fitReasons: ["Useful stable context for first-night planning."],
  caveats: ["No live provider check was run."],
  sourceLabel: "Generic model reasoning - not verified",
  decision: {
    label: "needs_confirmation" as const,
    bestAction: "Confirm the exact stop before adding it to tonight's plan.",
  },
};

const promptAction = {
  id: "places_plan_place_shaka",
  label: "Make this into a short plan",
  prompt: "Make Shaka Siargao into a short Siargao plan.",
};

const memoryMetadata: AgentMemoryMetadata = {
  versionId: "agent-memory:routefixture00000000",
  vectorStoreId: "vs_route_memory",
  files: [
    {
      id: "ask_siargao_agent_skills",
      title: "Ask Siargao Agent Skills",
      fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
      relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
      role: "instruction",
      checksum: "a".repeat(64),
      byteLength: 1234,
    },
  ],
};

const publicMemoryMetadata = {
  versionId: memoryMetadata.versionId,
  files: [
    {
      id: "ask_siargao_agent_skills",
      fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
      role: "instruction",
    },
  ],
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

const swimmingDecisionSummary: DecisionSummary = {
  id: "condition_decision:swimming:cloud_9:today",
  bestAction: "Keep swimming flexible.",
  basis: "Weather is usable, but surf reports are not checked.",
  fallback: "Use a nearby covered stop if conditions worsen.",
  avoid: "Avoid treating this as beach safety clearance.",
  timing: "today",
  area: "Cloud 9",
  sources: [weatherSourceSummary],
};

const conditionMarineSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Condition judgment unchecked marine signals",
  confidence: "medium",
  checked: [],
  notChecked: ["tide", "surf", "swell", "currents", "lifeguard or swimming safety"],
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

const browserLocationPlacesSourceSummary: AnswerSourceSummary = {
  ...placesSourceSummary,
  checked: [...placesSourceSummary.checked, "browser geolocation search center"],
};

const localGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach surface notes", "ride-time notes"],
  notChecked: ["live tide", "lifeguard status"],
};

const rainyCloud9Itinerary: ItineraryPlan = {
  title: "Rainy Cloud 9 Afternoon",
  durationLabel: "3-4 hours",
  decision: {
    label: "fallback",
    bestAction: "Use this if showers make beach time uncomfortable.",
  },
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep the exposed stop short.",
      caveats: ["Weather needs checking."],
    },
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 2,
      area: "Cloud 9",
      travelTimeFromPreviousMinutes: 5,
      mapsUrl: "https://maps.example/cloud9-cafe",
      rationale: "Fallback if rain builds.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Use during active rain.",
      caveats: ["Open status needs Places."],
    },
  ],
  skip: ["Exposed beach hopping"],
  sources: [localGuideSourceSummary],
};

const sunsetDinnerItinerary: ItineraryPlan = {
  title: "Sunset plus Dinner",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Cloud 9 sunset watch",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep sunset close before dinner.",
      caveats: ["Cloud cover needs checking."],
    },
    {
      title: "Dinner in General Luna",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Avoids a late long ride.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [
    {
      title: "Central General Luna dinner",
      kind: "meal",
      sequence: 1,
      area: "General Luna",
      rationale: "Use if sunset weather is poor.",
      caveats: ["Open status needs Places."],
    },
  ],
  skip: ["Far north dinner detours after dark"],
  sources: [localGuideSourceSummary],
};

const sandyBeachItinerary: ItineraryPlan = {
  title: "Sandy Beach Half-Day",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Doot Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna",
      rationale: "Main sandy beach stop within the ride-time constraint.",
      caveats: ["Tide and local safety were not checked."],
    },
    {
      title: "Cafe near General Luna",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 15,
      rationale: "Keeps the half-day compact.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [
    {
      title: "Malinao Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna",
      rationale: "Use if the first sandy stop is crowded.",
      caveats: ["Tide and local safety were not checked."],
    },
  ],
  skip: ["Pacifico under a strict 30-minute General Luna constraint"],
  sources: [localGuideSourceSummary],
};

const foodCrawlItinerary: ItineraryPlan = {
  title: "General Luna Food Crawl",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "First restaurant stop in General Luna",
      kind: "meal",
      sequence: 1,
      area: "General Luna",
      rationale: "Start central.",
      caveats: ["Use Places before naming venues."],
    },
    {
      title: "Dessert or cafe stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Keep the route compact.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [
    {
      title: "One central General Luna venue",
      kind: "meal",
      sequence: 1,
      area: "General Luna",
      rationale: "Use if Places returns too few crawl stops.",
      caveats: ["Do not claim reliability without evidence."],
    },
  ],
  skip: ["Venue names without Places evidence"],
  sources: [genericSourceSummary],
};

const providerUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};
