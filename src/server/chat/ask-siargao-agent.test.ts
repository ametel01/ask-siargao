import { describe, expect, test } from "bun:test";

import type { Logger } from "pino";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentResponsesClient,
  AgentResponsesCreateResult,
  AgentToolExecutor,
  AgentToolResult,
  ItineraryPlan,
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
    const firstInput = parseFirstInput(client.requests[0]?.input);
    expect(firstInput.agentMemory?.versionId).toBe(result.memory?.versionId);
    expect(firstInput.agentMemory?.files?.[0]).toEqual({
      id: "ask_siargao_agent_skills",
      role: "instruction",
    });
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("checksum");
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("byteLength");
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("relativePath");
    expect(firstInput.conversation?.[0]?.content).toContain("first afternoon");
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
    const firstInput = parseFirstInput(client.requests[0]?.input);
    expect(firstInput.agentMemory?.vectorStoreId).toBeUndefined();
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("vs_memory");
  });

  test("binds the resolved memory snapshot into backend memory tool calls", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_memory_call",
        requestId: "req_memory_call",
        callId: "call_memory",
        name: "search_agent_memory",
        arguments: { query: "resolved snapshot needle", max_results: 1 },
      }),
      {
        id: "resp_memory_final",
        output_text: "Used the resolved memory snapshot.",
        _request_id: "req_memory_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What does the source policy say?" }],
        requestId: "agent_request_bound_memory",
      },
      {
        client,
        loadMemorySnapshot: () =>
          memorySnapshotFixture({
            sourcePolicyContent: "Resolved snapshot needle only exists in this loaded snapshot.",
          }),
        model: "gpt-test",
      },
    );

    expect(result.memory?.versionId).toBe("agent-memory:testmemory000000000000");
    expect(parseToolOutput(client.requests[1]?.input, 0).text).toContain(
      "Resolved snapshot needle",
    );
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

  test("executes an itinerary planning tool call and attaches itinerary artifacts", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_itinerary_call",
        requestId: "req_itinerary_call",
        callId: "call_itinerary",
        name: "plan_local_itinerary",
        arguments: {
          theme: "rainy_cloud_9_afternoon",
          origin: "Cloud 9",
          duration_hours: 3,
          needs_weather_check: true,
        },
      }),
      {
        id: "resp_itinerary_final",
        output_text: "Keep Cloud 9 short, then use the covered cafe fallback if rain builds.",
        _request_id: "req_itinerary_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared.",
        data: { plan: rainyCloud9Plan },
        sources: [localGuideSourceSummary],
        itineraries: [rainyCloud9Plan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 afternoon for 3 hours." }],
        requestId: "agent_request_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(String(client.requests[0]?.instructions)).toContain("call plan_local_itinerary first");
    const toolOutput = parseToolOutput(client.requests[1]?.input, 0) as {
      data: { plan: { title: string } };
    };
    expect(toolOutput.data.plan.title).toBe("Rainy Cloud 9 Afternoon");
    expect(result.message).toContain("covered cafe");
    expect(result.toolCalls[0]).toMatchObject({
      name: "plan_local_itinerary",
      providerOperation: "local_itinerary.plan",
    });
    expect(result.itineraries).toEqual([rainyCloud9Plan]);
    expect(result.sources).toEqual([localGuideSourceSummary]);
  });

  test("rainy Cloud 9 itineraries call planning and weather before final prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_rainy_plan",
        requestId: "req_rainy_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "rainy_cloud_9_afternoon", needs_weather_check: true },
      }),
      responseWithToolCall({
        id: "resp_rainy_weather",
        requestId: "req_rainy_weather",
        callId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Cloud 9", date_range: "today" },
      }),
      {
        id: "resp_rainy_final",
        output_text: "Weather was checked; keep the covered fallback and avoid exposed beach hops.",
        _request_id: "req_rainy_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required weather check: Cloud 9.",
        sources: [localGuideSourceSummary],
        itineraries: [rainyCloud9Plan],
      },
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded for Cloud 9.",
        sources: [weatherSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Rainy Cloud 9 afternoon plan?" }],
        requestId: "agent_request_rainy_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_weather_forecast",
    ]);
    expect(result.sources).toEqual([localGuideSourceSummary, weatherSourceSummary]);
    expect(result.message).toContain("Weather was checked");
  });

  test("sunset plus dinner itineraries call planning and Places before final prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_dinner_plan",
        requestId: "req_dinner_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "sunset_plus_dinner", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_dinner_places",
        requestId: "req_dinner_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "dinner restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_dinner_final",
        output_text: "Use the sunset stop, then choose the live-checked dinner venue.",
        _request_id: "req_dinner_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required Places check: dinner.",
        sources: [localGuideSourceSummary],
        itineraries: [sunsetDinnerPlan],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned open dinner options.",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sunset plus dinner plan for tonight." }],
        requestId: "agent_request_dinner_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "search_places",
    ]);
    expect(result.sources).toEqual([localGuideSourceSummary, placesSourceSummary]);
    expect(result.itineraries?.[0]).toMatchObject({
      title: sunsetDinnerPlan.title,
      durationLabel: sunsetDinnerPlan.durationLabel,
      stops: sunsetDinnerPlan.stops,
    });
    expect(result.itineraries?.[0]?.sources).toContainEqual(localGuideSourceSummary);
    expect(result.itineraries?.[0]?.sources).toContainEqual(placesSourceSummary);
  });

  test("sandy beach half-day itineraries avoid surf-only brainstorms", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_sandy_plan",
        requestId: "req_sandy_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: {
          theme: "sandy_beach_half_day",
          origin: "General Luna",
          duration_hours: 3,
          max_ride_minutes: 30,
          avoid: ["surf-only stops"],
        },
      }),
      {
        id: "resp_sandy_final",
        output_text: "Use the sandy beach sequence and skip surf-only stops.",
        _request_id: "req_sandy_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured sandy beach itinerary artifact prepared.",
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          { role: "user", content: "Plan a non-surfer sandy beach half-day from General Luna." },
        ],
        requestId: "agent_request_sandy_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual(["plan_local_itinerary"]);
    expect(result.itineraries).toEqual([sandyBeachPlan]);
    expect(result.itineraries?.[0]?.stops.map((stop) => stop.title).join(" ")).not.toMatch(
      /surf lesson/i,
    );
    expect(result.itineraries?.[0]?.skip).toEqual(
      expect.arrayContaining(["Surf-only Cloud 9 sessions"]),
    );
    expect(result.message).toContain("skip surf-only stops");
  });

  test("food crawl itineraries call Places for live food options", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_food_plan",
        requestId: "req_food_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "food_crawl", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_food_places",
        requestId: "req_food_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_food_final",
        output_text: "Use the live food options as the crawl stops.",
        _request_id: "req_food_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured food crawl artifact prepared. Required Places check: restaurants.",
        sources: [genericSourceSummary],
        itineraries: [foodCrawlPlan],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned food options.",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Make a food crawl for 3 hours." }],
        requestId: "agent_request_food_crawl",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "search_places",
    ]);
    expect(result.sources).toEqual([genericSourceSummary, placesSourceSummary]);
  });

  test("Places failures in itinerary flows remain caveated instead of live checked", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_plan",
        requestId: "req_failed_places_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "sunset_plus_dinner", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_failed_places",
        requestId: "req_failed_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "dinner restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text: "Places was unavailable, so dinner open status is not live checked.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required Places check: dinner.",
        sources: [localGuideSourceSummary],
        itineraries: [sunsetDinnerPlan],
      },
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places search failed.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sunset plus dinner plan for tonight." }],
        requestId: "agent_request_places_failure_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls[1]).toMatchObject({
      name: "search_places",
      status: "error",
      errorCode: "provider_unavailable",
    });
    expect(result.sources).toEqual([localGuideSourceSummary, providerUnavailableSourceSummary]);
    expect(result.message).toContain("not live checked");
  });

  test("attaches tool-generated cards and actions to the final model-written answer", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_artifact_call",
        requestId: "req_artifact_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: {
          query: "sandy swimming beaches within 30 minutes",
          filters: { beach_surface: "sand", swimming: true, max_ride_minutes: 30 },
        },
      }),
      {
        id: "resp_artifact_final",
        output_text: "The model wrote this final answer after reading the tool output.",
        _request_id: "req_artifact_final",
      },
    ]);
    const card = {
      id: "card_doot",
      kind: "beach" as const,
      title: "Doot Beach",
      subtitle: "General Luna-side sandy beach",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Doot%20Beach%20Siargao",
      distanceLabel: "About 20 minutes by tricycle from General Luna",
      fitReasons: ["Sandy shore", "Works for a quieter beach stop"],
      caveats: ["Check tide and road conditions before leaving"],
      sourceLabel: "Ask Siargao curated local beach guide",
    };
    const action = {
      id: "ask_weather",
      label: "Check weather",
      prompt: "Check weather before going to Doot Beach.",
    };
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach.",
        data: { restrictedProviderPayload: "SECRET_CARD_PAYLOAD" },
        sources: [localGuideSourceSummary],
        cards: [card],
        actions: [action],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_artifacts",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toBe("The model wrote this final answer after reading the tool output.");
    expect(result.cards).toEqual([card]);
    expect(result.actions).toEqual([action]);
    expect(result.sources).toEqual([localGuideSourceSummary]);
    expect(JSON.stringify(result.toolCalls)).not.toContain("SECRET_CARD_PAYLOAD");
    expect(parseToolOutput(client.requests[1]?.input, 0).cards).toBeUndefined();
    expect(parseToolOutput(client.requests[1]?.input, 0).actions).toBeUndefined();
  });

  test("auto-executes required itinerary checks before accepting final prose", async () => {
    const uncheckedItinerarySource: AnswerSourceSummary = {
      label: "not_verified",
      sourceName: "Itinerary planner unchecked live signals",
      confidence: "medium",
      checked: [],
      notChecked: ["weather forecast", "live open-now status", "surf"],
    };
    const planNeedingChecks: ItineraryPlan = {
      ...rainyCloud9Plan,
      sources: [uncheckedItinerarySource],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_required_plan",
        requestId: "req_required_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "rainy_cloud_9_afternoon", needs_weather_check: true },
      }),
      {
        id: "resp_premature_final",
        output_text: "Premature final answer without required checks.",
        _request_id: "req_premature_final",
      },
      {
        id: "resp_checked_final",
        output_text: "Weather and Places were checked; keep surf caveats.",
        _request_id: "req_checked_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required weather and Places checks remain.",
        data: {
          plan: planNeedingChecks,
          requiredToolChecks: {
            weather: {
              required: true,
              tool: "get_weather_forecast",
              location: "Cloud 9",
              date_range: "today",
              reason: "Rain-sensitive Cloud 9 plan.",
            },
            places: [
              {
                required: true,
                tool: "search_places",
                query: "covered cafe Cloud 9 Siargao",
                center: { latitude: 9.8116, longitude: 126.1651 },
                radius_meters: 2500,
                constraints: { included_type: "cafe", open_now: true, page_size: 5 },
                reason: "Cafe fallback needs live identity and open status.",
              },
            ],
          },
        },
        sources: [uncheckedItinerarySource],
        itineraries: [planNeedingChecks],
      },
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded for Cloud 9.",
        sources: [weatherSourceSummary],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned live cafe options.",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 cafe afternoon." }],
        requestId: "agent_request_required_itinerary_checks",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Weather and Places were checked");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_weather_forecast",
      "search_places",
    ]);
    expect(client.requests).toHaveLength(3);
    const automaticInput = parseAutomaticRequiredCheckInput(client.requests[2]?.input);
    expect(automaticInput.automaticRequiredToolChecks?.map((check) => check.name)).toEqual([
      "get_weather_forecast",
      "search_places",
    ]);
    expect(result.itineraries?.[0]?.sources).toContainEqual(weatherSourceSummary);
    expect(result.itineraries?.[0]?.sources).toContainEqual(placesSourceSummary);
    expect(result.itineraries?.[0]?.sources.flatMap((source) => source.notChecked)).not.toContain(
      "weather forecast",
    );
    expect(result.itineraries?.[0]?.sources.flatMap((source) => source.notChecked)).not.toContain(
      "live open-now status",
    );
    expect(result.itineraries?.[0]?.sources.flatMap((source) => source.notChecked)).toContain(
      "surf",
    );
  });

  test("executes safe local data tools through the tool loop", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_schema_call",
        requestId: "req_schema_call",
        callId: "call_schema",
        name: "describe_database_schema",
        arguments: {},
      }),
      responseWithToolCall({
        id: "resp_facts_call",
        requestId: "req_facts_call",
        callId: "call_facts",
        name: "query_local_facts",
        arguments: { entityTypes: ["beach"], tags: ["sandy"], limit: 2 },
      }),
      responseWithToolCall({
        id: "resp_evidence_call",
        requestId: "req_evidence_call",
        callId: "call_evidence",
        name: "get_source_evidence",
        arguments: { factIds: ["curated_local_guide:beach:doot-beach"] },
      }),
      {
        id: "resp_local_data_final",
        output_text: "Doot Beach is a curated local fact; tide and safety were not checked.",
        _request_id: "req_local_data_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      describe_database_schema: {
        name: "describe_database_schema",
        status: "success",
        text: "Safe schema dictionary loaded.",
        sources: [],
      },
      query_local_facts: {
        name: "query_local_facts",
        status: "success",
        text: "Safe local facts returned Doot Beach.",
        sources: [localGuideSourceSummary],
      },
      get_source_evidence: {
        name: "get_source_evidence",
        status: "success",
        text: "Display-safe evidence returned for Doot Beach.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Which sandy beach has source evidence?" }],
        requestId: "agent_request_local_data",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Doot Beach");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "describe_database_schema",
      "query_local_facts",
      "get_source_evidence",
    ]);
    expect(result.toolCalls.map((toolCall) => toolCall.providerOperation)).toEqual([
      "local_data.schema",
      "local_data.query",
      "local_data.evidence",
    ]);
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
  agentMemory?: {
    versionId?: string;
    vectorStoreId?: string;
    files?: Array<Record<string, unknown>>;
  };
} {
  return typeof input === "string" ? JSON.parse(input) : {};
}

