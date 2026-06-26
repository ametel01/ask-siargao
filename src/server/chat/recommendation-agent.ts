import OpenAI from "openai";
import type { Logger } from "pino";
import { z } from "zod";

import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import { createComponentLogger } from "@/server/observability/logger";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatPlace,
  type GooglePlacesChatSearch,
  type GooglePlacesOpeningHours,
  getGooglePlacesChatContext,
} from "@/server/providers/google-places-chat";
import { createDefaultCachedGooglePlacesChatContextAdapter } from "@/server/providers/google-places-chat-cache";

export type RecommendationAgentResponse = {
  status: "answered" | "clarifying_question" | "unsupported";
  message: string;
  model: string;
  requestId?: string;
};

export type RecommendationAgentRequest = {
  messages: readonly AskSiargaoChatMessage[];
  trace?: RecommendationTraceContext;
};

export type RecommendationTraceContext = {
  requestId?: string;
};

export type RecommendationAgentPlannerInput = {
  messages: readonly AskSiargaoChatMessage[];
  locations: Record<string, ResolvedLocation>;
  candidates: PlaceCandidate[];
  previousActions: RecommendationAction[];
  trace?: RecommendationTraceContext;
  toolResults: ToolResult[];
};

export type RecommendationAgentPlanner = (
  input: RecommendationAgentPlannerInput,
) => Promise<RecommendationAction>;

export type RecommendationAgentDependencies = {
  model?: string;
  planner?: RecommendationAgentPlanner;
  placesAdapter?: (input: {
    fetchedAt: string;
    search: GooglePlacesChatSearch;
    trace?: RecommendationTraceContext;
  }) => Promise<GooglePlacesChatContext>;
  clock?: () => Date;
  logger?: Logger;
  maxSteps?: number;
};

export type ResolvedLocation = {
  label: string;
  center: { latitude: number; longitude: number };
  source: "gazetteer" | "google_places";
};

export type PlaceCandidate = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  primaryType?: string;
  types: string[];
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: GooglePlacesOpeningHours;
  regularOpeningHours?: GooglePlacesOpeningHours;
  googleMapsUri: string;
  sourceQuery: string;
  distanceMeters?: number;
  latitude?: number;
  longitude?: number;
  score: number;
};

type MealIntent = "breakfast" | "lunch" | "dinner" | null;

type FoodRequestIntent = {
  category: "food" | null;
  meal: MealIntent;
  location: string | null;
  areaScope: "nearby" | "in_area" | null;
  constraints: string[];
  avoid: string[];
  latestUserTurn: string;
  recentUserContext: string;
};

type ToolResult =
  | {
      type: "resolve_location";
      text: string;
      location?: ResolvedLocation;
      status: "found" | "missing";
    }
  | { type: "search_places"; query: string; found: number }
  | { type: "rank_candidates"; ranked: number };

type OpenAIResponsesClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{ output_text?: string }>;
  };
};

const resolveLocationActionSchema = z.object({
  type: z.literal("resolve_location"),
  text: z.string().min(2),
});

const searchPlacesActionSchema = z.object({
  type: z.literal("search_places"),
  query: z.string().min(2),
  centerLabel: z.string().min(2).optional(),
  radiusMeters: z.number().int().positive().max(60_000).optional(),
  includedType: z.string().min(2).optional(),
});

const rankCandidatesActionSchema = z.object({
  type: z.literal("rank_candidates"),
  preferredTerms: z.array(z.string()).default([]),
  excludedTerms: z.array(z.string()).default([]),
});

const askClarifyingQuestionActionSchema = z.object({
  type: z.literal("ask_clarifying_question"),
  question: z.string().min(4),
});

const finalAnswerActionSchema = z.object({
  type: z.literal("final_answer"),
});

const unsupportedActionSchema = z.object({
  type: z.literal("unsupported"),
});

const recommendationActionSchema = z.discriminatedUnion("type", [
  resolveLocationActionSchema,
  searchPlacesActionSchema,
  rankCandidatesActionSchema,
  askClarifyingQuestionActionSchema,
  finalAnswerActionSchema,
  unsupportedActionSchema,
]);

export type RecommendationAction = z.infer<typeof recommendationActionSchema>;

const recommendationLogger = createComponentLogger("chat.recommendation_agent");

