import {
  buildGooglePlacesAttributionMetadata,
  computeGooglePlacesRequestWindows,
  type GooglePlacesRequestKind,
  type GooglePlacesStoragePolicy,
} from "@/server/providers/google-places-policy";

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

export type UpsertGooglePlaceDetailsInput = {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  snapshot?: GooglePlaceSnapshotInput;
  details: GooglePlaceDetailsInput;
};

export type UpsertGooglePlaceReviewsInput = {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  snapshot: GooglePlaceSnapshotInput;
  reviews: GooglePlaceReviewInput[];
};

export async function findFreshPlacesForSearchRequirement(
  db: GooglePlacesStoreDatabase,
  {
    limit = 8,
    now,
    primaryType,
  }: {
    now: string;
    primaryType?: string;
    limit?: number;
  },
) {
  const result = await db.query<{
    place_id: string;
    display_name_json: JsonObject | null;
    formatted_address: string | null;
    primary_type: string | null;
    rating: string | null;
    user_rating_count: number | null;
    google_maps_uri: string | null;
    price_level: string | null;
    fetched_at: Date;
    stale_at: Date;
    retention_expires_at: Date;
  }>(
    `
      select
        place_id,
        display_name_json,
        formatted_address,
        primary_type,
        rating::text as rating,
        user_rating_count,
        google_maps_uri,
        price_level,
        fetched_at,
        stale_at,
        retention_expires_at
      from google_place_details
      where stale_at > $1
        and retention_expires_at > $1
        and ($2::text is null or primary_type = $2 or types_json ? $2)
      order by user_rating_count desc nulls last, rating desc nulls last, place_id asc
      limit $3
    `,
    [now, primaryType ?? null, limit],
  );

  return result.rows;
}

