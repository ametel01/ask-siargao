import type { Logger } from "pino";
import postgres from "postgres";

import { createComponentLogger } from "@/server/observability/logger";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatPlace,
  type GooglePlacesChatSearch,
  getGooglePlacesChatContext,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  createGooglePlaceSnapshotInput,
  type GooglePlaceDetailsInput,
  type GooglePlaceDetailsWriteSummary,
  type GooglePlacesSourceRecordInput,
  type GooglePlacesStoreDatabase,
  GooglePlacesStoreWriteError,
  upsertGooglePlaceDetails,
} from "@/server/providers/google-places-store";

type TraceContext = {
  requestId?: string;
};

type LiveGooglePlacesChatAdapter = (input: {
  fetchedAt: string;
  search: GooglePlacesChatSearch;
  trace?: TraceContext;
}) => Promise<GooglePlacesChatContext>;

type CachedGooglePlacesChatContextInput = {
  fetchedAt?: string;
  search: GooglePlacesChatSearch;
  trace?: TraceContext;
};

type CachedGooglePlacesChatContextDependencies = {
  db: GooglePlacesStoreDatabase;
  liveAdapter?: LiveGooglePlacesChatAdapter;
  logger?: Logger;
  minimumFreshCachePlaces?: number;
};

const googlePlacesChatCacheLogger = createComponentLogger("provider.google_places.chat_cache");
const defaultMinimumFreshCachePlaces = 4;
type PersistGooglePlacesChatContextOptions = {
  logger?: Logger;
};

export function createCachedGooglePlacesChatContextAdapter(
  dependencies: CachedGooglePlacesChatContextDependencies,
) {
  return (input: CachedGooglePlacesChatContextInput) =>
    getCachedGooglePlacesChatContext(input, dependencies);
}

export function createDefaultCachedGooglePlacesChatContextAdapter({
  databaseUrl = process.env.DATABASE_URL,
}: {
  databaseUrl?: string;
} = {}) {
  if (!databaseUrl) {
    return undefined;
  }

  return createCachedGooglePlacesChatContextAdapter({
    db: createPostgresGooglePlacesStoreDatabase(databaseUrl),
  });
}

async function getCachedGooglePlacesChatContext(
  { fetchedAt = new Date().toISOString(), search, trace }: CachedGooglePlacesChatContextInput,
  {
    db,
    liveAdapter = ({ fetchedAt: liveFetchedAt, search: liveSearch, trace: liveTrace }) =>
      getGooglePlacesChatContext({
        fetchedAt: liveFetchedAt,
        search: liveSearch,
        trace: liveTrace,
      }),
    logger = googlePlacesChatCacheLogger,
    minimumFreshCachePlaces = defaultMinimumFreshCachePlaces,
  }: CachedGooglePlacesChatContextDependencies,
): Promise<GooglePlacesChatContext> {
  const scopedLogger = logger.child(
    compactLogFields({
      requestId: trace?.requestId,
      cacheKey: googlePlacesChatSearchCacheKey(search),
    }),
  );
  const cachedContext = await findFreshGooglePlacesChatContext(db, { now: fetchedAt, search });
  const cacheStatus =
    cachedContext.places.length >= minimumFreshCachePlaces
      ? "hit"
      : cachedContext.places.length > 0
        ? "partial"
        : "miss";

  scopedLogger.info(
    {
      cacheStatus,
      cacheCandidateCount: cachedContext.places.length,
      minimumFreshCachePlaces,
      query: search.textQuery,
      includedType: search.includedType,
      radiusMeters: search.radiusMeters,
      pageSize: search.pageSize,
    },
    "Google Places chat cache checked.",
  );

  if (cacheStatus === "hit") {
    return cachedContext;
  }

  const liveContext = await liveAdapter({ fetchedAt, search, trace });
  const persistStartedAt = Date.now();
  const writeSummaries = await persistGooglePlacesChatContext(db, liveContext, {
    logger: scopedLogger,
  });
  const tableWriteSummary = googlePlacesTableWriteSummary(writeSummaries);

  scopedLogger.info(
    {
      cacheStatus,
      googleApiCalled: true,
      persistedPlaceIds: writeSummaries.map((summary) => summary.placeId),
      persistedPlaceCount: liveContext.places.length,
      persistedSourceRecordIds: writeSummaries.map((summary) => summary.sourceRecordId),
      persistedSnapshotIds: writeSummaries.flatMap((summary) =>
        summary.snapshotId === undefined ? [] : [summary.snapshotId],
      ),
      providerStatus: liveContext.status,
      tableWriteSummary,
      writeDurationMs: Date.now() - persistStartedAt,
    },
    "Google Places chat live lookup persisted.",
  );

  return liveContext;
}

