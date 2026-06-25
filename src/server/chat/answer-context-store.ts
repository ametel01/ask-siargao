import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatPlace,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
} from "@/server/providers/google-places-chat";
import {
  createGooglePlaceSnapshotInput,
  findFreshPlacesForSearchRequirement,
  type GooglePlaceDetailsInput,
  type GooglePlacesStoreDatabase,
  upsertGooglePlaceDetails,
} from "@/server/providers/google-places-store";

export type AnswerContextRequest = {
  messages: readonly AskSiargaoChatMessage[];
  tripId?: string;
  userMessageId?: string;
};

export type AnswerFact = {
  id: string;
  type: string;
  claim: string;
  value?: string | number | boolean;
  sourceRecordIds: string[];
  requiresGoogleAttribution: boolean;
};

export type EvidenceSummary = {
  id: string;
  sourceName: string;
  citationUrl?: string;
  fetchedAt?: string;
  staleAt?: string;
  retentionExpiresAt?: string;
};

export type FactGap = {
  type: string;
  reason: "not_required" | "missing" | "stale" | "expired" | "refresh_blocked" | "refresh_failed";
  message: string;
};

export type SourceFreshness = {
  sourceName: string;
  status: "fresh" | "refreshed" | "missing" | "blocked";
  fetchedAt?: string;
  staleAt?: string;
  retentionExpiresAt?: string;
};

export type AnswerPlace = {
  name: string;
  placeId: string;
  sourceName: "Google Places";
  formattedAddress?: string;
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  googleMapsUri?: string;
  requiresGoogleAttribution: true;
};

export type AnswerContext = {
  places: AnswerPlace[];
  facts: AnswerFact[];
  evidence: EvidenceSummary[];
  gaps: FactGap[];
  sourceFreshness: SourceFreshness[];
  liveRefreshCount: number;
  estimatedProviderCostUsd: number;
};

export type AnswerContextStoreDependencies = {
  db: GooglePlacesStoreDatabase;
  googlePlacesAdapter?: (input: {
    fetchedAt: string;
    search: GooglePlacesChatSearch;
  }) => Promise<GooglePlacesChatContext>;
  clock?: () => Date;
  canUseLiveRefresh?: (request: PlannedGoogleRequirement) => boolean | Promise<boolean>;
};

export type PlannedGoogleRequirement = {
  kind: "google_places_search";
  primaryType?: string;
  search: GooglePlacesChatSearch;
};

export class AnswerContextStore {
  readonly #db: GooglePlacesStoreDatabase;
  readonly #googlePlacesAdapter: NonNullable<AnswerContextStoreDependencies["googlePlacesAdapter"]>;
  readonly #clock: () => Date;
  readonly #canUseLiveRefresh: NonNullable<AnswerContextStoreDependencies["canUseLiveRefresh"]>;

  constructor({
    canUseLiveRefresh = () => true,
    clock = () => new Date(),
    db,
    googlePlacesAdapter = ({ fetchedAt, search }) =>
      getGooglePlacesChatContext({ fetchedAt, search }),
  }: AnswerContextStoreDependencies) {
    this.#db = db;
    this.#googlePlacesAdapter = googlePlacesAdapter;
    this.#clock = clock;
    this.#canUseLiveRefresh = canUseLiveRefresh;
  }