function parseAutomaticRequiredCheckInput(input: unknown): {
  automaticRequiredToolChecks?: Array<{ name?: string }>;
} {
  return typeof input === "string" ? JSON.parse(input) : {};
}

function parseToolOutput(
  input: unknown,
  index: number,
): {
  text?: string;
  errorCode?: string;
} & Record<string, unknown> {
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
  sourcePolicyContent = "Never create source labels from memory retrieval alone.",
}: {
  instructionContent?: string;
  sourcePolicyContent?: string;
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
        byteLength: sourcePolicyContent.length,
        content: sourcePolicyContent,
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
        byteLength: sourcePolicyContent.length,
        content: sourcePolicyContent,
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

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Itinerary planner unchecked live signals",
  confidence: "medium",
  checked: [],
  notChecked: ["live open-now status", "weather forecast"],
};

const rainyCloud9Plan: ItineraryPlan = {
  title: "Rainy Cloud 9 Afternoon",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep the exposed stop short.",
      caveats: ["Weather still needs a forecast check."],
    },
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 2,
      area: "Cloud 9",
      travelTimeFromPreviousMinutes: 5,
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
      rationale: "Use when rain is active.",
      caveats: ["Open status needs Places."],
    },
  ],
  skip: ["Exposed beach hopping"],
  sources: [localGuideSourceSummary],
};

