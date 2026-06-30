import { describe, expect, test } from "bun:test";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import {
  agentToolDefinitions,
  buildAgentResponseTools,
  describeAvailableTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
import { conditionJudgmentToolParameters } from "@/server/chat/condition-tools";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { googlePlacesDetailsFieldMask } from "@/server/providers/google-places-enrichment";
import type { OpenMeteoForecastLocation } from "@/server/providers/open-meteo";
import {
  createOpenMeteoMarineIngestionBatch,
  type OpenMeteoMarineIngestionBatch,
} from "@/server/providers/open-meteo-marine";
import type { TideForecastSnapshot } from "@/server/providers/tide-forecast";
import {
  fallbackWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

describe("agent tools", () => {
  test("defines strict Responses function tools", () => {
    expect(agentToolDefinitions).toEqual([
      {
        type: "function",
        name: "get_weather_forecast",
        description:
          "Get the governed Open-Meteo weather forecast snapshot for a known Siargao location.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              enum: ["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"],
              description: "Known Siargao forecast location label.",
            },
            date_range: {
              type: "string",
              enum: ["today", "next_7_days"],
              description: "Forecast range to summarize.",
            },
          },
          required: ["location", "date_range"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "get_marine_conditions",
        description:
          "Get governed Open-Meteo Marine model data for Siargao tide-proxy sea level, waves, swell, and ocean current. This is not official tide-table, navigation, or safety authority data.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              enum: ["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"],
              description: "Known Siargao marine forecast location label.",
            },
            date_range: {
              type: "string",
              enum: ["today", "next_48_hours"],
              description: "Marine model range to summarize.",
            },
          },
          required: ["location", "date_range"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "get_tide_forecast",
        description:
          "Get Tide-Forecast Dapa predicted tide table data and embedded sea-condition periods for Siargao surf/tide timing during development/testing. This is not an official tide gauge, navigation aid, or safety clearance.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              enum: ["Siargao Island", "Cloud 9", "General Luna", "Dapa"],
              description: "Known Siargao tide forecast location label.",
            },
            date_range: {
              type: "string",
              enum: ["today", "tomorrow", "next_7_days"],
              description: "Tide forecast range to summarize.",
            },
          },
          required: ["location", "date_range"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "get_condition_judgment",
        description:
          "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, checked Tide-Forecast tide/sea-period data when available, checked Open-Meteo Marine model data when available, curated local caveats, and explicit unchecked road, official-warning, lifeguard, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
        parameters: conditionJudgmentToolParameters,
        strict: true,
      },
      {
        type: "function",
        name: "search_nightlife_events",
        description:
          "Search approved General Luna nightlife event facts before using Google Places for venue details. Use for tonight, party, nightlife, bar-hopping, DJ, live-music, foam-party, pub-quiz, trivia, and drinks-tonight route answers. This returns event schedule evidence, source profile IDs, freshness/expiry metadata, refresh decisions, and route roles, not live crowd size, door policy, guest list, table availability, last-minute cancellation, or exact closing time.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              enum: ["General Luna"],
              description: "Nightlife area currently supported by approved event facts.",
            },
            date: {
              type: "string",
              enum: ["tonight", "today"],
              description: "Time-bound nightlife date to check.",
            },
            interests: {
              type: ["array", "null"],
              items: {
                type: "string",
                enum: [
                  "party",
                  "bar_hopping",
                  "dj",
                  "live_music",
                  "foam_party",
                  "pub_quiz",
                  "trivia",
                  "drinks",
                ],
              },
              description:
                "Optional nightlife interests from the user, such as party, dj, pub_quiz, trivia, foam_party, or drinks.",
            },
          },
          required: ["location", "date", "interests"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "search_places",
        description:
          "Search governed Google Places results for Siargao places using allowed chat-search fields.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language place search query scoped to Siargao.",
            },
            center: {
              type: "object",
              properties: {
                latitude: { type: "number" },
                longitude: { type: "number" },
              },
              required: ["latitude", "longitude"],
              additionalProperties: false,
            },
            radius_meters: {
              type: "integer",
              minimum: 500,
              maximum: 20000,
              description: "Search radius around the center point.",
            },
            constraints: {
              type: ["object", "null"],
              properties: {
                included_type: {
                  type: ["string", "null"],
                  description: "Optional Google Places primary type such as restaurant or cafe.",
                },
                open_now: {
                  type: ["boolean", "null"],
                  description: "Whether live opening status is needed.",
                },
                page_size: {
                  type: ["integer", "null"],
                  minimum: 1,
                  maximum: 10,
                  description: "Maximum number of places to return.",
                },
              },
              required: ["included_type", "open_now", "page_size"],
              additionalProperties: false,
            },
          },
          required: ["query", "center", "radius_meters", "constraints"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "get_place_details",
        description:
          "Get governed Google Places identity details for one place ID using cache-first lookup and the allowed details field mask.",
        parameters: {
          type: "object",
          properties: {
            place_id: {
              type: "string",
              description: "Google Places place ID.",
            },
          },
          required: ["place_id"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "search_local_guide",
        description:
          "Search Ask Siargao curated local guide facts for beaches and local trip-planning fit.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language local guide query.",
            },
            filters: {
              type: ["object", "null"],
              properties: {
                beach_surface: {
                  type: ["string", "null"],
                  enum: ["sand", "mixed", "rocky", "any", null],
                  description: "Preferred beach surface.",
                },
                origin_area: {
                  type: ["string", "null"],
                  description:
                    "Named Siargao area to prioritize before broader island options, such as Cloud 9, General Luna, Malinao, Pacifico, or Alegria.",
                },
                swimming: {
                  type: ["boolean", "null"],
                  description: "Whether swimming fit should be prioritized.",
                },
                sunset: {
                  type: ["boolean", "null"],
                  description: "Whether sunset or late-afternoon fit should be prioritized.",
                },
                rain_fit: {
                  type: ["boolean", "null"],
                  description: "Whether bad-weather or short-ride fit should be prioritized.",
                },
                max_ride_minutes: {
                  type: ["integer", "null"],
                  minimum: 1,
                  maximum: 180,
                  description: "Maximum ride time from the General Luna side.",
                },
                transport_mode: {
                  type: ["string", "null"],
                  enum: ["walk", "scooter", "tricycle", "van", null],
                  description: "Traveler transport constraint.",
                },
                with_kids: {
                  type: ["boolean", "null"],
                  description: "Whether the traveler is with kids.",
                },
              },
              required: [
                "beach_surface",
                "origin_area",
                "swimming",
                "sunset",
                "rain_fit",
                "max_ride_minutes",
                "transport_mode",
                "with_kids",
              ],
              additionalProperties: false,
            },
          },
          required: ["query", "filters"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "rank_surf_spots_nearby",
        description:
          "Rank known Siargao surf spots by straight-line distance from the user's consented browser geolocation. Use for closest/nearest/near-me surf spot requests. The tool returns distances and spot metadata only; it does not expose the user's coordinates or live surf conditions.",
        parameters: {
          type: "object",
          properties: {
            skill_level: {
              type: ["string", "null"],
              enum: ["beginner", "intermediate", "advanced", "any", null],
              description: "Optional skill filter for the surf spots to rank.",
            },
            max_results: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 10,
              description: "Maximum number of ranked surf spots to return.",
            },
            include_boat_access: {
              type: ["boolean", "null"],
              description: "Whether boat-access surf spots may be included.",
            },
          },
          required: ["skill_level", "max_results", "include_boat_access"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "plan_local_itinerary",
        description:
          "Build a governed structured 2-4 hour Siargao itinerary artifact from curated local guide evidence and explicit unchecked caveats. The AI must use the returned plan as evidence and write the final answer itself.",
        parameters: {
          type: "object",
          properties: {
            theme: {
              type: "string",
              enum: [
                "rainy_cloud_9_afternoon",
                "sunset_plus_dinner",
                "sandy_beach_half_day",
                "non_surfer_half_day",
                "food_crawl",
              ],
              description: "Initial supported local itinerary theme.",
            },
            origin: {
              type: ["string", "null"],
              description:
                "Traveler origin or assumed start area, such as General Luna or Cloud 9.",
            },
            duration_hours: {
              type: ["number", "null"],
              minimum: 2,
              maximum: 4,
              description: "Target plan length in hours.",
            },
            transport_mode: {
              type: ["string", "null"],
              enum: ["walk", "scooter", "tricycle", "van", null],
              description: "Traveler transport mode or constraint.",
            },
            max_ride_minutes: {
              type: ["integer", "null"],
              minimum: 5,
              maximum: 180,
              description: "Maximum estimated ride time for any itinerary leg.",
            },
            needs_weather_check: {
              type: ["boolean", "null"],
              description: "Whether weather materially affects the itinerary.",
            },
            needs_open_now: {
              type: ["boolean", "null"],
              description: "Whether meal, cafe, or venue stops need live open-now checks.",
            },
            meal_preference: {
              type: ["string", "null"],
              description: "Optional meal style, cuisine, or price preference.",
            },
            constraints: {
              type: ["array", "null"],
              items: { type: "string" },
              description: "Other user constraints to preserve as caveats.",
            },
          },
          required: [
            "theme",
            "origin",
            "duration_hours",
            "transport_mode",
            "max_ride_minutes",
            "needs_weather_check",
            "needs_open_now",
            "meal_preference",
            "constraints",
          ],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "describe_database_schema",
        description:
          "Describe the approved safe local data surfaces, fields, query rules, limits, and prohibited database access.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "query_local_facts",
        description:
          "Query approved local Siargao facts with structured filters only; no SQL, private data, or restricted provider bodies.",
        parameters: {
          type: "object",
          properties: {
            entityTypes: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "area",
                  "route",
                  "beach",
                  "service",
                  "place",
                  "accommodation",
                  "operator",
                  "risk",
                  "local_caveat",
                ],
              },
              description: "Approved entity types to retrieve.",
            },
            area: {
              type: ["string", "null"],
              description: "Optional Siargao area filter such as General Luna or Cloud 9.",
            },
            tags: {
              type: ["array", "null"],
              items: { type: "string" },
              description: "Optional tags such as sandy, swimming, rain-fit, sunset, or transport.",
            },
            text: {
              type: ["string", "null"],
              description: "Optional text filter matched against names and claims.",
            },
            limit: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 20,
              description: "Maximum number of local facts to return.",
            },
          },
          required: ["entityTypes", "area", "tags", "text", "limit"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "get_source_evidence",
        description:
          "Return display-safe source evidence, caveats, freshness, and checked boundaries for safe local fact IDs.",
        parameters: {
          type: "object",
          properties: {
            factIds: {
              type: "array",
              items: { type: "string" },
              description: "Fact IDs returned by query_local_facts or compatible safe fact IDs.",
            },
          },
          required: ["factIds"],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        strict: true,
      },
      {
        type: "function",
        name: "load_agent_memory_file",
        description:
          "Load exact Ask Siargao agent-memory reference files by filename after using INDEX.md to choose the smallest relevant set. This is policy/reference context, not live evidence.",
        parameters: {
          type: "object",
          properties: {
            documents: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "SURF.md",
                  "LOCAL_GUIDE_BEACHES.md",
                  "NIGHTLIFE.md",
                  "ASK_SIARGAO_AGENT_SKILLS.md",
                  "ASK_SIARGAO_ANSWER_PATTERNS.md",
                  "ASK_SIARGAO_TOOL_USE_POLICY.md",
                  "ASK_SIARGAO_DATA_DICTIONARY.md",
                  "ASK_SIARGAO_SOURCE_POLICY.md",
                  "ASK_SIARGAO_LOCAL_ASSUMPTIONS.md",
                ],
              },
              minItems: 1,
              maxItems: 3,
              description: "Agent-memory reference document filenames to load exactly.",
            },
          },
          required: ["documents"],
          additionalProperties: false,
        },
        strict: true,
      },
    ]);
  });

  test("requires every property in strict Responses object schemas", () => {
    const tools = buildAgentResponseTools(memorySnapshotFixture());
    const functionTools = tools.filter((tool) => tool.type === "function");

    for (const tool of functionTools) {
      expect(tool.strict).toBe(true);
      assertStrictObjectSchema(tool.parameters, tool.name);
    }
  });

  test("registers a strict condition judgment schema", () => {
    assertStrictObjectSchema(conditionJudgmentToolParameters, "get_condition_judgment");
    expect(conditionJudgmentToolParameters.required).toEqual([
      "activity",
      "location",
      "date_range",
      "beach_name",
      "include_local_caveats",
      "constraints",
    ]);
    expect(agentToolDefinitions.map((tool) => tool.name)).toContain("get_condition_judgment");
  });

  test("describes available tools without exposing the helper as model-callable", () => {
    expect(describeAvailableTools()).toEqual([
      {
        name: "get_weather_forecast",
        description:
          "Get the governed Open-Meteo weather forecast snapshot for a known Siargao location.",
      },
      {
        name: "get_marine_conditions",
        description:
          "Get governed Open-Meteo Marine model data for Siargao tide-proxy sea level, waves, swell, and ocean current. This is not official tide-table, navigation, or safety authority data.",
      },
      {
        name: "get_tide_forecast",
        description:
          "Get Tide-Forecast Dapa predicted tide table data and embedded sea-condition periods for Siargao surf/tide timing during development/testing. This is not an official tide gauge, navigation aid, or safety clearance.",
      },
      {
        name: "get_condition_judgment",
        description:
          "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, checked Tide-Forecast tide/sea-period data when available, checked Open-Meteo Marine model data when available, curated local caveats, and explicit unchecked road, official-warning, lifeguard, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
      },
      {
        name: "search_nightlife_events",
        description:
          "Search approved General Luna nightlife event facts before using Google Places for venue details. Use for tonight, party, nightlife, bar-hopping, DJ, live-music, foam-party, pub-quiz, trivia, and drinks-tonight route answers. This returns event schedule evidence, source profile IDs, freshness/expiry metadata, refresh decisions, and route roles, not live crowd size, door policy, guest list, table availability, last-minute cancellation, or exact closing time.",
      },
      {
        name: "search_places",
        description:
          "Search governed Google Places results for Siargao places using allowed chat-search fields.",
      },
      {
        name: "get_place_details",
        description:
          "Get governed Google Places identity details for one place ID using cache-first lookup and the allowed details field mask.",
      },
      {
        name: "search_local_guide",
        description:
          "Search Ask Siargao curated local guide facts for beaches and local trip-planning fit.",
      },
      {
        name: "rank_surf_spots_nearby",
        description:
          "Rank known Siargao surf spots by straight-line distance from the user's consented browser geolocation. Use for closest/nearest/near-me surf spot requests. The tool returns distances and spot metadata only; it does not expose the user's coordinates or live surf conditions.",
      },
      {
        name: "plan_local_itinerary",
        description:
          "Build a governed structured 2-4 hour Siargao itinerary artifact from curated local guide evidence and explicit unchecked caveats. The AI must use the returned plan as evidence and write the final answer itself.",
      },
      {
        name: "describe_database_schema",
        description:
          "Describe the approved safe local data surfaces, fields, query rules, limits, and prohibited database access.",
      },
      {
        name: "query_local_facts",
        description:
          "Query approved local Siargao facts with structured filters only; no SQL, private data, or restricted provider bodies.",
      },
      {
        name: "get_source_evidence",
        description:
          "Return display-safe source evidence, caveats, freshness, and checked boundaries for safe local fact IDs.",
      },
      {
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
      },
      {
        name: "load_agent_memory_file",
        description:
          "Load exact Ask Siargao agent-memory reference files by filename after using INDEX.md to choose the smallest relevant set. This is policy/reference context, not live evidence.",
      },
    ]);
    expect(agentToolDefinitions.map((tool) => tool.name)).not.toContain("describe_available_tools");
  });

  test("accepts nullable optional fields required by strict Responses schemas", async () => {
    const placesResult = await executeAgentTool(
      {
        requestId: "agent_request_nullable_places",
        name: "search_places",
        arguments: {
          query: "cafes General Luna",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
          constraints: null,
        },
      },
      {
        getGooglePlacesChatContext: async ({ fetchedAt, search }) =>
          googlePlacesContextFixture({ fetchedAt, placeName: "Nullable Cafe", search }),
      },
    );
    const localGuideResult = await executeAgentTool({
      requestId: "agent_request_nullable_local_guide",
      name: "search_local_guide",
      arguments: {
        query: "sandy beaches",
        filters: null,
      },
    });
    const surfRankingResult = await executeAgentTool({
      requestId: "agent_request_nullable_surf_ranking",
      name: "rank_surf_spots_nearby",
      arguments: {
        skill_level: null,
        max_results: null,
        include_boat_access: null,
      },
      toolContext: {
        surfSpotRanking: {
          centerSource: "browser_geolocation",
          center: { latitude: 9.952, longitude: 126.088 },
        },
      },
    });
    const itineraryResult = await executeAgentTool({
      requestId: "agent_request_nullable_itinerary",
      name: "plan_local_itinerary",
      arguments: {
        theme: "sandy_beach_half_day",
        origin: null,
        duration_hours: null,
        transport_mode: null,
        max_ride_minutes: null,
        needs_weather_check: null,
        needs_open_now: null,
        meal_preference: null,
        constraints: null,
      },
    });
    const conditionResult = await executeAgentTool(
      {
        requestId: "agent_request_nullable_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "sunset",
          location: "Cloud 9",
          date_range: "today",
          beach_name: null,
          include_local_caveats: null,
          constraints: null,
        },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("Cloud 9"),
      },
    );
    const nightlifeResult = await executeAgentTool(
      {
        requestId: "agent_request_nullable_nightlife",
        name: "search_nightlife_events",
        arguments: {
          location: "General Luna",
          date: "tonight",
          interests: null,
        },
      },
      { now: () => new Date("2026-06-30T12:00:00+08:00") },
    );
    const localFactsResult = await executeAgentTool(
      {
        requestId: "agent_request_nullable_local_facts",
        name: "query_local_facts",
        arguments: {
          entityTypes: ["beach"],
          area: null,
          tags: null,
          text: null,
          limit: null,
        },
      },
      { localFactsQueryRunner: async () => [] },
    );

    expect(placesResult.status).toBe("success");
    expect(localGuideResult.status).toBe("success");
    expect(surfRankingResult.status).toBe("success");
    expect(itineraryResult.status).toBe("success");
    expect(conditionResult.status).toBe("success");
    expect(nightlifeResult.status).toBe("success");
    expect(localFactsResult.status).toBe("success");
  });

  test("ranks surf spots from browser geolocation without exposing coordinates", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_surf_ranking_pacifico",
      name: "rank_surf_spots_nearby",
      arguments: {
        skill_level: "any",
        max_results: 3,
        include_boat_access: false,
      },
      toolContext: {
        surfSpotRanking: {
          centerSource: "browser_geolocation",
          consentScope: "trip_session",
          center: { latitude: 9.952, longitude: 126.088 },
        },
      },
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("Pacifico / Big Wish");
    expect(result.text).toContain("Bamboo Garden");
    expect(result.text).toContain("km straight-line");
    expect(result.data).toMatchObject({
      centerSource: "browser_geolocation",
      distanceBasis: "straight_line_km",
      consentScope: "trip_session",
    });
    expect(
      (result.data as { spots?: Array<{ name: string; distanceKm: number }> }).spots?.map(
        (spot) => spot.name,
      ),
    ).toEqual(["Pacifico / Big Wish", "Bamboo Garden", "Innertubes"]);
    expect(JSON.stringify(result)).not.toContain("9.952");
    expect(JSON.stringify(result)).not.toContain("126.088");
    expect(result.sources[0]).toMatchObject({
      label: "curated_local_guide",
      sourceName: "Ask Siargao surf spot reference",
    });
  });

  test("filters nearby surf ranking by ability before distance ordering", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_surf_ranking_beginner",
      name: "rank_surf_spots_nearby",
      arguments: {
        skill_level: "beginner",
        max_results: 3,
        include_boat_access: false,
      },
      toolContext: {
        surfSpotRanking: {
          centerSource: "browser_geolocation",
          consentScope: "single_request",
          center: { latitude: 9.8147, longitude: 126.1654 },
        },
      },
    });

    const data = result.data as {
      spots?: Array<{ name: string; skillLevels: string[]; fitReasons: string[] }>;
    };
    expect(data.spots?.map((spot) => spot.name)).not.toContain("Cloud 9");
    expect(data.spots?.[0]?.name).toBe("Jacking Horse");
    expect(data.spots?.[0]?.skillLevels).toContain("beginner");
    expect(data.spots?.[0]?.fitReasons).toContain("matches beginner surf ability filter");
    expect(JSON.stringify(result)).not.toContain("9.8147");
    expect(JSON.stringify(result)).not.toContain("126.1654");
  });

  test("requires browser geolocation for surf spot ranking", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_surf_ranking_no_location",
      name: "rank_surf_spots_nearby",
      arguments: {
        skill_level: "any",
        max_results: 3,
        include_boat_access: false,
      },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("browser_geolocation_unavailable");
  });

  test("searches live Google Places with the chat field mask", async () => {
    const requests: RequestInit[] = [];
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "cafes near Cloud 9",
          center: { latitude: 9.8116, longitude: 126.1651 },
          radius_meters: 4_000,
          constraints: { included_type: "cafe", open_now: true, page_size: 2 },
        },
      },
      {
        googlePlacesApiKey: "test-key",
        googlePlacesFetcher: async (_url, init) => {
          requests.push(init);
          return Response.json({
            places: [
              {
                id: "place_shaka",
                name: "places/place_shaka",
                displayName: { text: "Shaka Siargao" },
                formattedAddress: "Cloud 9, General Luna",
                location: { latitude: 9.8117, longitude: 126.1652 },
                types: ["cafe", "food", "point_of_interest", "establishment"],
                primaryType: "cafe",
                businessStatus: "OPERATIONAL",
                googleMapsUri: "https://maps.google.com/?cid=shaka",
                rating: 4.6,
                userRatingCount: 900,
                currentOpeningHours: { openNow: true },
              },
            ],
          });
        },
        now: () => new Date("2026-06-26T00:00:00.000Z"),
      },
    );

    expect(result.status).toBe("success");
    expect((requests[0]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      googlePlacesChatSearchFieldMask,
    );
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({ openNow: true });
    expect(result.text).toContain("Shaka Siargao");
    expect(result.text).not.toContain("Field mask");
    expect(result.sources[0]).toMatchObject({
      label: "live_checked",
      sourceName: "Google Places",
      sourceProfileId: "source_google_places",
    });
    const data = result.data as {
      fieldMask: string;
      freshness: string;
      places: Array<{ displayName: string; rating?: number; currentOpeningHours?: unknown }>;
      search: { textQuery: string; includedType?: string };
    };
    expect(data.fieldMask).toBe(googlePlacesChatSearchFieldMask);
    expect(data.freshness).toBe("live");
    expect(data.search.textQuery).toBe("cafes near Cloud 9 Siargao");
    expect(data.search.includedType).toBe("cafe");
    expect(data.places[0]).toMatchObject({
      displayName: "Shaka Siargao",
      rating: 4.6,
      currentOpeningHours: { openNow: true },
    });
    expect(result.cards?.[0]).toMatchObject({
      kind: "place",
      title: "Shaka Siargao",
      mapsUrl: "https://maps.google.com/?cid=shaka",
      distanceLabel: "About 50 m from search center.",
      openStatusLabel: "Open now according to Google Places.",
      sourceLabel: "Google Places - live checked",
    });
    expect(result.cards?.[0]?.fitReasons).toContain(
      'A top Google Places match for "cafes near Cloud 9 Siargao".',
    );
    expect(result.cards?.[0]?.fitReasons.join(" ")).toContain("Well rated on Google: 4.6");
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("Review text");
    const travelerVisiblePayload = JSON.stringify({
      text: result.text,
      cards: result.cards,
      actions: result.actions,
    });
    expect(travelerVisiblePayload).not.toContain("Enhanced chat lookup");
    expect(travelerVisiblePayload).not.toContain("Do not store");
    expect(travelerVisiblePayload).not.toContain("raw provider");
    expect(travelerVisiblePayload).not.toContain("retention handling");
    expect(travelerVisiblePayload).not.toContain("Field mask");
    expect(travelerVisiblePayload).not.toContain("provider relevance");
    expect(result.actions?.map((action) => action.label)).toEqual([
      "Ask for alternatives",
      "Make this into a short plan",
    ]);
  });

  test("uses browser geolocation as the Places center and marks no-store context", async () => {
    const searches: Array<{
      cacheMode?: string;
      search: GooglePlacesChatSearch;
    }> = [];
    const browserCenter = { latitude: 9.8123, longitude: 126.1664 };
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places_browser_location",
        name: "search_places",
        arguments: {
          query: "cafes near me",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 2_500,
          constraints: { included_type: "cafe", open_now: true, page_size: 3 },
        },
        toolContext: {
          googlePlaces: {
            center: browserCenter,
            centerSource: "browser_geolocation",
            cacheMode: "no_store",
            consentScope: "single_request",
          },
        },
      },
      {
        getGooglePlacesChatContext: async ({ cacheMode, fetchedAt, search }) => {
          searches.push({ cacheMode, search });
          return googlePlacesContextFixture({
            fetchedAt,
            placeName: "Browser Center Cafe",
            search,
          });
        },
      },
    );

    expect(result.status).toBe("success");
    expect(searches[0]).toMatchObject({
      cacheMode: "no_store",
      search: {
        center: browserCenter,
        includedType: "cafe",
        openNow: true,
      },
    });
    expect(result.text).toContain("consented browser geolocation");
    expect(result.sources[0]?.checked).toContain("browser geolocation search center");
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("browser geolocation");
    expect(result.cards?.[0]?.caveats.join(" ")).not.toContain("9.8123");
    expect(result.cards?.[0]?.caveats.join(" ")).not.toContain("126.1664");
    expect(result.data).toMatchObject({
      centerSource: "browser_geolocation",
      consentScope: "single_request",
      search: {
        center: { source: "browser_geolocation" },
      },
    });
    expect(JSON.stringify(result.data)).not.toContain("9.8123");
    expect(JSON.stringify(result.data)).not.toContain("126.1664");
  });

  test("uses browser geolocation when near-me Places arguments omit center", async () => {
    const searches: Array<{
      cacheMode?: string;
      search: GooglePlacesChatSearch;
    }> = [];
    const browserCenter = { latitude: 9.8123, longitude: 126.1664 };
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places_browser_location_no_center",
        name: "search_places",
        arguments: {
          query: "cafes near me",
          radius_meters: 2_500,
          constraints: { included_type: "cafe", open_now: true, page_size: 3 },
        },
        toolContext: {
          googlePlaces: {
            center: browserCenter,
            centerSource: "browser_geolocation",
            cacheMode: "no_store",
            consentScope: "single_request",
          },
        },
      },
      {
        getGooglePlacesChatContext: async ({ cacheMode, fetchedAt, search }) => {
          searches.push({ cacheMode, search });
          return googlePlacesContextFixture({
            fetchedAt,
            placeName: "Browser Center Cafe",
            search,
          });
        },
      },
    );

    expect(result.status).toBe("success");
    expect(searches[0]).toMatchObject({
      cacheMode: "no_store",
      search: {
        center: browserCenter,
        includedType: "cafe",
        openNow: true,
      },
    });
    expect(result.data).toMatchObject({
      centerSource: "browser_geolocation",
      search: {
        center: { source: "browser_geolocation" },
      },
    });
  });

  test("repairs browser geolocation center references before Places validation", async () => {
    const searches: Array<{
      cacheMode?: string;
      search: GooglePlacesChatSearch;
    }> = [];
    const browserCenter = { latitude: 9.8123, longitude: 126.1664 };
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places_browser_location_center_reference",
        name: "search_places",
        arguments: {
          query: "cafes near me",
          center: { source: "browser_geolocation" },
          radius_meters: 2_500,
          constraints: { included_type: "cafe", open_now: true, page_size: 3 },
        },
        toolContext: {
          googlePlaces: {
            center: browserCenter,
            centerSource: "browser_geolocation",
            cacheMode: "no_store",
            consentScope: "single_request",
          },
        },
      },
      {
        getGooglePlacesChatContext: async ({ cacheMode, fetchedAt, search }) => {
          searches.push({ cacheMode, search });
          return googlePlacesContextFixture({
            fetchedAt,
            placeName: "Browser Center Cafe",
            search,
          });
        },
      },
    );

    expect(result.status).toBe("success");
    expect(searches[0]).toMatchObject({
      cacheMode: "no_store",
      search: {
        center: browserCenter,
        includedType: "cafe",
        openNow: true,
      },
    });
    expect(result.data).toMatchObject({
      centerSource: "browser_geolocation",
      search: {
        center: { source: "browser_geolocation" },
      },
    });
  });

  test("rejects Places search without center or runtime browser geolocation", async () => {
    let providerCalls = 0;
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places_missing_center",
        name: "search_places",
        arguments: {
          query: "cafes",
          radius_meters: 2_500,
          constraints: { included_type: "cafe", open_now: true, page_size: 3 },
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => {
          providerCalls += 1;
          return googlePlacesContextFixture({ placeName: "Should Not Run", search });
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.text).toContain("Invalid arguments");
    expect(providerCalls).toBe(0);
  });

  test("returns fresh-cache Google Places search output", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "restaurants near General Luna Siargao",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 6_000,
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) =>
          googlePlacesContextFixture({
            freshness: "fresh_cache",
            placeName: "Cached Dinner Grill",
            search,
          }),
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources[0]?.label).toBe("fresh_cache");
    expect(result.text).toContain("Cached Dinner Grill");
    expect(result.cards?.[0]?.sourceLabel).toBe("Google Places - fresh cache");
    expect(result.cards?.[0]?.mapsUrl).toContain("Cached%20Dinner%20Grill");
  });

  test("re-ranks Places outputs when local-fit constraints match returned public fields", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places_local_fit",
        name: "search_places",
        arguments: {
          query: "covered family cafes near Cloud 9 Siargao",
          center: { latitude: 9.814, longitude: 126.165 },
          radius_meters: 4_000,
          constraints: { included_type: "cafe", open_now: true, page_size: 3 },
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => {
          const context = googlePlacesContextFixture({ placeName: "Generic Cafe", search });
          return {
            ...context,
            places: [
              {
                ...context.places[0],
                placeId: "place_generic_cafe",
                resourceName: "places/Generic Cafe",
                displayName: "Generic Cafe",
                latitude: 9.8145,
                longitude: 126.165,
              },
              {
                ...context.places[0],
                placeId: "place_covered_family_cafe",
                resourceName: "places/Covered Family Cafe",
                displayName: "Covered Family Cafe",
                formattedAddress: "Covered beach lane, Cloud 9",
                latitude: 9.803,
                longitude: 126.161,
              },
            ],
          };
        },
      },
    );

    const data = result.data as { places?: Array<{ displayName: string }> };
    expect(data.places?.map((place) => place.displayName)).toEqual([
      "Covered Family Cafe",
      "Generic Cafe",
    ]);
    expect(result.text).toContain("1. Covered Family Cafe");
    expect(result.cards?.[0]?.title).toBe("Covered Family Cafe");
    expect(result.cards?.[0]?.fitReasons).toEqual(
      expect.arrayContaining([
        "covered wording matched the rainy-day constraint",
        "family wording matched the traveler profile",
      ]),
    );
  });

  test("does not fabricate a Places card map URL when no returned map URL is available", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "cafes near Cloud 9",
          center: { latitude: 9.8116, longitude: 126.1651 },
          radius_meters: 4_000,
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => {
          const context = googlePlacesContextFixture({
            placeName: "Map Missing Cafe",
            search,
          });
          return {
            ...context,
            places: [{ ...context.places[0], googleMapsUri: "" }],
          };
        },
      },
    );

    expect(result.status).toBe("success");
    expect(result.cards?.[0]?.title).toBe("Map Missing Cafe");
    expect(result.cards?.[0]?.mapsUrl).toBeUndefined();
  });

  test("drops closed Places candidates for open-now searches", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 4_000,
          constraints: { open_now: true },
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => {
          const context = googlePlacesContextFixture({
            placeName: "Closed Dinner Grill",
            search,
          });
          return {
            ...context,
            places: [{ ...context.places[0], currentOpeningHours: { openNow: false } }],
          };
        },
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources[0]).toMatchObject({
      label: "not_verified",
      notChecked: expect.arrayContaining(["useful Google Places shortlist"]),
    });
    expect(result.cards).toBeUndefined();
    expect(JSON.stringify(result.data)).not.toContain("Closed Dinner Grill");
  });

  test("returns not-verified output when Places search has no results", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "rare impossible place Siargao",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 2_000,
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => ({
          ...googlePlacesContextFixture({ placeName: "unused", search }),
          status: "no_results",
          places: [],
        }),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("no useful results");
    expect(result.sources[0]?.label).toBe("not_verified");
    expect(result.sources[0]?.checked).toEqual([]);
    expect(result.cards).toBeUndefined();
    expect(result.actions).toBeUndefined();
  });

  test("rejects invalid Places search arguments before provider code", async () => {
    let providerCalls = 0;
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "cafes",
          center: { latitude: 15, longitude: 126.1651 },
          radius_meters: 4_000,
        },
      },
      {
        getGooglePlacesChatContext: async ({ search }) => {
          providerCalls += 1;
          return googlePlacesContextFixture({ placeName: "Should Not Run", search });
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(providerCalls).toBe(0);
  });

  test("returns provider-unavailable output for Places search failures", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_places",
        name: "search_places",
        arguments: {
          query: "cafes near Cloud 9",
          center: { latitude: 9.8116, longitude: 126.1651 },
          radius_meters: 4_000,
        },
      },
      {
        getGooglePlacesChatContext: async () => {
          throw new Error("Google Places chat lookup failed: PERMISSION_DENIED");
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("provider_unavailable");
    expect(result.sources[0]?.label).toBe("provider_unavailable");
    expect(result.text).toBe("Google Places search is temporarily unavailable.");
    expect(result.text).not.toContain("PERMISSION_DENIED");
    expect(result.cards).toBeUndefined();
    expect(result.actions).toBeUndefined();
  });

  test("returns cache-first Place details without enterprise or review fields", async () => {
    let liveCalls = 0;
    const result = await executeAgentTool(
      {
        requestId: "agent_request_details",
        name: "get_place_details",
        arguments: { place_id: "place_cached" },
      },
      {
        findFreshPlaceDetails: async () => ({
          place_id: "place_cached",
          resource_name: "places/place_cached",
          display_name_json: { text: "Cached Cafe" },
          formatted_address: "General Luna, Siargao",
          latitude: "9.8006",
          longitude: "126.1586",
          types_json: ["cafe", "food"],
          primary_type: "cafe",
          business_status: "OPERATIONAL",
          google_maps_uri: "https://maps.google.com/?cid=cached",
          fetched_at: new Date("2026-06-25T00:00:00.000Z"),
          stale_at: new Date("2026-07-01T00:00:00.000Z"),
          retention_expires_at: new Date("2026-07-25T00:00:00.000Z"),
        }),
        enrichGooglePlacesDetails: async () => {
          liveCalls += 1;
          return [];
        },
        now: () => new Date("2026-06-26T00:00:00.000Z"),
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources[0]?.label).toBe("fresh_cache");
    expect(result.text).toContain("Cached Cafe");
    const data = result.data as {
      fieldMask: string;
      place: Record<string, unknown>;
    };
    expect(data.fieldMask).toBe(googlePlacesDetailsFieldMask);
    expect(data.place.displayName).toBe("Cached Cafe");
    expect(data.place).not.toHaveProperty("rating");
    expect(data.place).not.toHaveProperty("reviews");
    expect(result.cards?.[0]).toMatchObject({
      title: "Cached Cafe",
      mapsUrl: "https://maps.google.com/?cid=cached",
      openStatusLabel: "Hours not returned by Google Places.",
      sourceLabel: "Google Places - fresh cache",
    });
    expect(liveCalls).toBe(0);
  });

  test("falls back to live Place details with the allowed details field mask", async () => {
    const requests: RequestInit[] = [];
    const result = await executeAgentTool(
      {
        requestId: "agent_request_details",
        name: "get_place_details",
        arguments: { place_id: "place_live" },
      },
      {
        findFreshPlaceDetails: async () => null,
        googlePlacesApiKey: "test-key",
        googlePlacesFetcher: async (_url, init) => {
          requests.push(init);
          return Response.json({
            id: "place_live",
            name: "places/place_live",
            displayName: { text: "Live Surf Shop" },
            formattedAddress: "Tourism Road, General Luna",
            location: { latitude: 9.81, longitude: 126.16 },
            types: ["store", "point_of_interest"],
            primaryType: "store",
            businessStatus: "OPERATIONAL",
            currentOpeningHours: { openNow: true },
            rating: 4.7,
            userRatingCount: 321,
            priceLevel: "PRICE_LEVEL_MODERATE",
            googleMapsUri: "https://maps.google.com/?cid=live",
          });
        },
        now: () => new Date("2026-06-26T00:00:00.000Z"),
      },
    );

    expect(result.status).toBe("success");
    expect((requests[0]?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      googlePlacesDetailsFieldMask,
    );
    expect(result.sources[0]?.label).toBe("live_checked");
    const data = result.data as { place: Record<string, unknown>; fieldMask: string };
    expect(data.fieldMask).toBe(googlePlacesDetailsFieldMask);
    expect(data.place.displayName).toBe("Live Surf Shop");
    expect(data.place.currentOpeningHours).toEqual({ openNow: true });
    expect(data.place.rating).toBe(4.7);
    expect(data.place.userRatingCount).toBe(321);
    expect(data.place.priceLevel).toBe("PRICE_LEVEL_MODERATE");
    expect(data.place).not.toHaveProperty("reviews");
    expect(result.text).toContain("open now");
    expect(result.text).toContain("Google rating 4.7 from 321 ratings");
    expect(result.text).toContain("moderate");
    expect(result.sources[0]?.checked).toContain("rating signals");
    expect(result.sources[0]?.checked).toContain("open-now signal");
    expect(result.sources[0]?.checked).toContain("price signals");
    expect(result.cards?.[0]).toMatchObject({
      title: "Live Surf Shop",
      subtitle:
        "store - Tourism Road, General Luna - Google rating 4.7 from 321 ratings - moderate",
      mapsUrl: "https://maps.google.com/?cid=live",
      openStatusLabel: "Open now according to Google Places.",
      sourceLabel: "Google Places - live checked",
    });
    expect(result.cards?.[0]?.fitReasons).toContain(
      "Good practical option right now: Google shows it as open.",
    );
    expect(result.cards?.[0]?.fitReasons).toContain("Well rated on Google: 4.7 from 321 ratings");
    expect(result.cards?.[0]?.caveats).not.toContain(
      "Opening hours were not returned for this place.",
    );
  });

  test("returns provider-unavailable output for Place details failures", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_details",
        name: "get_place_details",
        arguments: { place_id: "place_denied" },
      },
      {
        findFreshPlaceDetails: async () => null,
        enrichGooglePlacesDetails: async () => {
          throw new Error("Google Places enrichment failed: PERMISSION_DENIED");
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("provider_unavailable");
    expect(result.sources[0]?.label).toBe("provider_unavailable");
    expect(result.text).toBe("Google Places details are temporarily unavailable.");
    expect(result.text).not.toContain("PERMISSION_DENIED");
  });

  test("returns sand-only curated beach guide candidates", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "sandy beaches near General Luna",
        filters: {
          beach_surface: "sand",
          max_ride_minutes: 30,
        },
      },
    });

    expect(result.status).toBe("success");
    expect(result.sources[0]).toMatchObject({
      label: "curated_local_guide",
      sourceName: "Ask Siargao curated local beach guide",
    });
    const data = result.data as {
      candidates: Array<{ name: string; surface: string }>;
      caveats: string[];
    };
    expect(data.candidates.map((candidate) => candidate.name)).toEqual([
      "Malinao Beach",
      "Doot Beach",
      "Secret Beach",
    ]);
    expect(data.candidates.every((candidate) => candidate.surface === "sand")).toBe(true);
    expect(data.caveats.join(" ")).toContain("not a live tide");
    expect(result.cards?.[0]).toMatchObject({
      kind: "beach",
      title: "Malinao Beach",
      subtitle: "Malinao - 10-20 min estimated ride from General Luna",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Malinao%20Beach%20Malinao%20Siargao",
      distanceLabel: "Estimated 10-20 min ride from General Luna.",
      sourceLabel: "Ask Siargao curated local beach guide - curated local guide",
    });
    expect(result.cards?.[0]?.openStatusLabel).toBeUndefined();
    expect(result.cards?.[0]?.fitReasons.join(" ")).toContain("sandy shoreline");
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("not a live tide");
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("not a live Google Places identity");
    expect(result.cards?.[0]?.caveats).toContain(
      "Live road, tide, current, beach access, and lifeguard conditions were not checked.",
    );
    expect(result.cards?.[0]?.caveats).not.toContain("live road conditions");
    expect(result.cards?.[0]?.caveats).not.toContain("beach access changes");
    expect(result.actions?.map((action) => action.label)).toEqual([
      "Check weather first",
      "Ask for alternatives",
    ]);
  });

  test("prioritizes swimming follow-up local guide results", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "best for swimming?",
        filters: {
          beach_surface: "sand",
          swimming: true,
          max_ride_minutes: 30,
        },
      },
    });

    const data = result.data as {
      candidates: Array<{ name: string; fitReasons: string[]; caveats: string[] }>;
    };
    expect(data.candidates[0]?.name).toBe("Doot Beach");
    expect(data.candidates[1]?.name).toBe("Malinao Beach");
    expect(data.candidates[0]?.fitReasons.join(" ")).toContain("easier sandy options");
    expect(data.candidates[0]?.caveats.join(" ")).toContain("No live tide/current");
    expect(result.cards?.[0]?.title).toBe("Doot Beach");
    expect(result.cards?.[0]?.fitReasons.join(" ")).toContain("easier sandy options");
  });

  test("keeps strict 30-minute local guide filters and north-island exclusions", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "beaches within 30 min ride from General Luna",
        filters: {
          max_ride_minutes: 30,
        },
      },
    });

    expect(result.text).toContain("Excluded: Pacifico Beach");
    expect(result.text).toContain("Excluded: Alegria Beach");
    const data = result.data as {
      candidates: Array<{ name: string; rideTimeFromGeneralLunaMinutes: { max: number } }>;
      excluded: Array<{ name: string; reason: string }>;
    };
    expect(
      data.candidates.every((candidate) => candidate.rideTimeFromGeneralLunaMinutes.max <= 30),
    ).toBe(true);
    expect(
      data.excluded.find((candidate) => candidate.name === "Pacifico Beach")?.reason,
    ).toContain("outside the 30-minute filter");
    expect(result.cards?.map((card) => card.title)).not.toContain("Cloud 9 beach access");
    expect(result.cards?.map((card) => card.title)).not.toContain("Pacifico Beach");
  });

  test("does not promote negatively mentioned north-island beaches in broad guide queries", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "sandy beaches within 30 minutes from General Luna, not Pacifico",
        filters: {
          max_ride_minutes: 30,
        },
      },
    });

    const data = result.data as {
      candidates: Array<{ name: string; rideTimeFromGeneralLunaMinutes: { max: number } }>;
      excluded: Array<{ name: string; reason: string }>;
    };
    expect(data.candidates[0]?.name).not.toBe("Pacifico Beach");
    expect(data.candidates.map((candidate) => candidate.name)).not.toContain("Pacifico Beach");
    expect(
      data.candidates.every((candidate) => candidate.rideTimeFromGeneralLunaMinutes.max <= 30),
    ).toBe(true);
    expect(data.excluded.find((candidate) => candidate.name === "Pacifico Beach")?.reason).toBe(
      "explicitly excluded by the query",
    );
    expect(result.cards?.map((card) => card.title)).not.toContain("Pacifico Beach");
  });

  test("carries kids and no-scooter caveats without safety overclaims", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "with kids and no scooter beach options",
        filters: {
          beach_surface: "sand",
          max_ride_minutes: 30,
          transport_mode: "walk",
          with_kids: true,
        },
      },
    });

    const data = result.data as {
      candidates: Array<{ fitReasons: string[]; caveats: string[] }>;
    };
    expect(data.candidates[0]?.fitReasons.join(" ")).toContain("Family/kids constraint");
    expect(data.candidates[0]?.caveats.join(" ")).toContain("Re-check conditions in person");
    expect(result.sources[0]?.notChecked.join(" ")).toContain("lifeguard or swimming safety");
    expect(result.cards?.[0]?.caveats).toContain(
      "Live road, tide, current, beach access, and lifeguard conditions were not checked.",
    );
    expect(result.cards?.[0]?.caveats).not.toContain("lifeguard or swimming safety");
    expect(result.text).not.toContain("lifeguard checked");
  });

  test("prioritizes named-area local guide matches before broader island options", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local_pacifico",
      name: "search_local_guide",
      arguments: {
        query: "sandy beach near Pacifico for a short stop",
        filters: {
          beach_surface: "sand",
          origin_area: "Pacifico",
          max_ride_minutes: 30,
        },
      },
    });

    const data = result.data as {
      candidates: Array<{ name: string; fitReasons: string[] }>;
      excluded: Array<{ name: string; reason: string }>;
    };
    expect(data.candidates[0]?.name).toBe("Pacifico Beach");
    expect(data.candidates[0]?.fitReasons).toContain("Named-area fit for Pacifico.");
    expect(data.excluded.find((candidate) => candidate.name === "Alegria Beach")?.reason).toContain(
      "not a close Pacifico proximity match",
    );
    expect(result.cards?.[0]?.title).toBe("Pacifico Beach");
    expect(result.cards?.[0]?.fitReasons).toContain("Named-area fit for Pacifico.");
  });

  test("changes local guide ranking and exclusions for rainy no-scooter family constraints", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local_no_scooter_family",
      name: "search_local_guide",
      arguments: {
        query: "rainy with kids and no scooter beach fallback",
        filters: {
          beach_surface: "sand",
          rain_fit: true,
          transport_mode: "walk",
          with_kids: true,
        },
      },
    });

    const data = result.data as {
      filters: { maxRideMinutes?: number; transportMode?: string; withKids?: boolean };
      candidates: Array<{ name: string; fitReasons: string[]; caveats: string[] }>;
      excluded: Array<{ name: string; reason: string }>;
    };
    expect(data.filters).toMatchObject({
      maxRideMinutes: 20,
      transportMode: "walk",
      withKids: true,
    });
    expect(data.candidates[0]?.name).toBe("Malinao Beach");
    expect(data.candidates[0]?.fitReasons.join(" ")).toContain("No-scooter/walking constraint");
    expect(data.candidates[0]?.fitReasons.join(" ")).toContain("Family/kids constraint");
    expect(data.candidates[0]?.caveats.join(" ")).toContain("Rain fit does not include");
    expect(data.excluded.find((candidate) => candidate.name === "Doot Beach")?.reason).toContain(
      "outside the 20-minute filter",
    );
  });

  test("rejects local guide origin filters until origin-specific ride times exist", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_local",
      name: "search_local_guide",
      arguments: {
        query: "beaches within 30 min ride from Cloud 9",
        filters: {
          origin: "Cloud 9",
          max_ride_minutes: 30,
        },
      },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.text).toContain("Unrecognized key");
    expect(result.sources).toEqual([]);
  });

  test("plans a local itinerary artifact without rendering final chat prose", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_itinerary",
      name: "plan_local_itinerary",
      arguments: {
        theme: "sunset_plus_dinner",
        origin: "General Luna",
        duration_hours: 3,
        needs_open_now: true,
        meal_preference: "seafood",
        constraints: ["with kids"],
      },
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("Structured itinerary artifact prepared");
    expect(result.text).toContain("write the final traveler-facing answer");
    expect(result.sources.map((source) => source.label)).toEqual([
      "curated_local_guide",
      "not_verified",
    ]);
    expect(result.itineraries?.[0]).toMatchObject({
      title: "Sunset plus Dinner",
      durationLabel: "3-4 hours",
      stops: [
        expect.objectContaining({ sequence: 1 }),
        expect.objectContaining({ kind: "meal", title: "Dinner in General Luna matching seafood" }),
      ],
      skip: expect.arrayContaining(["Far north dinner detours after sunset"]),
    });
    const data = result.data as {
      plan: { title: string };
      localGuide: { status: string };
      requiredToolChecks: {
        weather?: { tool: string };
        places: Array<{ query: string; constraints: { open_now?: boolean } }>;
      };
      constraints: { labels: string[]; withKids: boolean };
    };
    expect(data.plan.title).toBe("Sunset plus Dinner");
    expect(data.localGuide.status).toBe("available");
    expect(data.constraints.labels).toContain("with kids");
    expect(data.constraints.withKids).toBe(true);
    expect(data.requiredToolChecks.weather?.tool).toBe("get_weather_forecast");
    expect(data.requiredToolChecks.places[0]?.query).toBe("seafood General Luna Siargao");
    expect(data.requiredToolChecks.places[0]?.constraints.open_now).toBe(true);
    expect(result.actions?.map((action) => action.label)).toEqual([
      "Check weather",
      "Find live places",
    ]);
  });

  test("rejects invalid itinerary planning arguments before execution", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_itinerary_invalid",
      name: "plan_local_itinerary",
      arguments: {
        theme: "all_day_north_island",
        duration_hours: 8,
      },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.sources).toEqual([]);
  });

  test("returns a safe database schema description", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_schema",
      name: "describe_database_schema",
      arguments: {},
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("Approved local data surfaces");
    expect(result.text).toContain("curated_local_guide");
    expect(result.sources).toEqual([]);
    const data = result.data as { schema: { publicViews: Array<{ name: string }> } };
    expect(data.schema.publicViews.map((view) => view.name)).toContain("governed_facts");
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain("raw_payload");
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain("payments");
  });

  test("executes structured local fact queries with source metadata", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_local_facts",
        name: "query_local_facts",
        arguments: {
          entityTypes: ["beach"],
          area: "General Luna",
          tags: ["sandy"],
          limit: 2,
        },
      },
      {
        localFactsQueryRunner: async () => [],
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Safe local fact query returned 2 fact");
    expect(result.sources[0]).toMatchObject({
      label: "curated_local_guide",
      sourceName: "Ask Siargao curated local beach guide",
    });
    const data = result.data as {
      facts: Array<{ id: string; source: { label: string }; confidence: string }>;
      query: { limit: number };
    };
    expect(data.query.limit).toBe(2);
    expect(data.facts[0]?.id).toStartWith("curated_local_guide:beach:");
    expect(data.facts[0]?.source.label).toBe("curated_local_guide");
    expect(data.facts[0]?.confidence).toBe("medium");
  });

  test("executes local fact database queries through injected dependencies", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_db_facts",
        name: "query_local_facts",
        arguments: {
          entityTypes: ["route"],
          tags: ["transport"],
          limit: 5,
        },
      },
      {
        localFactsQueryRunner: async () => [
          {
            id: "route_gl_dapa",
            name: "General Luna to Dapa",
            origin: "General Luna",
            destination: "Dapa",
            transport_modes: ["van"],
            risk_notes: ["Check road conditions separately."],
            payload_json: { should: "not leak" },
          },
        ],
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("General Luna to Dapa");
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain("payload_json");
    expect(result.sources[0]?.checked.join(" ")).toContain("route fact");
  });

  test("times out slow local fact database queries", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_db_facts_timeout",
        name: "query_local_facts",
        arguments: {
          entityTypes: ["route"],
          limit: 5,
        },
      },
      {
        localFactsQueryRunner: async () => new Promise(() => {}),
        localFactsQueryTimeoutMs: 1,
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("tool_execution_failed");
    expect(result.text).toBe("Local data query timed out after 1ms.");
    expect(result.sources).toEqual([]);
  });

  test("executes display-safe source evidence lookup", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_evidence",
      name: "get_source_evidence",
      arguments: {
        factIds: ["curated_local_guide:beach:doot-beach"],
      },
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("Display-safe source evidence returned");
    expect(result.sources[0]).toMatchObject({
      label: "curated_local_guide",
      sourceName: "Ask Siargao curated local beach guide",
    });
    const data = result.data as {
      evidence: Array<{ factId: string; checked: string[]; notChecked: string[] }>;
    };
    expect(data.evidence[0]?.factId).toBe("curated_local_guide:beach:doot-beach");
    expect(data.evidence[0]?.notChecked).toContain("live tide");
  });

  test("keeps source evidence database output free of raw restricted fields", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_evidence_google",
        name: "get_source_evidence",
        arguments: {
          factIds: ["fact_google_place"],
        },
      },
      {
        localFactsQueryRunner: async () => [
          {
            fact_id: "fact_google_place",
            fact_public_republish_allowed: true,
            confidence_label: "low",
            source_profile_id: "source_google_places",
            source_name: "Google Places API profile",
            source_allowed_use: "citation_only",
            evidence_label: "allowed Google Places field mask",
            citation_url: "https://maps.google.com/?cid=test",
            evidence_allowed_use: "citation_only",
            public_republish_allowed: false,
            raw_payload: { should: "not leak" },
            text_json: { should: "not leak" },
          },
        ],
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources[0]?.notChecked).toContain("Google review text");
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain("raw_payload");
    expect(JSON.stringify(result.data).toLowerCase()).not.toContain("text_json");
  });

  test("rejects invalid local data tool arguments before execution", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_invalid_local_facts",
      name: "query_local_facts",
      arguments: {
        entityTypes: ["users"],
        table: "users",
      },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.sources).toEqual([]);
  });

  test("returns a normalized live weather forecast tool output", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        toolCallId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Cloud 9", date_range: "today" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("Cloud 9"),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Open-Meteo weather API forecast for Cloud 9");
    expect(result.text).toContain("Partly cloudy");
    expect(result.sources[0]).toMatchObject({
      label: "weather_checked",
      sourceName: "Open-Meteo weather API",
      sourceProfileId: "source_open_meteo",
      checked: ["forecast for Cloud 9"],
    });
    const data = result.data as {
      requestedLocation: string;
      dateRange: string;
      status: string;
      signals: string[];
      metrics: unknown[];
    };
    expect(data).toMatchObject({
      requestedLocation: "Cloud 9",
      dateRange: "today",
      status: "live",
    });
    expect(data.signals.join(" ")).toContain("precipitation probability 20%");
    expect(data.metrics).toEqual([]);
  });

  test("includes seven-day weather metrics when requested", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "next_7_days" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("Siargao Island"),
      },
    );

    const data = result.data as { metrics: Array<{ id: string }> };
    expect(result.text).toContain("Seven-day signals");
    expect(data.metrics.map((metric) => metric.id)).toEqual([
      "precipitation_probability",
      "rain_sum",
      "wind_gust",
    ]);
  });

  test("uses the Del Carmen Open-Meteo forecast location override", async () => {
    const weatherLocations: OpenMeteoForecastLocation[] = [];
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        name: "get_weather_forecast",
        arguments: { location: "Del Carmen", date_range: "today" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async (options) => {
          if (options?.location) {
            weatherLocations.push(options.location);
          }
          return liveWeatherSnapshot(options?.location?.name ?? "Siargao Island");
        },
      },
    );

    expect(result.status).toBe("success");
    expect(weatherLocations[0]?.id).toBe("siargao_del_carmen");
    expect(weatherLocations[0]?.name).toContain("Del Carmen");
  });

  test("returns provider-unavailable output for fallback weather snapshots", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => fallbackWeatherSnapshot,
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("provider_unavailable");
    expect(result.text).toContain("Open-Meteo weather forecast is unavailable");
    expect(result.sources[0]).toMatchObject({
      label: "provider_unavailable",
      sourceName: "Open-Meteo weather API",
      sourceProfileId: "source_open_meteo",
    });
  });

  test("returns normalized Open-Meteo Marine model conditions", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_marine",
        toolCallId: "call_marine",
        name: "get_marine_conditions",
        arguments: { location: "Cloud 9", date_range: "next_48_hours" },
      },
      {
        buildOpenMeteoMarineIngestionBatch: async () => liveMarineBatch(),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Open-Meteo Marine API modelled marine conditions");
    expect(result.text).toContain("sea level 0.26m MSL");
    expect(result.text).toContain("not an official tide table");
    expect(result.sources[0]).toMatchObject({
      label: "marine_checked",
      sourceName: "Open-Meteo Marine API",
      sourceProfileId: "source_open_meteo_marine",
      checked: [
        expect.stringContaining("modelled sea level height MSL"),
        "modelled wave height",
        "modelled swell wave height",
        "modelled ocean current velocity",
      ],
    });
    const data = result.data as {
      requestedLocation: string;
      dateRange: string;
      current: { seaLevelHeightMsl: number };
      metrics: { seaLevelHeightRangeMsl: number };
      caveats: string[];
    };
    expect(data.requestedLocation).toBe("Cloud 9");
    expect(data.dateRange).toBe("next_48_hours");
    expect(data.current.seaLevelHeightMsl).toBe(0.26);
    expect(data.metrics.seaLevelHeightRangeMsl).toBe(0.15);
    expect(data.caveats.join(" ")).toContain("modelled marine forecast data");
  });

  test("returns Tide-Forecast predicted tide data and surf windows", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_tide_forecast",
        toolCallId: "call_tide_forecast",
        name: "get_tide_forecast",
        arguments: { location: "Cloud 9", date_range: "tomorrow" },
      },
      {
        buildTideForecastSnapshot: async (input) =>
          liveTideForecastSnapshot(input.requestedLocation, input.dateRange),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Tide-Forecast Dapa page predicted tide data");
    expect(result.text).toContain("Best daylight surf/tide windows");
    expect(result.text).toContain("not an official tide-gauge");
    expect(result.sources[0]).toMatchObject({
      label: "tide_forecast_checked",
      sourceName: "Tide-Forecast Dapa page",
      sourceProfileId: "source_tide_forecast_dev",
      checked: [
        expect.stringContaining("Dapa tide station predicted tide table"),
        "predicted high and low tide times",
        "predicted tide heights",
        "embedded Tide-Forecast 3-hour swell and wind periods",
      ],
    });
    const data = result.data as {
      requestedLocation: string;
      recommendedWindows: Array<{ localLabel: string; nearestTideType: string }>;
    };
    expect(data.requestedLocation).toBe("Cloud 9");
    expect(data.recommendedWindows[0]).toMatchObject({
      localLabel: "5:00 AM-8:00 AM",
      nearestTideType: "high",
    });
  });

  test("returns a weather-backed condition judgment tool output", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "swimming",
          location: "General Luna",
          date_range: "today",
          beach_name: "Malinao Beach",
          include_local_caveats: true,
          constraints: ["with kids"],
        },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("General Luna"),
        buildOpenMeteoMarineIngestionBatch: async () => liveMarineBatch(),
        buildTideForecastSnapshot: async (input) =>
          liveTideForecastSnapshot(input.requestedLocation, input.dateRange),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Condition judgment for swimming at Malinao Beach");
    expect(result.text).toContain("tide checked");
    expect(result.text).toContain(
      "Decision summary artifact: condition_decision:swimming:malinao_beach:today",
    );
    expect(result.sources.map((source) => source.label)).toEqual([
      "weather_checked",
      "tide_forecast_checked",
      "marine_checked",
      "curated_local_guide",
    ]);
    const data = result.data as {
      judgment: {
        recommendation: string;
        signals: Array<{ kind: string; status: string }>;
      };
      decisionSummary: {
        id: string;
        bestAction: string;
        basis: string;
        timing: string;
        area: string;
      };
    };
    expect(data.judgment.recommendation).toBe("flexible");
    expect(data.decisionSummary).toMatchObject({
      id: "condition_decision:swimming:malinao_beach:today",
      bestAction: "Keep swimming flexible.",
      timing: "today",
      area: "Malinao Beach",
    });
    expect(result.decisionSummaries).toEqual([
      expect.objectContaining({
        id: data.decisionSummary.id,
        sources: result.sources,
      }),
    ]);
    expect(data.judgment.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "weather", status: "checked" }),
        expect.objectContaining({ kind: "tide", status: "checked" }),
        expect.objectContaining({ kind: "surf", status: "checked" }),
      ]),
    );
  });

  test("does not include curated beach guide caveats for non-beach condition tool requests", async () => {
    const cases = [
      { activity: "scooter", location: "General Luna" },
      { activity: "boat_trip", location: "Del Carmen" },
      { activity: "surfing", location: "Cloud 9" },
      { activity: "rain_plan", location: "General Luna" },
      { activity: "sunset", location: "General Luna" },
    ] as const;

    for (const conditionCase of cases) {
      const result = await executeAgentTool(
        {
          requestId: `agent_request_condition_${conditionCase.activity}`,
          name: "get_condition_judgment",
          arguments: {
            activity: conditionCase.activity,
            location: conditionCase.location,
            date_range: "today",
            beach_name: null,
            include_local_caveats: null,
            constraints: null,
          },
        },
        {
          getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot(conditionCase.location),
          buildOpenMeteoMarineIngestionBatch: unavailableMarineBatch,
          buildTideForecastSnapshot: unavailableTideForecastSnapshot,
        },
      );

      expect(result.status).toBe("success");
      expect(result.sources.map((source) => source.label)).not.toContain("curated_local_guide");
      expect(result.text).not.toContain("manual_caveat");
    }
  });

  test("does not include curated beach guide caveats for generic swimming condition requests", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_condition_generic_swimming",
        name: "get_condition_judgment",
        arguments: {
          activity: "swimming",
          location: "General Luna",
          date_range: "today",
          beach_name: null,
          include_local_caveats: null,
          constraints: null,
        },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("General Luna"),
        buildOpenMeteoMarineIngestionBatch: unavailableMarineBatch,
        buildTideForecastSnapshot: unavailableTideForecastSnapshot,
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources.map((source) => source.label)).not.toContain("curated_local_guide");
    expect(result.text).not.toContain("manual_caveat");
    expect(JSON.stringify(result.data)).not.toContain("curated_local_guide:doot_beach");
  });

  test("uses matching named beach caveats for condition tool requests", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_condition_pacifico",
        name: "get_condition_judgment",
        arguments: {
          activity: "swimming",
          location: "Siargao Island",
          date_range: "today",
          beach_name: "Pacifico Beach",
          include_local_caveats: true,
          constraints: null,
        },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => liveWeatherSnapshot("Siargao Island"),
        buildOpenMeteoMarineIngestionBatch: unavailableMarineBatch,
        buildTideForecastSnapshot: unavailableTideForecastSnapshot,
      },
    );
    const data = result.data as {
      judgment: {
        signals: Array<{ kind: string; evidenceIds: string[] }>;
      };
    };

    expect(result.status).toBe("success");
    const manualCaveat = data.judgment.signals.find((signal) => signal.kind === "manual_caveat");
    expect(manualCaveat?.evidenceIds).toEqual(["curated_local_guide:pacifico_beach"]);
    expect(result.text).not.toContain("Doot");
  });

  test("returns provider-unavailable condition evidence when weather fails", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_condition_unavailable",
        name: "get_condition_judgment",
        arguments: {
          activity: "boat_trip",
          location: "Del Carmen",
          date_range: "today",
          beach_name: null,
          include_local_caveats: false,
          constraints: null,
        },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => {
          throw new Error("Open-Meteo unavailable");
        },
        buildOpenMeteoMarineIngestionBatch: unavailableMarineBatch,
        buildTideForecastSnapshot: unavailableTideForecastSnapshot,
      },
    );

    expect(result.status).toBe("success");
    expect(result.sources[0]).toMatchObject({
      label: "provider_unavailable",
      sourceName: "Open-Meteo weather API",
    });
    const data = result.data as {
      judgment: {
        recommendation: string;
        signals: Array<{ kind: string; status: string }>;
      };
      decisionSummary: {
        bestAction: string;
        avoid: string;
      };
    };
    expect(data.judgment.recommendation).toBe("needs_local_confirmation");
    expect(data.decisionSummary).toMatchObject({
      bestAction: "Confirm locally before committing to boat trip.",
      avoid: "Avoid treating this as checked safety clearance.",
    });
    expect(result.decisionSummaries?.[0]?.sources[0]?.label).toBe("provider_unavailable");
    expect(data.judgment.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "weather", status: "unavailable" }),
        expect.objectContaining({ kind: "tide", status: "not_checked" }),
        expect.objectContaining({ kind: "surf", status: "not_checked" }),
      ]),
    );
  });

  test("rejects invalid weather date ranges before provider code", async () => {
    let providerCalls = 0;
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "tomorrow" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => {
          providerCalls += 1;
          return liveWeatherSnapshot();
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(providerCalls).toBe(0);
  });

  test("returns provider-unavailable output for weather provider failures", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_weather",
        name: "get_weather_forecast",
        arguments: { location: "General Luna", date_range: "today" },
      },
      {
        getLatestSiargaoWeatherSnapshot: async () => {
          throw new Error("Open-Meteo forecast request failed with HTTP 503.");
        },
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("provider_unavailable");
    expect(result.text).toContain("HTTP 503");
    expect(result.sources[0]?.notChecked.join(" ")).toContain("General Luna");
  });

  test("returns governed nightlife event route evidence before venue enrichment", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_nightlife",
        name: "search_nightlife_events",
        arguments: {
          location: "General Luna",
          date: "tonight",
          interests: ["party", "pub_quiz"],
        },
      },
      { now: () => new Date("2026-06-30T12:00:00+08:00") },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("BARREL - Tuesday Pub Quiz");
    expect(result.text).toContain("Barbosa - Disco Tropico");
    expect(result.text).toContain("Route roles:");
    expect(result.text).toContain("Not checked: same-day venue social posts");
    expect(result.sources[0]).toMatchObject({
      label: "event_checked",
      sourceName: "Local nightlife event directories",
      sourceProfileId: "source_nightlife_local_event_directories",
      checked: [
        "approved General Luna nightlife event facts for Tuesday",
        "verified event occurrences: BARREL, Mama Coco",
        "route roles: warm-up, main party, late option, and softer option when available",
      ],
    });
    const data = result.data as {
      route?: { warmUp?: { venueName?: string }; mainParty?: { venueName?: string } };
      nextStep?: string;
      refreshDecision?: { status?: string; checkedFreshHighMediumEventCount?: number };
    };
    expect(data.route?.warmUp?.venueName).toBe("BARREL");
    expect(data.route?.mainParty?.venueName).toBe("Barbosa");
    expect(data.refreshDecision).toMatchObject({
      status: "not_needed",
      checkedFreshHighMediumEventCount: 4,
    });
    expect(data.nextStep).toContain("Use Google Places only after this event lookup");
    expect(JSON.stringify(result)).not.toContain("raw");
    expect(JSON.stringify(result)).not.toContain("guest list checked");
  });

  test("does not label stale nightlife baselines as event checked", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_stale_nightlife",
        name: "search_nightlife_events",
        arguments: {
          location: "General Luna",
          date: "tonight",
          interests: ["party"],
        },
      },
      { now: () => new Date("2026-07-07T12:00:00+08:00") },
    );

    expect(result.status).toBe("success");
    expect(result.sources.map((source) => source.label)).toEqual(["no_current_event_facts"]);
    expect(result.sources[0]?.checked).toEqual([]);
    expect(result.sources[0]?.notChecked).toEqual(
      expect.arrayContaining([
        "current General Luna nightlife event facts for Tuesday",
        "same-day event schedule until approved priority sources are refreshed",
      ]),
    );
    expect(result.text).toContain(
      "No approved General Luna nightlife event facts matched Tuesday 2026-07-07.",
    );
    const data = result.data as {
      boundaries?: { checked?: string[]; notChecked?: string[] };
      refreshDecision?: { status?: string; checkedFreshHighMediumEventCount?: number };
    };
    expect(data.boundaries?.checked).toEqual([]);
    expect(data.refreshDecision).toMatchObject({
      status: "recommended",
      checkedFreshHighMediumEventCount: 0,
    });
  });

  test("returns machine-readable source policy output", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      toolCallId: "call_source_policy",
      name: "describe_source_policy",
      arguments: {},
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("live_checked");
    expect(result.text).toContain("fresh_cache");
    expect(result.text).toContain("event_checked");
    expect(result.text).toContain("venue_checked");
    expect(result.text).toContain("curated_local_guide");
    expect(result.text).toContain("weather_checked");
    expect(result.text).toContain("marine_checked");
    expect(result.text).toContain("community_signal");
    expect(result.text).toContain("not_verified");
    expect(result.text).toContain("no_current_event_facts");
    expect(result.text).toContain("web_researched");
    expect(result.text).toContain("official_checked");
    expect(result.text).toContain("directory_checked");
    expect(result.text).toContain("insufficient_web_evidence");
    expect(result.text).toContain("Never label generic model reasoning as live checked");
    expect(result.sources).toEqual([]);
    const data = result.data as { policies: Array<{ label: string }> };
    expect(data.policies[0]?.label).toBe("live_checked");
  });

  test("builds file search tools when a vector store is configured", () => {
    const memorySnapshot = memorySnapshotFixture();
    const tools = buildAgentResponseTools(memorySnapshot, {
      vectorStoreId: "vs_memory",
    });

    expect(tools).toContainEqual({
      type: "file_search",
      vector_store_ids: ["vs_memory"],
      max_num_results: 5,
    });
    expect(tools).toContainEqual(
      expect.objectContaining({
        type: "function",
        name: "load_agent_memory_file",
      }),
    );
    expect(memoryToolDocumentEnum(tools, "load_agent_memory_file")).toEqual(
      memorySnapshot.referenceFiles.map((file) => file.fileName),
    );
    expect(tools).not.toContainEqual(expect.objectContaining({ name: "search_agent_memory" }));
  });

  test("builds backend memory fallback when no vector store is configured", () => {
    const memorySnapshot = memorySnapshotFixture();
    const tools = buildAgentResponseTools(memorySnapshot);

    expect(tools).toContainEqual(
      expect.objectContaining({
        type: "function",
        name: "search_agent_memory",
      }),
    );
    expect(memoryToolDocumentEnum(tools, "search_agent_memory")).toEqual(
      memorySnapshot.referenceFiles.map((file) => file.fileName),
    );
    expect(tools).not.toContainEqual(expect.objectContaining({ type: "file_search" }));
  });

  test("searches source policy memory without creating source evidence labels", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_memory",
        name: "search_agent_memory",
        arguments: {
          query: "source labels checked not checked",
          documents: ["ASK_SIARGAO_SOURCE_POLICY.md"],
          max_results: 2,
        },
      },
      {
        memorySnapshot: memorySnapshotFixture(),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("ASK_SIARGAO_SOURCE_POLICY.md");
    expect(result.text).toContain("not live evidence");
    expect(result.sources).toEqual([]);
    expect(JSON.stringify(result.data)).toContain("source labels");
    expect(JSON.stringify(result.data)).not.toContain("checksum");
    expect(JSON.stringify(result.data)).not.toContain("b".repeat(64));
    expect(JSON.stringify(result.data)).not.toContain("live_checked");
    expect(JSON.stringify(result.data)).not.toContain("fresh_cache");
    expect(JSON.stringify(result.data)).not.toContain("weather_checked");
  });

  test("searches data dictionary memory", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_memory_dictionary",
        name: "search_agent_memory",
        arguments: {
          query: "unrestricted database access out of scope",
          documents: ["ASK_SIARGAO_DATA_DICTIONARY.md"],
        },
      },
      {
        memorySnapshot: memorySnapshotFixture(),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("ASK_SIARGAO_DATA_DICTIONARY.md");
    expect(result.text).toContain("unrestricted database access is out of scope");
    expect(result.sources).toEqual([]);
  });

  test("loads exact memory files chosen from the index", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_memory_load",
        name: "load_agent_memory_file",
        arguments: {
          documents: ["SURF.md", "ASK_SIARGAO_SOURCE_POLICY.md"],
        },
      },
      {
        memorySnapshot: memorySnapshotFixture(),
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Loaded Ask Siargao agent memory file(s)");
    expect(result.text).toContain("SURF.md");
    expect(result.text).toContain("surf spots are separate from beach fallbacks");
    expect(result.sources).toEqual([]);
    const data = result.data as {
      loadedMemoryFileNames?: string[];
      files?: Array<{ fileName?: string; content?: string }>;
    };
    expect(data.loadedMemoryFileNames).toEqual(["SURF.md", "ASK_SIARGAO_SOURCE_POLICY.md"]);
    expect(data.files?.map((file) => file.fileName)).toEqual([
      "SURF.md",
      "ASK_SIARGAO_SOURCE_POLICY.md",
    ]);
    expect(data.files?.[0]?.content).toContain("surf spots are separate from beach fallbacks");
    expect(JSON.stringify(data)).not.toContain("checksum");
  });

  test("rejects invalid memory-search arguments", async () => {
    const result = await executeAgentTool(
      {
        requestId: "agent_request_memory_invalid",
        name: "search_agent_memory",
        arguments: {
          query: "source",
          documents: ["PLAN.md"],
        },
      },
      {
        memorySnapshot: memorySnapshotFixture(),
      },
    );

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.sources).toEqual([]);
  });

  test("rejects invalid arguments before tool execution", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      name: "describe_source_policy",
      arguments: { label: "live_checked" },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.text).toContain("Invalid arguments");
    expect(result.sources).toEqual([]);
  });

  test("returns unknown tool errors without throwing", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      name: "run_unrestricted_sql",
      arguments: {},
    });

    expect(result).toMatchObject({
      name: "run_unrestricted_sql",
      status: "error",
      errorCode: "unknown_tool",
      sources: [],
    });
  });
});