  async getOrRefresh(request: AnswerContextRequest): Promise<AnswerContext> {
    const requirement = planGooglePlacesRequirement(request.messages);
    if (!requirement) {
      return emptyAnswerContext({
        gaps: [
          {
            type: "google_places",
            reason: "not_required",
            message: "No Google Places data is required for this answer.",
          },
        ],
      });
    }

    const now = this.#clock().toISOString();
    const freshRows = await this.#findFreshRowsOrEmpty(requirement, now);
    if (freshRows.length > 0) {
      return answerContextFromRows(freshRows, {
        liveRefreshCount: 0,
        sourceStatus: "fresh",
      });
    }

    if (!(await this.#canUseLiveRefresh(requirement))) {
      return emptyAnswerContext({
        gaps: [
          {
            type: "google_places",
            reason: "refresh_blocked",
            message:
              "Stored Google Places data is missing, stale, or expired, and live refresh is not allowed.",
          },
        ],
        sourceFreshness: [{ sourceName: "Google Places", status: "blocked" }],
      });
    }

    try {
      return await this.#refreshGooglePlacesContext(requirement, now);
    } catch {
      return emptyAnswerContext({
        gaps: [
          {
            type: "google_places",
            reason: "refresh_failed",
            message: "Google Places refresh failed, so no live provider facts are available.",
          },
        ],
        sourceFreshness: [{ sourceName: "Google Places", status: "missing" }],
      });
    }
  }

  async #findFreshRows(requirement: PlannedGoogleRequirement, now: string) {
    return findFreshPlacesForSearchRequirement(this.#db, {
      now,
      primaryType: requirement.primaryType,
      limit: requirement.search.pageSize,
    });
  }

  async #findFreshRowsOrEmpty(requirement: PlannedGoogleRequirement, now: string) {
    try {
      return await this.#findFreshRows(requirement, now);
    } catch {
      return [];
    }
  }

  async #refreshGooglePlacesContext(requirement: PlannedGoogleRequirement, now: string) {
    const context = await this.#googlePlacesAdapter({
      fetchedAt: now,
      search: requirement.search,
    });

    try {
      await this.#persistGooglePlacesContext(context);
      const refreshedRows = await this.#findFreshRows(requirement, now);
      if (refreshedRows.length > 0) {
        return answerContextFromRows(refreshedRows, {
          liveRefreshCount: 1,
          sourceStatus: "refreshed",
        });
      }
    } catch {
      // Keep the answer useful from bounded provider facts even when local persistence is unavailable.
    }

    if (context.places.length > 0) {
      return answerContextFromGooglePlacesContext(context);
    }

    return emptyAnswerContext({
      gaps: [
        {
          type: "google_places",
          reason: "missing",
          message: "Google Places refresh completed but did not return reusable facts.",
        },
      ],
      liveRefreshCount: 1,
      sourceFreshness: [{ sourceName: "Google Places", status: "missing" }],
    });
  }

  async #persistGooglePlacesContext(context: GooglePlacesChatContext) {
    await Promise.all(
      context.places.map(async (place) => {
        const snapshot = createGooglePlaceSnapshotInput({
          placeId: place.placeId,
          requestKind: "chat_search",
          fieldMask: context.fieldMask,
          fetchedAt: context.fetchedAt,
          payloadJson: place.captureJson ? { ...place.captureJson } : googlePlacePayload(place),
        });
        await upsertGooglePlaceDetails(this.#db, {
          place: {
            placeId: place.placeId,
            resourceName: place.resourceName,
          },
          sourceRecord: {
            id: `record_google_places_chat_${slugPart(place.placeId)}`,
            sourceProfileId: context.sourceProfileId,
            providerEntityId: place.placeId,
            entityType: place.primaryType ?? "place",
            name: place.displayName,
            normalizedPayload: {
              placeId: place.placeId,
              resourceName: place.resourceName,
              fieldMask: context.fieldMask,
              search: context.search,
            },
            sourceUrl: place.googleMapsUri,
            fetchedAt: context.fetchedAt,
            allowedUse: "citation_only",
          },
          snapshot,
          details: googlePlaceDetailsInputFromChatPlace(place, snapshot),
        });
      }),
    );
  }
}