const sunsetDinnerPlan: ItineraryPlan = {
  title: "Sunset plus Dinner",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Cloud 9 sunset stop",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep sunset close to General Luna.",
      caveats: ["Weather still needs a forecast check."],
    },
    {
      title: "Dinner in General Luna",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Avoid a long ride after sunset.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [],
  skip: ["Far north dinner detours after sunset"],
  sources: [localGuideSourceSummary],
};

const sandyBeachPlan: ItineraryPlan = {
  title: "Sandy Beach Half-Day",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Doot Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna side",
      rationale: "Use the sandy beach option instead of surf-only Cloud 9.",
      caveats: ["Tide and lifeguard status were not checked."],
    },
    {
      title: "General Luna snack stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 15,
      rationale: "Keep the route compact for a half-day.",
      caveats: ["Open status needs Places if a specific venue is selected."],
    },
  ],
  fallbackStops: [
    {
      title: "Malinao Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna side",
      rationale: "Use as a quieter sandy fallback.",
      caveats: ["Tide and swim conditions were not checked."],
    },
  ],
  skip: ["Surf-only Cloud 9 sessions", "Far north beach detours"],
  sources: [localGuideSourceSummary],
};

const foodCrawlPlan: ItineraryPlan = {
  title: "General Luna Food Crawl",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "First food stop",
      kind: "meal",
      sequence: 1,
      area: "General Luna",
      rationale: "Start central.",
      caveats: ["Open status needs Places."],
    },
    {
      title: "Second food stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      rationale: "Keep the crawl compact.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [],
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
