import { describe, expect, test } from "bun:test";

import {
  type AgentResponsesClient,
  type AgentToolExecutor,
  type AgentToolResult,
  aggregateAgentSourceSummaries,
  createAgentToolCallAudit,
  createAgentTurnResult,
  type ItineraryPlan,
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

  test("merges and de-duplicates cards and actions from tool results", () => {
    const turn = createAgentTurnResult({
      message: "Use Doot first, then check a cafe near Cloud 9.",
      requestId: "agent_request_artifacts",
      model: "gpt-test",
      toolResults: [
        {
          sources: [localGuideSourceSummary],
          cards: [dootBeachCard],
          actions: [weatherAction],
        },
        {
          sources: [
            { ...localGuideSourceSummary, sourceName: " Ask Siargao curated local beach guide " },
          ],
          cards: [{ ...dootBeachCard, title: "Duplicate Doot Beach" }],
          actions: [{ ...weatherAction, label: "Duplicate weather action" }],
        },
        {
          sources: [placesSourceSummary],
          cards: [cloud9CafeCard],
          actions: [planAction],
        },
      ],
    });

    expect(turn.sources).toEqual([localGuideSourceSummary, placesSourceSummary]);
    expect(turn.cards?.map((card) => card.title)).toEqual(["Doot Beach", "Cloud 9 Cafe"]);
    expect(turn.actions?.map((action) => action.label)).toEqual([
      "Check weather",
      "Make a short plan",
    ]);
  });

  test("merges and de-duplicates itinerary artifacts from tool results", () => {
    const turn = createAgentTurnResult({
      message: "Here is a short rainy-day sequence.",
      requestId: "agent_request_itinerary_artifacts",
      model: "gpt-test",
      toolResults: [
        {
          sources: [localGuideSourceSummary],
          itineraries: [rainyCloud9Plan],
        },
        {
          sources: [weatherSourceSummary],
          itineraries: [
            {
              ...rainyCloud9Plan,
              title: " Rainy Cloud 9 Afternoon ",
              stops: [
                {
                  title: "Duplicate first stop",
                  kind: "activity",
                  sequence: 1,
                  rationale: "This duplicate should be ignored.",
                  caveats: [],
                },
              ],
            },
            sunsetDinnerPlan,
          ],
        },
      ],
    });

    expect(turn.sources).toEqual([localGuideSourceSummary, weatherSourceSummary]);
    expect(turn.itineraries?.map((plan) => plan.title)).toEqual([
      "Rainy Cloud 9 Afternoon",
      "Sunset plus Dinner",
    ]);
    expect(turn.itineraries?.[0]?.stops[0]?.title).toBe("Cloud 9 boardwalk");
    expect(turn.itineraries?.[0]?.fallbackStops[0]?.title).toBe("Covered cafe near Cloud 9");
    expect(turn.itineraries?.[0]?.skip).toContain("Exposed beach hopping if heavy rain starts");
  });

  test("keeps existing card, action, and source aggregation when itineraries are present", () => {
    const turn = createAgentTurnResult({
      message: "Use Doot, then a backup cafe if rain builds.",
      requestId: "agent_request_mixed_artifacts",
      model: "gpt-test",
      cards: [dootBeachCard],
      actions: [weatherAction],
      toolResults: [
        {
          sources: [localGuideSourceSummary],
          cards: [{ ...dootBeachCard, title: "Duplicate Doot Beach" }],
          actions: [{ ...weatherAction, label: "Duplicate weather action" }],
          itineraries: [rainyCloud9Plan],
        },
        {
          sources: [placesSourceSummary],
          cards: [cloud9CafeCard],
          actions: [planAction],
        },
      ],
    });

    expect(turn.sources).toEqual([localGuideSourceSummary, placesSourceSummary]);
    expect(turn.cards?.map((card) => card.title)).toEqual(["Doot Beach", "Cloud 9 Cafe"]);
    expect(turn.actions?.map((action) => action.label)).toEqual([
      "Check weather",
      "Make a short plan",
    ]);
    expect(turn.itineraries?.map((plan) => plan.durationLabel)).toEqual(["2-3 hours"]);
  });

  test("does not clear itinerary Places caveats until every required Places check succeeds", () => {
    const restaurantSearch = {
      query: "restaurants General Luna Siargao",
      center: { latitude: 9.784, longitude: 126.158 },
      radius_meters: 4000,
      constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
    };
    const cafeSearch = {
      query: "cafes or dessert near General Luna Siargao",
      center: { latitude: 9.784, longitude: 126.158 },
      radius_meters: 4000,
      constraints: { included_type: "cafe", open_now: true, page_size: 5 },
    };
    const restaurantCall = createAgentToolCallAudit({
      auditId: "audit_restaurant_places",
      name: "search_places",
      arguments: restaurantSearch,
      result: {
        name: "search_places",
        status: "success",
        text: "Restaurants loaded.",
        sources: [placesSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.000Z"),
      completedAt: new Date("2026-06-26T00:00:00.010Z"),
    });
    const failedCafeCall = createAgentToolCallAudit({
      auditId: "audit_cafe_places",
      name: "search_places",
      arguments: cafeSearch,
      result: {
        name: "search_places",
        status: "error",
        text: "Cafe search failed.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.020Z"),
      completedAt: new Date("2026-06-26T00:00:00.030Z"),
    });

    const turn = createAgentTurnResult({
      message: "Use the restaurant results, but cafe status failed.",
      requestId: "agent_request_partial_places",
      model: "gpt-test",
      toolCalls: [restaurantCall, failedCafeCall],
      toolResults: [
        {
          sources: [genericSourceSummary],
          itineraries: [{ ...foodCrawlPlan, sources: [genericSourceSummary] }],
          data: {
            requiredToolChecks: {
              places: [
                { required: true, tool: "search_places", ...restaurantSearch },
                { required: true, tool: "search_places", ...cafeSearch },
              ],
            },
          },
        },
        {
          sources: [placesSourceSummary],
        },
        {
          sources: [providerUnavailableSourceSummary],
        },
      ],
    });

    expect(turn.sources).toEqual([
      genericSourceSummary,
      placesSourceSummary,
      providerUnavailableSourceSummary,
    ]);
    expect(turn.itineraries?.[0]?.sources.flatMap((source) => source.notChecked)).toContain(
      "live open-now status",
    );
    expect(turn.itineraries?.[0]?.sources).toContainEqual(placesSourceSummary);
    expect(turn.itineraries?.[0]?.sources).toContainEqual(providerUnavailableSourceSummary);
  });

  test("does not clear open-status caveats when Places lacks open-now evidence", () => {
    const identityAndOpenStatusCaveatSource: AnswerSourceSummary = {
      ...genericSourceSummary,
      notChecked: ["live open-now status", "Google Places lookup"],
    };
    const cafeSearch = {
      query: "cafes near Cloud 9 Siargao",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radius_meters: 2500,
      constraints: { included_type: "cafe", open_now: true, page_size: 5 },
    };
    const identityOnlyPlacesCall = createAgentToolCallAudit({
      auditId: "audit_identity_only_places",
      name: "search_places",
      arguments: cafeSearch,
      result: {
        name: "search_places",
        status: "success",
        text: "Cafes loaded without opening-hours fields.",
        sources: [identityOnlyPlacesSourceSummary],
      },
      startedAt: new Date("2026-06-26T00:00:00.000Z"),
      completedAt: new Date("2026-06-26T00:00:00.010Z"),
    });

    const turn = createAgentTurnResult({
      message: "Use the cafe identities, but do not claim open-now status.",
      requestId: "agent_request_identity_only_places",
      model: "gpt-test",
      toolCalls: [identityOnlyPlacesCall],
      toolResults: [
        {
          sources: [identityAndOpenStatusCaveatSource],
          itineraries: [{ ...rainyCloud9Plan, sources: [identityAndOpenStatusCaveatSource] }],
          data: {
            requiredToolChecks: {
              places: [{ required: true, tool: "search_places", ...cafeSearch }],
            },
          },
        },
        {
          sources: [identityOnlyPlacesSourceSummary],
        },
      ],
    });

    const notChecked = turn.itineraries?.[0]?.sources.flatMap((source) => source.notChecked) ?? [];
    expect(notChecked).toContain("live open-now status");
    expect(notChecked).not.toContain("Google Places lookup");
    expect(turn.itineraries?.[0]?.sources).toContainEqual(identityOnlyPlacesSourceSummary);
  });

  test("omits empty card and action arrays from turn results", () => {
    const turn = createAgentTurnResult({
      message: "No structured artifacts needed.",
      requestId: "agent_request_no_artifacts",
      model: "gpt-test",
      toolResults: [
        {
          sources: [providerUnavailableSourceSummary],
          cards: [],
          actions: [],
          itineraries: [],
        },
      ],
    });

    expect(turn.sources).toEqual([providerUnavailableSourceSummary]);
    expect("cards" in turn).toBe(false);
    expect("actions" in turn).toBe(false);
    expect("itineraries" in turn).toBe(false);
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

const identityOnlyPlacesSourceSummary: AnswerSourceSummary = {
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

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Itinerary planner unchecked live signals",
  confidence: "medium",
  checked: [],
  notChecked: ["live open-now status", "weather forecast"],
};

const dootBeachCard = {
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

const cloud9CafeCard = {
  id: "card_cloud9_cafe",
  kind: "place" as const,
  title: "Cloud 9 Cafe",
  subtitle: "Cafe near Cloud 9",
  mapsUrl: "https://maps.example/cloud9-cafe",
  distanceLabel: "About 500 m from Cloud 9",
  openStatusLabel: "Open status checked",
  fitReasons: ["Close to the surf tower"],
  caveats: ["Bookings and review text were not checked"],
  sourceLabel: "Google Places - live checked",
};

const weatherAction = {
  id: "ask_weather",
  label: "Check weather",
  prompt: "Check the weather before I go.",
};

const planAction = {
  id: "make_plan",
  label: "Make a short plan",
  prompt: "Make this into a short plan.",
};

const rainyCloud9Plan: ItineraryPlan = {
  title: "Rainy Cloud 9 Afternoon",
  durationLabel: "2-3 hours",
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Short, easy first stop with nearby cover if showers build.",
      caveats: ["Use weather evidence before committing to exposed time outside."],
    },
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 2,
      area: "Cloud 9",
      travelTimeFromPreviousMinutes: 5,
      mapsUrl: "https://maps.example/cloud9-cafe",
      rationale: "Keeps the plan close and gives a rain fallback.",
      caveats: ["Opening hours need a live Places check."],
    },
  ],
  fallbackStops: [
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Use this if rain makes the boardwalk uncomfortable.",
      caveats: ["Live open status not checked in this artifact."],
    },
  ],
  skip: ["Exposed beach hopping if heavy rain starts"],
  sources: [localGuideSourceSummary, weatherSourceSummary],
};

const sunsetDinnerPlan: ItineraryPlan = {
  title: "Sunset plus Dinner",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "General Luna sunset stop",
      kind: "activity",
      sequence: 1,
      area: "General Luna",
      rationale: "Keeps the route compact before dinner.",
      caveats: ["Sunset view depends on cloud cover."],
    },
    {
      title: "Dinner near General Luna",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Avoids a late long ride after sunset.",
      caveats: ["Use Places for live open status."],
    },
  ],
  fallbackStops: [],
  skip: ["Far north dinner detours after dark"],
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
      title: "Dessert stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Keep the route compact.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [],
  skip: ["Venue names without Places evidence"],
  sources: [genericSourceSummary],
};
