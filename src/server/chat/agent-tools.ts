import postgres from "postgres";
import { z } from "zod";

import {
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
type LocalItineraryArguments = z.infer<typeof localItineraryRequestSchema>;
type SearchAgentMemoryArguments = z.infer<typeof searchAgentMemorySchema>;
type WeatherForecastArguments = z.infer<typeof weatherForecastSchema>;
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

const defaultLocalFactsQueryTimeoutMs = 2_000;
const describeSourcePolicySchema = z.object({}).strict();
const agentMemoryReferenceDocumentNames = requiredAgentMemoryManifest
  .filter((entry) => entry.role === "reference")
  .map((entry) => entry.fileName) as [string, ...string[]];
const siargaoCenterSchema = z
  .object({
    latitude: z.number().min(9.0).max(10.5),
    longitude: z.number().min(125.0).max(127.0),
  })
  .strict();
const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());
const searchPlacesSchema = z
  .object({
    query: z.string().trim().min(2).max(180),
    center: siargaoCenterSchema,
    radius_meters: z.number().int().min(500).max(20_000),
    constraints: optionalNullable(
      z
        .object({
          included_type: optionalNullable(z.string().trim().min(2).max(60)),
          open_now: optionalNullable(z.boolean()),
          page_size: optionalNullable(z.number().int().min(1).max(10)),
        })
        .strict(),
    ),
  })
  .strict();
const placeDetailsSchema = z
  .object({
    place_id: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .regex(/^[A-Za-z0-9_.:-]+$/),
  })
  .strict();
const searchLocalGuideSchema = z
  .object({
    query: z.string().trim().min(2).max(240),
    filters: optionalNullable(
      z
        .object({
          beach_surface: optionalNullable(z.enum(["sand", "mixed", "rocky", "any"])),
          swimming: optionalNullable(z.boolean()),
          sunset: optionalNullable(z.boolean()),
          rain_fit: optionalNullable(z.boolean()),
          max_ride_minutes: optionalNullable(z.number().int().min(1).max(180)),
          transport_mode: optionalNullable(z.enum(["walk", "scooter", "tricycle", "van"])),
          with_kids: optionalNullable(z.boolean()),
        })
        .strict(),
    ),
  })
  .strict();
const weatherForecastSchema = z
  .object({
    location: z.enum(weatherForecastLocations),
    date_range: z.enum(["today", "next_7_days"]),
  })
  .strict();
const searchAgentMemorySchema = z
  .object({
    query: z.string().trim().min(2).max(240),
    documents: optionalNullable(z.array(z.enum(agentMemoryReferenceDocumentNames)).min(1).max(5)),
    max_results: optionalNullable(z.number().int().min(1).max(5)),
  })
  .strict();