const gazetteer: Record<string, ResolvedLocation> = {
  "general luna": {
    label: "General Luna",
    center: { latitude: 9.8006, longitude: 126.1586 },
    source: "gazetteer",
  },
  dapa: {
    label: "Dapa",
    center: { latitude: 9.7594, longitude: 125.9761 },
    source: "gazetteer",
  },
  "del carmen": {
    label: "Del Carmen",
    center: { latitude: 9.869, longitude: 125.969 },
    source: "gazetteer",
  },
  "del carmen port": {
    label: "Del Carmen Port",
    center: { latitude: 9.8722, longitude: 125.9698 },
    source: "gazetteer",
  },
  "sugba lagoon": {
    label: "Sugba Lagoon",
    center: { latitude: 9.8184, longitude: 125.9531 },
    source: "gazetteer",
  },
  "cloud 9": {
    label: "Cloud 9",
    center: { latitude: 9.8116, longitude: 126.1651 },
    source: "gazetteer",
  },
};

export class RecommendationAgent {
  readonly #model: string;
  readonly #planner: RecommendationAgentPlanner;
  readonly #placesAdapter: NonNullable<RecommendationAgentDependencies["placesAdapter"]>;
  readonly #clock: () => Date;
  readonly #logger: Logger;
  readonly #maxSteps: number;

  constructor({
    clock = () => new Date(),
    logger = recommendationLogger,
    maxSteps = 5,
    model = process.env.OPENAI_MODEL ?? "gpt-5.5",
    planner,
    placesAdapter = ({ fetchedAt, search, trace }) =>
      getGooglePlacesChatContext({ fetchedAt, search, trace }),
  }: RecommendationAgentDependencies = {}) {
    this.#model = model;
    this.#planner =
      planner ?? createDefaultRecommendationPlanner(createOpenAIRecommendationPlanner(model));
    this.#placesAdapter = placesAdapter;
    this.#clock = clock;
    this.#logger = logger;
    this.#maxSteps = maxSteps;
  }

  async answer({
    messages,
    trace,
  }: RecommendationAgentRequest): Promise<RecommendationAgentResponse> {
    const startedAt = Date.now();
    const logger = this.#logger.child(compactLogFields({ requestId: trace?.requestId }));
    const state = {
      locations: {} as Record<string, ResolvedLocation>,
      candidates: [] as PlaceCandidate[],
      previousActions: [] as RecommendationAction[],
      toolResults: [] as ToolResult[],
    };

    logger.info(
      {
        model: this.#model,
        messageCount: messages.length,
        maxSteps: this.#maxSteps,
      },
      "Recommendation agent started.",
    );
    const interpretedIntent = interpretFoodRequest(messages);
    logger.debug(
      {
        intent: summarizeFoodIntentForLogs(interpretedIntent),
      },
      "Recommendation request intent interpreted.",
    );

    for (let step = 0; step < this.#maxSteps; step += 1) {
      let candidates = state.candidates;
      const plannerStartedAt = Date.now();
      let action: RecommendationAction;
      try {
        action = await this.#planner({
          messages,
          locations: state.locations,
          candidates,
          previousActions: state.previousActions,
          trace,
          toolResults: state.toolResults,
        });
      } catch (error) {
        logger.error(
          {
            error,
            step,
            durationMs: Date.now() - plannerStartedAt,
            previousActionTypes: state.previousActions.map((previousAction) => previousAction.type),
            candidateCount: candidates.length,
          },
          "Recommendation planner failed.",
        );
        throw error;
      }

      state.previousActions.push(action);
      logger.debug(
        {
          step,
          action: summarizeActionForLogs(action),
          candidateCount: candidates.length,
          locationLabels: Object.values(state.locations).map((location) => location.label),
          durationMs: Date.now() - plannerStartedAt,
        },
        "Recommendation planner action selected.",
      );