export function planGooglePlacesRequirement(
  messages: readonly AskSiargaoChatMessage[],
): PlannedGoogleRequirement | undefined {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const content = latestUserMessage?.content ?? "";
  const conversationContent = messages.map((message) => message.content).join(" ");

  if (!isPlacesRecommendationQuestion(content, conversationContent)) {
    return undefined;
  }

  const primaryType =
    detectGooglePlacesIncludedType(content) ?? detectGooglePlacesIncludedType(conversationContent);
  const area = detectGooglePlacesSearchArea(`${content} ${conversationContent}`);
  const searchContent = contextualizeGooglePlacesSearchContent(
    content,
    primaryType,
    conversationContent,
  );
  return {
    kind: "google_places_search",
    primaryType,
    search: {
      label: `chat_${primaryType ?? "place"}_${area.slug}`,
      textQuery: normalizeGooglePlacesTextQuery(appendAreaToShortFollowUp(searchContent, area)),
      ...(primaryType ? { includedType: primaryType } : {}),
      center: area.center,
      radiusMeters: area.radiusMeters,
      pageSize: 8,
    },
  };
}

function answerContextFromGooglePlacesContext(context: GooglePlacesChatContext): AnswerContext {
  const places = context.places.map((place) =>
    answerPlaceFromGooglePlace({
      displayName: place.displayName,
      formattedAddress: place.formattedAddress,
      googleMapsUri: place.googleMapsUri,
      placeId: place.placeId,
      priceLevel: place.priceLevel,
      primaryType: place.primaryType,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
    }),
  );

  return {
    places,
    facts: places.flatMap(answerFactsForPlace),
    evidence: context.places.map((place) => ({
      id: `evidence_google_places_${slugPart(place.placeId)}`,
      sourceName: "Google Places",
      citationUrl: place.googleMapsUri,
      fetchedAt: context.fetchedAt,
    })),
    gaps: [],
    sourceFreshness: [
      {
        sourceName: "Google Places",
        status: "refreshed",
        fetchedAt: context.fetchedAt,
      },
    ],
    liveRefreshCount: 1,
    estimatedProviderCostUsd: 0.017,
  };
}

function answerContextFromRows(
  rows: Awaited<ReturnType<typeof findFreshPlacesForSearchRequirement>>,
  {
    liveRefreshCount,
    sourceStatus,
  }: {
    liveRefreshCount: number;
    sourceStatus: "fresh" | "refreshed";
  },
): AnswerContext {
  const places = rows.flatMap((row) => {
    const displayName = readDisplayName(row.display_name_json);
    if (!displayName) {
      return [];
    }

    return answerPlaceFromGooglePlace({
      displayName,
      formattedAddress: row.formatted_address ?? undefined,
      googleMapsUri: row.google_maps_uri ?? undefined,
      placeId: row.place_id,
      priceLevel: row.price_level ?? undefined,
      primaryType: row.primary_type ?? undefined,
      rating: row.rating ? Number(row.rating) : undefined,
      userRatingCount: row.user_rating_count ?? undefined,
    });
  });

  return {
    places,
    facts: places.flatMap(answerFactsForPlace),
    evidence: rows.map((row) => ({
      id: `evidence_google_places_${slugPart(row.place_id)}`,
      sourceName: "Google Places",
      citationUrl: row.google_maps_uri ?? undefined,
      fetchedAt: row.fetched_at.toISOString(),
      staleAt: row.stale_at.toISOString(),
      retentionExpiresAt: row.retention_expires_at.toISOString(),
    })),
    gaps: [],
    sourceFreshness: rows.map((row) => ({
      sourceName: "Google Places",
      status: sourceStatus,
      fetchedAt: row.fetched_at.toISOString(),
      staleAt: row.stale_at.toISOString(),
      retentionExpiresAt: row.retention_expires_at.toISOString(),
    })),
    liveRefreshCount,
    estimatedProviderCostUsd: liveRefreshCount > 0 ? 0.017 : 0,
  };
}

function answerPlaceFromGooglePlace({
  displayName,
  formattedAddress,
  googleMapsUri,
  placeId,
  priceLevel,
  primaryType,
  rating,
  userRatingCount,
}: {
  displayName: string;
  formattedAddress?: string;
  placeId: string;
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  googleMapsUri?: string;
}): AnswerPlace {
  return {
    name: displayName,
    placeId,
    sourceName: "Google Places",
    formattedAddress,
    primaryType,
    rating,
    userRatingCount,
    priceLevel,
    googleMapsUri,
    requiresGoogleAttribution: true,
  };
}

