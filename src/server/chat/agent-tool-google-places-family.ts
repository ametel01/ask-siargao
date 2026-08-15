import { z } from "zod";
import type {
  AgentToolExecutionContext,
  AgentToolExecutionRequest,
  AgentToolResult,
  ChatAction,
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
  currentIso,
  isRecord,
  optionalNullable,
  slugPart,
  uniqueText,
} from "@/server/chat/agent-tool-utils";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { rankLocalRecommendationCandidates } from "@/server/chat/local-recommendation";
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

type GooglePlacesToolExecutionContext = NonNullable<AgentToolExecutionContext["googlePlaces"]>;

const siargaoCenterSchema = z.strictObject({
  latitude: z.number().min(9.0).max(10.5),
  longitude: z.number().min(125.0).max(127.0),
});

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

export type SearchPlacesArguments = z.infer<typeof searchPlacesSchema>;
export type PlaceDetailsArguments = z.infer<typeof placeDetailsSchema>;

export type GooglePlacesToolContext = ReturnType<typeof normalizeGooglePlacesToolContext>;

export type GooglePlacesToolHandlers = {
  searchPlaces: ToolHandler<SearchPlacesArguments>;
  getPlaceDetails: ToolHandler<PlaceDetailsArguments>;
};

export function createGooglePlacesToolFamily(
  handlers: GooglePlacesToolHandlers = {
    searchPlaces: searchPlacesToolResult,
    getPlaceDetails: (args, _request, dependencies) =>
      getPlaceDetailsToolResult(args, dependencies),
  },
): AgentToolFamily {
  return {
    id: "google_places",
    toolNames: ["search_places", "get_place_details"],
    tools: {
      search_places: defineTool({
        definition: {
          type: "function",
          name: "search_places",
          description:
            "Search governed Google Places results for Siargao places, venues, and local services using allowed chat-search fields. The model chooses a natural-language query from the user's prompt; if another provider failed, successful Places evidence can still support a caveated answer.",
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
        execute: handlers.searchPlaces,
        argumentsForValidation: searchPlacesArgumentsForValidation,
      }),
      get_place_details: defineTool({
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
        execute: handlers.getPlaceDetails,
      }),
    },
  };
}

export function normalizeGooglePlacesToolContext(
  toolContext: AgentToolExecutionContext | undefined,
) {
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

export type GooglePlacesCenterContext = {
  centerSource: GooglePlacesToolExecutionContext["centerSource"];
  consentScope?: GooglePlacesToolExecutionContext["consentScope"];
};

function searchPlacesArgumentsForValidation(request: AgentToolExecutionRequest) {
  if (!isRecord(request.arguments)) {
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

export async function searchPlacesToolResult(
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

export async function getPlaceDetailsToolResult(
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