function memorySnapshotFixture(): AgentMemorySnapshot {
  const index = {
    id: "ask_siargao_memory_index",
    title: "Ask Siargao Agent Memory Index",
    fileName: "INDEX.md",
    relativePath: "docs/agent-memory/INDEX.md",
    role: "instruction" as const,
    checksum: "i".repeat(64),
    byteLength: 60,
    content: "Use INDEX.md to choose which detailed memory files to load.",
  };
  const surf = {
    id: "ask_siargao_surf",
    title: "Siargao Surf Spots",
    fileName: "SURF.md",
    relativePath: "docs/agent-memory/SURF.md",
    role: "reference" as const,
    checksum: "u".repeat(64),
    byteLength: 70,
    content: "The surf memory says surf spots are separate from beach fallbacks.",
  };
  const dataDictionary = {
    id: "ask_siargao_data_dictionary",
    title: "Ask Siargao Data Dictionary",
    fileName: "ASK_SIARGAO_DATA_DICTIONARY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md",
    role: "reference" as const,
    checksum: "d".repeat(64),
    byteLength: 80,
    content:
      "The data dictionary says unrestricted database access is out of scope for persistent agent memory.",
  };
  const sourcePolicy = {
    id: "ask_siargao_source_policy",
    title: "Ask Siargao Source Policy",
    fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
    relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
    role: "reference" as const,
    checksum: "s".repeat(64),
    byteLength: 90,
    content:
      "The source policy explains source labels, checked and not checked wording, and says memory is not live evidence.",
  };

  return {
    versionId: "agent-memory:toolfixture000000",
    files: [index, surf, dataDictionary, sourcePolicy],
    instructionMarkdown: index.content,
    referenceFiles: [surf, dataDictionary, sourcePolicy],
  };
}

