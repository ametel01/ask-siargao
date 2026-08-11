import { z } from "zod";

import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import {
  conditionJudgmentRequestSchema,
  conditionJudgmentToolParameters,
} from "@/server/chat/condition-tools";

const weatherForecastLocations = [
  "Siargao Island",
  "Cloud 9",
  "General Luna",
  "Del Carmen",
] as const;
const marineConditionsLocations = weatherForecastLocations;
const tideForecastLocations = ["Siargao Island", "Cloud 9", "General Luna", "Dapa"] as const;

const weatherForecastSchema = z.strictObject({
  location: z.enum(weatherForecastLocations),
  date_range: z.enum(["today", "next_7_days"]),
});
const marineConditionsSchema = z.strictObject({
  location: z.enum(marineConditionsLocations),
  date_range: z.enum(["today", "next_48_hours"]),
});
const tideForecastSchema = z.strictObject({
  location: z.enum(tideForecastLocations),
  date_range: z.enum(["today", "tomorrow", "next_7_days"]),
});

export type WeatherForecastArguments = z.infer<typeof weatherForecastSchema>;
export type MarineConditionsArguments = z.infer<typeof marineConditionsSchema>;
export type TideForecastArguments = z.infer<typeof tideForecastSchema>;
export type ConditionJudgmentArguments = z.infer<typeof conditionJudgmentRequestSchema>;

export type ConditionToolHandlers = {
  getWeatherForecast: ToolHandler<WeatherForecastArguments>;
  getMarineConditions: ToolHandler<MarineConditionsArguments>;
  getTideForecast: ToolHandler<TideForecastArguments>;
  getConditionJudgment: ToolHandler<ConditionJudgmentArguments>;
};

export function createConditionToolFamily(handlers: ConditionToolHandlers): AgentToolFamily {
  return {
    id: "conditions",
    toolNames: [
      "get_weather_forecast",
      "get_marine_conditions",
      "get_tide_forecast",
      "get_condition_judgment",
    ],
    tools: {
      get_weather_forecast: defineTool({
        definition: {
          type: "function",
          name: "get_weather_forecast",
          description:
            "Get the governed Open-Meteo weather forecast snapshot for a known Siargao location.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: weatherForecastLocations,
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
        schema: weatherForecastSchema,
        execute: handlers.getWeatherForecast,
      }),
      get_marine_conditions: defineTool({
        definition: {
          type: "function",
          name: "get_marine_conditions",
          description:
            "Get governed Open-Meteo Marine model data for Siargao tide-proxy sea level, waves, swell, and ocean current. This is not official tide-table, navigation, or safety authority data.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: marineConditionsLocations,
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
        schema: marineConditionsSchema,
        execute: handlers.getMarineConditions,
      }),
      get_tide_forecast: defineTool({
        definition: {
          type: "function",
          name: "get_tide_forecast",
          description:
            "Get Tide-Forecast Dapa predicted tide table data and embedded sea-condition periods for Siargao surf/tide timing during development/testing. This is not an official tide gauge, navigation aid, or safety clearance.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: tideForecastLocations,
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
        schema: tideForecastSchema,
        execute: handlers.getTideForecast,
      }),
      get_condition_judgment: defineTool({
        definition: {
          type: "function",
          name: "get_condition_judgment",
          description:
            "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, checked Tide-Forecast tide/sea-period data when available, checked Open-Meteo Marine model data when available, curated local caveats, and explicit unchecked road, official-warning, lifeguard, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
          parameters: conditionJudgmentToolParameters,
          strict: true,
        },
        schema: conditionJudgmentRequestSchema,
        argumentDefaults: {
          beach_name: null,
          include_local_caveats: null,
          constraints: null,
        },
        execute: handlers.getConditionJudgment,
      }),
    },
  };
}