async function findFreshGooglePlacesChatContext(
  db: GooglePlacesStoreDatabase,
  { now, search }: { now: string; search: GooglePlacesChatSearch },
): Promise<GooglePlacesChatContext> {
  const cacheKey = googlePlacesChatSearchCacheKey(search);
  const result = await db.query<{
    place_id: string;
    resource_name: string | null;
    source_record_name: string | null;
    display_name_json: { text?: string } | null;
    formatted_address: string | null;
    latitude: string | number | null;
    longitude: string | number | null;
    types_json: string[] | null;
    primary_type: string | null;
    business_status: string | null;
    google_maps_uri: string | null;
    rating: string | number | null;
    user_rating_count: number | null;
    opening_hours_json: unknown;
    price_level: string | null;
    price_range_json: unknown;
    website_uri: string | null;
    international_phone_number: string | null;
    snapshot_fetched_at: Date;
  }>(
    `
      select
        place_id,
        resource_name,
        source_record_name,
        display_name_json,
        formatted_address,
        latitude,
        longitude,
        types_json,
        primary_type,
        business_status,
        google_maps_uri,
        rating,
        user_rating_count,
        opening_hours_json,
        price_level,
        price_range_json,
        website_uri,
        international_phone_number,
        snapshot_fetched_at
      from (
        select
          d.place_id,
          gp.resource_name,
          sr.name as source_record_name,
          d.display_name_json,
          d.formatted_address,
          d.latitude::text as latitude,
          d.longitude::text as longitude,
          d.types_json,
          d.primary_type,
          d.business_status,
          d.google_maps_uri,
          d.rating::text as rating,
          d.user_rating_count,
          d.opening_hours_json,
          d.price_level,
          d.price_range_json,
          d.website_uri,
          d.international_phone_number,
          s.fetched_at as snapshot_fetched_at,
          nullif(s.payload_json->'search'->>'resultIndex', '')::int as result_index,
          row_number() over (partition by d.place_id order by s.fetched_at desc) as row_number
        from google_place_snapshots s
        join google_place_details d on d.place_id = s.place_id
        join google_places gp on gp.place_id = d.place_id
        left join source_records sr on sr.id = gp.latest_source_record_id
        where s.request_kind = 'chat_search'
          and s.payload_json->'search'->>'cacheKey' = $1
          and s.stale_at > $2
          and (s.retention_expires_at is null or s.retention_expires_at > $2)
          and d.stale_at > $2
          and d.retention_expires_at > $2
      ) fresh_places
      where row_number = 1
      order by result_index nulls last, snapshot_fetched_at desc
      limit $3
    `,
    [cacheKey, now, search.pageSize],
  );
  const places = result.rows.flatMap((row) => googlePlacesChatPlaceFromCachedRow(row));

  return {
    status: places.length > 0 ? "available" : "no_results",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt: result.rows[0]?.snapshot_fetched_at.toISOString() ?? now,
    freshness: "fresh_cache",
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    places,
    caveats: [
      "Returned from fresh cached Google Places chat search rows.",
      "It does not include review text, bookings, table availability, room availability, or verified local quality checks.",
      "Cached Google Places content still requires Google attribution and retention handling.",
    ],
  };
}

