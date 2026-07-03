import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
} from "@/server/providers/google-places-chat";
import { createDefaultCachedGooglePlacesChatContextAdapter } from "@/server/providers/google-places-chat-cache";
import {
  enrichGooglePlacesDetails,
  type GooglePlacesDetails,
} from "@/server/providers/google-places-enrichment";
import {
  findFreshPlaceDetails,
  type GooglePlacesStoreDatabase,
} from "@/server/providers/google-places-store";

export type PlacesEvidenceAdapterDependencies = {
  enrichGooglePlacesDetails?: typeof enrichGooglePlacesDetails;
  findFreshPlaceDetails?: typeof findFreshPlaceDetails;
  getGooglePlacesChatContext?: (input: {
    cacheMode?: "standard" | "no_store";
    fetchedAt: string;
    requiresLiveStatus?: boolean;
    search: GooglePlacesChatSearch;
    trace?: { requestId?: string };
  }) => Promise<GooglePlacesChatContext>;
  googlePlacesApiKey?: string;
  googlePlacesDetailsDb?: GooglePlacesStoreDatabase;
  googlePlacesFetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

export type PlacesEvidenceAdapter = {
  search(input: {
    cacheMode?: "standard" | "no_store";
    fetchedAt: string;
    requiresLiveStatus?: boolean;
    search: GooglePlacesChatSearch;
    trace?: { requestId?: string };
  }): Promise<GooglePlacesChatContext>;
  findFreshDetails(input: { now: string; placeId: string }): Promise<GooglePlacesDetails | null>;
  getLiveDetails(input: { fetchedAt: string; placeId: string }): Promise<GooglePlacesDetails[]>;
};

export function createPlacesEvidenceAdapter(
  dependencies: PlacesEvidenceAdapterDependencies = {},
): PlacesEvidenceAdapter {
  return {
    search: (input) => getGooglePlacesSearchContext(input, dependencies),
    findFreshDetails: async ({ now, placeId }) => {
      const cached = await findCachedPlaceDetails(placeId, now, dependencies);
      return cached ? normalizeCachedPlaceDetails(cached) : null;
    },
    getLiveDetails: ({ fetchedAt, placeId }) =>
      getLivePlaceDetails(placeId, fetchedAt, dependencies),
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
  dependencies: PlacesEvidenceAdapterDependencies,
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
  dependencies: PlacesEvidenceAdapterDependencies,
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

  const sql = postgres(databaseUrl, createPostgresConnectionOptions("cli"));
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
  dependencies: PlacesEvidenceAdapterDependencies,
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

function normalizeCachedPlaceDetails(
  cached: NonNullable<Awaited<ReturnType<typeof findFreshPlaceDetails>>>,
) {
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

function googlePlacesOpeningHoursFromJson(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(typeof value.openNow === "boolean" ? { openNow: value.openNow } : {}),
    ...(Array.isArray(value.weekdayDescriptions)
      ? {
          weekdayDescriptions: value.weekdayDescriptions.filter(
            (item): item is string => typeof item === "string",
          ),
        }
      : {}),
    ...(typeof value.nextOpenTime === "string" ? { nextOpenTime: value.nextOpenTime } : {}),
    ...(typeof value.nextCloseTime === "string" ? { nextCloseTime: value.nextCloseTime } : {}),
  };
}

function googlePlacesPriceRangeFromJson(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function readLocalizedText(value: unknown) {
  return isRecord(value) && typeof value.text === "string" ? value.text : undefined;
}

function numberOrUndefined(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const inertGooglePlacesStoreDatabase: GooglePlacesStoreDatabase = {
  async query<T>() {
    return { rows: [] as T[] };
  },
};