      switch (action.type) {
        case "unsupported":
          logger.info(
            { step, durationMs: Date.now() - startedAt },
            "Recommendation agent returned unsupported.",
          );
          return { status: "unsupported", message: "", model: this.#model };
        case "ask_clarifying_question":
          logger.info(
            { step, durationMs: Date.now() - startedAt },
            "Recommendation agent returned clarifying question.",
          );
          return {
            status: "clarifying_question",
            message: action.question,
            model: this.#model,
          };
        case "resolve_location": {
          const location = await this.#resolveLocation(action.text, trace);
          if (location) {
            state.locations[normalizeKey(action.text)] = location;
          }
          logger.debug(
            {
              step,
              text: action.text,
              status: location ? "found" : "missing",
              location: location
                ? {
                    label: location.label,
                    source: location.source,
                    center: location.center,
                  }
                : undefined,
            },
            "Recommendation location resolution completed.",
          );
          state.toolResults.push({
            type: "resolve_location",
            text: action.text,
            ...(location ? { location } : {}),
            status: location ? "found" : "missing",
          });
          break;
        }
        case "search_places": {
          const search = buildSearch(action, state.locations);
          const searchStartedAt = Date.now();
          logger.info(
            {
              step,
              query: search.textQuery,
              includedType: search.includedType,
              center: search.center,
              radiusMeters: search.radiusMeters,
              pageSize: search.pageSize,
            },
            "Recommendation Places search started.",
          );
          const context = await this.#placesAdapter({
            fetchedAt: this.#clock().toISOString(),
            search,
            trace,
          });
          const foundCandidates = context.places.map((place) =>
            placeCandidateFromGooglePlace(place, search.textQuery, search.center),
          );
          candidates = dedupeCandidates([...candidates, ...foundCandidates]);
          state.candidates = candidates;
          logger.info(
            {
              step,
              query: search.textQuery,
              providerStatus: context.status,
              found: foundCandidates.length,
              totalCandidateCount: candidates.length,
              durationMs: Date.now() - searchStartedAt,
            },
            "Recommendation Places search completed.",
          );
          state.toolResults.push({
            type: "search_places",
            query: action.query,
            found: foundCandidates.length,
          });
          break;
        }
        case "rank_candidates":
          candidates = rankCandidates(candidates, action);
          state.candidates = candidates;
          logger.debug(
            {
              step,
              ranked: candidates.length,
              topCandidates: candidates.slice(0, 5).map((candidate) => ({
                placeId: candidate.placeId,
                name: candidate.name,
                rating: candidate.rating,
                userRatingCount: candidate.userRatingCount,
                score: candidate.score,
              })),
            },
            "Recommendation candidates ranked.",
          );
          state.toolResults.push({ type: "rank_candidates", ranked: candidates.length });
          break;
        case "final_answer":
          logger.info(
            {
              step,
              candidateCount: candidates.length,
              actionTypes: state.previousActions.map((previousAction) => previousAction.type),
              durationMs: Date.now() - startedAt,
            },
            "Recommendation agent rendered final answer.",
          );
          return {
            status: "answered",
            message: renderRecommendationAnswer(
              candidates,
              state.previousActions,
              interpretedIntent,
            ),
            model: this.#model,
          };
      }
    }

    logger.warn(
      {
        candidateCount: state.candidates.length,
        actionTypes: state.previousActions.map((previousAction) => previousAction.type),
        durationMs: Date.now() - startedAt,
      },
      "Recommendation agent reached max steps.",
    );

    return {
      status: state.candidates.length > 0 ? "answered" : "unsupported",
      message:
        state.candidates.length > 0
          ? renderRecommendationAnswer(state.candidates, state.previousActions, interpretedIntent)
          : "",
      model: this.#model,
    };
  }

  async #resolveLocation(
    text: string,
    trace?: RecommendationTraceContext,
  ): Promise<ResolvedLocation | undefined> {
    const gazetteerLocation = gazetteer[normalizeKey(text)];
    if (gazetteerLocation) {
      return gazetteerLocation;
    }

    const context = await this.#placesAdapter({
      fetchedAt: this.#clock().toISOString(),
      search: {
        label: `resolve_${slugPart(text)}`,
        textQuery: normalizeSiargaoQuery(text),
        center: gazetteer["general luna"].center,
        radiusMeters: 60_000,
        pageSize: 1,
      },
      trace,
    });
    const place = context.places.find(
      (candidate) => candidate.latitude !== undefined && candidate.longitude !== undefined,
    );

    if (place?.latitude === undefined || place.longitude === undefined) {
      return undefined;
    }

    return {
      label: place.displayName,
      center: { latitude: place.latitude, longitude: place.longitude },
      source: "google_places",
    };
  }
}