async function persistGooglePlacesChatContext(
  db: GooglePlacesStoreDatabase,
  context: GooglePlacesChatContext,
  { logger }: PersistGooglePlacesChatContextOptions = {},
) {
  return Promise.all(
    context.places.map(async (place, resultIndex): Promise<GooglePlaceDetailsWriteSummary> => {
      const capture = googlePlacesChatCaptureInput({ context, place, resultIndex });
      const placeLogger = logger?.child(
        compactLogFields({
          placeId: place.placeId,
          resultIndex,
          snapshotId: capture.snapshot?.id,
          sourceRecordId: capture.sourceRecord.id,
        }),
      );
      const writeStartedAt = Date.now();

      placeLogger?.debug(
        {
          businessStatus: place.businessStatus,
          displayName: place.displayName,
          primaryType: place.primaryType,
          rating: place.rating,
          requestKind: capture.snapshot?.requestKind,
          staleAt: capture.details.staleAt,
          userRatingCount: place.userRatingCount,
        },
        "Google Places chat DB place write started.",
      );

      try {
        const summary = await upsertGooglePlaceDetails(db, capture);

        placeLogger?.debug(
          {
            detailsUpserted: summary.detailsUpserted,
            durationMs: Date.now() - writeStartedAt,
            evidenceUpserted: summary.evidenceUpserted,
            factsUpserted: summary.factsUpserted,
            fetchedAt: summary.fetchedAt,
            placeIdentityUpserted: summary.placeIdentityUpserted,
            retentionExpiresAt: summary.retentionExpiresAt,
            snapshotUpserted: summary.snapshotUpserted,
            sourceRecordUpserted: summary.sourceRecordUpserted,
            staleAt: summary.staleAt,
          },
          "Google Places chat DB place write completed.",
        );

        return summary;
      } catch (error) {
        const writeError =
          error instanceof GooglePlacesStoreWriteError
            ? {
                phase: error.phase,
                placeId: error.placeId,
                snapshotId: error.snapshotId,
                sourceRecordId: error.sourceRecordId,
              }
            : undefined;

        placeLogger?.error(
          {
            err: error,
            durationMs: Date.now() - writeStartedAt,
            writeError,
          },
          "Google Places chat DB place write failed.",
        );
        throw error;
      }
    }),
  );
}

export function googlePlacesChatSearchCacheKey(search: GooglePlacesChatSearch) {
  return [
    normalizeCachePart(search.textQuery),
    normalizeCachePart(search.includedType ?? "any"),
    coordinatePart(search.center.latitude),
    coordinatePart(search.center.longitude),
    search.radiusMeters,
    search.pageSize,
  ].join("|");
}

function googlePlacesChatCaptureInput({
  context,
  place,
  resultIndex,
}: {
  context: GooglePlacesChatContext;
  place: GooglePlacesChatPlace;
  resultIndex: number;
}) {
  const snapshot = createGooglePlaceSnapshotInput({
    placeId: place.placeId,
    requestKind: "chat_search",
    fieldMask: context.fieldMask,
    fetchedAt: context.fetchedAt,
    payloadJson: {
      search: {
        cacheKey: googlePlacesChatSearchCacheKey(context.search),
        label: context.search.label,
        textQuery: context.search.textQuery,
        includedType: context.search.includedType,
        center: context.search.center,
        radiusMeters: context.search.radiusMeters,
        pageSize: context.search.pageSize,
        resultIndex,
      },
      place: place.captureJson ?? {
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
      },
    },
  });
  const sourceRecord: GooglePlacesSourceRecordInput = {
    id: `record_google_places_chat_${slugPart(place.placeId)}`,
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    providerEntityId: place.placeId,
    entityType: place.primaryType ?? place.types[0] ?? context.search.includedType ?? "place",
    name: place.displayName,
    normalizedPayload: {
      placeId: place.placeId,
      resourceName: place.resourceName,
      searchCacheKey: googlePlacesChatSearchCacheKey(context.search),
      searchLabel: context.search.label,
      textQuery: context.search.textQuery,
      fieldMask: context.fieldMask,
      storagePolicy: snapshot.storagePolicy,
    },
    sourceUrl: place.googleMapsUri,
    fetchedAt: context.fetchedAt,
    allowedUse: "citation_only",
  };
  const details: GooglePlaceDetailsInput = {
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
    openingHoursJson: place.currentOpeningHours ?? place.regularOpeningHours,
    priceLevel: place.priceLevel,
    priceRangeJson: place.priceRange,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    fetchedAt: context.fetchedAt,
    staleAt: snapshot.staleAt,
    retentionExpiresAt: snapshot.retentionExpiresAt ?? snapshot.staleAt,
  };

  return {
    place: {
      placeId: place.placeId,
      resourceName: place.resourceName,
    },
    sourceRecord,
    snapshot,
    details,
  };
}

