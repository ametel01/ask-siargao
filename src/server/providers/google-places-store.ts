import type { GovernedEvidence, GovernedFact } from "@/server/facts/types";
import {
  buildGooglePlacesAttributionMetadata,
  computeGooglePlacesRequestWindows,
  type GooglePlacesRequestKind,
  type GooglePlacesStoragePolicy,
} from "@/server/providers/google-places-policy";
import {
  upsertGovernedEvidence,
  upsertGovernedFacts,
} from "@/server/providers/provider-write-batches";

type QueryResult<T> = { rows: T[] };

export type GooglePlacesStoreDatabase = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type JsonObject = Record<string, unknown>;

export type GooglePlacesCleanupCounts = {
  reviewsDeleted: number;
  detailsDeleted: number;
  snapshotsDeleted: number;
};

export type GooglePlacesCleanupTableProgress = {
  rows: number;
  batches: number;
  hasMore: boolean;
};

export type GooglePlacesCleanupProgress = GooglePlacesCleanupCounts & {
  reviews: GooglePlacesCleanupTableProgress;
  details: GooglePlacesCleanupTableProgress;
  snapshots: GooglePlacesCleanupTableProgress;
  totalRows: number;
  totalBatches: number;
  hasMore: boolean;
};

export type GooglePlacesCleanupOptions = {
  now: string;
  batchSize: number;
  maxBatches: number;
};

export const defaultGooglePlacesCleanupBatchSize = 500;
export const defaultGooglePlacesCleanupMaxBatches = 20;

export type GooglePlacesStoreWritePhase =
  | "source_record"
  | "place_identity"
  | "snapshot"
  | "details"
  | "facts_evidence";

export type GooglePlaceDetailsWriteSummary = {
  placeId: string;
  sourceRecordId: string;
  snapshotId?: string;
  requestKind?: GooglePlacesRequestKind;
  sourceRecordUpserted: boolean;
  placeIdentityUpserted: boolean;
  snapshotUpserted: boolean;
  detailsUpserted: boolean;
  factsUpserted: number;
  evidenceUpserted: number;
  fetchedAt: string;
  staleAt: string;
  retentionExpiresAt: string;
};

export class GooglePlacesStoreWriteError extends Error {
  readonly phase: GooglePlacesStoreWritePhase;
  readonly placeId: string;
  readonly sourceRecordId: string;
  readonly snapshotId?: string;

  constructor({
    cause,
    phase,
    placeId,
    snapshotId,
    sourceRecordId,
  }: {
    cause: unknown;
    phase: GooglePlacesStoreWritePhase;
    placeId: string;
    sourceRecordId: string;
    snapshotId?: string;
  }) {
    super(`Google Places store write failed during ${phase} for ${placeId}.`, { cause });
    this.name = "GooglePlacesStoreWriteError";
    this.phase = phase;
    this.placeId = placeId;
    this.sourceRecordId = sourceRecordId;
    this.snapshotId = snapshotId;
  }
}

export type GooglePlacesSourceRecordInput = {
  id: string;
  sourceProfileId: string;
  providerEntityId: string;
  entityType: string;
  name: string;
  normalizedPayload: JsonObject;
  sourceUrl?: string;
  fetchedAt: string;
  allowedUse: string;
};

export type GooglePlaceIdentityInput = {
  placeId: string;
  resourceName?: string;
  canonicalEntityId?: string;
};

export type GooglePlaceSnapshotInput = {
  id: string;
  requestKind: GooglePlacesRequestKind;
  fieldMask: string;
  payloadJson?: JsonObject;
  payloadHash?: string;
  fetchedAt: string;
  staleAt: string;
  retentionExpiresAt?: string;
  storagePolicy: GooglePlacesStoragePolicy;
  attributionJson?: JsonObject;
};