export function createDefaultRecommendationAgent() {
  return new RecommendationAgent({
    placesAdapter: createDefaultCachedGooglePlacesChatContextAdapter(),
  });
}

function createDefaultRecommendationPlanner(
  modelPlanner: RecommendationAgentPlanner,
): RecommendationAgentPlanner {
  return async (input) => inferDeterministicAction(input) ?? modelPlanner(input);
}

function inferDeterministicAction(
  input: RecommendationAgentPlannerInput,
): RecommendationAction | undefined {
  const intent = interpretFoodRequest(input.messages);
  const searchAttempts = input.previousActions.filter((action) => action.type === "search_places");
  const hasRanked = input.previousActions.some((action) => action.type === "rank_candidates");

  if (input.candidates.length > 0 && !hasRanked) {
    return {
      type: "rank_candidates",
      preferredTerms: inferPreferredTerms(intent),
      excludedTerms: inferExcludedTerms(intent),
    };
  }

  if (searchAttempts.length > 0) {
    return { type: "final_answer" };
  }

  if (intent.category !== "food") {
    return undefined;
  }

  const centerLabel = intent.location;
  if (!centerLabel) {
    return undefined;
  }

  const foodTerm = inferFoodSearchTerm(intent);
  const locationPhrase =
    intent.areaScope === "nearby" ? `near ${centerLabel}` : `in ${centerLabel}`;

  return {
    type: "search_places",
    query: `${foodTerm} ${locationPhrase} Siargao`,
    centerLabel,
    includedType: inferIncludedType(foodTerm),
  };
}

function createOpenAIRecommendationPlanner(
  model: string,
  clientFactory: () => OpenAIResponsesClient = () =>
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30_000,
    }) as OpenAIResponsesClient,
): RecommendationAgentPlanner {
  return async (input) => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for Ask Siargao recommendations.");
    }
    const logger = recommendationLogger.child(
      compactLogFields({
        requestId: input.trace?.requestId,
        model,
        provider: "openai",
        purpose: "recommendation_planner",
      }),
    );
    const client = clientFactory();

    const startedAt = Date.now();
    logger.info(
      {
        messageCount: input.messages.length,
        knownLocationCount: Object.keys(input.locations).length,
        candidateCount: input.candidates.length,
        previousActionTypes: input.previousActions.map((action) => action.type),
      },
      "Recommendation planner OpenAI call started.",
    );
    const response = await client.responses.create({
      model,
      store: false,
      max_output_tokens: 500,
      instructions: recommendationPlannerInstructions,
      input: JSON.stringify({
        conversation: input.messages.slice(-10),
        knownLocations: input.locations,
        candidates: input.candidates.slice(0, 8),
        previousActions: input.previousActions,
        toolResults: input.toolResults,
        allowedActions: [
          "resolve_location",
          "search_places",
          "rank_candidates",
          "ask_clarifying_question",
          "final_answer",
          "unsupported",
        ],
      }),
      text: {
        format: {
          type: "json_schema",
          name: "ask_siargao_recommendation_action",
          schema: recommendationActionJsonSchema,
          strict: false,
        },
      },
    });

    const action = parseRecommendationAction(response.output_text ?? "");
    logger.info(
      {
        actionType: action.type,
        outputLength: response.output_text?.length ?? 0,
        durationMs: Date.now() - startedAt,
      },
      "Recommendation planner OpenAI call completed.",
    );

    return action;
  };
}

function parseRecommendationAction(outputText: string): RecommendationAction {
  const json = outputText
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(json) as unknown;
  return recommendationActionSchema.parse(parsed);
}

function isPlaceRecommendationContent(content: string) {
  return /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|bars?|nightlife|places?\s+to\s+(?:eat|go|stop)|stop\s+to\s+eat|food\s+stops?|car[ie]nderias?|seafood|covered\s+(?:caf[eé]s?|places?|spots?)|beachfront\s+(?:places?|caf[eé]s?|restaurants?|spots?)|specific\s+(?:places?|spots?|caf[eé]s?))\b/i.test(
    content,
  );
}