function answerFactsForPlace({
  googleMapsUri,
  name,
  placeId,
  priceLevel,
  rating,
  userRatingCount,
}: AnswerPlace): AnswerFact[] {
  const slug = slugPart(placeId);

  return [
    {
      id: `answer_fact_${slug}_place`,
      type: "place_candidate",
      claim: `${name} is a Google Places candidate for this request.`,
      sourceRecordIds: [],
      requiresGoogleAttribution: true,
    },
    ...(rating
      ? [
          {
            id: `answer_fact_${slug}_rating`,
            type: "google_rating_signal",
            claim: `${name} has a Google rating signal of ${rating}.`,
            value: rating,
            sourceRecordIds: [],
            requiresGoogleAttribution: true,
          },
        ]
      : []),
    ...(userRatingCount
      ? [
          {
            id: `answer_fact_${slug}_review_count`,
            type: "google_review_count_signal",
            claim: `${name} has ${userRatingCount} Google user rating signals.`,
            value: userRatingCount,
            sourceRecordIds: [],
            requiresGoogleAttribution: true,
          },
        ]
      : []),
    ...(priceLevel
      ? [
          {
            id: `answer_fact_${slug}_price`,
            type: "google_price_signal",
            claim: `${name} has Google price information: ${priceLevel}.`,
            value: priceLevel,
            sourceRecordIds: [],
            requiresGoogleAttribution: true,
          },
        ]
      : []),
    ...(googleMapsUri
      ? [
          {
            id: `answer_fact_${slug}_map_link`,
            type: "map_link",
            claim: `${name} has a Google Maps link.`,
            value: googleMapsUri,
            sourceRecordIds: [],
            requiresGoogleAttribution: true,
          },
        ]
      : []),
  ];
}

function emptyAnswerContext({
  gaps = [],
  liveRefreshCount = 0,
  sourceFreshness = [],
}: {
  gaps?: FactGap[];
  liveRefreshCount?: number;
  sourceFreshness?: SourceFreshness[];
}): AnswerContext {
  return {
    places: [],
    facts: [],
    evidence: [],
    gaps,
    sourceFreshness,
    liveRefreshCount,
    estimatedProviderCostUsd: liveRefreshCount > 0 ? 0.017 : 0,
  };
}

function googlePlaceDetailsInputFromChatPlace(
  place: GooglePlacesChatPlace,
  snapshot: ReturnType<typeof createGooglePlaceSnapshotInput>,
): GooglePlaceDetailsInput {
  return {
    displayNameJson: place.captureJson?.displayNameJson ?? { text: place.displayName },
    formattedAddress: place.formattedAddress,
    locationJson: place.captureJson?.locationJson,
    latitude: place.latitude,
    longitude: place.longitude,
    typesJson: place.types,
    primaryType: place.primaryType,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    websiteUri: place.websiteUri,
    internationalPhoneNumber: place.internationalPhoneNumber,
    openingHoursJson: place.currentOpeningHours,
    priceLevel: place.priceLevel,
    priceRangeJson: place.priceRange,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    fetchedAt: snapshot.fetchedAt,
    staleAt: snapshot.staleAt,
    retentionExpiresAt: snapshot.retentionExpiresAt ?? snapshot.staleAt,
  };
}

function googlePlacePayload(place: GooglePlacesChatPlace) {
  return {
    placeId: place.placeId,
    resourceName: place.resourceName,
    displayNameJson: { text: place.displayName },
    formattedAddress: place.formattedAddress,
    locationJson:
      place.latitude === undefined || place.longitude === undefined
        ? undefined
        : { latitude: place.latitude, longitude: place.longitude },
    typesJson: place.types,
    primaryType: place.primaryType,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
  };
}