export async function findFreshPlaceDetails(
  db: GooglePlacesStoreDatabase,
  { now, placeId }: { placeId: string; now: string },
) {
  const result = await db.query<{
    place_id: string;
    display_name_json: JsonObject | null;
    formatted_address: string | null;
    rating: string | null;
    user_rating_count: number | null;
    price_level: string | null;
    fetched_at: Date;
    stale_at: Date;
    retention_expires_at: Date;
  }>(
    `
      select
        place_id,
        display_name_json,
        formatted_address,
        rating::text as rating,
        user_rating_count,
        price_level,
        fetched_at,
        stale_at,
        retention_expires_at
      from google_place_details
      where place_id = $1
        and stale_at > $2
        and retention_expires_at > $2
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
) {
  const { details, place, snapshot, sourceRecord } = input;

  await upsertSourceRecord(db, sourceRecord);
  await upsertGooglePlaceIdentity(db, place, sourceRecord.id, details.fetchedAt, details.staleAt);
  if (snapshot) {
    await upsertGooglePlaceSnapshot(db, place.placeId, sourceRecord.id, snapshot);
  }

  await db.query(
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
  );

  await upsertNormalizedGooglePlaceFacts(db, {
    details,
    fieldMask: snapshot?.fieldMask ?? "",
    place,
    sourceRecord,
  });
}

export async function upsertGooglePlaceReviews(
  db: GooglePlacesStoreDatabase,
  input: UpsertGooglePlaceReviewsInput,
) {
  const { place, reviews, snapshot, sourceRecord } = input;

  await upsertGoogleSearchSnapshot(db, { place, sourceRecord, snapshot });

  for (const review of reviews) {
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
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8::jsonb,
          $9::jsonb,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15
        )
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
      [
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
      ],
    );
  }
}

export function normalizeGooglePlaceFacts({
  details,
  fieldMask,
  place,
  sourceRecord,
}: {
  place: GooglePlaceIdentityInput;
  sourceRecord: GooglePlacesSourceRecordInput;
  details: GooglePlaceDetailsInput;
  fieldMask: string;
}) {
  const base = {
    entityId: place.canonicalEntityId,
    sourceProfileId: sourceRecord.sourceProfileId,
    sourceRecordId: sourceRecord.id,
    fetchedAt: details.fetchedAt,
    expiresAt: details.staleAt,
    confidenceLabel: "medium",
    sourceAuthority: 60,
    publicRepublishAllowed: false,
    auditUseAllowed: true,
    rawEvidenceAllowed: false,
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
      sourceType: "google_places",
    },
    evidence: {
      id: `evidence_${fact.id}_${slugPart(sourceRecord.id)}`,
      factId: fact.id,
      sourceRecordId: sourceRecord.id,
      label: evidenceLabel,
      citationUrl: evidenceCitationUrl,
      citationText: fact.claim,
      allowedUse: sourceRecord.allowedUse,
      publicRepublishAllowed: false,
    },
  }));
}

export async function deleteExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  { now }: { now: string },
): Promise<GooglePlacesCleanupCounts> {
  const reviews = await db.query<{ id: string }>(
    "delete from google_place_reviews where retention_expires_at < $1 returning id",
    [now],
  );
  const details = await db.query<{ place_id: string }>(
    "delete from google_place_details where retention_expires_at < $1 returning place_id",
    [now],
  );
  const snapshots = await db.query<{ id: string }>(
    "delete from google_place_snapshots where retention_expires_at is not null and retention_expires_at < $1 returning id",
    [now],
  );

  return {
    reviewsDeleted: reviews.rows.length,
    detailsDeleted: details.rows.length,
    snapshotsDeleted: snapshots.rows.length,
  };
}

export async function countExpiredGooglePlacesContent(
  db: GooglePlacesStoreDatabase,
  { now }: { now: string },
): Promise<GooglePlacesCleanupCounts> {
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
    reviewsDeleted: row?.reviews_deleted ?? 0,
    detailsDeleted: row?.details_deleted ?? 0,
    snapshotsDeleted: row?.snapshots_deleted ?? 0,
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

async function upsertNormalizedGooglePlaceFacts(
  db: GooglePlacesStoreDatabase,
  input: Parameters<typeof normalizeGooglePlaceFacts>[0],
) {
  const records = normalizeGooglePlaceFacts(input);

  for (const record of records) {
    await db.query(
      `
        insert into facts (
          id,
          entity_id,
          claim,
          fact_type,
          source_type,
          source_profile_id,
          source_record_id,
          fetched_at,
          verified_at,
          expires_at,
          confidence_label,
          source_authority,
          public_republish_allowed,
          audit_use_allowed,
          raw_evidence_allowed,
          conflicts_with_fact_ids,
          notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14, '[]'::jsonb, $15)
        on conflict (id) do update set
          entity_id = excluded.entity_id,
          claim = excluded.claim,
          fact_type = excluded.fact_type,
          source_type = excluded.source_type,
          source_profile_id = excluded.source_profile_id,
          source_record_id = excluded.source_record_id,
          fetched_at = excluded.fetched_at,
          verified_at = excluded.verified_at,
          expires_at = excluded.expires_at,
          confidence_label = excluded.confidence_label,
          source_authority = excluded.source_authority,
          public_republish_allowed = excluded.public_republish_allowed,
          audit_use_allowed = excluded.audit_use_allowed,
          raw_evidence_allowed = excluded.raw_evidence_allowed,
          notes = excluded.notes
      `,
      [
        record.fact.id,
        record.fact.entityId ?? null,
        record.fact.claim,
        record.fact.factType,
        record.fact.sourceType,
        record.fact.sourceProfileId,
        record.fact.sourceRecordId,
        record.fact.fetchedAt,
        record.fact.expiresAt,
        record.fact.confidenceLabel,
        record.fact.sourceAuthority,
        record.fact.publicRepublishAllowed,
        record.fact.auditUseAllowed,
        record.fact.rawEvidenceAllowed,
        record.fact.notes,
      ],
    );

    await db.query(
      `
        insert into evidence (
          id,
          fact_id,
          source_record_id,
          label,
          citation_url,
          citation_text,
          allowed_use,
          public_republish_allowed
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update set
          source_record_id = excluded.source_record_id,
          label = excluded.label,
          citation_url = excluded.citation_url,
          citation_text = excluded.citation_text,
          allowed_use = excluded.allowed_use,
          public_republish_allowed = excluded.public_republish_allowed
      `,
      [
        record.evidence.id,
        record.evidence.factId,
        record.evidence.sourceRecordId,
        record.evidence.label,
        record.evidence.citationUrl ?? null,
        record.evidence.citationText,
        record.evidence.allowedUse,
        record.evidence.publicRepublishAllowed,
      ],
    );
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

function jsonParam(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function readBoolean(record: JsonObject | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}
