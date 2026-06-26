import { describe, expect, test } from "bun:test";

import type { AgentMemorySnapshot } from "@/server/chat/agent-memory";
import {
  agentToolDefinitions,
  buildAgentResponseTools,
  describeAvailableTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
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
              type: "object",
              properties: {
                included_type: {
                  type: "string",
                  description: "Optional Google Places primary type such as restaurant or cafe.",
                },
                open_now: {
                  type: "boolean",
                  description: "Whether live opening status is needed.",
                },
                page_size: {
                  type: "integer",
                  minimum: 1,
                  maximum: 10,
                  description: "Maximum number of places to return.",
                },
              },
              additionalProperties: false,
            },
          },
          required: ["query", "center", "radius_meters"],
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
              type: "object",
              properties: {
                beach_surface: {
                  type: "string",
                  enum: ["sand", "mixed", "rocky", "any"],
                  description: "Preferred beach surface.",
                },
                swimming: {
                  type: "boolean",
                  description: "Whether swimming fit should be prioritized.",
                },
                sunset: {
                  type: "boolean",
                  description: "Whether sunset or late-afternoon fit should be prioritized.",
                },
                rain_fit: {
                  type: "boolean",
                  description: "Whether bad-weather or short-ride fit should be prioritized.",
                },
                max_ride_minutes: {
                  type: "integer",
                  minimum: 1,
                  maximum: 180,
                  description: "Maximum ride time from the General Luna side.",
                },
                transport_mode: {
                  type: "string",
                  enum: ["walk", "scooter", "tricycle", "van"],
                  description: "Traveler transport constraint.",
                },
                with_kids: {
                  type: "boolean",
                  description: "Whether the traveler is with kids.",
                },
              },
              additionalProperties: false,
            },
          },
          required: ["query"],
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
          additionalProperties: false,
        },
        strict: true,
      },
    ]);
  });

  test("describes available tools without exposing the helper as model-callable", () => {
    expect(describeAvailableTools()).toEqual([
      {
        name: "get_weather_forecast",
        description:
          "Get the governed Open-Meteo weather forecast snapshot for a known Siargao location.",
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
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
      },
    ]);
    expect(agentToolDefinitions.map((tool) => tool.name)).not.toContain("describe_available_tools");
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
    expect(data.place).not.toHaveProperty("reviews");
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
      name: "query_local_facts",
      arguments: {},
    });

    expect(result).toMatchObject({
      name: "query_local_facts",
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
