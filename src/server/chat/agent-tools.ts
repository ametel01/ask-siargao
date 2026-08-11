import postgres from "postgres";
import {
  type AgentMemoryReferenceFile,
  type AgentMemorySnapshot,
  loadAgentMemorySnapshot,
} from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  AskSiargaoAgentToolName,
  ChatAction,
  ItineraryPlan,
  RecommendationCard,
} from "@/server/chat/agent-runtime";
import {
  type AgentResponseToolDefinition,
  type AgentToolDefinition,
  type AgentToolDependencies,
  composeAgentToolFamilies,
} from "@/server/chat/agent-tool-catalogue";
import {
  type ConditionJudgmentArguments,
  createConditionToolFamily,
  type MarineConditionsArguments,
  type TideForecastArguments,
  type WeatherForecastArguments,
} from "@/server/chat/agent-tool-condition-family";
import {
  createGooglePlacesToolFamily,
  type GooglePlacesCenterContext,
  normalizeGooglePlacesToolContext,
  type PlaceDetailsArguments,
  type SearchPlacesArguments,
} from "@/server/chat/agent-tool-google-places-family";
import {
  createLocalToolFamily,
  type DescribeDatabaseSchemaArguments,
  type QueryLocalFactsArguments,
  type RankSurfSpotsNearbyArguments,
  type SearchLocalGuideArguments,
  type SourceEvidenceArguments,
} from "@/server/chat/agent-tool-local-family";
import {
  createMemoryToolFamily,
  type LoadAgentMemoryFileArguments,
  memoryToolDefinitionForSnapshot as memoryToolDefinitionForSnapshotBase,
  type SearchAgentMemoryArguments,
} from "@/server/chat/agent-tool-memory-family";
import {
  createNightlifeToolFamily,
  type SearchNightlifeEventsArguments,
} from "@/server/chat/agent-tool-nightlife-family";
import { createSourcePolicyToolFamily } from "@/server/chat/agent-tool-source-policy-family";
import {
  cardSourceLabel,
  currentIso,
  formatNullableNumber,
  isRecord,
  safeProviderUnavailableText,
  slugPart,
  uniqueText,
} from "@/server/chat/agent-tool-utils";
import {
  createWebResearchToolFamily,
  type ResearchWebArguments,
} from "@/server/chat/agent-tool-web-research-family";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import { judgeConditions, type MarineConditionsSnapshot } from "@/server/chat/condition-tools";
import {
  type LocalItineraryRequest,
  planLocalItinerary,
  renderLocalItineraryToolText,
} from "@/server/chat/itinerary-tools";
import {
  describeDatabaseSchema,
  getSourceEvidence,
  type LocalFactsQueryRunner,
  queryLocalFacts,
} from "@/server/chat/local-data-tools";
import { rankLocalRecommendationCandidates } from "@/server/chat/local-recommendation";
import { renderNightlifeEventsText, searchNightlifeEvents } from "@/server/chat/nightlife-events";
import {
  buildWebResearchQueries,
  type ResearchFinding,
  type ResearchWebRequest,
  type ResearchWebResultData,
  runWebResearch,
} from "@/server/chat/web-research";
import { createPostgresConnectionOptions } from "@/server/db/connection-options";
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
import type {
  GooglePlacesChatContext,
  GooglePlacesChatPlace,
  GooglePlacesChatSearch,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  type GooglePlacesDetails,
  googlePlacesDetailsFieldMask,
} from "@/server/providers/google-places-enrichment";
import { createPlacesEvidenceAdapter } from "@/server/providers/google-places-evidence";
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