export type GooglePlaceDetailsInput = {
  displayNameJson?: JsonObject;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponentsJson?: JsonObject[];
  locationJson?: JsonObject;
  latitude?: number;
  longitude?: number;
  viewportJson?: JsonObject;
  typesJson?: string[];
  primaryType?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  openingHoursJson?: JsonObject;
  priceLevel?: string;
  priceRangeJson?: JsonObject;
  rating?: number;
  userRatingCount?: number;
  paymentOptionsJson?: JsonObject;
  parkingOptionsJson?: JsonObject;
  amenitiesJson?: JsonObject;
  attributionsJson?: JsonObject[];
  fetchedAt: string;
  staleAt: string;
  retentionExpiresAt: string;
};

export type GooglePlaceReviewInput = {
  id: string;
  reviewName?: string;
  relativePublishTimeDescription?: string;
  rating?: number;
  textJson?: JsonObject;
  originalTextJson?: JsonObject;
  authorAttributionJson?: JsonObject;
  publishTime?: string;
  flaggedContent?: boolean;
  fetchedAt: string;
  staleAt: string;
  retentionExpiresAt: string;
  displayRequiresGoogleAttribution?: boolean;
};

export type GooglePlaceGovernedFactEvidenceInput = {
  fact: GovernedFact;
  evidence: GovernedEvidence;
};

export type UpsertGooglePlaceDetailsInput = {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  snapshot?: GooglePlaceSnapshotInput;
  details: GooglePlaceDetailsInput;
  governedFactEvidence?: GooglePlaceGovernedFactEvidenceInput[];
};

export type UpsertGooglePlaceReviewsInput = {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  snapshot: GooglePlaceSnapshotInput;
  reviews: GooglePlaceReviewInput[];
};

export type FreshGooglePlaceDetails = {
  place_id: string;
  resource_name: string | null;
  display_name_json: JsonObject | null;
  formatted_address: string | null;
  latitude: string | null;
  longitude: string | null;
  types_json: string[] | null;
  primary_type: string | null;
  business_status: string | null;
  google_maps_uri: string | null;
  opening_hours_json?: JsonObject | null;
  price_level?: string | null;
  price_range_json?: JsonObject | null;
  rating?: string | null;
  user_rating_count?: number | null;
  fetched_at: Date;
  stale_at: Date;
  retention_expires_at: Date;
};

export async function findFreshPlaceDetails(
  db: GooglePlacesStoreDatabase,
  { now, placeId }: { placeId: string; now: string },
): Promise<FreshGooglePlaceDetails | null> {
  const result = await db.query<FreshGooglePlaceDetails>(
    `
      select
        d.place_id,
        gp.resource_name,
        d.display_name_json,
        d.formatted_address,
        d.latitude::text as latitude,
        d.longitude::text as longitude,
        d.types_json,
        d.primary_type,
        d.business_status,
        d.google_maps_uri,
        d.opening_hours_json,
        d.price_level,
        d.price_range_json,
        d.rating::text as rating,
        d.user_rating_count,
        d.fetched_at,
        d.stale_at,
        d.retention_expires_at
      from google_place_details d
      left join google_places gp on gp.place_id = d.place_id
      where d.place_id = $1
        and d.stale_at > $2
        and d.retention_expires_at > $2
      limit 1
    `,
    [placeId, now],
  );

  return result.rows[0] ?? null;
}

async function upsertGoogleSearchSnapshot(
  db: GooglePlacesStoreDatabase,
  {
    place,
    snapshot,
    sourceRecord,
  }: {
    place: GooglePlaceIdentityInput;
    sourceRecord: GooglePlacesSourceRecordInput;
    snapshot: GooglePlaceSnapshotInput;
  },
) {
  await upsertSourceRecord(db, sourceRecord);
  await upsertGooglePlaceSnapshotAfterIdentity(db, place, sourceRecord.id, snapshot);
}

