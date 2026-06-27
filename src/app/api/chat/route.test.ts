import { describe, expect, test } from "bun:test";

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
  ItineraryPlan,
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
    expect(body.toolCalls).toEqual([itineraryToolCall]);
    expect(body.sources).toEqual([localGuideSourceSummary]);
    expect(body.memory).toEqual(publicMemoryMetadata);
    expect(body.itineraries).toEqual([rainyCloud9Itinerary]);
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
      agentMemoryVersionId: memoryMetadata.versionId,
      providerFailure: true,
      sourceLabels: ["provider_unavailable"],
      itineraryCount: 0,
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
    activityPlan?: boolean;
    beach?: boolean;
    placeIntent?: { category?: string };
    tripContext?: { activeGoal?: string };
    weatherSensitive?: boolean;
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
        ...(result.memory ? { memory: result.memory } : {}),
        ...(result.cards ? { cards: result.cards } : {}),
        ...(result.actions ? { actions: result.actions } : {}),
        ...(result.itineraries ? { itineraries: result.itineraries } : {}),
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

const placeRecommendationCard = {
  id: "place_shaka",
  kind: "place" as const,
  title: "Shaka Siargao",
  subtitle: "Cafe - Cloud 9, General Luna - Google rating 4.6 from 900 ratings",
  mapsUrl: "https://maps.google.com/?cid=shaka",
  distanceLabel: "About 50 m from search center.",
  openStatusLabel: "Open now according to Google Places.",
  fitReasons: ["Returned #1 by Google Places for the request."],
  caveats: ["Review text and bookings were not checked."],
  sourceLabel: "Google Places - live checked",
};

const genericRecommendationCard = {
  id: "generic_arrival_tip",
  kind: "place" as const,
  title: "General Luna arrival area",
  fitReasons: ["Useful stable context for first-night planning."],
  caveats: ["No live provider check was run."],
  sourceLabel: "Generic model reasoning - not verified",
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

const rainyCloud9Itinerary: ItineraryPlan = {
  title: "Rainy Cloud 9 Afternoon",
  durationLabel: "3-4 hours",
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
