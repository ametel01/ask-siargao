import postgres from "postgres";
import { z } from "zod";

import {
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
  requiredAgentMemoryManifest,
} from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
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
  memorySnapshot?: AgentMemorySnapshot;
  now?: () => Date;
};

type SearchPlacesArguments = z.infer<typeof searchPlacesSchema>;
type PlaceDetailsArguments = z.infer<typeof placeDetailsSchema>;
type SearchLocalGuideArguments = z.infer<typeof searchLocalGuideSchema>;
type SearchAgentMemoryArguments = z.infer<typeof searchAgentMemorySchema>;
type WeatherForecastArguments = z.infer<typeof weatherForecastSchema>;
type DescribeDatabaseSchemaArguments = z.infer<typeof describeDatabaseSchemaArgumentsSchema>;
type QueryLocalFactsArguments = z.infer<typeof localFactsQuerySchema>;
type SourceEvidenceArguments = z.infer<typeof sourceEvidenceArgumentsSchema>;

const weatherForecastLocations = [
  "Siargao Island",
  "Cloud 9",
  "General Luna",
  "Del Carmen",
] as const;

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
const searchPlacesSchema = z
  .object({
    query: z.string().trim().min(2).max(180),
    center: siargaoCenterSchema,
    radius_meters: z.number().int().min(500).max(20_000),
    constraints: z
      .object({
        included_type: z.string().trim().min(2).max(60).optional(),
        open_now: z.boolean().optional(),
        page_size: z.number().int().min(1).max(10).optional(),
      })
      .strict()
      .optional(),
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
    filters: z
      .object({
        beach_surface: z.enum(["sand", "mixed", "rocky", "any"]).optional(),
        swimming: z.boolean().optional(),
        sunset: z.boolean().optional(),
        rain_fit: z.boolean().optional(),
        max_ride_minutes: z.number().int().min(1).max(180).optional(),
        transport_mode: z.enum(["walk", "scooter", "tricycle", "van"]).optional(),
        with_kids: z.boolean().optional(),
      })
      .strict()
      .optional(),
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
    documents: z.array(z.enum(agentMemoryReferenceDocumentNames)).min(1).max(5).optional(),
    max_results: z.number().int().min(1).max(5).optional(),
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
    schema: searchLocalGuideSchema,
    execute: (args) => searchLocalGuideToolResult(args as SearchLocalGuideArguments),
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
            type: "string",
            description: "Optional Siargao area filter such as General Luna or Cloud 9.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags such as sandy, swimming, rain-fit, sunset, or transport.",
          },
          text: {
            type: "string",
            description: "Optional text filter matched against names and claims.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: localFactsMaxLimit,
            description: "Maximum number of local facts to return.",
          },
        },
        required: ["entityTypes"],
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
            type: "array",
            items: {
              type: "string",
              enum: agentMemoryReferenceDocumentNames,
            },
            description: "Optional subset of agent-memory reference documents to search.",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Maximum number of reference excerpts to return.",
          },
        },
        required: ["query"],
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
  "search_places",
  "get_place_details",
  "search_local_guide",
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

  const parsed = tool.schema.safeParse(request.arguments);
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

async function searchPlacesToolResult(
  args: SearchPlacesArguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const fetchedAt = currentIso(dependencies);
  const search: GooglePlacesChatSearch = {
    label: `agent_${slugPart(args.query)}`,
    textQuery: ensureSiargaoQuery(args.query),
    ...(args.constraints?.included_type ? { includedType: args.constraints.included_type } : {}),
    center: args.center,
    radiusMeters: args.radius_meters,
    pageSize: args.constraints?.page_size ?? 8,
  };

  try {
    const context = await getGooglePlacesSearchContext(
      {
        fetchedAt,
        requiresLiveStatus: args.constraints?.open_now,
        search,
        trace: { requestId: request.requestId },
      },
      dependencies,
    );
    const sourceSummary = googlePlacesSearchSourceSummary(context);
    return {
      name: "search_places",
      status: "success",
      text: renderGooglePlacesSearchText(context),
      data: normalizeGooglePlacesSearchContext(context),
      sources: [sourceSummary],
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

async function getPlaceDetailsToolResult(
  args: PlaceDetailsArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const now = currentIso(dependencies);
  const cached = await findCachedPlaceDetails(args.place_id, now, dependencies);
  if (cached) {
    const details = normalizeCachedPlaceDetails(cached);
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
      sources: [
        googlePlacesDetailsSourceSummary("fresh_cache", details.displayName, cached.fetched_at),
      ],
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
      sources: [googlePlacesDetailsSourceSummary("live", detail.displayName, detail.fetchedAt)],
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

  return {
    name: "search_local_guide",
    status: "success",
    text: renderLocalGuideText(result),
    data: normalizeLocalGuideSearchResult(result),
    sources: [result.sourceSummary],
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
  const result = await withLocalFactsQueryRunner(dependencies, (queryRunner) =>
    getSourceEvidence(args, { queryRunner }),
  );
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
  if (dependencies.localFactsQueryRunner) {
    return callback(dependencies.localFactsQueryRunner);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return callback(undefined);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await callback((query, ...params) => sql(query, ...(params as never[])));
  } finally {
    await sql.end({ timeout: 1 });
  }
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

function normalizeGooglePlacesSearchContext(context: GooglePlacesChatContext) {
  return {
    status: context.status,
    sourceName: context.sourceName,
    sourceProfileId: context.sourceProfileId,
    fetchedAt: context.fetchedAt,
    freshness: context.freshness,
    search: context.search,
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
    fetchedAt: cached.fetched_at.toISOString(),
  } satisfies GooglePlacesDetails;
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
    details.googleMapsUri ? `Maps: ${details.googleMapsUri}` : undefined,
    `Field mask: ${googlePlacesDetailsFieldMask}.`,
    ...googlePlacesDetailsCaveats,
  ];
  return fields.filter(Boolean).join("\n");
}

function googlePlacesSearchSourceSummary(context: GooglePlacesChatContext): AnswerSourceSummary {
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
    checked: googlePlacesSearchCheckedFields(context),
    notChecked: googlePlacesNotCheckedFields,
  };
}

function googlePlacesDetailsSourceSummary(
  freshness: "fresh_cache" | "live",
  displayName: string,
  fetchedAt: string | Date,
): AnswerSourceSummary {
  const label = freshness === "fresh_cache" ? "fresh_cache" : "live_checked";
  return {
    label,
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt: typeof fetchedAt === "string" ? fetchedAt : fetchedAt.toISOString(),
    confidence: freshness === "live" ? "high" : "medium",
    checked: [`identity details for ${displayName}`, "map link when returned"],
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

function googlePlacesSearchCheckedFields(context: GooglePlacesChatContext) {
  const checked = ["place listings", "addresses", "map links"];
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

function ensureSiargaoQuery(query: string) {
  return /\bsiargao\b/i.test(query) ? query : `${query} Siargao`;
}

function currentIso(dependencies: AgentToolDependencies) {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

function readLocalizedText(value: Record<string, unknown> | null) {
  return typeof value?.text === "string" ? value.text : undefined;
}

function numberOrUndefined(value: string | number | null) {
  if (value === null) {
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
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

function uniqueText(values: readonly string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
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