function memoryToolDocumentEnum(tools: readonly unknown[], toolName: string) {
  const tool = tools.find((candidate) => isRecord(candidate) && candidate.name === toolName);
  if (!isRecord(tool)) {
    return [];
  }
  const parameters = tool.parameters;
  if (!isRecord(parameters)) {
    return [];
  }
  const properties = parameters.properties;
  if (!isRecord(properties)) {
    return [];
  }
  const documents = properties.documents;
  if (!isRecord(documents)) {
    return [];
  }
  const items = documents.items;
  if (!isRecord(items) || !Array.isArray(items.enum)) {
    return [];
  }
  return items.enum;
}

function liveWeatherSnapshot(locationName = "Siargao Island"): WeatherSnapshot {
  return {
    ...fallbackWeatherSnapshot,
    status: "live",
    locationName,
    fetchedAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-27T00:00:00.000Z",
    freshness: "fresh",
    confidence: "medium",
    summary: `Open-Meteo live forecast for ${locationName}.`,
    today: {
      ...fallbackWeatherSnapshot.today,
      date: "2026-06-26",
      condition: "Partly cloudy",
      precipitationProbability: 20,
      precipitationSum: 1.1,
      rainSum: 0.7,
      windGust: 18,
      level: "low",
    },
  };
}

