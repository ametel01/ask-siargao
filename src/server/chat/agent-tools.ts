import postgres from "postgres";
import { z } from "zod";

import {
  type AgentMemoryReferenceFile,
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
  requiredAgentMemoryManifest,
} from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionContext,
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
  ChatAction,
  ItineraryPlan,
  RecommendationCard,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import {
  buildConditionJudgment,
  type ConditionJudgment,
  conditionJudgmentRequestSchema,
  conditionJudgmentToolParameters,
  type MarineConditionsSnapshot,
  shouldIncludeConditionLocalCaveats,
} from "@/server/chat/condition-tools";
import {
  type LocalItineraryRequest,
  localItineraryRequestSchema,
  localItineraryThemes,
  planLocalItinerary,
  renderLocalItineraryToolText,
} from "@/server/chat/itinerary-tools";
import {
  describeDatabaseSchema,
  describeDatabaseSchemaArgumentsSchema,
  getSourceEvidence,
  type LocalFactsQueryRunner,
  localFactsMaxLimit,
  localFactsQuerySchema,
  queryLocalFacts,
  sourceEvidenceArgumentsSchema,
} from "@/server/chat/local-data-tools";
import {
  type LocalGuideCandidate,
  type LocalGuideSearchResult,
  searchSiargaoLocalGuide,
} from "@/server/local/siargao-beaches";
import {
  parseSurfSpotDistanceAnchors,
  type RankedSurfSpot,
  rankSurfSpotsNearby,
  type SurfSpotSkillLevel,
} from "@/server/local/siargao-surf-spots";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatPlace,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
} from "@/server/providers/google-places-chat";
import { createDefaultCachedGooglePlacesChatContextAdapter } from "@/server/providers/google-places-chat-cache";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  enrichGooglePlacesDetails,
  type GooglePlacesDetails,
  googlePlacesDetailsFieldMask,
} from "@/server/providers/google-places-enrichment";
import {
  findFreshPlaceDetails,
  type GooglePlacesStoreDatabase,
} from "@/server/providers/google-places-store";
import {
  type OpenMeteoForecastLocation,
  siargaoForecastLocations,
} from "@/server/providers/open-meteo";
import {
  buildOpenMeteoMarineIngestionBatch,
  type OpenMeteoMarineIngestionBatch,
  type OpenMeteoMarineLocation,
  siargaoMarineLocations,
} from "@/server/providers/open-meteo-marine";
import {
  buildTideForecastSnapshot,
  type TideForecastDateRange,
  type TideForecastSnapshot,
  tideForecastLocationForSiargaoLabel,
} from "@/server/providers/tide-forecast";
import {
  getLatestSiargaoWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

export type AgentToolDefinition = {
  type: "function";
  name: AskSiargaoAgentToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties: false;
  };
  strict: true;
};

export type AgentHostedToolDefinition = {
  type: "file_search";
  vector_store_ids: readonly string[];
  max_num_results?: number;
};

export type AgentResponseToolDefinition = AgentToolDefinition | AgentHostedToolDefinition;

type ToolHandler<Arguments> = (
  args: Arguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
) => Promise<AgentToolResult> | AgentToolResult;

type RegisteredTool<Arguments> = {
  definition: AgentToolDefinition;
  schema: z.ZodType<Arguments>;
  execute: ToolHandler<Arguments>;
};

type GooglePlacesToolExecutionContext = NonNullable<AgentToolExecutionContext["googlePlaces"]>;

type SourcePolicyDescription = {
  label: AnswerTrustLabel;
  meaning: string;
  useWhen: string;
  caveats: string[];
};

type SourcePolicyToolData = {
  policies: SourcePolicyDescription[];
};

export type AgentToolDependencies = {
  enrichGooglePlacesDetails?: typeof enrichGooglePlacesDetails;
  findFreshPlaceDetails?: typeof findFreshPlaceDetails;
  getGooglePlacesChatContext?: (input: {
    cacheMode?: "standard" | "no_store";
    fetchedAt: string;
    requiresLiveStatus?: boolean;
    search: GooglePlacesChatSearch;
    trace?: { requestId?: string };
  }) => Promise<GooglePlacesChatContext>;
  buildOpenMeteoMarineIngestionBatch?: typeof buildOpenMeteoMarineIngestionBatch;
  buildTideForecastSnapshot?: typeof buildTideForecastSnapshot;
  getLatestSiargaoWeatherSnapshot?: typeof getLatestSiargaoWeatherSnapshot;
  googlePlacesApiKey?: string;
  googlePlacesDetailsDb?: GooglePlacesStoreDatabase;
  googlePlacesFetcher?: (url: string, init: RequestInit) => Promise<Response>;
  localFactsQueryRunner?: LocalFactsQueryRunner;
  localFactsQueryTimeoutMs?: number;
  memorySnapshot?: AgentMemorySnapshot;
  now?: () => Date;
};

type SearchPlacesArguments = z.infer<typeof searchPlacesSchema>;
type PlaceDetailsArguments = z.infer<typeof placeDetailsSchema>;
type SearchLocalGuideArguments = z.infer<typeof searchLocalGuideSchema>;
type RankSurfSpotsNearbyArguments = z.infer<typeof rankSurfSpotsNearbySchema>;
type LocalItineraryArguments = z.infer<typeof localItineraryRequestSchema>;
type SearchAgentMemoryArguments = z.infer<typeof searchAgentMemorySchema>;
type LoadAgentMemoryFileArguments = z.infer<typeof loadAgentMemoryFileSchema>;
type WeatherForecastArguments = z.infer<typeof weatherForecastSchema>;
type MarineConditionsArguments = z.infer<typeof marineConditionsSchema>;
type TideForecastArguments = z.infer<typeof tideForecastSchema>;
type ConditionJudgmentArguments = z.infer<typeof conditionJudgmentRequestSchema>;
type DescribeDatabaseSchemaArguments = z.infer<typeof describeDatabaseSchemaArgumentsSchema>;
type QueryLocalFactsArguments = z.infer<typeof localFactsQuerySchema>;
type SourceEvidenceArguments = z.infer<typeof sourceEvidenceArgumentsSchema>;

const weatherForecastLocations = [
  "Siargao Island",
  "Cloud 9",
  "General Luna",
  "Del Carmen",
] as const;
const marineConditionsLocations = weatherForecastLocations;
const tideForecastLocations = ["Siargao Island", "Cloud 9", "General Luna", "Dapa"] as const;