function googlePlacesChatPlaceFromCachedRow(row: {
  place_id: string;
  resource_name: string | null;
  source_record_name: string | null;
  display_name_json: { text?: string } | null;
  formatted_address: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  types_json: string[] | null;
  primary_type: string | null;
  business_status: string | null;
  google_maps_uri: string | null;
  rating: string | number | null;
  user_rating_count: number | null;
  opening_hours_json: unknown;
  price_level: string | null;
  price_range_json: unknown;
  website_uri: string | null;
  international_phone_number: string | null;
}): GooglePlacesChatPlace[] {
  const displayName = row.display_name_json?.text ?? row.source_record_name;
  if (!displayName) {
    return [];
  }

  return [
    {
      placeId: row.place_id,
      resourceName: row.resource_name ?? `places/${row.place_id}`,
      displayName,
      formattedAddress: row.formatted_address ?? undefined,
      latitude: numberOrUndefined(row.latitude),
      longitude: numberOrUndefined(row.longitude),
      types: row.types_json ?? [],
      primaryType: row.primary_type ?? undefined,
      businessStatus: row.business_status ?? undefined,
      googleMapsUri: row.google_maps_uri ?? googleMapsSearchUri(displayName, row.place_id),
      rating: numberOrUndefined(row.rating),
      userRatingCount: row.user_rating_count ?? undefined,
      currentOpeningHours: isRecord(row.opening_hours_json) ? row.opening_hours_json : undefined,
      priceLevel: row.price_level ?? undefined,
      priceRange: isRecord(row.price_range_json) ? row.price_range_json : undefined,
      websiteUri: row.website_uri ?? undefined,
      internationalPhoneNumber: row.international_phone_number ?? undefined,
    },
  ];
}

function createPostgresGooglePlacesStoreDatabase(databaseUrl: string): GooglePlacesStoreDatabase {
  const sql = postgres(databaseUrl, { prepare: false });

  return {
    async query<T>(query: string, params: unknown[] = []) {
      const rows = await sql.unsafe<T[]>(query, params as never[]);
      return { rows };
    },
  };
}

function googlePlacesTableWriteSummary(summaries: GooglePlaceDetailsWriteSummary[]) {
  return {
    evidence: sumBy(summaries, (summary) => summary.evidenceUpserted),
    facts: sumBy(summaries, (summary) => summary.factsUpserted),
    googlePlaceDetails: summaries.filter((summary) => summary.detailsUpserted).length,
    googlePlaceSnapshots: summaries.filter((summary) => summary.snapshotUpserted).length,
    googlePlaces: summaries.filter((summary) => summary.placeIdentityUpserted).length,
    sourceRecords: summaries.filter((summary) => summary.sourceRecordUpserted).length,
  };
}

function sumBy<T>(items: T[], readValue: (item: T) => number) {
  return items.reduce((total, item) => total + readValue(item), 0);
}

function googleMapsSearchUri(displayName: string, placeId: string) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", displayName);
  url.searchParams.set("query_place_id", placeId);
  return url.toString();
}

function numberOrUndefined(value: string | number | null) {
  if (value === null) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCachePart(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function coordinatePart(value: number) {
  return value.toFixed(4);
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function compactLogFields(input: Record<string, number | string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