function liveMarineBatch(): OpenMeteoMarineIngestionBatch {
  return createOpenMeteoMarineIngestionBatch({
    fetchedAt: "2026-06-28T04:00:00.000Z",
    payload: {
      latitude: 9.79,
      longitude: 126.12,
      timezone: "Asia/Manila",
      current: {
        time: "2026-06-28T12:15",
        interval: 900,
        wave_height: 0.48,
        wave_direction: 84,
        wave_period: 8.35,
        swell_wave_height: 0.38,
        swell_wave_direction: 76,
        swell_wave_period: 6.75,
        sea_level_height_msl: 0.26,
        sea_surface_temperature: 30.7,
        ocean_current_velocity: 1.3,
        ocean_current_direction: 180,
      },
      hourly: {
        time: ["2026-06-28T12:00", "2026-06-28T13:00", "2026-06-28T14:00"],
        wave_height: [0.48, 0.58, 0.51],
        swell_wave_height: [0.38, 0.52, 0.45],
        sea_level_height_msl: [0.24, 0.33, 0.18],
        ocean_current_velocity: [1.3, 1.1, 1.6],
      },
    },
    requestUrl: "https://marine-api.open-meteo.com/v1/marine?example=true",
  });
}

function liveTideForecastSnapshot(
  requestedLocation = "Cloud 9",
  dateRange: "today" | "tomorrow" | "next_7_days" = "tomorrow",
): TideForecastSnapshot {
  return {
    status: "live",
    sourceName: "Tide-Forecast Dapa page",
    sourceProfileId: "source_tide_forecast_dev",
    stationName: "Dapa tide station",
    stationUrl: "https://www.tide-forecast.com/locations/Dapa/tides/latest",
    stationLatitude: 9.7594,
    stationLongitude: 126.053,
    requestedLocation,
    proxyFor: "Cloud 9, General Luna, and nearby Siargao east-coast surf planning",
    fetchedAt: "2026-06-28T10:00:00.000Z",
    serverTime: "2026-06-28T10:27:30.000Z",
    forecastUpdatedAt: "2026-06-28T13:49:53.000Z",
    dateRange,
    targetDates: ["2026-06-29"],
    days: [
      {
        date: "2026-06-29",
        sunriseTimestamp: 1782681420,
        sunsetTimestamp: 1782727200,
        tides: [
          { timestamp: 1782680100, time: "4:55AM", heightMeters: 1.68, type: "high" },
          { timestamp: 1782704880, time: "11:48AM", heightMeters: 0.21, type: "low" },
          { timestamp: 1782728700, time: "6:25PM", heightMeters: 1.49, type: "high" },
          { timestamp: 1782747840, time: "11:44PM", heightMeters: 0.81, type: "low" },
        ],
      },
    ],
    seaPeriods: [
      {
        timestamp: 1782680400,
        startsAt: "2026-06-28T21:00:00.000Z",
        localLabel: "5:00 AM",
        weatherSummary: "clear",
        windSpeedKmh: 10,
        swellHeightMeters: 0.7,
        swellPeriodSeconds: 10,
        swellDirection: "NE",
      },
    ],
    recommendedWindows: [
      {
        startsAt: "2026-06-28T21:00:00.000Z",
        endsAt: "2026-06-29T00:00:00.000Z",
        localLabel: "5:00 AM-8:00 AM",
        score: 9.2,
        tideHeightMeters: 1.68,
        nearestTideType: "high",
        nearestTideTime: "4:55AM",
        swellHeightMeters: 0.7,
        swellPeriodSeconds: 10,
        windSpeedKmh: 10,
        reason: "near high tide at 4:55AM (1.68m); swell 0.7m; 10s period; wind 10km/h",
      },
    ],
    caveats: [
      "Tide-Forecast page data is enabled for development/testing and commercial production use needs an appropriate Tide-Forecast/Meteo365 license.",
      "Dapa is used as the nearby Tide-Forecast station proxy for Cloud 9 and General Luna surf timing.",
      "This is predicted tide and forecast sea-condition data, not an official tide-gauge, navigation aid, lifeguard check, local operator call, or safety clearance.",
    ],
  };
}