function isPlacesRecommendationQuestion(content: string, conversationContent = content) {
  if (
    /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch|date[-\s]?night|romantic|cafes?|coffee|bars?|nightlife|hotels?|hostels?|resorts?|villas?|lodging|accomm?odations?|where\s+to\s+stay|places?\s+to\s+stay|places?\s+near|nearby\s+places?|ratings?|rated|reviews?|best\s+.+\s+(near|around))\b/i.test(
      content,
    )
  ) {
    return true;
  }

  return (
    hasPriorPlacesRecommendationQuestion(conversationContent) &&
    /\b(quiet|lively|casual|nice|date[-\s]?night|romantic|seaside|beachfront|local|filipino|seafood|healthy|budget|cheap|fine\s+dining|cocktails?|open\s+now|tonight|nearby|best|good)\b/i.test(
      content,
    )
  );
}

function hasPriorPlacesRecommendationQuestion(conversationContent: string) {
  return /\b(restaurants?|where\s+should\s+(we|i)\s+eat|food|dinner|lunch|breakfast|brunch|cafes?|coffee|bars?|nightlife|hotels?|hostels?|resorts?|villas?|lodging|accomm?odations?|where\s+to\s+stay|places?\s+to\s+stay)\b/i.test(
    conversationContent,
  );
}

function contextualizeGooglePlacesSearchContent(
  content: string,
  primaryType: string | undefined,
  conversationContent: string,
) {
  if (!primaryType || detectGooglePlacesIncludedType(content)) {
    return content;
  }

  const descriptorByPrimaryType: Record<string, string> = {
    bar: "bar",
    cafe: "cafe",
    lodging: "accommodation",
    restaurant: "restaurant",
  };
  const descriptor = descriptorByPrimaryType[primaryType];

  if (!descriptor || !hasPriorPlacesRecommendationQuestion(conversationContent)) {
    return content;
  }

  return `${content} ${descriptor}`;
}

function detectGooglePlacesIncludedType(content: string) {
  if (
    /\b(hotels?|hostels?|resorts?|villas?|lodging|accomm?odations?|where\s+to\s+stay|places?\s+to\s+stay)\b/i.test(
      content,
    )
  ) {
    return "lodging";
  }

  if (/\b(cafes?|coffee)\b/i.test(content)) {
    return "cafe";
  }

  if (/\b(bars?|nightlife|cocktails?|drinks?)\b/i.test(content)) {
    return "bar";
  }

  if (
    /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch|date[-\s]?night|romantic)\b/i.test(
      content,
    )
  ) {
    return "restaurant";
  }

  return undefined;
}

function detectGooglePlacesSearchArea(content: string) {
  if (/\b(cloud\s*9|cloud9|catangnan)\b/i.test(content)) {
    return {
      slug: "cloud_9",
      label: "Cloud 9",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 4_000,
    };
  }

  if (/\bgeneral\s+luna\b/i.test(content)) {
    return {
      slug: "general_luna",
      label: "General Luna",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 7_000,
    };
  }

  return {
    slug: "siargao",
    label: "Siargao",
    center: { latitude: 9.8006, longitude: 126.1586 },
    radiusMeters: 12_000,
  };
}

function appendAreaToShortFollowUp(
  content: string,
  area: ReturnType<typeof detectGooglePlacesSearchArea>,
) {
  if (/\b(siargao|general\s+luna|cloud\s*9|cloud9|catangnan)\b/i.test(content)) {
    return content;
  }

  return `${content} near ${area.label}`;
}

function normalizeGooglePlacesTextQuery(content: string) {
  const textQuery = content
    .trim()
    .replaceAll(/\s+/g, " ")
    .replace(/[.?!]+$/g, "");
  return /\bsiargao\b/i.test(textQuery) ? textQuery : `${textQuery} Siargao Philippines`;
}

function readDisplayName(value: Record<string, unknown> | null) {
  const text = value?.text;
  return typeof text === "string" ? text : undefined;
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