function interpretFoodRequest(messages: readonly AskSiargaoChatMessage[]): FoodRequestIntent {
  const userTurns = messages.filter((message) => message.role === "user");
  const latestUserTurn = userTurns.at(-1)?.content ?? "";
  const recentUserContext = userTurns
    .slice(0, -1)
    .slice(-6)
    .map((message) => message.content)
    .join(" ");
  const latestMeal = inferMeal(latestUserTurn);
  const meal = latestMeal ?? inferMeal(recentUserContext);
  const latestAsksForFood = isPlaceRecommendationContent(latestUserTurn);
  const contextualFoodRequest =
    latestAsksForFood ||
    /\b(what\s+about|how\s+about|that\s+area|there|nearby|instead|options?|open\s+now|open\s+today|currently\s+open|still\s+open|hours?)\b/i.test(
      latestUserTurn,
    );
  const category =
    latestAsksForFood || (contextualFoodRequest && isPlaceRecommendationContent(recentUserContext))
      ? "food"
      : null;
  const explicitlyRequestedCafe = /\b(caf[eé]s?|coffee)\b/i.test(
    `${latestUserTurn} ${recentUserContext}`,
  );
  const constraints = [...inferConstraints(recentUserContext), ...inferConstraints(latestUserTurn)];
  const avoid = inferAvoidTerms({ explicitlyRequestedCafe, latestUserTurn, meal });

  return {
    category,
    meal,
    location: inferCenterLabel(latestUserTurn) ?? inferCenterLabel(recentUserContext) ?? null,
    areaScope: inferAreaScope(latestUserTurn) ?? inferAreaScope(recentUserContext),
    constraints: [...new Set(constraints)],
    avoid,
    latestUserTurn,
    recentUserContext,
  };
}

function inferMeal(content: string): MealIntent {
  if (/\bbreakfast\b/i.test(content)) {
    return "breakfast";
  }
  if (/\blunch\b/i.test(content)) {
    return "lunch";
  }
  if (/\bdinner|evening\s+(?:meal|food|dining)\b/i.test(content)) {
    return "dinner";
  }
  return null;
}

function inferAreaScope(content: string): FoodRequestIntent["areaScope"] {
  if (/\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(content)) {
    return "nearby";
  }
  if (/\bon\s+the\s+way|route|from\s+.+\s+to/i.test(content)) {
    return "nearby";
  }
  if (inferCenterLabel(content)) {
    return "in_area";
  }
  return null;
}

function inferConstraints(content: string) {
  const constraints: string[] = [];
  if (/\brain(?:y|ing)?|downpour|storm/i.test(content)) {
    constraints.push("rainy_day", "covered_seating");
  }
  if (/\bcovered|indoors?|inside\b/i.test(content)) {
    constraints.push("covered_seating");
  }
  return constraints;
}

function inferAvoidTerms({
  explicitlyRequestedCafe,
  latestUserTurn,
  meal,
}: {
  explicitlyRequestedCafe: boolean;
  latestUserTurn: string;
  meal: MealIntent;
}) {
  const avoid: string[] = [];
  if (meal === "dinner" && !explicitlyRequestedCafe) {
    avoid.push("brunch_only", "coffee_only");
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(latestUserTurn)) {
    avoid.push("carinderia", "canteen");
  }
  return avoid;
}

function inferCenterLabel(content: string) {
  const normalizedContent = normalizeKey(content);
  const sortedLocations = Object.values(gazetteer).sort((a, b) => b.label.length - a.label.length);
  return sortedLocations.find((location) =>
    normalizedContent.includes(normalizeKey(location.label)),
  )?.label;
}

function inferFoodSearchTerm(intent: FoodRequestIntent) {
  const primaryIntentText = `${intent.latestUserTurn} ${intent.recentUserContext}`;
  if (/\bseafood\b/i.test(primaryIntentText)) {
    return "seafood restaurant";
  }
  if (
    /\bbeachfront\b/i.test(primaryIntentText) &&
    /\b(caf[eé]s?|coffee)\b/i.test(primaryIntentText)
  ) {
    return "beachfront cafe";
  }
  if (/\bbeachfront\b/i.test(primaryIntentText)) {
    return "beachfront restaurant";
  }
  if (/\b(caf[eé]s?|coffee)\b/i.test(primaryIntentText)) {
    return "cafe";
  }
  if (/\b(bars?|nightlife|drinks?)\b/i.test(primaryIntentText)) {
    return "bar";
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(intent.latestUserTurn)) {
    return "sit down restaurant";
  }
  if (intent.meal === "breakfast") {
    return "breakfast restaurants";
  }
  if (intent.meal === "lunch") {
    return "lunch restaurants";
  }
  if (intent.meal === "dinner") {
    return "dinner restaurants";
  }
  return "good restaurant";
}

