import { z } from "zod";

import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { optionalNullable } from "@/server/chat/agent-tool-utils";
import { localItineraryRequestSchema, localItineraryThemes } from "@/server/chat/itinerary-tools";
import {
  describeDatabaseSchemaArgumentsSchema,
  localFactsMaxLimit,
  localFactsQuerySchema,
  sourceEvidenceArgumentsSchema,
} from "@/server/chat/local-data-tools";

const searchLocalGuideSchema = z.strictObject({
  query: z.string().trim().min(2).max(240),
  filters: optionalNullable(
    z.strictObject({
      beach_surface: optionalNullable(z.enum(["sand", "mixed", "rocky", "any"])),
      origin_area: optionalNullable(z.string().trim().min(2).max(80)),
      swimming: optionalNullable(z.boolean()),
      sunset: optionalNullable(z.boolean()),
      rain_fit: optionalNullable(z.boolean()),
      max_ride_minutes: optionalNullable(z.number().int().min(1).max(180)),
      transport_mode: optionalNullable(z.enum(["walk", "scooter", "tricycle", "van"])),
      with_kids: optionalNullable(z.boolean()),
    }),
  ),
});
const rankSurfSpotsNearbySchema = z.strictObject({
  skill_level: z.enum(["beginner", "intermediate", "advanced", "any"]).nullable(),
  max_results: z.number().int().min(1).max(10).nullable(),
  include_boat_access: z.boolean().nullable(),
});

export type SearchLocalGuideArguments = z.infer<typeof searchLocalGuideSchema>;
export type RankSurfSpotsNearbyArguments = z.infer<typeof rankSurfSpotsNearbySchema>;
export type LocalItineraryArguments = z.infer<typeof localItineraryRequestSchema>;
export type DescribeDatabaseSchemaArguments = z.infer<typeof describeDatabaseSchemaArgumentsSchema>;
export type QueryLocalFactsArguments = z.infer<typeof localFactsQuerySchema>;
export type SourceEvidenceArguments = z.infer<typeof sourceEvidenceArgumentsSchema>;

export type LocalToolHandlers = {
  searchLocalGuide: ToolHandler<SearchLocalGuideArguments>;
  rankSurfSpotsNearby: ToolHandler<RankSurfSpotsNearbyArguments>;
  planLocalItinerary: ToolHandler<LocalItineraryArguments>;
  describeDatabaseSchema: ToolHandler<DescribeDatabaseSchemaArguments>;
  queryLocalFacts: ToolHandler<QueryLocalFactsArguments>;
  getSourceEvidence: ToolHandler<SourceEvidenceArguments>;
};

export function createLocalToolFamily(handlers: LocalToolHandlers): AgentToolFamily {
  return {
    id: "local_knowledge",
    toolNames: [
      "search_local_guide",
      "rank_surf_spots_nearby",
      "plan_local_itinerary",
      "describe_database_schema",
      "query_local_facts",
      "get_source_evidence",
    ],
    tools: {
      search_local_guide: defineTool({
        definition: {
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
        schema: searchLocalGuideSchema,
        execute: handlers.searchLocalGuide,
      }),
      rank_surf_spots_nearby: defineTool({
        definition: {
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
        schema: rankSurfSpotsNearbySchema,
        execute: handlers.rankSurfSpotsNearby,
      }),
      plan_local_itinerary: defineTool({
        definition: {
          type: "function",
          name: "plan_local_itinerary",
          description:
            "Build a governed structured Siargao itinerary artifact or review a traveler-supplied itinerary for practical conflicts. Reviews accept at most seven days and seven total stops, preserve non-live estimate caveats, and return a concrete revision. The AI must use the returned plan as evidence and write the final answer itself.",
          parameters: {
            type: "object",
            properties: {
              theme: {
                type: "string",
                enum: localItineraryThemes,
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
              review_days: {
                type: ["array", "null"],
                maxItems: 7,
                items: {
                  type: "object",
                  properties: {
                    day_label: {
                      type: "string",
                      description: "Short traveler-supplied day label, such as Day 1.",
                    },
                    stops: {
                      type: "array",
                      minItems: 1,
                      maxItems: 7,
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          area: { type: "string" },
                          kind: {
                            type: "string",
                            enum: ["place", "beach", "activity", "meal", "transfer"],
                          },
                          time: {
                            type: ["string", "null"],
                            pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
                          },
                          duration_minutes: {
                            type: ["integer", "null"],
                            minimum: 15,
                            maximum: 720,
                          },
                          weather_sensitive: { type: ["boolean", "null"] },
                        },
                        required: [
                          "title",
                          "area",
                          "kind",
                          "time",
                          "duration_minutes",
                          "weather_sensitive",
                        ],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["day_label", "stops"],
                  additionalProperties: false,
                },
                description:
                  "Traveler-supplied days and stops for itinerary_review; null for theme planning.",
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
              "review_days",
            ],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: localItineraryRequestSchema,
        execute: handlers.planLocalItinerary,
      }),
      describe_database_schema: defineTool({
        definition: {
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
        schema: describeDatabaseSchemaArgumentsSchema,
        execute: handlers.describeDatabaseSchema,
      }),
      query_local_facts: defineTool({
        definition: {
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
                description:
                  "Optional tags such as sandy, swimming, rain-fit, sunset, or transport.",
              },
              text: {
                type: ["string", "null"],
                description: "Optional text filter matched against names and claims.",
              },
              limit: {
                type: ["integer", "null"],
                minimum: 1,
                maximum: localFactsMaxLimit,
                description: "Maximum number of local facts to return.",
              },
            },
            required: ["entityTypes", "area", "tags", "text", "limit"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: localFactsQuerySchema,
        execute: handlers.queryLocalFacts,
      }),
      get_source_evidence: defineTool({
        definition: {
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
        schema: sourceEvidenceArgumentsSchema,
        execute: handlers.getSourceEvidence,
      }),
    },
  };
}