const defaultLocalFactsQueryTimeoutMs = 2_000;
const describeSourcePolicySchema = z.strictObject({});
const agentMemoryReferenceDocumentNames = requiredAgentMemoryManifest.reduce<string[]>(
  (names, entry) => {
    if (entry.role === "reference") {
      names.push(entry.fileName);
    }
    return names;
  },
  [],
) as [string, ...string[]];
const agentMemoryLoadableDocumentNames = agentMemoryReferenceDocumentNames;
const siargaoCenterSchema = z.strictObject({
  latitude: z.number().min(9.0).max(10.5),
  longitude: z.number().min(125.0).max(127.0),
});
const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());
const searchPlacesSchema = z.strictObject({
  query: z.string().trim().min(2).max(180),
  center: siargaoCenterSchema,
  radius_meters: z.number().int().min(500).max(20_000),
  constraints: optionalNullable(
    z.strictObject({
      included_type: optionalNullable(z.string().trim().min(2).max(60)),
      open_now: optionalNullable(z.boolean()),
      page_size: optionalNullable(z.number().int().min(1).max(10)),
    }),
  ),
});
const placeDetailsSchema = z.strictObject({
  place_id: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .regex(/^[A-Za-z0-9_.:-]+$/),
});
const searchLocalGuideSchema = z.strictObject({
  query: z.string().trim().min(2).max(240),
  filters: optionalNullable(
    z.strictObject({
      beach_surface: optionalNullable(z.enum(["sand", "mixed", "rocky", "any"])),
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
const searchAgentMemorySchema = z.strictObject({
  query: z.string().trim().min(2).max(240),
  documents: optionalNullable(z.array(z.enum(agentMemoryReferenceDocumentNames)).min(1).max(5)),
  max_results: optionalNullable(z.number().int().min(1).max(5)),
});
const loadAgentMemoryFileSchema = z.strictObject({
  documents: z.array(z.enum(agentMemoryLoadableDocumentNames)).min(1).max(3),
});

const sourcePolicyDescriptions: SourcePolicyDescription[] = [
  {
    label: "live_checked",
    meaning: "A live Google Places lookup returned current allowed place fields.",
    useWhen:
      "Use for live Places search/detail outputs with allowed identity, rating, hours, price, contact, and map-link fields.",
    caveats: [
      "Use the result order as a shortlist, not a local quality ranking.",
      "Review text, bookings, table availability, room availability, and local quality checks were not checked.",
    ],
  },
  {
    label: "fresh_cache",
    meaning: "Fresh reusable Google Places cache rows backed the answer.",
    useWhen:
      "Use for cached Places facts that are still inside the configured freshness and retention windows.",
    caveats: [
      "Cached rows can be stale even when they are recent.",
      "Do not imply live open-now status unless that field was present and fresh.",
    ],
  },
  {
    label: "curated_local_guide",
    meaning: "Ask Siargao curated local guide data backed the answer.",
    useWhen: "Use for local beach and trip-planning facts maintained by Ask Siargao.",
    caveats: [
      "Tides, currents, road conditions, access changes, and lifeguard or safety status are not live checked.",
    ],
  },
  {
    label: "weather_checked",
    meaning: "Open-Meteo forecast data backed the weather or activity-planning answer.",
    useWhen: "Use when a usable live or stored Open-Meteo snapshot was available for the request.",
    caveats: [
      "Surf, swell, tides, road flooding, local closures, and provider-independent safety checks are not included.",
    ],
  },
  {
    label: "marine_checked",
    meaning:
      "Open-Meteo Marine model data backed tide-proxy sea level, wave, swell, or current context.",
    useWhen:
      "Use when get_marine_conditions or get_condition_judgment returned usable Open-Meteo Marine model data for the requested Siargao location.",
    caveats: [
      "This is modelled marine forecast data, not an official tide table, tide-gauge reading, navigation aid, or safety authority.",
      "Surf break quality, rip currents, lifeguards, local operator calls, and official marine warnings are not checked.",
    ],
  },
  {
    label: "tide_forecast_checked",
    meaning:
      "Tide-Forecast Dapa page data backed predicted tide times/heights and embedded 3-hour sea-condition timing.",
    useWhen:
      "Use when get_tide_forecast or get_condition_judgment returned usable Tide-Forecast Dapa page data for Siargao tide or surf timing.",
    caveats: [
      "This development/testing integration uses Tide-Forecast page data and production commercial use needs appropriate Tide-Forecast/Meteo365 permission or license.",
      "Dapa is a nearby station proxy for Cloud 9 and General Luna, not an exact break reading or safety clearance.",
      "Official tide-gauge measurements, navigation safety, rip currents, lifeguards, local operator calls, and official marine warnings are not checked.",
    ],
  },
  {
    label: "not_verified",
    meaning:
      "The answer uses generic model reasoning or stable context without a matching live/local tool output.",
    useWhen:
      "Use whenever no backend tool actually checked the specific live, cached, weather, or curated fact.",
    caveats: [
      "Never label generic model reasoning as live checked, fresh cache, weather checked, or curated local guide.",
    ],
  },
  {
    label: "provider_unavailable",
    meaning: "A provider or cache lookup needed for the answer failed or was unavailable.",
    useWhen:
      "Use when Google Places, Open-Meteo, or another backend provider could not return usable data.",
    caveats: [
      "Explain the missing check plainly and avoid fabricating provider-backed facts from model knowledge.",
    ],
  },
];

const registeredTools: Partial<Record<AskSiargaoAgentToolName, RegisteredTool<unknown>>> = {
  get_weather_forecast: {
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
    execute: (args, _request, dependencies) =>
      getWeatherForecastToolResult(args as WeatherForecastArguments, dependencies),
  },
  get_marine_conditions: {
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
    execute: (args, _request, dependencies) =>
      getMarineConditionsToolResult(args as MarineConditionsArguments, dependencies),
  },
  get_tide_forecast: {
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
    execute: (args, _request, dependencies) =>
      getTideForecastToolResult(args as TideForecastArguments, dependencies),
  },
  get_condition_judgment: {
    definition: {
      type: "function",
      name: "get_condition_judgment",
      description:
        "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, checked Tide-Forecast tide/sea-period data when available, checked Open-Meteo Marine model data when available, curated local caveats, and explicit unchecked road, official-warning, lifeguard, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
      parameters: conditionJudgmentToolParameters,
      strict: true,
    },
    schema: conditionJudgmentRequestSchema,
    execute: (args, _request, dependencies) =>
      getConditionJudgmentToolResult(args as ConditionJudgmentArguments, dependencies),
  },
  search_places: {
    definition: {
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
    schema: searchPlacesSchema,
    execute: (args, request, dependencies) =>
      searchPlacesToolResult(args as SearchPlacesArguments, request, dependencies),
  },
  get_place_details: {
    definition: {
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
    schema: placeDetailsSchema,
    execute: (args, _request, dependencies) =>
      getPlaceDetailsToolResult(args as PlaceDetailsArguments, dependencies),
  },
  search_local_guide: {
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
    schema: searchLocalGuideSchema,
    execute: (args) => searchLocalGuideToolResult(args as SearchLocalGuideArguments),
  },
  rank_surf_spots_nearby: {
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
    execute: (args, request, dependencies) =>
      rankSurfSpotsNearbyToolResult(args as RankSurfSpotsNearbyArguments, request, dependencies),
  },
  plan_local_itinerary: {
    definition: {
      type: "function",
      name: "plan_local_itinerary",
      description:
        "Build a governed structured 2-4 hour Siargao itinerary artifact from curated local guide evidence and explicit unchecked caveats. The AI must use the returned plan as evidence and write the final answer itself.",
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
            description: "Traveler origin or assumed start area, such as General Luna or Cloud 9.",
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
    schema: localItineraryRequestSchema,
    execute: (args) => planLocalItineraryToolResult(args as LocalItineraryArguments),
  },
  describe_database_schema: {
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
    execute: (args) => describeDatabaseSchemaToolResult(args as DescribeDatabaseSchemaArguments),
  },
  query_local_facts: {
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
            description: "Optional tags such as sandy, swimming, rain-fit, sunset, or transport.",
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
    execute: (args, _request, dependencies) =>
      queryLocalFactsToolResult(args as QueryLocalFactsArguments, dependencies),
  },
  get_source_evidence: {
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
    execute: (args, _request, dependencies) =>
      getSourceEvidenceToolResult(args as SourceEvidenceArguments, dependencies),
  },
  describe_source_policy: {
    definition: {
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
    schema: describeSourcePolicySchema,
    execute: () => ({
      name: "describe_source_policy",
      status: "success",
      text: renderSourcePolicyText(sourcePolicyDescriptions),
      data: {
        policies: sourcePolicyDescriptions,
      } satisfies SourcePolicyToolData,
      sources: [],
    }),
  },
  search_agent_memory: {
    definition: {
      type: "function",
      name: "search_agent_memory",
      description:
        "Search durable Ask Siargao agent memory references such as the data dictionary, source policy, and local assumptions. This is policy/reference context, not live evidence.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language memory search query.",
          },
          documents: {
            type: ["array", "null"],
            items: {
              type: "string",
              enum: agentMemoryReferenceDocumentNames,
            },
            description: "Optional subset of agent-memory reference documents to search.",
          },
          max_results: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 5,
            description: "Maximum number of reference excerpts to return.",
          },
        },
        required: ["query", "documents", "max_results"],
        additionalProperties: false,
      },
      strict: true,
    },
    schema: searchAgentMemorySchema,
    execute: (args, _request, dependencies) =>
      searchAgentMemoryToolResult(args as SearchAgentMemoryArguments, dependencies),
  },
  load_agent_memory_file: {
    definition: {
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
              enum: agentMemoryLoadableDocumentNames,
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
    schema: loadAgentMemoryFileSchema,
    execute: (args, _request, dependencies) =>
      loadAgentMemoryFileToolResult(args as LoadAgentMemoryFileArguments, dependencies),
  },
};

const defaultFunctionToolNames = [
  "get_weather_forecast",
  "get_marine_conditions",
  "get_tide_forecast",
  "get_condition_judgment",
  "search_places",
  "get_place_details",
  "search_local_guide",
  "rank_surf_spots_nearby",
  "plan_local_itinerary",
  "describe_database_schema",
  "query_local_facts",
  "get_source_evidence",
  "describe_source_policy",
  "load_agent_memory_file",
] as const satisfies readonly AskSiargaoAgentToolName[];

export const agentToolDefinitions = defaultFunctionToolNames.map(
  (name) => registeredTools[name]?.definition as AgentToolDefinition,
);

export function buildAgentResponseTools(
  memorySnapshot: AgentMemorySnapshot,
  options: {
    forceMemoryFallback?: boolean;
    includeMemoryFallbackWithFileSearch?: boolean;
    vectorStoreId?: string;
  } = {},
): AgentResponseToolDefinition[] {
  const tools: AgentResponseToolDefinition[] = defaultFunctionToolNames.map((name) =>
    name === "load_agent_memory_file"
      ? memoryToolDefinitionForSnapshot(name, memorySnapshot)
      : (registeredTools[name]?.definition as AgentToolDefinition),
  );
  const vectorStoreId = options.vectorStoreId ?? process.env.OPENAI_AGENT_MEMORY_VECTOR_STORE_ID;
  if (vectorStoreId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [vectorStoreId],
      max_num_results: 5,
    });
  }

  if (
    !vectorStoreId ||
    options.forceMemoryFallback ||
    options.includeMemoryFallbackWithFileSearch
  ) {
    const memorySearch = memoryToolDefinitionForSnapshot("search_agent_memory", memorySnapshot);
    if (memorySearch) {
      tools.push(memorySearch);
    }
  }

  return tools;
}

export function describeAvailableTools() {
  return agentToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

function searchAgentMemoryToolResult(
  args: SearchAgentMemoryArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const snapshot = dependencies.memorySnapshot ?? loadAgentMemorySnapshot();
  const maxResults = args.max_results ?? 3;
  const selectedDocuments = new Set(args.documents ?? []);
  const referenceFiles =
    selectedDocuments.size > 0
      ? snapshot.referenceFiles.filter((file) => selectedDocuments.has(file.fileName))
      : snapshot.referenceFiles;
  const terms = tokenizeMemoryQuery(args.query);
  const results = referenceFiles
    .flatMap((file) => {
      const score = scoreMemoryFile(file.content, file.title, terms);
      if (score <= 0 && terms.length > 0) {
        return [];
      }
      return [
        {
          fileName: file.fileName,
          title: file.title,
          excerpt: findMemoryExcerpt(file.content, terms),
          score,
        },
      ];
    })
    .sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName))
    .slice(0, maxResults);

  return {
    name: "search_agent_memory",
    status: "success",
    text:
      results.length > 0
        ? renderAgentMemorySearchText(results)
        : "No Ask Siargao agent memory reference matched the query.",
    data: {
      status: "available",
      memoryVersionId: snapshot.versionId,
      results,
      caveat: "Agent memory retrieval is policy/reference context only and is not live evidence.",
    },
    sources: [],
  };
}

function loadAgentMemoryFileToolResult(
  args: LoadAgentMemoryFileArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const snapshot = dependencies.memorySnapshot ?? loadAgentMemorySnapshot();
  const selectedDocuments = new Set(args.documents);
  const files = snapshot.referenceFiles.filter((file) => selectedDocuments.has(file.fileName));
  const missingDocuments = args.documents.filter(
    (fileName) => !files.some((file) => file.fileName === fileName),
  );

  return {
    name: "load_agent_memory_file",
    status: missingDocuments.length > 0 ? "error" : "success",
    text:
      missingDocuments.length > 0
        ? `Ask Siargao agent memory file(s) were not available: ${missingDocuments.join(", ")}.`
        : renderLoadedAgentMemoryFilesText(files),
    ...(missingDocuments.length > 0 ? { errorCode: "not_found" } : {}),
    data: {
      status: missingDocuments.length > 0 ? "missing" : "available",
      memoryVersionId: snapshot.versionId,
      loadedMemoryFileNames: files.map((file) => file.fileName),
      files: files.map((file) => ({
        fileName: file.fileName,
        title: file.title,
        role: file.role,
        content: file.content,
      })),
      caveat: "Agent memory retrieval is policy/reference context only and is not live evidence.",
    },
    sources: [],
  };
}

function memoryToolDefinitionForSnapshot(
  name: "load_agent_memory_file" | "search_agent_memory",
  memorySnapshot: AgentMemorySnapshot,
): AgentToolDefinition {
  const definition = registeredTools[name]?.definition as AgentToolDefinition;
  const documentNames = memoryReferenceDocumentNames(memorySnapshot);
  if (name === "search_agent_memory") {
    const documentsProperty = definition.parameters.properties.documents;
    const documentsPropertyRecord = isRecord(documentsProperty) ? documentsProperty : {};
    const items = isRecord(documentsPropertyRecord.items) ? documentsPropertyRecord.items : {};
    return {
      ...definition,
      parameters: {
        ...definition.parameters,
        properties: {
          ...definition.parameters.properties,
          documents: {
            ...documentsPropertyRecord,
            items: {
              ...items,
              enum: documentNames,
            },
          },
        },
      },
    };
  }

  const documentsProperty = definition.parameters.properties.documents;
  const documentsPropertyRecord = isRecord(documentsProperty) ? documentsProperty : {};
  const items = isRecord(documentsPropertyRecord.items) ? documentsPropertyRecord.items : {};
  return {
    ...definition,
    parameters: {
      ...definition.parameters,
      properties: {
        ...definition.parameters.properties,
        documents: {
          ...documentsPropertyRecord,
          items: {
            ...items,
            enum: documentNames,
          },
        },
      },
    },
  };
}

function memoryReferenceDocumentNames(memorySnapshot: AgentMemorySnapshot) {
  const names = memorySnapshot.referenceFiles.map((file) => file.fileName);
  return names.length > 0 ? names : agentMemoryReferenceDocumentNames;
}

function renderLoadedAgentMemoryFilesText(files: readonly AgentMemoryReferenceFile[]) {
  return [
    `Loaded Ask Siargao agent memory file(s): ${files.map((file) => file.fileName).join(", ")}.`,
    ...files.map((file) => `\n# ${file.fileName}\n${file.content.trim()}`),
    "Memory retrieval is policy/reference context only, not live evidence.",
  ].join("\n");
}

export async function executeAgentTool(
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies = {},
): Promise<AgentToolResult> {
  const tool = registeredTools[request.name as AskSiargaoAgentToolName];
  if (!tool) {
    return {
      name: request.name,
      status: "error",
      text: `Unknown Ask Siargao agent tool: ${request.name}.`,
      errorCode: "unknown_tool",
      sources: [],
    };
  }

  const parsed = tool.schema.safeParse(toolArgumentsForValidation(request));
  if (!parsed.success) {
    return {
      name: request.name,
      status: "error",
      text: `Invalid arguments for ${request.name}: ${parsed.error.issues
        .map((issue: { message: string }) => issue.message)
        .join("; ")}`,
      errorCode: "invalid_tool_arguments",
      sources: [],
    };
  }

  try {
    return await tool.execute(parsed.data, request, dependencies);
  } catch (error) {
    return {
      name: request.name,
      status: "error",
      text:
        error instanceof Error ? error.message : `${request.name} failed with an unknown error.`,
      errorCode: "tool_execution_failed",
      sources: [],
    };
  }
}

function toolArgumentsForValidation(request: AgentToolExecutionRequest) {
  if (request.name !== "search_places" || !isRecord(request.arguments)) {
    return request.arguments;
  }

  const placesToolContext = normalizeGooglePlacesToolContext(request.toolContext);
  if (!placesToolContext?.center) {
    return request.arguments;
  }

  if ("center" in request.arguments && placesToolContext.centerSource !== "browser_geolocation") {
    return request.arguments;
  }

  return {
    ...request.arguments,
    center: placesToolContext.center,
  };
}

async function searchPlacesToolResult(
  args: SearchPlacesArguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const fetchedAt = currentIso(dependencies);
  const placesToolContext = normalizeGooglePlacesToolContext(request.toolContext);
  const searchCenter = placesToolContext?.center ?? args.center;
  const search: GooglePlacesChatSearch = {
    label: `agent_${slugPart(args.query)}`,
    textQuery: ensureSiargaoQuery(args.query),
    ...(args.constraints?.included_type ? { includedType: args.constraints.included_type } : {}),
    ...(args.constraints?.open_now ? { openNow: true } : {}),
    center: searchCenter,
    radiusMeters: args.radius_meters,
    pageSize: args.constraints?.page_size ?? 8,
  };
  const centerSource = placesToolContext?.centerSource ?? "model_supplied";

  try {
    const context = enforceRequiredOpenNowContext(
      await getGooglePlacesSearchContext(
        {
          cacheMode: placesToolContext?.cacheMode ?? "standard",
          fetchedAt,
          requiresLiveStatus: args.constraints?.open_now,
          search,
          trace: { requestId: request.requestId },
        },
        dependencies,
      ),
      {
        requiresOpenNow: args.constraints?.open_now === true,
      },
    );
    const contextWithCenterCaveats = withGooglePlacesCenterCaveats(context, placesToolContext);
    const sourceSummary = googlePlacesSearchSourceSummary(context, placesToolContext);
    const cards = googlePlacesSearchCards(contextWithCenterCaveats, sourceSummary);
    const actions = googlePlacesPromptActions(cards, contextWithCenterCaveats.search.textQuery);
    return {
      name: "search_places",
      status: "success",
      text: renderGooglePlacesSearchText(contextWithCenterCaveats),
      data: normalizeGooglePlacesSearchContext(contextWithCenterCaveats, {
        centerSource,
        consentScope: placesToolContext?.consentScope,
      }),
      sources: [sourceSummary],
      ...(cards.length ? { cards } : {}),
      ...(actions.length ? { actions } : {}),
    };
  } catch (error) {
    return {
      name: "search_places",
      status: "error",
      text:
        error instanceof Error
          ? `Google Places search failed: ${error.message}`
          : "Google Places search failed.",
      errorCode: "provider_unavailable",
      sources: [googlePlacesProviderUnavailableSourceSummary("Google Places search lookup")],
    };
  }
}

function normalizeGooglePlacesToolContext(toolContext: AgentToolExecutionContext | undefined) {
  const googlePlaces = toolContext?.googlePlaces;
  if (!googlePlaces) {
    return undefined;
  }

  return {
    center: googlePlaces.center,
    centerSource: googlePlaces.centerSource,
    cacheMode: googlePlaces.cacheMode,
    consentScope: googlePlaces.consentScope,
  };
}

function withGooglePlacesCenterCaveats(
  context: GooglePlacesChatContext,
  toolContext: ReturnType<typeof normalizeGooglePlacesToolContext>,
): GooglePlacesChatContext {
  if (toolContext?.centerSource !== "browser_geolocation") {
    return context;
  }

  return {
    ...context,
    caveats: [
      ...context.caveats,
      "Search center came from consented browser geolocation; exact coordinates are not displayed.",
    ],
  };
}

function enforceRequiredOpenNowContext(
  context: GooglePlacesChatContext,
  { requiresOpenNow }: { requiresOpenNow: boolean },
): GooglePlacesChatContext {
  if (!requiresOpenNow) {
    return context;
  }

  const openPlaces = context.places.filter((place) => place.currentOpeningHours?.openNow === true);
  return {
    ...context,
    status: openPlaces.length > 0 ? "available" : "no_results",
    places: openPlaces,
    caveats:
      openPlaces.length === context.places.length
        ? context.caveats
        : [
            ...context.caveats,
            "Open-now filtering removed places that Google did not report as currently open.",
          ],
  };
}

async function getPlaceDetailsToolResult(
  args: PlaceDetailsArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const now = currentIso(dependencies);
  const cached = await findCachedPlaceDetails(args.place_id, now, dependencies);
  if (cached) {
    const details = normalizeCachedPlaceDetails(cached);
    const sourceSummary = googlePlacesDetailsSourceSummary("fresh_cache", details);
    const cards = googlePlacesDetailsCards(details, sourceSummary);
    const actions = googlePlacesPromptActions(cards, details.displayName);
    return {
      name: "get_place_details",
      status: "success",
      text: renderGooglePlacesDetailsText(details, "fresh_cache"),
      data: {
        status: "available",
        freshness: "fresh_cache",
        fieldMask: googlePlacesDetailsFieldMask,
        place: details,
        caveats: googlePlacesCaveats,
      },
      sources: [sourceSummary],
      ...(cards.length ? { cards } : {}),
      ...(actions.length ? { actions } : {}),
    };
  }

  try {
    const details = await getLivePlaceDetails(args.place_id, now, dependencies);
    const detail = details[0];
    if (!detail) {
      return {
        name: "get_place_details",
        status: "error",
        text: `Google Places details did not return a place for ${args.place_id}.`,
        errorCode: "not_found",
        sources: [googlePlacesNotVerifiedSourceSummary("Google Places details result")],
      };
    }

    const sourceSummary = googlePlacesDetailsSourceSummary("live", detail);
    const cards = googlePlacesDetailsCards(detail, sourceSummary);
    const actions = googlePlacesPromptActions(cards, detail.displayName);
    return {
      name: "get_place_details",
      status: "success",
      text: renderGooglePlacesDetailsText(detail, "live"),
      data: {
        status: "available",
        freshness: "live",
        fieldMask: googlePlacesDetailsFieldMask,
        place: detail,
        caveats: googlePlacesDetailsCaveats,
      },
      sources: [sourceSummary],
      ...(cards.length ? { cards } : {}),
      ...(actions.length ? { actions } : {}),
    };
  } catch (error) {
    return {
      name: "get_place_details",
      status: "error",
      text:
        error instanceof Error
          ? `Google Places details lookup failed: ${error.message}`
          : "Google Places details lookup failed.",
      errorCode: "provider_unavailable",
      sources: [googlePlacesProviderUnavailableSourceSummary("Google Places details lookup")],
    };
  }
}

function searchLocalGuideToolResult(args: SearchLocalGuideArguments): AgentToolResult {
  const result = searchSiargaoLocalGuide({
    query: args.query,
    filters: {
      ...(args.filters?.beach_surface ? { beachSurface: args.filters.beach_surface } : {}),
      ...(args.filters?.swimming !== undefined ? { swimming: args.filters.swimming } : {}),
      ...(args.filters?.sunset !== undefined ? { sunset: args.filters.sunset } : {}),
      ...(args.filters?.rain_fit !== undefined ? { rainFit: args.filters.rain_fit } : {}),
      ...(args.filters?.max_ride_minutes ? { maxRideMinutes: args.filters.max_ride_minutes } : {}),
      ...(args.filters?.transport_mode ? { transportMode: args.filters.transport_mode } : {}),
      ...(args.filters?.with_kids !== undefined ? { withKids: args.filters.with_kids } : {}),
    },
  });

  const cards = localGuideRecommendationCards(result);
  const actions = localGuidePromptActions(cards, result.query);
  return {
    name: "search_local_guide",
    status: "success",
    text: renderLocalGuideText(result),
    data: normalizeLocalGuideSearchResult(result),
    sources: [result.sourceSummary],
    ...(cards.length ? { cards } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

function rankSurfSpotsNearbyToolResult(
  args: RankSurfSpotsNearbyArguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const context = request.toolContext?.surfSpotRanking;
  if (!context?.center) {
    return {
      name: "rank_surf_spots_nearby",
      status: "error",
      text: "Browser geolocation is required to rank the closest surf spots, but no consented location was available to this tool.",
      errorCode: "browser_geolocation_unavailable",
      sources: [surfSpotRankingUnavailableSourceSummary()],
    };
  }

  const anchors = loadSurfSpotDistanceAnchors(dependencies);
  if (anchors.length === 0) {
    return {
      name: "rank_surf_spots_nearby",
      status: "error",
      text: "SURF.md did not contain machine-readable surf spot distance anchors.",
      errorCode: "surf_spot_anchors_unavailable",
      sources: [surfSpotRankingUnavailableSourceSummary()],
    };
  }

  const spots = rankSurfSpotsNearby({
    center: context.center,
    spots: anchors,
    skillLevel: args.skill_level ?? "any",
    maxResults: args.max_results ?? undefined,
    includeBoatAccess: args.include_boat_access ?? false,
  });
  const sourceSummary = surfSpotRankingSourceSummary(spots);
  return {
    name: "rank_surf_spots_nearby",
    status: "success",
    text: renderRankedSurfSpotsText(spots, args.skill_level ?? "any"),
    data: {
      status: "available",
      centerSource: "browser_geolocation",
      ...(context.consentScope ? { consentScope: context.consentScope } : {}),
      distanceBasis: "straight_line_km",
      skillLevel: args.skill_level ?? "any",
      includeBoatAccess: args.include_boat_access ?? false,
      spots,
      caveats: surfSpotRankingCaveats,
    },
    sources: [sourceSummary],
  };
}

function planLocalItineraryToolResult(args: LocalItineraryRequest): AgentToolResult {
  const result = planLocalItinerary(args);
  const actions = itineraryPromptActions(result.plan);
  return {
    name: "plan_local_itinerary",
    status: "success",
    text: renderLocalItineraryToolText(result),
    data: {
      status: "available",
      request: result.request,
      constraints: result.constraints,
      localGuide: normalizeLocalGuideSearchResult(result.localGuide),
      plan: result.plan,
      requiredToolChecks: result.requiredToolChecks,
      caveats: result.caveats,
    },
    sources: result.plan.sources,
    itineraries: [result.plan],
    ...(actions.length ? { actions } : {}),
  };
}

function renderRankedSurfSpotsText(
  spots: readonly RankedSurfSpot[],
  skillLevel: SurfSpotSkillLevel,
) {
  if (spots.length === 0) {
    return `No known Siargao surf spots matched the ${skillLevel} skill filter near the shared browser location.`;
  }

  return [
    `Ranked ${spots.length} known Siargao surf spot(s) by straight-line distance from the user's shared browser location.`,
    `Skill filter: ${skillLevel}.`,
    ...spots.map((spot, index) =>
      [
        `${index + 1}. ${spot.name}`,
        spot.area,
        spot.distanceLabel,
        `${spot.access} access`,
        `skill: ${spot.skillLevels.join("/")}`,
        ...spot.caveats,
      ].join(" - "),
    ),
    ...surfSpotRankingCaveats,
  ].join("\n");
}

function loadSurfSpotDistanceAnchors(dependencies: AgentToolDependencies) {
  const snapshot = dependencies.memorySnapshot ?? loadAgentMemorySnapshot();
  const surfMemory = snapshot.referenceFiles.find((file) => file.fileName === "SURF.md");
  return surfMemory ? parseSurfSpotDistanceAnchors(surfMemory.content) : [];
}

function describeDatabaseSchemaToolResult(_args: DescribeDatabaseSchemaArguments): AgentToolResult {
  const schema = describeDatabaseSchema();
  return {
    name: "describe_database_schema",
    status: "success",
    text: renderDatabaseSchemaText(schema),
    data: {
      status: "available",
      schema,
    },
    sources: [],
  };
}

async function queryLocalFactsToolResult(
  args: QueryLocalFactsArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const result = await withLocalFactsQueryRunner(dependencies, (queryRunner) =>
    queryLocalFacts(args, { queryRunner }),
  );
  return {
    name: "query_local_facts",
    status: "success",
    text: renderLocalFactsText(result),
    data: {
      status: "available",
      ...result,
    },
    sources: localFactSourceSummaries(result.facts),
  };
}

async function getSourceEvidenceToolResult(
  args: SourceEvidenceArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const needsDatabaseEvidence = args.factIds.some(
    (factId) => !factId.startsWith("curated_local_guide:"),
  );
  const result = needsDatabaseEvidence
    ? await withLocalFactsQueryRunner(dependencies, (queryRunner) =>
        getSourceEvidence(args, { queryRunner }),
      )
    : await getSourceEvidence(args);
  return {
    name: "get_source_evidence",
    status: "success",
    text: renderSourceEvidenceText(result),
    data: {
      status: "available",
      ...result,
    },
    sources: sourceEvidenceSummaries(result.evidence),
  };
}

function renderLocalGuideText(result: LocalGuideSearchResult) {
  const candidates = result.candidates
    .slice(0, 5)
    .map((candidate, index) =>
      [
        `${index + 1}. ${candidate.name}`,
        candidate.area,
        `${candidate.rideTimeFromGeneralLunaMinutes.min}-${candidate.rideTimeFromGeneralLunaMinutes.max} min from General Luna`,
        `${candidate.surface} surface`,
        candidate.bestFor,
      ]
        .filter(Boolean)
        .join(" - "),
    );
  const exclusions = result.excluded.flatMap((candidate) =>
    candidate.name === "Pacifico Beach" || candidate.name === "Alegria Beach"
      ? [`Excluded: ${candidate.name} - ${candidate.reason}`]
      : [],
  );

  return [
    `Ask Siargao curated local guide results for "${result.query}".`,
    ...candidates,
    ...exclusions,
    ...result.caveats,
  ].join("\n");
}

function localGuideRecommendationCards(result: LocalGuideSearchResult): RecommendationCard[] {
  return result.candidates.slice(0, 4).map((candidate, index) =>
    localGuideRecommendationCard({
      candidate,
      index,
      resultCaveats: result.caveats,
      sourceSummary: result.sourceSummary,
    }),
  );
}

function localGuideRecommendationCard({
  candidate,
  index,
  resultCaveats,
  sourceSummary,
}: {
  candidate: LocalGuideCandidate;
  index: number;
  resultCaveats: readonly string[];
  sourceSummary: AnswerSourceSummary;
}): RecommendationCard {
  const rideTimeLabel = `${candidate.rideTimeFromGeneralLunaMinutes.min}-${candidate.rideTimeFromGeneralLunaMinutes.max} min`;
  return {
    id: `beach_${slugPart(candidate.name).toLowerCase()}`,
    kind: "beach",
    title: candidate.name,
    subtitle: `${candidate.area} - ${rideTimeLabel} estimated ride from General Luna`,
    mapsUrl: localGuideMapSearchUrl(candidate),
    distanceLabel: `Estimated ${rideTimeLabel} ride from General Luna.`,
    fitReasons: uniqueText([
      `Ranked #${index + 1} by Ask Siargao curated guide for this request.`,
      candidate.bestFor,
      ...candidate.fitReasons,
    ]),
    caveats: uniqueText([
      ...candidate.caveats,
      ...resultCaveats,
      localGuideUncheckedCaveat(sourceSummary),
      candidate.sourceNotes,
      "Map link is a Google Maps search, not a live Google Places identity check.",
    ]),
    sourceLabel: cardSourceLabel(sourceSummary),
    sources: [sourceSummary],
  };
}

function localGuideUncheckedCaveat(sourceSummary: AnswerSourceSummary) {
  return sourceSummary.notChecked.length
    ? "Live road, tide, current, beach access, and lifeguard conditions were not checked."
    : undefined;
}

function localGuidePromptActions(
  cards: readonly RecommendationCard[],
  currentContext: string,
): ChatAction[] {
  const selected = cards[0];
  if (!selected) {
    return [];
  }
  const slug = slugPart(selected.id).toLowerCase();
  return [
    {
      id: `beach_weather_${slug}`,
      label: "Check weather first",
      prompt: `Check the weather before going to ${selected.title} for this request: ${currentContext}.`,
    },
    {
      id: `beach_alternatives_${slug}`,
      label: "Ask for alternatives",
      prompt: `Suggest alternatives to ${selected.title} for this request: ${currentContext}.`,
    },
  ];
}

function itineraryPromptActions(plan: ItineraryPlan): ChatAction[] {
  const actions: ChatAction[] = [];
  if (
    plan.sources.some((source) =>
      source.notChecked.some((item) => /weather|forecast|rain/i.test(item)),
    )
  ) {
    actions.push({
      id: `itinerary_weather_${slugPart(plan.title).toLowerCase()}`,
      label: "Check weather",
      prompt: `Check weather before finalizing this itinerary: ${plan.title}.`,
    });
  }
  if (
    plan.stops.some(
      (stop) =>
        stop.kind === "meal" || stop.caveats.some((caveat) => /places|open|hours/i.test(caveat)),
    )
  ) {
    actions.push({
      id: `itinerary_places_${slugPart(plan.title).toLowerCase()}`,
      label: "Find live places",
      prompt: `Find live open place options for this itinerary: ${plan.title}.`,
    });
  }
  return actions;
}

function localGuideMapSearchUrl(candidate: LocalGuideCandidate) {
  const query = `${candidate.name} ${candidate.area} Siargao`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderDatabaseSchemaText(schema: ReturnType<typeof describeDatabaseSchema>) {
  return [
    `Approved local data surfaces: ${schema.publicViews.map((view) => view.name).join(", ")}.`,
    `Default limit: ${schema.defaultLimit}; maximum limit: ${schema.maxLimit}.`,
    "Query rules:",
    ...schema.queryRules.map((rule) => `- ${rule}`),
  ].join("\n");
}

function renderLocalFactsText(result: Awaited<ReturnType<typeof queryLocalFacts>>) {
  if (result.facts.length === 0) {
    return "No safe local facts matched the structured query.";
  }
  return [
    `Safe local fact query returned ${result.facts.length} fact(s).`,
    ...result.facts.map((fact, index) =>
      [
        `${index + 1}. ${fact.name}`,
        fact.entityType,
        fact.area,
        fact.claim,
        `${fact.confidence} confidence`,
        `source: ${fact.source.sourceName} (${fact.source.label})`,
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    ...result.caveats,
  ].join("\n");
}

function renderSourceEvidenceText(result: Awaited<ReturnType<typeof getSourceEvidence>>) {
  if (result.evidence.length === 0) {
    return `No display-safe source evidence found for ${result.factIds.length} fact ID(s).`;
  }
  return [
    `Display-safe source evidence returned for ${result.evidence.length} fact ID(s).`,
    ...result.evidence.map((item, index) =>
      [
        `${index + 1}. ${item.factId}`,
        item.sourceName,
        `${item.confidence} confidence`,
        item.sourceProfileId ? `profile ${item.sourceProfileId}` : undefined,
        item.fetchedAt ? `fetched ${item.fetchedAt}` : undefined,
        item.citationUrl ? `citation ${item.citationUrl}` : undefined,
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    ...(result.missingFactIds.length
      ? [`Missing fact IDs: ${result.missingFactIds.join(", ")}.`]
      : []),
    ...result.caveats,
  ].join("\n");
}

function localFactSourceSummaries(
  facts: Awaited<ReturnType<typeof queryLocalFacts>>["facts"],
): AnswerSourceSummary[] {
  const summaries = new Map<string, AnswerSourceSummary>();
  for (const fact of facts) {
    const { fetchedAt, sourceProfileId } = fact.source;
    const key = [
      fact.source.label,
      fact.source.sourceName,
      sourceProfileId ?? "",
      fetchedAt ?? "",
    ].join("|");
    const existing = summaries.get(key);
    const checkedItem = `${fact.entityType} fact: ${fact.name}`;
    if (existing) {
      summaries.set(key, {
        ...existing,
        checked: uniqueText([...existing.checked, checkedItem]),
        notChecked: uniqueText([...existing.notChecked, ...fact.caveats]),
      });
      continue;
    }
    summaries.set(key, {
      label: fact.source.label,
      sourceName: fact.source.sourceName,
      ...(sourceProfileId ? { sourceProfileId } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      confidence: fact.confidence,
      checked: [checkedItem],
      notChecked: [...fact.caveats],
    });
  }
  return [...summaries.values()];
}

function sourceEvidenceSummaries(
  evidence: Awaited<ReturnType<typeof getSourceEvidence>>["evidence"],
): AnswerSourceSummary[] {
  const summaries = new Map<string, AnswerSourceSummary>();
  for (const item of evidence) {
    const key = [
      item.sourceLabel,
      item.sourceName,
      item.sourceProfileId ?? "",
      item.fetchedAt ?? "",
    ].join("|");
    const existing = summaries.get(key);
    if (existing) {
      summaries.set(key, {
        ...existing,
        checked: uniqueText([...existing.checked, ...item.checked]),
        notChecked: uniqueText([...existing.notChecked, ...item.notChecked, ...item.caveats]),
      });
      continue;
    }
    summaries.set(key, {
      label: item.sourceLabel,
      sourceName: item.sourceName,
      ...(item.sourceProfileId ? { sourceProfileId: item.sourceProfileId } : {}),
      ...(item.fetchedAt ? { fetchedAt: item.fetchedAt } : {}),
      confidence: item.confidence,
      checked: [...item.checked],
      notChecked: uniqueText([...item.notChecked, ...item.caveats]),
    });
  }
  return [...summaries.values()];
}

const surfSpotRankingCaveats = [
  "Distances are straight-line estimates from the shared browser location, not road travel distance or travel time.",
  "Exact break coordinates, live surf quality, tides, currents, access changes, lifeguards, and local warnings were not checked.",
  "For remote, reef, or boat-access waves, check with a local surf school, boatman, or experienced local surfer.",
] as const;

function surfSpotRankingSourceSummary(spots: readonly RankedSurfSpot[]): AnswerSourceSummary {
  return {
    label: "curated_local_guide",
    sourceName: "Ask Siargao surf spot reference",
    confidence: "medium",
    checked: [
      "known surf spot reference list",
      "approximate straight-line distance ranking from shared browser location",
      ...(spots.length ? [`ranked spots: ${spots.map((spot) => spot.name).join(", ")}`] : []),
    ],
    notChecked: [...surfSpotRankingCaveats],
  };
}

function surfSpotRankingUnavailableSourceSummary(): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Browser geolocation",
    confidence: "low",
    checked: [],
    notChecked: ["closest surf spot distance ranking"],
  };
}

async function withLocalFactsQueryRunner<T>(
  dependencies: AgentToolDependencies,
  callback: (queryRunner: LocalFactsQueryRunner | undefined) => Promise<T>,
) {
  const timeoutMs = normalizeLocalFactsQueryTimeoutMs(dependencies.localFactsQueryTimeoutMs);
  if (dependencies.localFactsQueryRunner) {
    return withLocalFactsTimeout(callback(dependencies.localFactsQueryRunner), timeoutMs);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return callback(undefined);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await withLocalFactsTimeout(
      (async () => {
        await sql`select set_config('statement_timeout', ${String(timeoutMs)}, false)`;
        return callback((query, ...params) => sql(query, ...(params as never[])));
      })(),
      timeoutMs,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function normalizeLocalFactsQueryTimeoutMs(timeoutMs: number | undefined) {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return defaultLocalFactsQueryTimeoutMs;
  }
  return Math.min(Math.floor(timeoutMs), 30_000);
}

function withLocalFactsTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Local data query timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function normalizeLocalGuideSearchResult(result: LocalGuideSearchResult) {
  return {
    status: "available",
    query: result.query,
    filters: result.filters,
    candidates: result.candidates,
    excluded: result.excluded,
    caveats: result.caveats,
  };
}

async function getGooglePlacesSearchContext(
  input: {
    cacheMode?: "standard" | "no_store";
    fetchedAt: string;
    requiresLiveStatus?: boolean;
    search: GooglePlacesChatSearch;
    trace?: { requestId?: string };
  },
  dependencies: AgentToolDependencies,
) {
  if (dependencies.getGooglePlacesChatContext) {
    return dependencies.getGooglePlacesChatContext(input);
  }

  if (input.cacheMode === "no_store") {
    return getGooglePlacesChatContext({
      apiKey: dependencies.googlePlacesApiKey,
      fetchedAt: input.fetchedAt,
      fetcher: dependencies.googlePlacesFetcher,
      search: input.search,
      trace: input.trace,
    });
  }

  if (dependencies.googlePlacesApiKey || dependencies.googlePlacesFetcher) {
    return getGooglePlacesChatContext({
      apiKey: dependencies.googlePlacesApiKey,
      fetchedAt: input.fetchedAt,
      fetcher: dependencies.googlePlacesFetcher,
      search: input.search,
      trace: input.trace,
    });
  }

  const cachedAdapter = createDefaultCachedGooglePlacesChatContextAdapter();
  if (cachedAdapter) {
    return cachedAdapter(input);
  }

  return getGooglePlacesChatContext({
    fetchedAt: input.fetchedAt,
    search: input.search,
    trace: input.trace,
  });
}

async function findCachedPlaceDetails(
  placeId: string,
  now: string,
  dependencies: AgentToolDependencies,
) {
  if (dependencies.findFreshPlaceDetails) {
    return dependencies.findFreshPlaceDetails(
      dependencies.googlePlacesDetailsDb ?? inertGooglePlacesStoreDatabase,
      { now, placeId },
    );
  }

  if (dependencies.googlePlacesDetailsDb) {
    return findFreshPlaceDetails(dependencies.googlePlacesDetailsDb, { now, placeId });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await findFreshPlaceDetails(
      {
        async query<T>(query: string, params: unknown[] = []) {
          const rows = await sql.unsafe<T[]>(query, params as never[]);
          return { rows };
        },
      },
      { now, placeId },
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function getLivePlaceDetails(
  placeId: string,
  fetchedAt: string,
  dependencies: AgentToolDependencies,
) {
  const enrich = dependencies.enrichGooglePlacesDetails ?? enrichGooglePlacesDetails;
  return enrich({
    apiKey:
      dependencies.googlePlacesApiKey ??
      process.env.GOOGLE_API_KEY ??
      process.env.GOOGLE_PLACES_API_KEY ??
      "",
    fetchedAt,
    fetcher: dependencies.googlePlacesFetcher,
    placeIds: [placeId],
  });
}

function normalizeGooglePlacesSearchContext(
  context: GooglePlacesChatContext,
  centerContext: {
    centerSource: GooglePlacesToolExecutionContext["centerSource"];
    consentScope?: GooglePlacesToolExecutionContext["consentScope"];
  },
) {
  const search =
    centerContext.centerSource === "browser_geolocation"
      ? {
          ...context.search,
          center: { source: "browser_geolocation" },
        }
      : context.search;

  return {
    status: context.status,
    sourceName: context.sourceName,
    sourceProfileId: context.sourceProfileId,
    fetchedAt: context.fetchedAt,
    freshness: context.freshness,
    search,
    centerSource: centerContext.centerSource,
    ...(centerContext.consentScope ? { consentScope: centerContext.consentScope } : {}),
    fieldMask: context.fieldMask,
    places: context.places.map(normalizeGooglePlacesChatPlace),
    caveats: context.caveats,
  };
}

function normalizeGooglePlacesChatPlace(place: GooglePlacesChatPlace) {
  return {
    placeId: place.placeId,
    resourceName: place.resourceName,
    displayName: place.displayName,
    formattedAddress: place.formattedAddress,
    latitude: place.latitude,
    longitude: place.longitude,
    types: place.types,
    primaryType: place.primaryType,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    currentOpeningHours: place.currentOpeningHours,
    regularOpeningHours: place.regularOpeningHours,
    priceLevel: place.priceLevel,
    priceRange: place.priceRange,
    websiteUri: place.websiteUri,
    internationalPhoneNumber: place.internationalPhoneNumber,
  };
}

function normalizeCachedPlaceDetails(cached: Awaited<ReturnType<typeof findFreshPlaceDetails>>) {
  if (!cached) {
    throw new Error("Cached Google Places detail row is required.");
  }

  const displayName = readLocalizedText(cached.display_name_json) ?? cached.place_id;
  const currentOpeningHours = googlePlacesOpeningHoursFromJson(cached.opening_hours_json);
  const priceRange = googlePlacesPriceRangeFromJson(cached.price_range_json);
  const rating = numberOrUndefined(cached.rating);
  return {
    placeId: cached.place_id,
    resourceName: cached.resource_name ?? `places/${cached.place_id}`,
    displayName,
    formattedAddress: cached.formatted_address ?? undefined,
    latitude: numberOrUndefined(cached.latitude),
    longitude: numberOrUndefined(cached.longitude),
    types: cached.types_json ?? [],
    primaryType: cached.primary_type ?? undefined,
    businessStatus: cached.business_status ?? undefined,
    googleMapsUri: cached.google_maps_uri ?? undefined,
    ...(currentOpeningHours ? { currentOpeningHours } : {}),
    ...(cached.price_level ? { priceLevel: cached.price_level } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(rating === undefined ? {} : { rating }),
    ...(cached.user_rating_count == null ? {} : { userRatingCount: cached.user_rating_count }),
    fetchedAt: cached.fetched_at.toISOString(),
  } satisfies GooglePlacesDetails;
}

function googlePlacesSearchCards(
  context: GooglePlacesChatContext,
  sourceSummary: AnswerSourceSummary,
): RecommendationCard[] {
  if (context.status !== "available" || context.places.length === 0) {
    return [];
  }

  return context.places.slice(0, 4).map((place, index) =>
    googlePlacesCardFromPlace({
      caveats: context.caveats,
      distanceLabel: googlePlacesDistanceLabel(context.search.center, place),
      index,
      place,
      search: context.search,
      sourceSummary,
    }),
  );
}

function googlePlacesDetailsCards(
  details: GooglePlacesDetails,
  sourceSummary: AnswerSourceSummary,
): RecommendationCard[] {
  return [
    googlePlacesCardFromPlace({
      caveats: googlePlacesDetailsCaveats,
      index: 0,
      place: {
        ...details,
        googleMapsUri: details.googleMapsUri ?? "",
      },
      sourceSummary,
    }),
  ];
}

function googlePlacesCardFromPlace({
  caveats,
  distanceLabel,
  index,
  place,
  search,
  sourceSummary,
}: {
  caveats: readonly string[];
  distanceLabel?: string;
  index: number;
  place: Pick<
    GooglePlacesChatPlace,
    | "businessStatus"
    | "currentOpeningHours"
    | "displayName"
    | "formattedAddress"
    | "googleMapsUri"
    | "placeId"
    | "priceLevel"
    | "primaryType"
    | "rating"
    | "types"
    | "userRatingCount"
  >;
  search?: GooglePlacesChatSearch;
  sourceSummary: AnswerSourceSummary;
}): RecommendationCard {
  const mapsUrl = normalizeText(place.googleMapsUri);
  const openStatusLabel = googlePlacesOpenStatusLabel(place.currentOpeningHours?.openNow);
  return {
    id: `place_${slugPart(place.placeId || place.displayName).toLowerCase()}`,
    kind: "place",
    title: place.displayName,
    ...(googlePlacesSubtitle(place) ? { subtitle: googlePlacesSubtitle(place) } : {}),
    ...(mapsUrl ? { mapsUrl } : {}),
    ...(distanceLabel ? { distanceLabel } : {}),
    openStatusLabel,
    fitReasons: googlePlacesFitReasons({ distanceLabel, index, openStatusLabel, place, search }),
    caveats: uniqueText([
      ...caveats,
      ...(place.currentOpeningHours?.openNow === undefined
        ? ["Opening hours were not returned for this place."]
        : []),
    ]),
    sourceLabel: cardSourceLabel(sourceSummary),
    sources: [sourceSummary],
  };
}

function googlePlacesSubtitle(
  place: Pick<
    GooglePlacesChatPlace,
    "formattedAddress" | "priceLevel" | "primaryType" | "rating" | "userRatingCount"
  >,
) {
  return [
    place.primaryType ? humanizeGooglePlaceType(place.primaryType) : undefined,
    place.formattedAddress,
    googlePlacesRatingLabel(place),
    googlePlacesPriceLabel(place.priceLevel),
  ]
    .filter(Boolean)
    .join(" - ");
}

function googlePlacesFitReasons({
  distanceLabel,
  index,
  openStatusLabel,
  place,
  search,
}: {
  distanceLabel?: string;
  index: number;
  openStatusLabel: string;
  place: Pick<
    GooglePlacesChatPlace,
    "currentOpeningHours" | "primaryType" | "rating" | "types" | "userRatingCount"
  >;
  search?: GooglePlacesChatSearch;
}) {
  return uniqueText([
    search ? googlePlacesSearchFitReason(index, search) : undefined,
    search?.includedType && place.types.includes(search.includedType)
      ? `Listed as a ${humanizeGooglePlaceType(search.includedType)}, matching what you asked for.`
      : place.primaryType
        ? `Listed on Google Places as a ${humanizeGooglePlaceType(place.primaryType)}.`
        : undefined,
    googlePlacesDistanceFitReason(distanceLabel),
    place.currentOpeningHours?.openNow === true
      ? "Good practical option right now: Google shows it as open."
      : undefined,
    place.currentOpeningHours?.openNow === false
      ? "Google does not show it as open right now."
      : undefined,
    place.rating === undefined ? undefined : googlePlacesRatingFitReason(place),
    openStatusLabel === "Hours not returned by Google Places." ? openStatusLabel : undefined,
  ]);
}

function googlePlacesSearchFitReason(index: number, search: GooglePlacesChatSearch) {
  if (index === 0) {
    return `A top Google Places match for "${search.textQuery}".`;
  }
  return `Another strong Google Places match for "${search.textQuery}".`;
}

function googlePlacesDistanceFitReason(distanceLabel: string | undefined) {
  if (!distanceLabel) {
    return undefined;
  }
  const normalizedDistance = distanceLabel.replace(/\.$/, "").replace(" from search center", "");
  return `Easy to reach from your search area: ${normalizedDistance.toLowerCase()}.`;
}

function googlePlacesRatingFitReason(
  place: Pick<GooglePlacesChatPlace, "rating" | "userRatingCount">,
) {
  const ratingLabel = googlePlacesRatingLabel(place);
  return ratingLabel?.replace(/^Google rating /, "Well rated on Google: ");
}

function googlePlacesPromptActions(
  cards: readonly RecommendationCard[],
  currentContext: string,
): ChatAction[] {
  const selected = cards[0];
  if (!selected) {
    return [];
  }
  const slug = slugPart(selected.id).toLowerCase();
  return [
    {
      id: `places_alternatives_${slug}`,
      label: "Ask for alternatives",
      prompt: `Suggest alternatives to ${selected.title} for this request: ${currentContext}.`,
    },
    {
      id: `places_plan_${slug}`,
      label: "Make this into a short plan",
      prompt: `Make ${selected.title} into a short Siargao plan for this request: ${currentContext}.`,
    },
  ];
}

function googlePlacesOpenStatusLabel(openNow: boolean | undefined) {
  if (openNow === true) {
    return "Open now according to Google Places.";
  }
  if (openNow === false) {
    return "Not open now according to Google Places.";
  }
  return "Hours not returned by Google Places.";
}

function googlePlacesDistanceLabel(
  center: GooglePlacesChatSearch["center"],
  place: Pick<GooglePlacesChatPlace, "latitude" | "longitude">,
) {
  if (place.latitude === undefined || place.longitude === undefined) {
    return undefined;
  }
  const distanceMeters = haversineDistanceMeters(center, {
    latitude: place.latitude,
    longitude: place.longitude,
  });
  if (distanceMeters < 950) {
    return `About ${Math.max(50, Math.round(distanceMeters / 50) * 50)} m from search center.`;
  }
  return `About ${formatOneDecimal(distanceMeters / 1000)} km from search center.`;
}

function haversineDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function formatOneDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function googlePlacesRatingLabel(place: Pick<GooglePlacesChatPlace, "rating" | "userRatingCount">) {
  if (place.rating === undefined) {
    return undefined;
  }
  return place.userRatingCount === undefined
    ? `Google rating ${place.rating}`
    : `Google rating ${place.rating} from ${place.userRatingCount} ratings`;
}

function googlePlacesPriceLabel(priceLevel: string | undefined) {
  return priceLevel
    ?.replace(/^PRICE_LEVEL_/, "")
    .replaceAll("_", " ")
    .toLowerCase();
}

function cardSourceLabel(summary: AnswerSourceSummary) {
  return `${summary.sourceName} - ${summary.label.replaceAll("_", " ")}`;
}

function humanizeGooglePlaceType(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function normalizeText(value: string | undefined) {
  return value?.replaceAll(/\s+/g, " ").trim() ?? "";
}

function renderGooglePlacesSearchText(context: GooglePlacesChatContext) {
  if (context.status === "no_results" || context.places.length === 0) {
    return `Google Places returned no useful results for "${context.search.textQuery}".`;
  }

  return [
    `Google Places returned ${context.places.length} result(s) for "${context.search.textQuery}".`,
    ...context.places.map((place, index) => {
      const fields = [
        `${index + 1}. ${place.displayName}`,
        place.formattedAddress,
        place.primaryType,
        place.currentOpeningHours?.openNow === undefined
          ? undefined
          : place.currentOpeningHours.openNow
            ? "open now"
            : "not open now",
        place.rating === undefined ? undefined : `rating ${place.rating}`,
        place.googleMapsUri ? `Maps: ${place.googleMapsUri}` : undefined,
      ];
      return fields.filter(Boolean).join(" - ");
    }),
    ...context.caveats,
  ].join("\n");
}

function renderGooglePlacesDetailsText(
  details: GooglePlacesDetails,
  freshness: "fresh_cache" | "live",
) {
  const fields = [
    `Google Places ${freshness === "live" ? "live" : "fresh cached"} details for ${details.displayName}.`,
    details.formattedAddress,
    details.primaryType,
    details.businessStatus,
    details.currentOpeningHours?.openNow === undefined
      ? undefined
      : details.currentOpeningHours.openNow
        ? "open now"
        : "not open now",
    googlePlacesRatingLabel(details),
    googlePlacesPriceLabel(details.priceLevel),
    details.googleMapsUri ? `Maps: ${details.googleMapsUri}` : undefined,
    ...googlePlacesDetailsCaveats,
  ];
  return fields.filter(Boolean).join("\n");
}

function googlePlacesSearchSourceSummary(
  context: GooglePlacesChatContext,
  toolContext?: ReturnType<typeof normalizeGooglePlacesToolContext>,
): AnswerSourceSummary {
  if (context.status === "no_results" || context.places.length === 0) {
    return googlePlacesNotVerifiedSourceSummary("useful Google Places shortlist");
  }

  const label = context.freshness === "fresh_cache" ? "fresh_cache" : "live_checked";
  return {
    label,
    sourceName: context.sourceName,
    sourceProfileId: context.sourceProfileId,
    fetchedAt: context.fetchedAt,
    confidence: label === "live_checked" ? "high" : "medium",
    checked: googlePlacesSearchCheckedFields(context, toolContext),
    notChecked: googlePlacesNotCheckedFields,
  };
}

function googlePlacesDetailsSourceSummary(
  freshness: "fresh_cache" | "live",
  details: GooglePlacesDetails,
): AnswerSourceSummary {
  const label = freshness === "fresh_cache" ? "fresh_cache" : "live_checked";
  return {
    label,
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt: details.fetchedAt,
    confidence: freshness === "live" ? "high" : "medium",
    checked: googlePlacesDetailsCheckedFields(details),
    notChecked: googlePlacesNotCheckedFields,
  };
}

function googlePlacesProviderUnavailableSourceSummary(check: string): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    confidence: "low",
    checked: [],
    notChecked: [check, ...googlePlacesNotCheckedFields],
  };
}

function googlePlacesNotVerifiedSourceSummary(check: string): AnswerSourceSummary {
  return {
    label: "not_verified",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    confidence: "low",
    checked: [],
    notChecked: [check, ...googlePlacesNotCheckedFields],
  };
}

function googlePlacesSearchCheckedFields(
  context: GooglePlacesChatContext,
  toolContext?: ReturnType<typeof normalizeGooglePlacesToolContext>,
) {
  const checked = ["place listings", "addresses", "map links"];
  if (toolContext?.centerSource === "browser_geolocation") {
    checked.push("browser geolocation search center");
  }
  if (context.places.some((place) => place.rating !== undefined)) {
    checked.push("rating signals");
  }
  if (context.places.some((place) => place.currentOpeningHours?.openNow !== undefined)) {
    checked.push("open-now signal");
  }
  if (context.places.some((place) => place.priceLevel || place.priceRange)) {
    checked.push("price signals");
  }
  if (context.places.some((place) => place.websiteUri || place.internationalPhoneNumber)) {
    checked.push("website or phone fields");
  }
  return checked;
}

function googlePlacesDetailsCheckedFields(details: GooglePlacesDetails) {
  const checked = [`identity details for ${details.displayName}`, "map link when returned"];
  if (details.rating !== undefined) {
    checked.push("rating signals");
  }
  if (details.currentOpeningHours?.openNow !== undefined) {
    checked.push("open-now signal");
  }
  if (details.priceLevel || details.priceRange) {
    checked.push("price signals");
  }
  return checked;
}

function ensureSiargaoQuery(query: string) {
  return /\bsiargao\b/i.test(query) ? query : `${query} Siargao`;
}

function currentIso(dependencies: AgentToolDependencies) {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

function readLocalizedText(value: Record<string, unknown> | null) {
  return typeof value?.text === "string" ? value.text : undefined;
}

function numberOrUndefined(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function googlePlacesOpeningHoursFromJson(
  value: unknown,
): GooglePlacesDetails["currentOpeningHours"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const weekdayDescriptions = stringArrayOrUndefined(value.weekdayDescriptions);
  return {
    ...(typeof value.openNow === "boolean" ? { openNow: value.openNow } : {}),
    ...(weekdayDescriptions ? { weekdayDescriptions } : {}),
    ...(typeof value.nextOpenTime === "string" ? { nextOpenTime: value.nextOpenTime } : {}),
    ...(typeof value.nextCloseTime === "string" ? { nextCloseTime: value.nextCloseTime } : {}),
  };
}

function googlePlacesPriceRangeFromJson(value: unknown): GooglePlacesDetails["priceRange"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const startPrice = googlePlacesMoneyFromJson(value.startPrice);
  const endPrice = googlePlacesMoneyFromJson(value.endPrice);
  return {
    ...(startPrice ? { startPrice } : {}),
    ...(endPrice ? { endPrice } : {}),
  };
}

function googlePlacesMoneyFromJson(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(typeof value.currencyCode === "string" ? { currencyCode: value.currencyCode } : {}),
    ...(typeof value.units === "string" ? { units: value.units } : {}),
    ...(typeof value.nanos === "number" ? { nanos: value.nanos } : {}),
  };
}

function stringArrayOrUndefined(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

const googlePlacesCaveats = [
  "Review text was not checked.",
  "Bookings, table availability, room availability, and independent local quality checks were not checked.",
];

const googlePlacesDetailsCaveats = [
  "Google Places details can confirm identity, address, map links, ratings, and opening-hour signals when returned.",
  ...googlePlacesCaveats,
];

const googlePlacesNotCheckedFields = [
  "review text",
  "bookings",
  "table availability",
  "room availability",
  "independent local quality checks",
];

const inertGooglePlacesStoreDatabase: GooglePlacesStoreDatabase = {
  async query() {
    return { rows: [] };
  },
};

async function getWeatherForecastToolResult(
  args: WeatherForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const getSnapshot =
    dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;

  try {
    const location = weatherForecastLocationForLabel(args.location);
    const snapshot = await getSnapshot(location ? { location } : {});
    const sourceSummary = weatherForecastSourceSummary(snapshot);
    return {
      name: "get_weather_forecast",
      status: snapshot.status === "live" ? "success" : "error",
      text: renderWeatherForecastText(snapshot, args),
      ...(snapshot.status === "live" ? {} : { errorCode: "provider_unavailable" }),
      data: normalizeWeatherSnapshot(snapshot, args),
      sources: [sourceSummary],
    };
  } catch (error) {
    return {
      name: "get_weather_forecast",
      status: "error",
      text:
        error instanceof Error
          ? `Open-Meteo weather forecast lookup failed: ${error.message}`
          : "Open-Meteo weather forecast lookup failed.",
      errorCode: "provider_unavailable",
      sources: [weatherProviderUnavailableSourceSummary(args.location)],
    };
  }
}

async function getMarineConditionsToolResult(
  args: MarineConditionsArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  try {
    const snapshot = await getMarineConditionsSnapshot(args, dependencies);
    const sourceSummary = marineConditionsSourceSummary(snapshot);
    return {
      name: "get_marine_conditions",
      status: "success",
      text: renderMarineConditionsText(snapshot, args),
      data: normalizeMarineConditionsSnapshot(snapshot, args),
      sources: [sourceSummary],
    };
  } catch (error) {
    return {
      name: "get_marine_conditions",
      status: "error",
      text:
        error instanceof Error
          ? `Open-Meteo Marine conditions lookup failed: ${error.message}`
          : "Open-Meteo Marine conditions lookup failed.",
      errorCode: "provider_unavailable",
      sources: [marineProviderUnavailableSourceSummary(args.location)],
    };
  }
}

async function getTideForecastToolResult(
  args: TideForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  try {
    const snapshot = await getTideForecastSnapshot(args, dependencies);
    const sourceSummary = tideForecastSourceSummary(snapshot);
    return {
      name: "get_tide_forecast",
      status: "success",
      text: renderTideForecastText(snapshot),
      data: normalizeTideForecastSnapshot(snapshot),
      sources: [sourceSummary],
    };
  } catch (error) {
    return {
      name: "get_tide_forecast",
      status: "error",
      text:
        error instanceof Error
          ? `Tide-Forecast tide lookup failed: ${error.message}`
          : "Tide-Forecast tide lookup failed.",
      errorCode: "provider_unavailable",
      sources: [tideForecastProviderUnavailableSourceSummary(args.location)],
    };
  }
}

async function getConditionJudgmentToolResult(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const getSnapshot =
    dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;
  const location = weatherForecastLocationForLabel(args.location);
  const [weatherSnapshot, marineSnapshot, tideForecastSnapshot] = await Promise.all([
    getConditionWeatherSnapshot({
      getSnapshot,
      location,
    }),
    getConditionMarineSnapshot(args, dependencies),
    getConditionTideForecastSnapshot(args, dependencies),
  ]);
  const localGuideResult = !shouldIncludeConditionLocalCaveats(args)
    ? null
    : searchSiargaoLocalGuide({
        query: conditionLocalGuideQuery(args),
        filters: {
          ...(args.beach_name ? { beachName: args.beach_name } : {}),
          swimming: args.activity === "swimming",
          sunset: args.activity === "sunset",
          rainFit: args.activity === "rain_plan",
          beachSurface: args.activity === "swimming" ? "sand" : "any",
        },
      });
  const judgment = buildConditionJudgment({
    request: args,
    weatherSnapshot,
    marineSnapshot,
    tideForecastSnapshot,
    localGuideResult,
  });

  return {
    name: "get_condition_judgment",
    status: "success",
    text: renderConditionJudgmentToolText(judgment),
    data: {
      status: "available",
      judgment,
    },
    sources: judgment.sources,
  };
}

async function getMarineConditionsSnapshot(
  args: MarineConditionsArguments,
  dependencies: AgentToolDependencies,
): Promise<MarineConditionsSnapshot> {
  const buildMarineBatch =
    dependencies.buildOpenMeteoMarineIngestionBatch ?? buildOpenMeteoMarineIngestionBatch;
  const location = marineConditionsLocationForLabel(args.location);
  const batch = await buildMarineBatch({
    fetchedAt: dependencies.now?.() ?? new Date(),
    ...(location ? { location } : {}),
  });
  return marineSnapshotFromBatch(batch);
}

async function getTideForecastSnapshot(
  args: TideForecastArguments,
  dependencies: AgentToolDependencies,
): Promise<TideForecastSnapshot> {
  const buildSnapshot = dependencies.buildTideForecastSnapshot ?? buildTideForecastSnapshot;
  const location = tideForecastLocationForSiargaoLabel(args.location);
  return buildSnapshot({
    dateRange: args.date_range as TideForecastDateRange,
    fetchedAt: dependencies.now?.() ?? new Date(),
    location,
    requestedLocation: args.location,
  });
}

async function getConditionWeatherSnapshot({
  getSnapshot,
  location,
}: {
  getSnapshot: typeof getLatestSiargaoWeatherSnapshot;
  location?: OpenMeteoForecastLocation;
}) {
  try {
    return await getSnapshot(location ? { location } : {});
  } catch {
    return null;
  }
}

async function getConditionMarineSnapshot(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
) {
  if (!["swimming", "surfing", "boat_trip"].includes(args.activity)) {
    return null;
  }
  try {
    const dateRange = args.date_range === "today" ? "today" : "next_48_hours";
    return await getMarineConditionsSnapshot(
      { location: args.location, date_range: dateRange },
      dependencies,
    );
  } catch {
    return null;
  }
}

async function getConditionTideForecastSnapshot(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
) {
  if (!["swimming", "surfing", "boat_trip"].includes(args.activity)) {
    return null;
  }
  try {
    const dateRange = args.date_range === "today" ? "today" : "next_7_days";
    return await getTideForecastSnapshot(
      { location: tideForecastLocationForCondition(args.location), date_range: dateRange },
      dependencies,
    );
  } catch {
    return null;
  }
}

function conditionLocalGuideQuery(args: ConditionJudgmentArguments) {
  const parts = [
    args.beach_name,
    args.activity.replaceAll("_", " "),
    args.location,
    ...(args.constraints ?? []),
  ];
  return uniqueText(parts).join(" ");
}

function renderConditionJudgmentToolText(judgment: ConditionJudgment) {
  return [
    `Condition judgment for ${judgment.activity.replaceAll("_", " ")} at ${judgment.locationName}: ${judgment.recommendation} (${judgment.level} risk).`,
    `Reasons: ${judgment.reasons.join(" ")}`,
    `Alternatives: ${judgment.alternatives.join(" ")}`,
    judgment.caveats.length ? `Caveats: ${judgment.caveats.join(" ")}` : "",
    `Signals: ${judgment.signals
      .map((signal) => `${signal.kind} ${signal.status} ${signal.level}: ${signal.summary}`)
      .join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function weatherForecastLocationForLabel(
  label: WeatherForecastArguments["location"],
): OpenMeteoForecastLocation | undefined {
  if (label === "Del Carmen") {
    return siargaoForecastLocations.delCarmen;
  }

  if (label === "Cloud 9" || label === "General Luna") {
    return siargaoForecastLocations.generalLuna;
  }

  return undefined;
}

function marineConditionsLocationForLabel(
  label: MarineConditionsArguments["location"],
): OpenMeteoMarineLocation | undefined {
  if (label === "Del Carmen") {
    return siargaoMarineLocations.delCarmen;
  }

  if (label === "Cloud 9" || label === "General Luna") {
    return siargaoMarineLocations.generalLuna;
  }

  return undefined;
}

function tideForecastLocationForCondition(
  label: ConditionJudgmentArguments["location"],
): TideForecastArguments["location"] {
  return label === "Del Carmen" ? "Siargao Island" : label;
}

function marineSnapshotFromBatch(batch: OpenMeteoMarineIngestionBatch): MarineConditionsSnapshot {
  const summary = batch.summary;
  return {
    status: "live",
    locationName: batch.sourceRecord.name,
    sourceName: "Open-Meteo Marine API",
    sourceProfileId: "source_open_meteo_marine",
    fetchedAt: batch.rawSnapshot.fetchedAt,
    expiresAt: batch.refreshJob.scheduledAt,
    confidence: marineConfidenceFromBatch(batch),
    citationUrl: batch.requestUrl,
    evidenceIds: batch.evidence.map((evidence) => evidence.id),
    summary: renderMarineSummary(summary),
    current: {
      time: summary.current.time,
      seaLevelHeightMsl: summary.current.seaLevelHeightMsl,
      waveHeight: summary.current.waveHeight,
      swellWaveHeight: summary.current.swellWaveHeight,
      wavePeriod: summary.current.wavePeriod,
      swellWavePeriod: summary.current.swellWavePeriod,
      oceanCurrentVelocity: summary.current.oceanCurrentVelocity,
      seaSurfaceTemperature: summary.current.seaSurfaceTemperature,
    },
    metrics: {
      maxWaveHeight: summary.maxWaveHeight,
      maxSwellWaveHeight: summary.maxSwellWaveHeight,
      maxOceanCurrentVelocity: summary.maxOceanCurrentVelocity,
      minSeaLevelHeightMsl: summary.minSeaLevelHeightMsl,
      maxSeaLevelHeightMsl: summary.maxSeaLevelHeightMsl,
      seaLevelHeightRangeMsl: summary.seaLevelHeightRangeMsl,
    },
  };
}

function marineConfidenceFromBatch(batch: OpenMeteoMarineIngestionBatch) {
  return batch.facts.some((fact) => fact.confidenceLabel === "low") ? "low" : "medium";
}

function normalizeMarineConditionsSnapshot(
  snapshot: MarineConditionsSnapshot,
  args: MarineConditionsArguments,
) {
  return {
    requestedLocation: args.location,
    dateRange: args.date_range,
    status: snapshot.status,
    locationName: snapshot.locationName,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
    confidence: snapshot.confidence,
    citationUrl: snapshot.citationUrl,
    evidenceIds: snapshot.evidenceIds,
    summary: snapshot.summary,
    current: snapshot.current,
    metrics: snapshot.metrics,
    caveats: marineConditionsCaveats,
  };
}

function normalizeTideForecastSnapshot(snapshot: TideForecastSnapshot) {
  return {
    requestedLocation: snapshot.requestedLocation,
    dateRange: snapshot.dateRange,
    status: snapshot.status,
    stationName: snapshot.stationName,
    stationUrl: snapshot.stationUrl,
    stationLatitude: snapshot.stationLatitude,
    stationLongitude: snapshot.stationLongitude,
    proxyFor: snapshot.proxyFor,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    serverTime: snapshot.serverTime,
    forecastUpdatedAt: snapshot.forecastUpdatedAt,
    confidence: "low",
    targetDates: snapshot.targetDates,
    days: snapshot.days,
    seaPeriods: snapshot.seaPeriods,
    recommendedWindows: snapshot.recommendedWindows,
    caveats: snapshot.caveats,
  };
}

function normalizeWeatherSnapshot(snapshot: WeatherSnapshot, args: WeatherForecastArguments) {
  return {
    requestedLocation: args.location,
    dateRange: args.date_range,
    status: snapshot.status,
    locationName: snapshot.locationName,
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
    freshness: snapshot.freshness,
    confidence: snapshot.confidence,
    citationUrl: snapshot.citationUrl,
    evidenceIds: snapshot.evidenceIds,
    summary: snapshot.summary,
    signals: weatherSignals(snapshot),
    today: snapshot.today,
    metrics: args.date_range === "next_7_days" ? snapshot.metrics : [],
  };
}

function renderWeatherForecastText(snapshot: WeatherSnapshot, args: WeatherForecastArguments) {
  const signals = weatherSignals(snapshot);
  if (snapshot.status !== "live") {
    return [
      `Open-Meteo weather forecast is unavailable for ${args.location}.`,
      snapshot.summary,
      signals.length ? `Signals: ${signals.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const today = snapshot.today;
  return [
    `${snapshot.sourceName} forecast for ${snapshot.locationName}.`,
    `Today: ${today.condition}; precipitation probability ${formatNullableNumber(
      today.precipitationProbability,
      "%",
    )}; rain ${formatNullableNumber(today.rainSum, "mm")}; wind gust ${formatNullableNumber(
      today.windGust,
      "km/h",
    )}.`,
    args.date_range === "next_7_days" && snapshot.metrics.length
      ? `Seven-day signals: ${snapshot.metrics
          .map((metric) => `${metric.label} ${metric.value}${metric.unit} on ${metric.peakDate}`)
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const marineConditionsCaveats = [
  "Open-Meteo Marine is modelled marine forecast data, not an official tide table or tide-gauge measurement.",
  "Navigation, lifeguard or swimming safety, rip currents, official marine warnings, and local operator calls were not checked.",
];

function renderMarineConditionsText(
  snapshot: MarineConditionsSnapshot,
  args: MarineConditionsArguments,
) {
  return [
    `${snapshot.sourceName} modelled marine conditions for ${snapshot.locationName}.`,
    `Current: sea level ${formatNullableNumber(
      snapshot.current.seaLevelHeightMsl,
      "m MSL",
    )}; wave ${formatNullableNumber(snapshot.current.waveHeight, "m")}; swell ${formatNullableNumber(
      snapshot.current.swellWaveHeight,
      "m",
    )}; ocean current ${formatNullableNumber(snapshot.current.oceanCurrentVelocity, "km/h")}.`,
    args.date_range === "next_48_hours"
      ? `Next-48-hour signals: max wave ${formatNullableNumber(
          snapshot.metrics.maxWaveHeight,
          "m",
        )}; max swell ${formatNullableNumber(
          snapshot.metrics.maxSwellWaveHeight,
          "m",
        )}; sea-level range ${formatNullableNumber(
          snapshot.metrics.seaLevelHeightRangeMsl,
          "m",
        )}; max ocean current ${formatNullableNumber(
          snapshot.metrics.maxOceanCurrentVelocity,
          "km/h",
        )}.`
      : "",
    `Caveat: ${marineConditionsCaveats.join(" ")}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function renderTideForecastText(snapshot: TideForecastSnapshot) {
  const tideLines = snapshot.days.map((day) => {
    const events = day.tides
      .filter((tide) => tide.type === "high" || tide.type === "low")
      .slice(0, 4)
      .map((tide) => `${tide.type} ${tide.time} ${formatNullableNumber(tide.heightMeters, "m")}`)
      .join("; ");
    return `${day.date}: ${events || "no high/low tide events available"}`;
  });
  const windowLines = snapshot.recommendedWindows.map(
    (window) => `${window.localLabel} (${window.reason})`,
  );
  return [
    `${snapshot.sourceName} predicted tide data for ${snapshot.requestedLocation} using ${snapshot.stationName}.`,
    `Tides: ${tideLines.join(" | ")}.`,
    windowLines.length
      ? `Best daylight surf/tide windows from available tide and sea-period data: ${windowLines.join(" | ")}.`
      : "No ranked daylight surf/tide window was available from the page data.",
    `Caveat: ${snapshot.caveats.join(" ")}`,
  ].join(" ");
}

function renderMarineSummary(summary: OpenMeteoMarineIngestionBatch["summary"]) {
  return [
    `current modelled sea level ${formatNullableNumber(
      summary.current.seaLevelHeightMsl,
      "m MSL",
    )}`,
    `wave ${formatNullableNumber(summary.current.waveHeight, "m")}`,
    `swell ${formatNullableNumber(summary.current.swellWaveHeight, "m")}`,
    `ocean current ${formatNullableNumber(summary.current.oceanCurrentVelocity, "km/h")}`,
    `forecast sea-level range ${formatNullableNumber(summary.seaLevelHeightRangeMsl, "m")}`,
  ].join("; ");
}

function weatherSignals(snapshot: WeatherSnapshot) {
  const today = snapshot.today;
  const signals = [today.condition];
  if (today.precipitationProbability !== null) {
    signals.push(`precipitation probability ${today.precipitationProbability}%`);
  }
  if (today.rainSum !== null) {
    signals.push(`rain ${today.rainSum}mm`);
  }
  if (today.windGust !== null) {
    signals.push(`wind gust ${today.windGust}km/h`);
  }
  signals.push(`${today.level} weather risk`);
  return signals;
}

function weatherForecastSourceSummary(snapshot: WeatherSnapshot): AnswerSourceSummary {
  if (snapshot.status === "live") {
    return {
      label: "weather_checked",
      sourceName: snapshot.sourceName,
      sourceProfileId: snapshot.sourceProfileId,
      fetchedAt: snapshot.fetchedAt,
      confidence: snapshot.confidence,
      checked: [`forecast for ${snapshot.locationName}`],
      notChecked: ["surf/swell reports", "tides", "road flooding", "bookings", "review text"],
    };
  }

  return weatherProviderUnavailableSourceSummary(snapshot.locationName);
}

function marineConditionsSourceSummary(snapshot: MarineConditionsSnapshot): AnswerSourceSummary {
  return {
    label: "marine_checked",
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    confidence: snapshot.confidence,
    checked: [
      `modelled sea level height MSL (tide proxy) for ${snapshot.locationName}`,
      "modelled wave height",
      "modelled swell wave height",
      "modelled ocean current velocity",
    ],
    notChecked: [
      "official tide table",
      "tide-gauge measurement",
      "navigation safety",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
      "local operator call",
    ],
  };
}

function tideForecastSourceSummary(snapshot: TideForecastSnapshot): AnswerSourceSummary {
  return {
    label: "tide_forecast_checked",
    sourceName: snapshot.sourceName,
    sourceProfileId: snapshot.sourceProfileId,
    fetchedAt: snapshot.fetchedAt,
    confidence: "low",
    checked: [
      `Tide-Forecast ${snapshot.stationName} predicted tide table for ${snapshot.targetDates.join(", ")}`,
      "predicted high and low tide times",
      "predicted tide heights",
      ...(snapshot.seaPeriods.length > 0
        ? ["embedded Tide-Forecast 3-hour swell and wind periods"]
        : []),
    ],
    notChecked: [
      "official tide-gauge measurement",
      "exact Cloud 9 break reading",
      "navigation safety",
      "rip currents",
      "lifeguard or swimming safety",
      "official marine warnings",
      "local operator call",
      "commercial production license",
    ],
  };
}

function weatherProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Open-Meteo weather API",
    sourceProfileId: "source_open_meteo",
    confidence: "low",
    checked: [],
    notChecked: [
      `Open-Meteo forecast for ${locationName}`,
      "surf/swell reports",
      "tides",
      "road flooding",
      "bookings",
      "review text",
    ],
  };
}

function marineProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Open-Meteo Marine API",
    sourceProfileId: "source_open_meteo_marine",
    confidence: "low",
    checked: [],
    notChecked: [
      `Open-Meteo Marine modelled conditions for ${locationName}`,
      "modelled sea level height MSL",
      "modelled wave height",
      "modelled swell wave height",
      "modelled ocean current velocity",
      "official tide table",
      "navigation safety",
      "official marine warnings",
    ],
  };
}

function tideForecastProviderUnavailableSourceSummary(locationName: string): AnswerSourceSummary {
  return {
    label: "provider_unavailable",
    sourceName: "Tide-Forecast Dapa page",
    sourceProfileId: "source_tide_forecast_dev",
    confidence: "low",
    checked: [],
    notChecked: [
      `Tide-Forecast predicted tide table for ${locationName}`,
      "predicted high and low tide times",
      "predicted tide heights",
      "embedded sea-condition periods",
      "official tide-gauge measurement",
      "official marine warnings",
    ],
  };
}

function formatNullableNumber(value: number | null, unit: string) {
  return value === null ? "unavailable" : `${value}${unit}`;
}

function uniqueText(values: readonly (string | null | undefined)[]) {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    const normalizedValue = value?.trim() ?? "";
    if (normalizedValue.length > 0) {
      uniqueValues.add(normalizedValue);
    }
  }
  return [...uniqueValues];
}

function tokenizeMemoryQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .flatMap((term) => {
      const normalizedTerm = term.trim();
      return normalizedTerm.length > 2 ? [normalizedTerm] : [];
    });
}

function scoreMemoryFile(content: string, title: string, terms: readonly string[]) {
  const haystack = `${title}\n${content}`.toLowerCase();
  return terms.reduce((score, term) => score + countOccurrences(haystack, term), 0);
}

function countOccurrences(content: string, term: string) {
  let count = 0;
  let index = content.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

function findMemoryExcerpt(content: string, terms: readonly string[]) {
  const paragraphs = content.split(/\n{2,}/).flatMap((paragraph) => {
    const normalizedParagraph = normalizeMemoryText(paragraph.replace(/^#+\s*/gm, ""));
    return normalizedParagraph ? [normalizedParagraph] : [];
  });
  const term = terms.find((candidate) =>
    paragraphs.some((paragraph) => paragraph.toLowerCase().includes(candidate)),
  );
  const paragraph =
    paragraphs.find((candidate) => term && candidate.toLowerCase().includes(term)) ??
    paragraphs[0] ??
    "";
  return truncateMemoryExcerpt(paragraph);
}

function renderAgentMemorySearchText(
  results: readonly { fileName: string; title: string; excerpt: string }[],
) {
  return [
    "Ask Siargao agent memory reference matches:",
    ...results.map((result) => `- ${result.fileName}: ${result.excerpt}`),
    "Memory retrieval is policy/reference context only, not live evidence.",
  ].join("\n");
}

function normalizeMemoryText(content: string) {
  return content.replaceAll(/\s+/g, " ").trim();
}

function truncateMemoryExcerpt(excerpt: string) {
  if (excerpt.length <= 360) {
    return excerpt;
  }
  return `${excerpt.slice(0, 357).trimEnd()}...`;
}

function renderSourcePolicyText(policies: readonly SourcePolicyDescription[]) {
  return [
    "Ask Siargao source policy labels:",
    ...policies.map(
      (policy) =>
        `- ${policy.label}: ${policy.meaning} Use when: ${policy.useWhen} Caveats: ${policy.caveats.join(" ")}`,
    ),
  ].join("\n");
}