function inferIncludedType(foodTerm: string) {
  if (/\bcafe\b/i.test(foodTerm)) {
    return "cafe";
  }
  if (/\bbar\b/i.test(foodTerm)) {
    return "bar";
  }
  return "restaurant";
}

function inferPreferredTerms(intent: FoodRequestIntent) {
  const terms = ["restaurant"];
  const primaryIntentText = `${intent.latestUserTurn} ${intent.recentUserContext}`;
  if (/\bseafood\b/i.test(primaryIntentText)) {
    terms.push("seafood");
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(intent.latestUserTurn)) {
    terms.push("restaurant", "grill");
  }
  if (/\b(caf[eé]s?|coffee)\b/i.test(primaryIntentText)) {
    terms.push("cafe", "coffee");
  }
  if (/\bbeachfront\b/i.test(primaryIntentText)) {
    terms.push("beachfront", "resort", "restaurant", "cafe");
  }
  if (intent.meal === "lunch") {
    terms.push("lunch", "brunch", "cafe", "casual");
  }
  if (intent.meal === "dinner") {
    terms.push("dinner", "grill", "seafood", "bar", "rooftop", "evening");
  }
  if (intent.constraints.includes("covered_seating")) {
    terms.push("indoor", "covered", "restaurant");
  }
  return [...new Set(terms)];
}

function inferExcludedTerms(intent: FoodRequestIntent) {
  const terms = [...intent.avoid];
  if (intent.avoid.includes("brunch_only")) {
    terms.push("brunch");
  }
  if (intent.avoid.includes("coffee_only")) {
    terms.push("coffee_shop", "coffee shop", "cafe");
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(intent.latestUserTurn)) {
    terms.push("carinderia", "canteen");
  }
  return [...new Set(terms)];
}

function buildSearch(
  action: z.infer<typeof searchPlacesActionSchema>,
  locations: Record<string, ResolvedLocation>,
): GooglePlacesChatSearch {
  const centerLocation = action.centerLabel
    ? (locations[normalizeKey(action.centerLabel)] ?? gazetteer[normalizeKey(action.centerLabel)])
    : undefined;

  return {
    label: `agent_${slugPart(action.query)}`,
    textQuery: normalizeSiargaoQuery(action.query),
    ...(action.includedType ? { includedType: action.includedType } : {}),
    center: centerLocation?.center ?? gazetteer["general luna"].center,
    radiusMeters:
      action.radiusMeters ??
      (/\bnear(?:by)?|close\s+to|around\b/i.test(action.query) ? 6_000 : 12_000),
    pageSize: 8,
  };
}

function placeCandidateFromGooglePlace(
  place: GooglePlacesChatPlace,
  sourceQuery: string,
  searchCenter: GooglePlacesChatSearch["center"],
): PlaceCandidate {
  const distanceMeters =
    place.latitude === undefined || place.longitude === undefined
      ? undefined
      : distanceMetersBetween(searchCenter, {
          latitude: place.latitude,
          longitude: place.longitude,
        });

  return {
    placeId: place.placeId,
    name: place.displayName,
    formattedAddress: place.formattedAddress,
    primaryType: place.primaryType,
    types: place.types,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    currentOpeningHours: place.currentOpeningHours,
    regularOpeningHours: place.regularOpeningHours,
    googleMapsUri: place.googleMapsUri,
    sourceQuery,
    distanceMeters,
    latitude: place.latitude,
    longitude: place.longitude,
    score: 0,
  };
}

function dedupeCandidates(candidates: PlaceCandidate[]) {
  const byPlaceId = new Map<string, PlaceCandidate>();
  for (const candidate of candidates) {
    byPlaceId.set(candidate.placeId, candidate);
  }
  return [...byPlaceId.values()];
}

