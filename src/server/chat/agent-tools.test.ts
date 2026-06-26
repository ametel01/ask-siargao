import { describe, expect, test } from "bun:test";

import {
  agentToolDefinitions,
  describeAvailableTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";
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
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
      },
    ]);
    expect(agentToolDefinitions.map((tool) => tool.name)).not.toContain("describe_available_tools");
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
    expect(result.sources.map((source) => source.label)).toEqual([
      "live_checked",
      "fresh_cache",
      "curated_local_guide",
      "weather_checked",
      "not_verified",
      "provider_unavailable",
    ]);
    expect(result.sources[0]?.checked.join(" ")).toContain("allowed live place identity");
    expect(result.sources[0]?.notChecked.join(" ")).toContain("review text");
    const data = result.data as { policies: Array<{ label: string }> };
    expect(data.policies[0]?.label).toBe("live_checked");
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