export async function upsertGooglePlaceDetails(
  db: GooglePlacesStoreDatabase,
  input: UpsertGooglePlaceDetailsInput,
): Promise<GooglePlaceDetailsWriteSummary> {
  const { details, place, snapshot, sourceRecord } = input;

  await runGooglePlacesStoreWritePhase("source_record", input, () =>
    upsertSourceRecord(db, sourceRecord),
  );
  await runGooglePlacesStoreWritePhase("place_identity", input, () =>
    upsertGooglePlaceIdentity(db, place, sourceRecord.id, details.fetchedAt, details.staleAt),
  );
  if (snapshot) {
    await runGooglePlacesStoreWritePhase("snapshot", input, () =>
      upsertGooglePlaceSnapshot(db, place.placeId, sourceRecord.id, snapshot),
    );
  }

  await runGooglePlacesStoreWritePhase("details", input, () =>
    db.query(
      `
      insert into google_place_details (
        place_id,
        display_name_json,
        formatted_address,
        short_formatted_address,
        address_components_json,
        location_json,
        latitude,
        longitude,
        viewport_json,
        types_json,
        primary_type,
        business_status,
        google_maps_uri,
        website_uri,
        national_phone_number,
        international_phone_number,
        opening_hours_json,
        price_level,
        price_range_json,
        rating,
        user_rating_count,
        payment_options_json,
        parking_options_json,
        amenities_json,
        attributions_json,
        fetched_at,
        stale_at,
        retention_expires_at
      )
      values (
        $1,
        $2::jsonb,
        $3,
        $4,
        $5::jsonb,
        $6::jsonb,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::jsonb,
        $18,
        $19::jsonb,
        $20,
        $21,
        $22::jsonb,
        $23::jsonb,
        $24::jsonb,
        $25::jsonb,
        $26,
        $27,
        $28
      )
      on conflict (place_id) do update set
        display_name_json = excluded.display_name_json,
        formatted_address = excluded.formatted_address,
        short_formatted_address = excluded.short_formatted_address,
        address_components_json = excluded.address_components_json,
        location_json = excluded.location_json,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        viewport_json = excluded.viewport_json,
        types_json = excluded.types_json,
        primary_type = excluded.primary_type,
        business_status = excluded.business_status,
        google_maps_uri = excluded.google_maps_uri,
        website_uri = excluded.website_uri,
        national_phone_number = excluded.national_phone_number,
        international_phone_number = excluded.international_phone_number,
        opening_hours_json = excluded.opening_hours_json,
        price_level = excluded.price_level,
        price_range_json = excluded.price_range_json,
        rating = excluded.rating,
        user_rating_count = excluded.user_rating_count,
        payment_options_json = excluded.payment_options_json,
        parking_options_json = excluded.parking_options_json,
        amenities_json = excluded.amenities_json,
        attributions_json = excluded.attributions_json,
        fetched_at = excluded.fetched_at,
        stale_at = excluded.stale_at,
        retention_expires_at = excluded.retention_expires_at
    `,
      [
        place.placeId,
        jsonParam(details.displayNameJson),
        details.formattedAddress ?? null,
        details.shortFormattedAddress ?? null,
        jsonParam(details.addressComponentsJson),
        jsonParam(details.locationJson),
        details.latitude?.toString() ?? null,
        details.longitude?.toString() ?? null,
        jsonParam(details.viewportJson),
        jsonParam(details.typesJson),
        details.primaryType ?? null,
        details.businessStatus ?? null,
        details.googleMapsUri ?? null,
        details.websiteUri ?? null,
        details.nationalPhoneNumber ?? null,
        details.internationalPhoneNumber ?? null,
        jsonParam(details.openingHoursJson),
        details.priceLevel ?? null,
        jsonParam(details.priceRangeJson),
        details.rating?.toString() ?? null,
        details.userRatingCount ?? null,
        jsonParam(details.paymentOptionsJson),
        jsonParam(details.parkingOptionsJson),
        jsonParam(details.amenitiesJson),
        jsonParam(details.attributionsJson),
        details.fetchedAt,
        details.staleAt,
        details.retentionExpiresAt,
      ],
    ),
  );

  const factsSummary = await runGooglePlacesStoreWritePhase("facts_evidence", input, () =>
    upsertGovernedGooglePlaceFactEvidence(db, input.governedFactEvidence ?? []),
  );

  return {
    placeId: place.placeId,
    sourceRecordId: sourceRecord.id,
    snapshotId: snapshot?.id,
    requestKind: snapshot?.requestKind,
    sourceRecordUpserted: true,
    placeIdentityUpserted: true,
    snapshotUpserted: snapshot !== undefined,
    detailsUpserted: true,
    factsUpserted: factsSummary.factsUpserted,
    evidenceUpserted: factsSummary.evidenceUpserted,
    fetchedAt: details.fetchedAt,
    staleAt: details.staleAt,
    retentionExpiresAt: details.retentionExpiresAt,
  };
}