const sourcePolicyDescriptions: SourcePolicyDescription[] = [
  {
    label: "live_checked",
    meaning: "A live Google Places lookup returned current allowed place fields.",
    useWhen:
      "Use for live Places search/detail outputs with allowed identity, rating, hours, price, contact, and map-link fields.",
    caveats: [
      "Google Places order is provider relevance, not an independent quality ranking.",
      "Review text, bookings, table availability, room availability, and local quality checks are not included.",
    ],
  },
  {
    label: "fresh_cache",
    meaning: "Fresh reusable Google Places cache rows backed the answer.",
    useWhen:
      "Use for cached Places facts that are still inside the configured freshness and retention windows.",
    caveats: [
      "Cached rows still require Google attribution and retention handling.",
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
  get_condition_judgment: {
    definition: {
      type: "function",
      name: "get_condition_judgment",
      description:
        "Build a governed condition judgment for Siargao activities from checked Open-Meteo weather, curated local caveats, and explicit unchecked tide, surf, road, current, and safety signals. The AI must use the returned judgment as evidence and write the final answer itself.",
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
};

const defaultFunctionToolNames = [
  "get_weather_forecast",
  "get_condition_judgment",
  "search_places",
  "get_place_details",
  "search_local_guide",
  "plan_local_itinerary",
  "describe_database_schema",
  "query_local_facts",
  "get_source_evidence",
  "describe_source_policy",
] as const satisfies readonly AskSiargaoAgentToolName[];

export const agentToolDefinitions = defaultFunctionToolNames.map(
  (name) => registeredTools[name]?.definition as AgentToolDefinition,
);

export function buildAgentResponseTools(
  _memorySnapshot: AgentMemorySnapshot,
  options: {
    forceMemoryFallback?: boolean;
    includeMemoryFallbackWithFileSearch?: boolean;
    vectorStoreId?: string;
  } = {},
): AgentResponseToolDefinition[] {
  const tools: AgentResponseToolDefinition[] = [...agentToolDefinitions];
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
    const memorySearch = registeredTools.search_agent_memory?.definition;
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
    .map((file) => {
      const excerpt = findMemoryExcerpt(file.content, terms);
      return {
        fileName: file.fileName,
        title: file.title,
        excerpt,
        score: scoreMemoryFile(file.content, file.title, terms),
      };
    })
    .filter((result) => result.score > 0 || terms.length === 0)
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
  const exclusions = result.excluded
    .filter(
      (candidate) => candidate.name === "Pacifico Beach" || candidate.name === "Alegria Beach",
    )
    .map((candidate) => `Excluded: ${candidate.name} - ${candidate.reason}`);

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
      ...sourceSummary.notChecked,
      candidate.sourceNotes,
      "Map link is a Google Maps search, not a live Google Places identity check.",
    ]),
    sourceLabel: cardSourceLabel(sourceSummary),
  };
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
    const key = [
      fact.source.label,
      fact.source.sourceName,
      fact.source.sourceProfileId ?? "",
      fact.source.fetchedAt ?? "",
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
      ...(fact.source.sourceProfileId ? { sourceProfileId: fact.source.sourceProfileId } : {}),
      ...(fact.source.fetchedAt ? { fetchedAt: fact.source.fetchedAt } : {}),
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
        await sql.unsafe(`set statement_timeout to ${timeoutMs}`);
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
      ...sourceSummary.notChecked,
      ...(place.currentOpeningHours?.openNow === undefined
        ? ["Opening hours were not returned for this place."]
        : []),
      "Google Places ordering is provider relevance, not an independent local quality ranking.",
    ]),
    sourceLabel: cardSourceLabel(sourceSummary),
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
    search ? `Returned #${index + 1} by Google Places for "${search.textQuery}".` : undefined,
    search?.includedType && place.types.includes(search.includedType)
      ? `Matches the requested ${humanizeGooglePlaceType(search.includedType)} type.`
      : place.primaryType
        ? `Google Places primary type: ${humanizeGooglePlaceType(place.primaryType)}.`
        : undefined,
    distanceLabel,
    place.currentOpeningHours?.openNow === true
      ? "Google Places returned an open-now signal."
      : undefined,
    place.currentOpeningHours?.openNow === false
      ? "Google Places returned a not-open-now signal."
      : undefined,
    place.rating === undefined ? undefined : googlePlacesRatingLabel(place),
    openStatusLabel === "Hours not returned by Google Places." ? openStatusLabel : undefined,
  ]);
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
    `Field mask: ${context.fieldMask}.`,
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
    `Field mask: ${googlePlacesDetailsFieldMask}.`,
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
  "Google Places output does not include review text.",
  "Booking availability, table availability, room availability, and independent local quality checks are not checked.",
  "Google Places content requires Google attribution and retention handling.",
];

const googlePlacesDetailsCaveats = [
  "Google Places details use the identity/details field mask only.",
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

async function getConditionJudgmentToolResult(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const getSnapshot =
    dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;
  const location = weatherForecastLocationForLabel(args.location);
  const weatherSnapshot = await getConditionWeatherSnapshot({
    getSnapshot,
    location,
  });
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

function formatNullableNumber(value: number | null, unit: string) {
  return value === null ? "unavailable" : `${value}${unit}`;
}

function uniqueText(values: readonly (string | null | undefined)[]) {
  return [
    ...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0)),
  ];
}

function tokenizeMemoryQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
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
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => normalizeMemoryText(paragraph.replace(/^#+\s*/gm, "")))
    .filter(Boolean);
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