async function unavailableMarineBatch(): Promise<OpenMeteoMarineIngestionBatch> {
  throw new Error("Open-Meteo Marine unavailable");
}

async function unavailableTideForecastSnapshot(): Promise<TideForecastSnapshot> {
  throw new Error("Tide-Forecast unavailable");
}

function googlePlacesContextFixture({
  fetchedAt = "2026-06-26T00:00:00.000Z",
  freshness = "live",
  placeName,
  search,
}: {
  fetchedAt?: string;
  freshness?: GooglePlacesChatContext["freshness"];
  placeName: string;
  search: GooglePlacesChatSearch;
}): GooglePlacesChatContext {
  return {
    status: "available",
    sourceName: "Google Places",
    sourceProfileId: "source_google_places",
    fetchedAt,
    freshness,
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    caveats: [
      "Review text, bookings, table availability, room availability, and independent local quality checks were not checked.",
    ],
    places: [
      {
        placeId: `place_${placeName.toLowerCase().replaceAll(/\W+/g, "_")}`,
        resourceName: `places/${placeName}`,
        displayName: placeName,
        formattedAddress: "General Luna, Siargao",
        latitude: 9.8006,
        longitude: 126.1586,
        types: [search.includedType ?? "restaurant", "point_of_interest"],
        primaryType: search.includedType ?? "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: `https://maps.google.com/?cid=${encodeURIComponent(placeName)}`,
        rating: 4.5,
        userRatingCount: 220,
        currentOpeningHours: { openNow: true },
      },
    ],
  };
}

function assertStrictObjectSchema(schema: unknown, path: string) {
  expect(isRecord(schema), `${path} must be a schema object`).toBe(true);
  if (!isRecord(schema)) {
    return;
  }

  if (schemaHasObjectType(schema)) {
    expect(schema.additionalProperties, `${path} must reject additional properties`).toBe(false);
    expect(Array.isArray(schema.required), `${path} must list required properties`).toBe(true);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    expect([...((schema.required as readonly string[] | undefined) ?? [])].sort()).toEqual(
      Object.keys(properties).sort(),
    );

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      assertNestedStrictObjectSchemas(propertySchema, `${path}.${propertyName}`);
    }
  }
}

function assertNestedStrictObjectSchemas(schema: unknown, path: string) {
  if (!isRecord(schema)) {
    return;
  }

  if (schemaHasObjectType(schema)) {
    assertStrictObjectSchema(schema, path);
  }

  if (schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array"))) {
    assertNestedStrictObjectSchemas(schema.items, `${path}[]`);
  }
}

function schemaHasObjectType(schema: Record<string, unknown>) {
  return schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