export type {
  AgentHostedToolDefinition,
  AgentResponseToolDefinition,
  AgentToolDefinition,
  AgentToolDependencies,
  WebPageFetchProvider,
} from "@/server/chat/agent-tool-catalogue";
export const agentToolFamilies = [
  createConditionToolFamily({
    getWeatherForecast: (args, _request, dependencies) =>
      getWeatherForecastToolResult(args, dependencies),
    getMarineConditions: (args, _request, dependencies) =>
      getMarineConditionsToolResult(args, dependencies),
    getTideForecast: (args, _request, dependencies) =>
      getTideForecastToolResult(args, dependencies),
    getConditionJudgment: (args, _request, dependencies) =>
      getConditionJudgmentToolResult(args, dependencies),
  }),
  createWebResearchToolFamily({
    researchWeb: researchWebToolResult,
  }),
  createNightlifeToolFamily({
    searchNightlifeEvents: (args, _request, dependencies) =>
      searchNightlifeEventsToolResult(args, dependencies),
  }),
  createGooglePlacesToolFamily({
    searchPlaces: searchPlacesToolResult,
    getPlaceDetails: (args, _request, dependencies) =>
      getPlaceDetailsToolResult(args, dependencies),
  }),
  createLocalToolFamily({
    searchLocalGuide: (args) => searchLocalGuideToolResult(args),
    rankSurfSpotsNearby: rankSurfSpotsNearbyToolResult,
    planLocalItinerary: (args) => planLocalItineraryToolResult(args),
    describeDatabaseSchema: (args) => describeDatabaseSchemaToolResult(args),
    queryLocalFacts: (args, _request, dependencies) =>
      queryLocalFactsToolResult(args, dependencies),
    getSourceEvidence: (args, _request, dependencies) =>
      getSourceEvidenceToolResult(args, dependencies),
  }),
  createSourcePolicyToolFamily(),
  createMemoryToolFamily({
    loadAgentMemoryFile: (args, _request, dependencies) =>
      loadAgentMemoryFileToolResult(args, dependencies),
    searchAgentMemory: (args, _request, dependencies) =>
      searchAgentMemoryToolResult(args, dependencies),
  }),
] as const;

const registeredTools = composeAgentToolFamilies(agentToolFamilies);
const defaultFunctionToolNames = agentToolFamilies.flatMap((family) => family.toolNames);

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
  return memoryToolDefinitionForSnapshotBase(definition, memorySnapshot);
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

  const parsed = tool.schema.safeParse(tool.argumentsForValidation?.(request) ?? request.arguments);
  if (!parsed.success) {
    const logData =
      request.name === "research_web"
        ? {
            invalidArguments: request.arguments,
            validationIssues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          }
        : undefined;
    return {
      name: request.name,
      status: "error",
      text: `Invalid arguments for ${request.name}: ${parsed.error.issues
        .map((issue: { message: string }) => issue.message)
        .join("; ")}`,
      ...(logData ? { logData } : {}),
      errorCode: "invalid_tool_arguments",
      sources: [],
    };
  }

  try {
    return await tool.execute(parsed.data, request, dependencies);
  } catch {
    return {
      name: request.name,
      status: "error",
      text: safeToolExecutionFailureText(request.name),
      errorCode: "tool_execution_failed",
      sources: [],
    };
  }
}

function safeToolExecutionFailureText(toolName: string) {
  return `${toolName} failed before it could return safe data.`;
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
    const placesAdapter =
      dependencies.placesEvidenceAdapter ?? createPlacesEvidenceAdapter(dependencies);
    const context = enforceRequiredOpenNowContext(
      await placesAdapter.search({
        cacheMode: placesToolContext?.cacheMode ?? "standard",
        fetchedAt,
        requiresLiveStatus: args.constraints?.open_now,
        search,
        trace: { requestId: request.requestId },
      }),
      {
        requiresOpenNow: args.constraints?.open_now === true,
      },
    );
    const contextWithCenterCaveats = withGooglePlacesLocalFitRanking(
      withGooglePlacesCenterCaveats(context, placesToolContext),
      args.query,
    );
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
  } catch {
    return {
      name: "search_places",
      status: "error",
      text: "Google Places search is temporarily unavailable.",
      errorCode: "provider_unavailable",
      sources: [googlePlacesProviderUnavailableSourceSummary("Google Places search lookup")],
    };
  }
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

function withGooglePlacesLocalFitRanking(
  context: GooglePlacesChatContext,
  query: string,
): GooglePlacesChatContext {
  if (context.status !== "available" || context.places.length <= 1) {
    return context;
  }

  const constraints = localFitConstraintsFromPlacesQuery(query);
  const rankedPlaces = rankLocalRecommendationCandidates(
    context.places.map((place) => ({
      ...place,
      name: place.displayName,
      distanceMeters: googlePlacesDistanceMeters(context.search.center, place),
    })),
    { constraints, center: context.search.center },
  );
  return {
    ...context,
    places: rankedPlaces,
  };
}

