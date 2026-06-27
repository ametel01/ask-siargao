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
        name: "get_condition_judgment",
        description:
          "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, curated local caveats, and explicit unchecked tide, surf, road, current, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
        parameters: conditionJudgmentToolParameters,
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
          "Query approved local Siargao facts with structured filters only; no SQL, private data, or raw provider payloads.",
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
        name: "get_condition_judgment",
        description:
          "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, curated local caveats, and explicit unchecked tide, surf, road, current, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
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
          "Query approved local Siargao facts with structured filters only; no SQL, private data, or raw provider payloads.",
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
    expect(itineraryResult.status).toBe("success");
    expect(conditionResult.status).toBe("success");
    expect(localFactsResult.status).toBe("success");
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
    expect(result.text).toContain("Field mask");
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
    expect(result.cards?.[0]?.fitReasons.join(" ")).toContain("Google rating 4.6");
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("review text");
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
        center: browserCenter,
      },
    });
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
    expect(result.text).toContain("PERMISSION_DENIED");
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
    expect(result.cards?.[0]?.fitReasons).toContain("Google Places returned an open-now signal.");
    expect(result.cards?.[0]?.fitReasons).toContain("Google rating 4.7 from 321 ratings");
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
    expect(result.text).toContain("PERMISSION_DENIED");
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
    expect(result.cards?.[0]?.caveats.join(" ")).toContain("lifeguard or swimming safety");
    expect(result.text).not.toContain("lifeguard checked");
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
      },
    );

    expect(result.status).toBe("success");
    expect(result.text).toContain("Condition judgment for swimming at Malinao Beach");
    expect(result.text).toContain("tide not_checked");
    expect(result.sources.map((source) => source.label)).toEqual([
      "weather_checked",
      "not_verified",
      "curated_local_guide",
    ]);
    const data = result.data as {
      judgment: {
        recommendation: string;
        signals: Array<{ kind: string; status: string }>;
      };
    };
    expect(data.judgment.recommendation).toBe("flexible");
    expect(data.judgment.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "weather", status: "checked" }),
        expect.objectContaining({ kind: "tide", status: "not_checked" }),
        expect.objectContaining({ kind: "surf", status: "not_checked" }),
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
    };
    expect(data.judgment.recommendation).toBe("needs_local_confirmation");
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
    expect(result.text).toContain("curated_local_guide");
    expect(result.text).toContain("weather_checked");
    expect(result.text).toContain("not_verified");
    expect(result.text).toContain("provider_unavailable");
    expect(result.text).toContain("Never label generic model reasoning as live checked");
    expect(result.sources).toEqual([]);
    const data = result.data as { policies: Array<{ label: string }> };
    expect(data.policies[0]?.label).toBe("live_checked");
  });

  test("builds file search tools when a vector store is configured", () => {
    const tools = buildAgentResponseTools(memorySnapshotFixture(), {
      vectorStoreId: "vs_memory",
    });

    expect(tools).toContainEqual({
      type: "file_search",
      vector_store_ids: ["vs_memory"],
      max_num_results: 5,
    });
    expect(tools).not.toContainEqual(expect.objectContaining({ name: "search_agent_memory" }));
  });

  test("builds backend memory fallback when no vector store is configured", () => {
    const tools = buildAgentResponseTools(memorySnapshotFixture());

    expect(tools).toContainEqual(
      expect.objectContaining({
        type: "function",
        name: "search_agent_memory",
      }),
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
    files: [
      {
        id: "ask_siargao_agent_skills",
        title: "Ask Siargao Agent Skills",
        fileName: "ASK_SIARGAO_AGENT_SKILLS.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md",
        role: "instruction",
        checksum: "a".repeat(64),
        byteLength: 20,
        content: "Instruction content.",
      },
      dataDictionary,
      sourcePolicy,
    ],
    instructionMarkdown: "Instruction content.",
    referenceFiles: [dataDictionary, sourcePolicy],
  };
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
      "It does not include review text, bookings, table availability, room availability, or verified local quality checks.",
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
