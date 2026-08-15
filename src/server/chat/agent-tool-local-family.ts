import postgres from "postgres";
import { z } from "zod";
import { loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentToolExecutionRequest,
  AgentToolResult,
  ChatAction,
  ItineraryPlan,
  RecommendationCard,
} from "@/server/chat/agent-runtime";

import {
  type AgentToolDependencies,
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import {
  cardSourceLabel,
  optionalNullable,
  slugPart,
  uniqueText,
} from "@/server/chat/agent-tool-utils";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
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
import { createPostgresConnectionOptions } from "@/server/db/connection-options";

const defaultLocalFactsQueryTimeoutMs = 2_000;

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

export function createLocalToolFamily(
  handlers: LocalToolHandlers = {
    searchLocalGuide: (args) => searchLocalGuideToolResult(args),
    rankSurfSpotsNearby: rankSurfSpotsNearbyToolResult,
    planLocalItinerary: (args) => planLocalItineraryToolResult(args),
    describeDatabaseSchema: (args) => describeDatabaseSchemaToolResult(args),
    queryLocalFacts: (args, _request, dependencies) =>
      queryLocalFactsToolResult(args, dependencies),
    getSourceEvidence: (args, _request, dependencies) =>
      getSourceEvidenceToolResult(args, dependencies),
  },
): AgentToolFamily {
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

export function searchLocalGuideToolResult(args: SearchLocalGuideArguments): AgentToolResult {
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

export function rankSurfSpotsNearbyToolResult(
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

export function planLocalItineraryToolResult(args: LocalItineraryRequest): AgentToolResult {
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

export function describeDatabaseSchemaToolResult(
  _args: DescribeDatabaseSchemaArguments,
): AgentToolResult {
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

export async function queryLocalFactsToolResult(
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

export async function getSourceEvidenceToolResult(
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