function localFitConstraintsFromPlacesQuery(query: string) {
  return uniqueText([
    /\brain|rainy|covered|indoors?|inside\b/i.test(query) ? "covered_seating" : undefined,
    /\bbeachfront|beach\s*front|beach\b/i.test(query) ? "beachfront" : undefined,
    /\bwith\s+kids|kids|family|families\b/i.test(query) ? "family_friendly" : undefined,
  ]);
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
  const placesAdapter =
    dependencies.placesEvidenceAdapter ?? createPlacesEvidenceAdapter(dependencies);
  const details = await placesAdapter.findFreshDetails({ now, placeId: args.place_id });
  if (details) {
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
    const liveDetails = await placesAdapter.getLiveDetails({
      fetchedAt: now,
      placeId: args.place_id,
    });
    const detail = liveDetails[0];
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
  } catch {
    return {
      name: "get_place_details",
      status: "error",
      text: "Google Places details are temporarily unavailable.",
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
      ...(args.filters?.origin_area ? { originArea: args.filters.origin_area } : {}),
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
      ...(result.review ? { review: result.review } : {}),
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
  return result.candidates
    .filter((candidate) => shouldDisplayLocalGuideCard(candidate, result))
    .slice(0, 4)
    .map((candidate, index) =>
      localGuideRecommendationCard({
        candidate,
        index,
        resultCaveats: result.caveats,
        sourceSummary: result.sourceSummary,
      }),
    );
}

function shouldDisplayLocalGuideCard(
  candidate: LocalGuideCandidate,
  result: LocalGuideSearchResult,
) {
  if (candidate.surface !== "rocky") {
    return true;
  }
  return Boolean(
    result.filters.beachName || result.filters.beachSurface === "rocky" || result.filters.sunset,
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

  const sql = postgres(databaseUrl, createPostgresConnectionOptions("cli"));
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

function normalizeGooglePlacesSearchContext(
  context: GooglePlacesChatContext,
  centerContext: GooglePlacesCenterContext,
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
    | "currentOpeningHours"
    | "displayName"
    | "formattedAddress"
    | "primaryType"
    | "rating"
    | "types"
    | "userRatingCount"
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
    ...googlePlacesConstraintFitReasons(place, search),
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

function googlePlacesConstraintFitReasons(
  place: Pick<GooglePlacesChatPlace, "formattedAddress" | "primaryType" | "types"> & {
    displayName?: string;
  },
  search: GooglePlacesChatSearch | undefined,
) {
  if (!search) {
    return [];
  }
  const text = [place.displayName, place.formattedAddress, place.primaryType, ...place.types]
    .join(" ")
    .toLowerCase();
  const query = search.textQuery.toLowerCase();
  return uniqueText([
    /\brain|rainy|covered|indoors?|inside\b/.test(query) && text.includes("covered")
      ? "covered wording matched the rainy-day constraint"
      : undefined,
    /\bbeachfront|beach\s*front|beach\b/.test(query) && text.includes("beach")
      ? "beach wording matched the place constraint"
      : undefined,
    /\bwith\s+kids|kids|family|families\b/.test(query) && text.includes("family")
      ? "family wording matched the traveler profile"
      : undefined,
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

function googlePlacesDistanceMeters(
  center: GooglePlacesChatSearch["center"],
  place: Pick<GooglePlacesChatPlace, "latitude" | "longitude">,
) {
  if (place.latitude === undefined || place.longitude === undefined) {
    return undefined;
  }
  return haversineDistanceMeters(center, {
    latitude: place.latitude,
    longitude: place.longitude,
  });
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
const defaultLocalFactsQueryTimeoutMs = 2_000;

function searchNightlifeEventsToolResult(
  args: SearchNightlifeEventsArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const result = searchNightlifeEvents({
    location: args.location,
    date: args.date,
    ...(args.interests ? { interests: args.interests } : {}),
    now: dependencies.now?.() ?? new Date(),
  });

  return {
    name: "search_nightlife_events",
    status: "success",
    text: renderNightlifeEventsText(result),
    data: {
      status: result.status,
      location: result.location,
      requestedDate: result.requestedDate,
      localDate: result.localDate,
      dayOfWeek: result.dayOfWeek,
      candidates: result.candidates,
      route: result.route,
      boundaries: {
        checked: result.sources.flatMap((source) => source.checked),
        notChecked: [...new Set(result.sources.flatMap((source) => source.notChecked))],
      },
      refreshDecision: result.refreshDecision,
      nextStep:
        "Use Google Places only after this event lookup to enrich selected venue identity, map links, address, business status, opening-hour signal, ratings, and review counts.",
    },
    sources: result.sources,
  };
}

async function researchWebToolResult(
  args: ResearchWebArguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const researchRequest = researchWebRequestFromArguments(args);
  const searchedQueries = buildWebResearchQueries(researchRequest);
  const provider = dependencies.webResearchProvider;

  if (!provider) {
    const result = runWebResearch(researchRequest, [], {
      now: dependencies.now?.(),
      providerUnavailable: true,
    });
    return researchWebProviderUnavailableToolResult(result, {
      reason: "not_configured",
      provider: "web_research",
      message:
        "WEB_RESEARCH_PROVIDER is not configured as openai or OPENAI_API_KEY is unavailable.",
    });
  }

  try {
    const providerResults = await provider(researchRequest, {
      requestId: request.requestId,
      searchedQueries,
    });
    const result = runWebResearch(researchRequest, providerResults, {
      now: dependencies.now?.(),
    });

    return {
      name: "research_web",
      status: "success",
      text: renderResearchWebText(result),
      data: result,
      sources: researchWebSourceSummaries(result),
    };
  } catch (error) {
    const providerFailure = summarizeWebResearchProviderFailure(error);
    const result = runWebResearch(researchRequest, [], {
      now: dependencies.now?.(),
      providerUnavailable: true,
    });
    return {
      name: "research_web",
      status: "error",
      text:
        typeof providerFailure.message === "string"
          ? `Public web research provider unavailable: ${providerFailure.message}`
          : "Public web research provider unavailable.",
      logData: { providerFailure },
      data: result,
      errorCode: "provider_unavailable",
      sources: researchWebProviderUnavailableSources(result),
    };
  }
}

function researchWebProviderUnavailableToolResult(
  result: ResearchWebResultData,
  providerFailure?: Record<string, unknown>,
): AgentToolResult {
  return {
    name: "research_web",
    status: "error",
    text: renderResearchWebText(result),
    ...(providerFailure ? { logData: { providerFailure } } : {}),
    data: result,
    errorCode: "provider_unavailable",
    sources: researchWebProviderUnavailableSources(result),
  };
}

function summarizeWebResearchProviderFailure(error: unknown): Record<string, unknown> {
  const record = isRecord(error) ? error : {};
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;

  return {
    reason: "provider_exception",
    provider: "openai_web_search",
    ...(error instanceof Error ? { name: error.name } : {}),
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...stringLogField("code", record.code),
    ...stringLogField("type", record.type),
    ...stringLogField("param", record.param),
    ...stringLogField("requestId", record.request_id ?? record.requestId),
    ...(message ? { message: sanitizeProviderFailureText(message) } : {}),
  };
}

function stringLogField(name: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  return { [name]: sanitizeProviderFailureText(value) };
}

function sanitizeProviderFailureText(value: string) {
  return value
    .replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [redacted]")
    .replaceAll(/\b(api[_-]?key|token|secret)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, 500);
}

function researchWebRequestFromArguments(args: ResearchWebArguments): ResearchWebRequest {
  return {
    query: args.query,
    intent: args.intent,
    ...(args.location ? { location: args.location } : {}),
    ...(args.localDate ? { localDate: args.localDate } : {}),
    ...(args.dateContext ? { dateContext: args.dateContext } : {}),
    ...(args.sourceTypes ? { sourceTypes: args.sourceTypes } : {}),
    ...(args.requiredFreshness ? { requiredFreshness: args.requiredFreshness } : {}),
    ...(args.maxSources ? { maxSources: args.maxSources } : {}),
  };
}

function renderResearchWebText(result: ResearchWebResultData) {
  const lines = [
    `Public web research status: ${result.status}.`,
    `Normalized query: ${result.normalizedQuery}.`,
    `Searched queries: ${result.searchedQueries.join(" | ")}.`,
  ];

  if (result.findings.length > 0) {
    lines.push("Findings:");
    lines.push(
      ...result.findings.map(
        (finding, index) =>
          `${index + 1}. ${finding.claim} (${finding.answerRole}; ${finding.confidence} confidence; ${finding.sourceType}; ${finding.sourceTitle}; ${finding.sourceUrl}).`,
      ),
    );
  } else {
    lines.push("Findings: none.");
  }

  if (result.entities.length > 0) {
    lines.push(
      `Selected entities: ${result.entities
        .map((entity) =>
          [
            entity.name,
            entity.kind,
            entity.area,
            entity.needsPlacesEnrichment ? "needs Places enrichment" : undefined,
          ]
            .filter(Boolean)
            .join(" / "),
        )
        .join("; ")}.`,
    );
  }

  if (result.notChecked.length > 0) {
    lines.push(`Not checked: ${result.notChecked.join("; ")}.`);
  }

  return lines.join("\n");
}

function researchWebSourceSummaries(result: ResearchWebResultData): AnswerSourceSummary[] {
  if (result.status === "provider_unavailable") {
    return researchWebProviderUnavailableSources(result);
  }
  if (result.status === "insufficient") {
    return [
      {
        label: "insufficient_web_evidence",
        sourceName: "Public web research",
        sourceProfileId: "source_web_research",
        confidence: "low",
        checked: [],
        notChecked: [...result.notChecked],
      },
    ];
  }

  return result.findings.map((finding) => ({
    label: researchWebLabelForFinding(finding),
    sourceName: finding.sourceTitle,
    sourceProfileId: `source_web_${finding.sourceType}`,
    ...(finding.publishedOrUpdatedAt ? { fetchedAt: finding.publishedOrUpdatedAt } : {}),
    confidence: finding.confidence,
    checked: [finding.claim],
    notChecked: [...result.notChecked],
  }));
}

function researchWebProviderUnavailableSources(
  result: ResearchWebResultData,
): AnswerSourceSummary[] {
  return [
    {
      label: "provider_unavailable",
      sourceName: "Public web research provider",
      sourceProfileId: "source_web_research",
      confidence: "low",
      checked: [],
      notChecked: [...result.notChecked],
    },
  ];
}

function researchWebLabelForFinding(finding: ResearchFinding): AnswerTrustLabel {
  if (finding.sourceType === "official" || finding.sourceType === "government") {
    return "official_checked";
  }
  if (finding.sourceType === "local_directory") {
    return "directory_checked";
  }
  if (finding.sourceType === "community" || finding.sourceType === "social") {
    return "community_signal";
  }
  return "web_researched";
}

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
  } catch {
    return {
      name: "get_weather_forecast",
      status: "error",
      text: safeProviderUnavailableText("Open-Meteo weather forecast"),
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
  } catch {
    return {
      name: "get_marine_conditions",
      status: "error",
      text: safeProviderUnavailableText("Open-Meteo Marine conditions", "are"),
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
  } catch {
    return {
      name: "get_tide_forecast",
      status: "error",
      text: safeProviderUnavailableText("Tide-Forecast tide data"),
      errorCode: "provider_unavailable",
      sources: [tideForecastProviderUnavailableSourceSummary(args.location)],
    };
  }
}

async function getConditionJudgmentToolResult(
  args: ConditionJudgmentArguments,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const { decisionSummary, judgment, text } = await judgeConditions(args, {
    getWeatherSnapshot: async ({ location }) => {
      const getSnapshot =
        dependencies.getLatestSiargaoWeatherSnapshot ?? getLatestSiargaoWeatherSnapshot;
      const providerLocation = weatherForecastLocationForLabel(location);
      return getSnapshot(providerLocation ? { location: providerLocation } : {});
    },
    getMarineSnapshot: ({ dateRange, location }) =>
      getMarineConditionsSnapshot({ location, date_range: dateRange }, dependencies),
    getTideForecastSnapshot: ({ dateRange, location }) =>
      getTideForecastSnapshot(
        { location: tideForecastLocationForCondition(location), date_range: dateRange },
        dependencies,
      ),
    searchLocalGuide: searchSiargaoLocalGuide,
  });

  return {
    name: "get_condition_judgment",
    status: "success",
    text,
    data: {
      status: "available",
      judgment,
      decisionSummary,
    },
    sources: judgment.sources,
    decisionSummaries: [decisionSummary],
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
