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

export type AnswerContext = {
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
    const freshRows = await this.#findFreshRows(requirement, now);
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
      const context = await this.#googlePlacesAdapter({
        fetchedAt: now,
        search: requirement.search,
      });
      await this.#persistGooglePlacesContext(context);

      const refreshedRows = await this.#findFreshRows(requirement, now);
      if (refreshedRows.length > 0) {
        return answerContextFromRows(refreshedRows, {
          liveRefreshCount: 1,
          sourceStatus: "refreshed",
        });
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

  if (!isPlacesRecommendationQuestion(content)) {
    return undefined;
  }

  const primaryType = detectGooglePlacesIncludedType(content);
  const area = detectGooglePlacesSearchArea(content);
  return {
    kind: "google_places_search",
    primaryType,
    search: {
      label: `chat_${primaryType ?? "place"}_${area.slug}`,
      textQuery: normalizeGooglePlacesTextQuery(content),
      ...(primaryType ? { includedType: primaryType } : {}),
      center: area.center,
      radiusMeters: area.radiusMeters,
      pageSize: 8,
    },
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
  const facts = rows.flatMap((row): AnswerFact[] => {
    const displayName = readDisplayName(row.display_name_json) ?? row.place_id;
    return [
      {
        id: `answer_fact_${slugPart(row.place_id)}_place`,
        type: "place_candidate",
        claim: `${displayName} is a Google Places candidate for this request.`,
        sourceRecordIds: [],
        requiresGoogleAttribution: true,
      },
      ...(row.rating
        ? [
            {
              id: `answer_fact_${slugPart(row.place_id)}_rating`,
              type: "google_rating_signal",
              claim: `${displayName} has a Google rating signal of ${row.rating}.`,
              value: Number(row.rating),
              sourceRecordIds: [],
              requiresGoogleAttribution: true,
            },
          ]
        : []),
      ...(row.user_rating_count
        ? [
            {
              id: `answer_fact_${slugPart(row.place_id)}_review_count`,
              type: "google_review_count_signal",
              claim: `${displayName} has ${row.user_rating_count} Google user rating signals.`,
              value: row.user_rating_count,
              sourceRecordIds: [],
              requiresGoogleAttribution: true,
            },
          ]
        : []),
      ...(row.price_level
        ? [
            {
              id: `answer_fact_${slugPart(row.place_id)}_price`,
              type: "google_price_signal",
              claim: `${displayName} has Google price information: ${row.price_level}.`,
              value: row.price_level,
              sourceRecordIds: [],
              requiresGoogleAttribution: true,
            },
          ]
        : []),
      ...(row.google_maps_uri
        ? [
            {
              id: `answer_fact_${slugPart(row.place_id)}_map_link`,
              type: "map_link",
              claim: `${displayName} has a Google Maps link.`,
              value: row.google_maps_uri,
              sourceRecordIds: [],
              requiresGoogleAttribution: true,
            },
          ]
        : []),
    ];
  });

  return {
    facts,
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

function isPlacesRecommendationQuestion(content: string) {
  return /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch|cafes?|coffee|bars?|nightlife|places?\s+near|nearby\s+places?|best\s+.+\s+(near|around))\b/i.test(
    content,
  );
}

function detectGooglePlacesIncludedType(content: string) {
  if (/\b(cafes?|coffee)\b/i.test(content)) {
    return "cafe";
  }

  if (/\b(bars?|nightlife|cocktails?|drinks?)\b/i.test(content)) {
    return "bar";
  }

  if (
    /\b(restaurants?|where\s+should\s+(we|i)\s+eat|eat|food|dinner|lunch|breakfast|brunch)\b/i.test(
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
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 4_000,
    };
  }

  if (/\bgeneral\s+luna\b/i.test(content)) {
    return {
      slug: "general_luna",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 7_000,
    };
  }

  return {
    slug: "siargao",
    center: { latitude: 9.8006, longitude: 126.1586 },
    radiusMeters: 12_000,
  };
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