export async function upsertGooglePlaceReviews(
  db: GooglePlacesStoreDatabase,
  input: UpsertGooglePlaceReviewsInput,
) {
  const { place, reviews, snapshot, sourceRecord } = input;

  await upsertGoogleSearchSnapshot(db, { place, sourceRecord, snapshot });
  await upsertGooglePlaceReviewRows(db, { place, reviews, snapshot });
}

async function upsertGooglePlaceReviewRows(
  db: GooglePlacesStoreDatabase,
  {
    place,
    reviews,
    snapshot,
  }: {
    place: GooglePlaceIdentityInput;
    snapshot: GooglePlaceSnapshotInput;
    reviews: readonly GooglePlaceReviewInput[];
  },
) {
  const reviewRows = dedupeById(reviews);

  for (const chunk of chunks(reviewRows, 100)) {
    const params: unknown[] = [];
    const valuesSql = chunk.map((review) => {
      params.push(
        review.id,
        place.placeId,
        snapshot.id,
        review.reviewName ?? null,
        review.relativePublishTimeDescription ?? null,
        review.rating?.toString() ?? null,
        jsonParam(review.textJson),
        jsonParam(review.originalTextJson),
        jsonParam(review.authorAttributionJson),
        review.publishTime ?? null,
        review.flaggedContent ?? false,
        review.fetchedAt,
        review.staleAt,
        review.retentionExpiresAt,
        review.displayRequiresGoogleAttribution ?? true,
      );
      const offset = params.length - 14;
      return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb, $${offset + 7}::jsonb, $${offset + 8}::jsonb, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`;
    });

    await db.query(
      `
        insert into google_place_reviews (
          id,
          place_id,
          snapshot_id,
          review_name,
          relative_publish_time_description,
          rating,
          text_json,
          original_text_json,
          author_attribution_json,
          publish_time,
          flagged_content,
          fetched_at,
          stale_at,
          retention_expires_at,
          display_requires_google_attribution
        )
        values ${valuesSql.join(",\n        ")}
        on conflict (id) do update set
          place_id = excluded.place_id,
          snapshot_id = excluded.snapshot_id,
          review_name = excluded.review_name,
          relative_publish_time_description = excluded.relative_publish_time_description,
          rating = excluded.rating,
          text_json = excluded.text_json,
          original_text_json = excluded.original_text_json,
          author_attribution_json = excluded.author_attribution_json,
          publish_time = excluded.publish_time,
          flagged_content = excluded.flagged_content,
          fetched_at = excluded.fetched_at,
          stale_at = excluded.stale_at,
          retention_expires_at = excluded.retention_expires_at,
          display_requires_google_attribution = excluded.display_requires_google_attribution
      `,
      params,
    );
  }
}

export function createGooglePlaceFactEvidenceInputs({
  details,
  fieldMask,
  governance,
  place,
  sourceRecord,
}: {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  details: GooglePlaceDetailsInput;
  fieldMask: string;
  governance: {
    auditUseAllowed: boolean;
    confidenceLabel: GovernedFact["confidenceLabel"];
    publicRepublishAllowed: boolean;
    rawEvidenceAllowed: boolean;
    sourceAuthority: number;
    sourceType: GovernedFact["sourceType"];
  };
}) {
  const base = {
    entityId: place.canonicalEntityId,
    allowedUse: sourceRecord.allowedUse as GovernedFact["allowedUse"],
    auditUseAllowed: governance.auditUseAllowed,
    confidenceLabel: governance.confidenceLabel,
    publicRepublishAllowed: governance.publicRepublishAllowed,
    rawEvidenceAllowed: governance.rawEvidenceAllowed,
    sourceProfileId: sourceRecord.sourceProfileId,
    sourceRecordId: sourceRecord.id,
    sourceAuthority: governance.sourceAuthority,
    sourceType: governance.sourceType,
    fetchedAt: details.fetchedAt,
    expiresAt: details.staleAt,
  };
  const notes = JSON.stringify({
    provider: "google_places",
    placeId: place.placeId,
    fieldMask,
    fetchedAt: details.fetchedAt,
    staleAt: details.staleAt,
    retentionExpiresAt: details.retentionExpiresAt,
    reuseScope: "answer_context",
    requiresGoogleAttribution: true,
    allowedUse: sourceRecord.allowedUse,
    auditUseAllowed: governance.auditUseAllowed,
    publicRepublishAllowed: governance.publicRepublishAllowed,
    rawEvidenceAllowed: governance.rawEvidenceAllowed,
  });
  const evidenceLabel = `Google Places ${sourceRecord.name}`;
  const evidenceCitationUrl = details.googleMapsUri;
  const facts: Array<{
    id: string;
    claim: string;
    factType: string;
    notes: string;
  }> = [];

  if (details.rating !== undefined) {
    facts.push({
      id: googleFactId(place.placeId, "google_rating_signal"),
      claim: `${sourceRecord.name} has a Google rating signal of ${details.rating}.`,
      factType: "google_rating_signal",
      notes,
    });
  }

  if (details.userRatingCount !== undefined) {
    facts.push({
      id: googleFactId(place.placeId, "google_review_count_signal"),
      claim: `${sourceRecord.name} has ${details.userRatingCount} Google user rating signals.`,
      factType: "google_review_count_signal",
      notes,
    });
  }

  if (details.priceLevel || details.priceRangeJson) {
    facts.push({
      id: googleFactId(place.placeId, "google_price_signal"),
      claim: `${sourceRecord.name} has Google price information available.`,
      factType: "google_price_signal",
      notes,
    });
  }

  const openNow = readBoolean(details.openingHoursJson, "openNow");
  if (openNow !== undefined) {
    facts.push({
      id: googleFactId(place.placeId, "google_open_now_signal"),
      claim: `${sourceRecord.name} was marked ${openNow ? "open" : "not open"} by Google at fetch time.`,
      factType: "google_open_now_signal",
      notes,
    });
  }

  if (details.primaryType === "restaurant" || details.typesJson?.includes("restaurant")) {
    facts.push({
      id: googleFactId(place.placeId, "restaurant_candidate"),
      claim: `${sourceRecord.name} is a Google Places restaurant candidate.`,
      factType: "restaurant_candidate",
      notes,
    });
  }

  if (details.googleMapsUri) {
    facts.push({
      id: googleFactId(place.placeId, "map_link"),
      claim: `${sourceRecord.name} has a Google Maps link.`,
      factType: "map_link",
      notes,
    });
  }

  return facts.map((fact) => ({
    fact: {
      ...base,
      ...fact,
    },
    evidence: {
      id: `evidence_${fact.id}_${slugPart(sourceRecord.id)}`,
      factId: fact.id,
      sourceRecordId: sourceRecord.id,
      label: evidenceLabel,
      citationUrl: evidenceCitationUrl,
      citationText: fact.claim,
      allowedUse: sourceRecord.allowedUse as GovernedEvidence["allowedUse"],
      publicRepublishAllowed: governance.publicRepublishAllowed,
    },
  }));
}

export async function deleteExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  options: GooglePlacesCleanupOptions,
): Promise<GooglePlacesCleanupProgress>;
export async function deleteExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  options: { now: string },
): Promise<GooglePlacesCleanupCounts>;
export async function deleteExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  options: { now: string; batchSize?: number; maxBatches?: number },
): Promise<GooglePlacesCleanupProgress | GooglePlacesCleanupCounts> {
  const includeProgress = options.batchSize !== undefined || options.maxBatches !== undefined;
  const batchSize = options.batchSize ?? defaultGooglePlacesCleanupBatchSize;
  const maxBatches = options.maxBatches ?? defaultGooglePlacesCleanupMaxBatches;
  const [reviews, details] = await Promise.all([
    deleteExpiredGooglePlacesTableInBatches(db, {
      batchSize,
      idColumn: "id",
      maxBatches,
      now: options.now,
      tableName: "google_place_reviews",
      whereSql: "retention_expires_at < $1",
    }),
    deleteExpiredGooglePlacesTableInBatches(db, {
      batchSize,
      idColumn: "place_id",
      maxBatches,
      now: options.now,
      tableName: "google_place_details",
      whereSql: "retention_expires_at < $1",
    }),
  ]);
  const snapshots = reviews.hasMore
    ? await readGooglePlacesCleanupTableProgress(db, {
        now: options.now,
        query:
          "select exists(select 1 from google_place_snapshots where retention_expires_at is not null and retention_expires_at < $1 limit 1) as has_more",
      })
    : await deleteExpiredGooglePlacesTableInBatches(db, {
        batchSize,
        idColumn: "id",
        maxBatches,
        now: options.now,
        tableName: "google_place_snapshots",
        whereSql: "retention_expires_at is not null and retention_expires_at < $1",
      });

  const progress = createGooglePlacesCleanupProgress({ details, reviews, snapshots });

  if (includeProgress) {
    return progress;
  }

  return {
    reviewsDeleted: progress.reviewsDeleted,
    detailsDeleted: progress.detailsDeleted,
    snapshotsDeleted: progress.snapshotsDeleted,
  };
}

export async function countExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  { now }: { now: string },
): Promise<GooglePlacesCleanupProgress> {
  const result = await db.query<{
    reviews_deleted: number;
    details_deleted: number;
    snapshots_deleted: number;
  }>(
    `
      select
        (select count(*)::int from google_place_reviews where retention_expires_at < $1) as reviews_deleted,
        (select count(*)::int from google_place_details where retention_expires_at < $1) as details_deleted,
        (
          select count(*)::int
          from google_place_snapshots
          where retention_expires_at is not null
            and retention_expires_at < $1
        ) as snapshots_deleted
    `,
    [now],
  );
  const row = result.rows[0];

  return {
    ...createGooglePlacesCleanupProgress({
      reviews: {
        rows: row?.reviews_deleted ?? 0,
        batches: 0,
        hasMore: (row?.reviews_deleted ?? 0) > 0,
      },
      details: {
        rows: row?.details_deleted ?? 0,
        batches: 0,
        hasMore: (row?.details_deleted ?? 0) > 0,
      },
      snapshots: {
        rows: row?.snapshots_deleted ?? 0,
        batches: 0,
        hasMore: (row?.snapshots_deleted ?? 0) > 0,
      },
    }),
  };
}

async function deleteExpiredGooglePlacesTableInBatches(
  db: GooglePlacesStoreDatabase,
  {
    batchSize,
    idColumn,
    maxBatches,
    now,
    tableName,
    whereSql,
  }: {
    tableName: "google_place_reviews" | "google_place_details" | "google_place_snapshots";
    idColumn: "id" | "place_id";
    whereSql: string;
    now: string;
    batchSize: number;
    maxBatches: number;
  },
): Promise<GooglePlacesCleanupTableProgress> {
  let rows = 0;
  let batches = 0;

  for (let index = 0; index < maxBatches; index += 1) {
    const result = await db.query<{ deleted_count: number }>(
      `
        with expired as (
          select ${idColumn}
          from ${tableName}
          where ${whereSql}
          order by retention_expires_at, ${idColumn}
          limit $2
        ),
        deleted as (
          delete from ${tableName}
          using expired
          where ${tableName}.${idColumn} = expired.${idColumn}
          returning 1
        )
        select count(*)::int as deleted_count from deleted
      `,
      [now, batchSize],
    );
    const deletedCount = result.rows[0]?.deleted_count ?? 0;
    if (deletedCount === 0) {
      break;
    }

    rows += deletedCount;
    batches += 1;

    if (deletedCount < batchSize) {
      break;
    }
  }

  return {
    rows,
    batches,
    hasMore: await hasExpiredGooglePlacesRows(db, {
      now,
      query: `select exists(select 1 from ${tableName} where ${whereSql} limit 1) as has_more`,
    }),
  };
}

async function readGooglePlacesCleanupTableProgress(
  db: GooglePlacesStoreDatabase,
  { now, query }: { now: string; query: string },
): Promise<GooglePlacesCleanupTableProgress> {
  return {
    rows: 0,
    batches: 0,
    hasMore: await hasExpiredGooglePlacesRows(db, { now, query }),
  };
}

async function hasExpiredGooglePlacesRows(
  db: GooglePlacesStoreDatabase,
  { now, query }: { now: string; query: string },
) {
  const result = await db.query<{ has_more: boolean }>(query, [now]);
  return result.rows[0]?.has_more ?? false;
}

function createGooglePlacesCleanupProgress({
  details,
  reviews,
  snapshots,
}: {
  reviews: GooglePlacesCleanupTableProgress;
  details: GooglePlacesCleanupTableProgress;
  snapshots: GooglePlacesCleanupTableProgress;
}): GooglePlacesCleanupProgress {
  const totalRows = reviews.rows + details.rows + snapshots.rows;
  const totalBatches = reviews.batches + details.batches + snapshots.batches;
  const hasMore = reviews.hasMore || details.hasMore || snapshots.hasMore;

  return {
    reviewsDeleted: reviews.rows,
    detailsDeleted: details.rows,
    snapshotsDeleted: snapshots.rows,
    reviews,
    details,
    snapshots,
    totalRows,
    totalBatches,
    hasMore,
  };
}

export function createGooglePlaceSnapshotInput({
  fetchedAt,
  fieldMask,
  payloadJson,
  placeId,
  requestKind,
}: {
  placeId: string;
  requestKind: GooglePlacesRequestKind;
  fieldMask: string;
  fetchedAt: string;
  payloadJson?: JsonObject;
}): GooglePlaceSnapshotInput {
  const windows = computeGooglePlacesRequestWindows({ fetchedAt, requestKind });

  return {
    id: googleSnapshotId(placeId, requestKind, fieldMask, fetchedAt),
    requestKind,
    fieldMask,
    payloadJson,
    payloadHash: hashStableJson(payloadJson ?? {}),
    fetchedAt,
    staleAt: windows.staleAt.toISOString(),
    retentionExpiresAt: windows.retentionExpiresAt.toISOString(),
    storagePolicy: windows.storagePolicy,
    attributionJson: buildGooglePlacesAttributionMetadata({
      fetchedAt,
      fieldMask,
      place: payloadJson,
    }),
  };
}

async function upsertSourceRecord(
  db: GooglePlacesStoreDatabase,
  sourceRecord: GooglePlacesSourceRecordInput,
) {
  await db.query(
    `
      insert into source_records (
        id,
        source_profile_id,
        provider_entity_id,
        entity_type,
        name,
        normalized_payload,
        source_url,
        fetched_at,
        allowed_use
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      on conflict (id) do update set
        provider_entity_id = excluded.provider_entity_id,
        entity_type = excluded.entity_type,
        name = excluded.name,
        normalized_payload = excluded.normalized_payload,
        source_url = excluded.source_url,
        fetched_at = excluded.fetched_at,
        allowed_use = excluded.allowed_use
    `,
    [
      sourceRecord.id,
      sourceRecord.sourceProfileId,
      sourceRecord.providerEntityId,
      sourceRecord.entityType,
      sourceRecord.name,
      jsonParam(sourceRecord.normalizedPayload),
      sourceRecord.sourceUrl ?? null,
      sourceRecord.fetchedAt,
      sourceRecord.allowedUse,
    ],
  );
}

async function upsertGooglePlaceIdentity(
  db: GooglePlacesStoreDatabase,
  place: GooglePlaceIdentityInput,
  sourceRecordId: string,
  fetchedAt: string,
  staleAt: string,
) {
  await db.query(
    `
      insert into google_places (
        place_id,
        resource_name,
        latest_source_record_id,
        canonical_entity_id,
        first_seen_at,
        last_seen_at,
        last_details_fetched_at,
        details_stale_at
      )
      values ($1, $2, $3, $4, $5, $5, $5, $6)
      on conflict (place_id) do update set
        resource_name = coalesce(excluded.resource_name, google_places.resource_name),
        latest_source_record_id = excluded.latest_source_record_id,
        canonical_entity_id = coalesce(excluded.canonical_entity_id, google_places.canonical_entity_id),
        last_seen_at = excluded.last_seen_at,
        last_details_fetched_at = excluded.last_details_fetched_at,
        details_stale_at = excluded.details_stale_at
    `,
    [
      place.placeId,
      place.resourceName ?? null,
      sourceRecordId,
      place.canonicalEntityId ?? null,
      fetchedAt,
      staleAt,
    ],
  );
}

async function upsertGooglePlaceSnapshotAfterIdentity(
  db: GooglePlacesStoreDatabase,
  place: GooglePlaceIdentityInput,
  sourceRecordId: string,
  snapshot: GooglePlaceSnapshotInput,
) {
  await upsertGooglePlaceIdentity(db, place, sourceRecordId, snapshot.fetchedAt, snapshot.staleAt);
  return upsertGooglePlaceSnapshot(db, place.placeId, sourceRecordId, snapshot);
}

async function upsertGooglePlaceSnapshot(
  db: GooglePlacesStoreDatabase,
  placeId: string,
  sourceRecordId: string,
  snapshot: GooglePlaceSnapshotInput,
) {
  await db.query(
    `
      insert into google_place_snapshots (
        id,
        place_id,
        source_record_id,
        request_kind,
        field_mask,
        payload_json,
        payload_hash,
        fetched_at,
        stale_at,
        retention_expires_at,
        storage_policy,
        attribution_json
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb)
      on conflict (id) do update set
        source_record_id = excluded.source_record_id,
        request_kind = excluded.request_kind,
        field_mask = excluded.field_mask,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash,
        fetched_at = excluded.fetched_at,
        stale_at = excluded.stale_at,
        retention_expires_at = excluded.retention_expires_at,
        storage_policy = excluded.storage_policy,
        attribution_json = excluded.attribution_json
    `,
    [
      snapshot.id,
      placeId,
      sourceRecordId,
      snapshot.requestKind,
      snapshot.fieldMask,
      jsonParam(snapshot.payloadJson),
      snapshot.payloadHash ?? null,
      snapshot.fetchedAt,
      snapshot.staleAt,
      snapshot.retentionExpiresAt ?? null,
      snapshot.storagePolicy,
      jsonParam(snapshot.attributionJson),
    ],
  );
}

async function upsertGovernedGooglePlaceFactEvidence(
  db: GooglePlacesStoreDatabase,
  records: readonly GooglePlaceGovernedFactEvidenceInput[],
) {
  await upsertGovernedFacts(
    db,
    records.map((record) => record.fact),
  );
  await upsertGovernedEvidence(
    db,
    records.map((record) => record.evidence),
  );

  return {
    factsUpserted: records.length,
    evidenceUpserted: records.length,
  };
}

async function runGooglePlacesStoreWritePhase<T>(
  phase: GooglePlacesStoreWritePhase,
  input: UpsertGooglePlaceDetailsInput,
  write: () => Promise<T>,
) {
  try {
    return await write();
  } catch (cause) {
    throw new GooglePlacesStoreWriteError({
      cause,
      phase,
      placeId: input.place.placeId,
      snapshotId: input.snapshot?.id,
      sourceRecordId: input.sourceRecord.id,
    });
  }
}

function googleFactId(placeId: string, factType: string) {
  return `fact_google_places_${slugPart(placeId)}_${factType}`;
}

function googleSnapshotId(
  placeId: string,
  requestKind: GooglePlacesRequestKind,
  fieldMask: string,
  fetchedAt: string,
) {
  return `snapshot_google_places_${slugPart(placeId)}_${slugPart(requestKind)}_${hashStableJson({
    fetchedAt,
    fieldMask,
  })}`;
}

function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hashStableJson(value: unknown) {
  const json = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash * 31 + json.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function dedupeById<T extends { id: string }>(items: readonly T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function jsonParam(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function readBoolean(record: JsonObject | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}