function rankCandidates(
  candidates: PlaceCandidate[],
  criteria: z.infer<typeof rankCandidatesActionSchema>,
) {
  const preferredTerms = criteria.preferredTerms.map((term) => term.toLowerCase());
  const excludedTerms = criteria.excludedTerms.map((term) => term.toLowerCase());

  const scoredCandidates = candidates.map((candidate) => {
    const searchable =
      `${candidate.name} ${candidate.formattedAddress ?? ""} ${candidate.primaryType ?? ""} ${candidate.types.join(" ")}`.toLowerCase();
    const excluded = excludedTerms.some((term) => searchable.includes(term));
    const excludedPenalty = excluded ? -1_000 : 0;
    const preferredBonus = preferredTerms.filter((term) => searchable.includes(term)).length * 75;
    const openingHoursScore =
      candidate.currentOpeningHours?.openNow === false
        ? -300
        : candidate.currentOpeningHours?.openNow === true
          ? 40
          : 0;
    const nearQueryDistanceScore = /\bnear(?:by)?|close\s+to|around\b/i.test(candidate.sourceQuery)
      ? -Math.min(candidate.distanceMeters ?? 0, 8_000) / 80
      : 0;
    const reviewScore = Math.min(candidate.userRatingCount ?? 0, 500) / 5;
    const ratingScore = (candidate.rating ?? 0) * 20;

    return {
      ...candidate,
      excludedByRanking: excluded,
      score:
        excludedPenalty +
        preferredBonus +
        openingHoursScore +
        nearQueryDistanceScore +
        reviewScore +
        ratingScore,
    };
  });
  const candidatesToRender = scoredCandidates.some((candidate) => !candidate.excludedByRanking)
    ? scoredCandidates.filter((candidate) => !candidate.excludedByRanking)
    : scoredCandidates;

  return candidatesToRender.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function renderRecommendationAnswer(
  candidates: readonly PlaceCandidate[],
  actions: readonly RecommendationAction[],
  intent: FoodRequestIntent,
) {
  const searchActions = actions.filter((action) => action.type === "search_places");

  if (candidates.length === 0) {
    const fallbackSearches = searchActions.slice(-3).map((action) => ({
      query: action.query,
      url: googleMapsSearchUri(action.query),
    }));

    if (fallbackSearches.length === 0) {
      return "I could not verify useful place options for that request.";
    }

    return [
      "I could not verify exact place listings, so I will not name a restaurant as confirmed.",
      "",
      "Tap these searches instead:",
      ...fallbackSearches.map((search) => `- ${search.query}: ${search.url}`),
    ].join("\n");
  }

  const centerLabel = searchActions.at(-1)?.centerLabel ?? intent.location ?? "the requested area";
  const caveats = compactMealFollowUpCaveat(intent)
    ? ["Checked Google Places for open nearby options. Covered seating and bookings not verified."]
    : [
        "Checked: Google Places ratings, open-now signal, distance, addresses, and map links.",
        "Not checked: covered seating, bookings, review text, or independent local validation.",
      ];

  return [
    "Good options I found from Google Places:",
    ...caveats,
    "",
    ...candidates.slice(0, 4).map((candidate, index) => {
      const rating =
        candidate.rating && candidate.userRatingCount
          ? `\n  Rating: ${candidate.rating} (${candidate.userRatingCount.toLocaleString()} reviews)`
          : "";
      const address = candidate.formattedAddress ? `\n  Area: ${candidate.formattedAddress}` : "";
      return `${index + 1}. **${candidate.name}**\n  Best fit: ${candidateFitLabel(
        candidate,
        index,
        centerLabel,
      )}${rating}${address}\n  Maps: ${candidate.googleMapsUri}`;
    }),
  ].join("\n");
}

function openingHoursLabel(hours: GooglePlacesOpeningHours | undefined) {
  if (hours?.openNow === true) {
    return "open now";
  }
  if (hours?.openNow === false) {
    return "currently closed";
  }
  return "hours not returned";
}

function distanceFitLabel(distanceMeters: number, centerLabel: string, index: number) {
  const distanceLabel = `${formatDistance(distanceMeters)} from ${centerLabel}`;
  if (index === 0) {
    return `closest strong match, ${distanceLabel}`;
  }
  if (distanceMeters < 1_000) {
    return `close option, ${distanceLabel}`;
  }
  if (distanceMeters < 4_000) {
    return `short ride, ${distanceLabel}`;
  }
  return `broader-area option, ${distanceLabel}`;
}

function candidateFitLabel(candidate: PlaceCandidate, index: number, centerLabel: string) {
  const fitParts: string[] = [];
  if (candidate.distanceMeters !== undefined) {
    fitParts.push(distanceFitLabel(candidate.distanceMeters, centerLabel, index));
  } else if (index === 0) {
    fitParts.push("top-ranked match");
  }
  fitParts.push(openingHoursLabel(candidate.currentOpeningHours));
  return `${fitParts.join(", ")}.`;
}

function compactMealFollowUpCaveat(intent: FoodRequestIntent) {
  return (
    intent.meal !== null &&
    /\b(what\s+about|how\s+about|instead|also|and\s+(?:lunch|dinner|breakfast))\b/i.test(
      intent.latestUserTurn,
    ) &&
    isPlaceRecommendationContent(intent.recentUserContext)
  );
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}

function distanceMetersBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadiusMeters = 6_371_000;
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function googleMapsSearchUri(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    normalizeSiargaoQuery(query),
  )}`;
}

function normalizeSiargaoQuery(query: string) {
  return /\bsiargao\b/i.test(query) ? query : `${query} Siargao Philippines`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function summarizeActionForLogs(action: RecommendationAction) {
  switch (action.type) {
    case "resolve_location":
      return { type: action.type, text: action.text };
    case "search_places":
      return {
        type: action.type,
        query: action.query,
        centerLabel: action.centerLabel,
        includedType: action.includedType,
        radiusMeters: action.radiusMeters,
      };
    case "rank_candidates":
      return {
        type: action.type,
        preferredTerms: action.preferredTerms,
        excludedTerms: action.excludedTerms,
      };
    case "ask_clarifying_question":
      return { type: action.type };
    case "final_answer":
    case "unsupported":
      return { type: action.type };
  }
}

function summarizeFoodIntentForLogs(intent: FoodRequestIntent) {
  return {
    areaScope: intent.areaScope,
    avoid: intent.avoid,
    category: intent.category,
    constraints: intent.constraints,
    location: intent.location,
    meal: intent.meal,
  };
}

function compactLogFields(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

const recommendationPlannerInstructions = [
  "You are a planner for Ask Siargao recommendations.",
  "Return exactly one JSON action and no prose.",
  "Use resolve_location before location-specific searches when the relevant location is not in knownLocations.",
  "Use search_places to gather provider candidates. Prefer multiple searches over asking clarifying questions when the request can be reasonably attempted.",
  "Use rank_candidates after searches when candidates are available.",
  "Use final_answer only after candidates have been ranked or after the useful searches have returned no candidates.",
  "Use ask_clarifying_question only when required information is missing and cannot be inferred from the conversation.",
  "Use unsupported for non-place, non-route, or non-recommendation requests.",
].join("\n");

const recommendationActionJsonSchema = {
  type: "object",
  anyOf: [
    actionSchemaVariant({
      type: "resolve_location",
      required: ["type", "text"],
      properties: { text: { type: "string" } },
    }),
    actionSchemaVariant({
      type: "search_places",
      required: ["type", "query"],
      properties: {
        query: { type: "string" },
        centerLabel: { type: "string" },
        radiusMeters: { type: "integer", minimum: 1, maximum: 60_000 },
        includedType: { type: "string" },
      },
    }),
    actionSchemaVariant({
      type: "rank_candidates",
      required: ["type", "preferredTerms", "excludedTerms"],
      properties: {
        preferredTerms: { type: "array", items: { type: "string" } },
        excludedTerms: { type: "array", items: { type: "string" } },
      },
    }),
    actionSchemaVariant({
      type: "ask_clarifying_question",
      required: ["type", "question"],
      properties: { question: { type: "string" } },
    }),
    actionSchemaVariant({ type: "final_answer", required: ["type"], properties: {} }),
    actionSchemaVariant({ type: "unsupported", required: ["type"], properties: {} }),
  ],
};

function actionSchemaVariant({
  properties,
  required,
  type,
}: {
  type: RecommendationAction["type"];
  required: string[];
  properties: Record<string, unknown>;
}) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      type: { const: type },
      ...properties,
    },
  };
}
