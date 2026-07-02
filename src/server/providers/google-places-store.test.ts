import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import { createGooglePlacesDetailsCaptureInput } from "@/server/providers/google-places-governed-capture";
import {
  type GooglePlacesRequestKind,
  googlePlacesAtmosphereDetailsFieldMask,
  googlePlacesEnterpriseDetailsFieldMask,
  googlePlacesRequestPolicies,
} from "@/server/providers/google-places-policy";
import {
  deleteExpiredGooglePlacesContent,
  findFreshPlaceDetails,
  type GooglePlaceDetailsInput,
  type GooglePlaceIdentityInput,
  upsertGooglePlaceDetails,
  upsertGooglePlaceReviews,
} from "@/server/providers/google-places-store";

describe("Google Places capture store", () => {
  test("upserts typed captures and normalized facts idempotently", async () => {
    const db = await openGooglePlacesStoreTestDatabase();
    const capture = createDetailsCapture();

    const firstSummary = await upsertGooglePlaceDetails(db, capture);
    const secondSummary = await upsertGooglePlaceDetails(db, capture);

    const counts = await db.query<{
      google_places: number;
      google_place_snapshots: number;
      google_place_details: number;
      source_records: number;
      facts: number;
      evidence: number;
    }>(`
      select
        (select count(*)::int from google_places) as google_places,
        (select count(*)::int from google_place_snapshots) as google_place_snapshots,
        (select count(*)::int from google_place_details) as google_place_details,
        (select count(*)::int from source_records) as source_records,
        (select count(*)::int from facts) as facts,
        (select count(*)::int from evidence) as evidence
    `);

    expect(counts.rows[0]).toEqual({
      google_places: 1,
      google_place_snapshots: 1,
      google_place_details: 1,
      source_records: 1,
      facts: 6,
      evidence: 6,
    });
    expect(firstSummary).toMatchObject({
      detailsUpserted: true,
      evidenceUpserted: 6,
      factsUpserted: 6,
      placeId: "place_kermit",
      placeIdentityUpserted: true,
      requestKind: "details_enterprise",
      snapshotUpserted: true,
      sourceRecordId: "record_google_places_details_place_kermit",
      sourceRecordUpserted: true,
    });
    expect(secondSummary).toMatchObject({
      detailsUpserted: true,
      evidenceUpserted: 6,
      factsUpserted: 6,
      placeId: "place_kermit",
    });

    await db.close();
  });

  test("returns fresh details and hides expired Google content from lookup methods", async () => {
    const db = await openGooglePlacesStoreTestDatabase();
    await upsertGooglePlaceDetails(db, createDetailsCapture());
    await upsertGooglePlaceDetails(
      db,
      createDetailsCapture({
        place: {
          placeId: "place_expired",
          resourceName: "places/place_expired",
        },
        details: {
          ...createDetailsInput("2026-05-01T00:00:00.000Z"),
          displayNameJson: { text: "Expired Cafe" },
          fetchedAt: "2026-05-01T00:00:00.000Z",
          staleAt: "2026-05-08T00:00:00.000Z",
          retentionExpiresAt: "2026-05-31T00:00:00.000Z",
        },
        requestKind: "details_enterprise",
      }),
    );

    const freshDetail = await findFreshPlaceDetails(db, {
      placeId: "place_kermit",
      now: "2026-06-28T00:00:00.000Z",
    });
    const expiredDetail = await findFreshPlaceDetails(db, {
      placeId: "place_expired",
      now: "2026-06-28T00:00:00.000Z",
    });

    expect(freshDetail?.place_id).toBe("place_kermit");
    expect(expiredDetail).toBeNull();

    await db.close();
  });

  test("stores review freshness, retention, and attribution requirements", async () => {
    const db = await openGooglePlacesStoreTestDatabase();
    const capture = createDetailsCapture({ requestKind: "details_atmosphere_reviews" });

    await upsertGooglePlaceReviews(db, {
      place: capture.place,
      sourceRecord: capture.sourceRecord,
      snapshot: expectSnapshot(capture),
      reviews: [
        {
          id: "review_place_kermit_1",
          reviewName: "places/place_kermit/reviews/review_1",
          relativePublishTimeDescription: "a week ago",
          rating: 5,
          textJson: { text: "Great pizza after surfing." },
          originalTextJson: { text: "Great pizza after surfing." },
          authorAttributionJson: { displayName: "A reviewer" },
          publishTime: "2026-06-20T00:00:00.000Z",
          fetchedAt: "2026-06-25T00:00:00.000Z",
          staleAt: "2026-07-02T00:00:00.000Z",
          retentionExpiresAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    const rows = await db.query<{
      rating: string;
      stale_at: Date;
      retention_expires_at: Date;
      display_requires_google_attribution: boolean;
      attribution_json: { requiresGoogleAttribution: boolean; fieldMask: string };
    }>(`
      select
        r.rating::text as rating,
        r.stale_at,
        r.retention_expires_at,
        r.display_requires_google_attribution,
        s.attribution_json
      from google_place_reviews r
      join google_place_snapshots s on s.id = r.snapshot_id
    `);

    expect(rows.rows[0]).toMatchObject({
      rating: "5",
      display_requires_google_attribution: true,
      attribution_json: {
        requiresGoogleAttribution: true,
        fieldMask: googlePlacesRequestPolicies.details_atmosphere_reviews.fieldMask,
      },
    });
    expect(rows.rows[0]?.stale_at.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(rows.rows[0]?.retention_expires_at.toISOString()).toBe("2026-07-02T00:00:00.000Z");

    await db.close();
  });

  test("does not emit reusable facts or evidence without governed capture metadata", async () => {
    const db = await openGooglePlacesStoreTestDatabase();
    const governedCapture = createDetailsCapture();
    const rawStoreInput = {
      place: governedCapture.place,
      sourceRecord: governedCapture.sourceRecord,
      snapshot: governedCapture.snapshot,
      details: governedCapture.details,
    };

    const summary = await upsertGooglePlaceDetails(db, rawStoreInput);
    const counts = await db.query<{ facts: number; evidence: number }>(`
      select
        (select count(*)::int from facts) as facts,
        (select count(*)::int from evidence) as evidence
    `);

    expect(summary).toMatchObject({
      factsUpserted: 0,
      evidenceUpserted: 0,
      detailsUpserted: true,
      snapshotUpserted: true,
    });
    expect(counts.rows[0]).toEqual({
      facts: 0,
      evidence: 0,
    });

    await db.close();
  });

  test("deletes expired Google content while preserving durable place IDs", async () => {
    const db = await openGooglePlacesStoreTestDatabase();
    const capture = createDetailsCapture({
      details: {
        ...createDetailsInput("2026-05-01T00:00:00.000Z"),
        fetchedAt: "2026-05-01T00:00:00.000Z",
        staleAt: "2026-05-08T00:00:00.000Z",
        retentionExpiresAt: "2026-05-31T00:00:00.000Z",
      },
      fetchedAt: "2026-05-01T00:00:00.000Z",
      requestKind: "details_atmosphere_reviews",
    });

    await upsertGooglePlaceDetails(db, capture);
    await upsertGooglePlaceReviews(db, {
      place: capture.place,
      sourceRecord: capture.sourceRecord,
      snapshot: expectSnapshot(capture),
      reviews: [
        {
          id: "review_expired",
          fetchedAt: "2026-05-01T00:00:00.000Z",
          staleAt: "2026-05-08T00:00:00.000Z",
          retentionExpiresAt: "2026-05-31T00:00:00.000Z",
          rating: 4,
        },
      ],
    });

    const result = await deleteExpiredGooglePlacesContent(db, {
      now: "2026-06-25T00:00:00.000Z",
    });
    const counts = await db.query<{
      google_places: number;
      google_place_snapshots: number;
      google_place_details: number;
      google_place_reviews: number;
    }>(`
      select
        (select count(*)::int from google_places) as google_places,
        (select count(*)::int from google_place_snapshots) as google_place_snapshots,
        (select count(*)::int from google_place_details) as google_place_details,
        (select count(*)::int from google_place_reviews) as google_place_reviews
    `);

    expect(result).toEqual({
      reviewsDeleted: 1,
      detailsDeleted: 1,
      snapshotsDeleted: 1,
    });
    expect(counts.rows[0]).toEqual({
      google_places: 1,
      google_place_snapshots: 0,
      google_place_details: 0,
      google_place_reviews: 0,
    });

    await db.close();
  });
});

async function openGooglePlacesStoreTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  await db.query(`
    insert into providers (id, slug, name, provider_type)
    values ('provider_google_places', 'google-places', 'Google Places', 'places_api')
  `);
  await db.query(
    `
      insert into source_profiles (
        id,
        provider_id,
        source_name,
        source_type,
        access_method,
        allowed_use,
        freshness_window_days,
        authority_level,
        stores_raw_allowed,
        publishes_raw_allowed
      )
      values ($1, 'provider_google_places', 'Google Places', 'provider_api', 'api', 'citation_only', 7, 60, false, false)
    `,
    [googlePlacesDiscoverySourceProfileId],
  );
  return db;
}

function createDetailsCapture({
  details = createDetailsInput("2026-06-25T00:00:00.000Z"),
  fetchedAt,
  place = {
    placeId: "place_kermit",
    resourceName: "places/place_kermit",
  },
  requestKind = "details_enterprise",
}: {
  place?: GooglePlaceIdentityInput;
  details?: GooglePlaceDetailsInput;
  fetchedAt?: string;
  requestKind?: GooglePlacesRequestKind;
} = {}) {
  const captureFetchedAt = fetchedAt ?? details.fetchedAt;

  return createGooglePlacesDetailsCaptureInput({
    details: {
      placeId: place.placeId,
      resourceName: place.resourceName ?? `places/${place.placeId}`,
      displayName: readDisplayName(details),
      displayNameJson: details.displayNameJson as { text?: string; languageCode?: string },
      formattedAddress: details.formattedAddress,
      locationJson: details.locationJson as { latitude?: number; longitude?: number } | undefined,
      latitude: details.latitude,
      longitude: details.longitude,
      types: details.typesJson ?? [],
      primaryType: details.primaryType,
      businessStatus: details.businessStatus,
      googleMapsUri: details.googleMapsUri,
      websiteUri: details.websiteUri,
      internationalPhoneNumber: details.internationalPhoneNumber,
      currentOpeningHoursJson: details.openingHoursJson as
        | { openNow?: boolean; weekdayDescriptions?: string[] }
        | undefined,
      priceLevel: details.priceLevel,
      priceRangeJson: details.priceRangeJson as
        | {
            startPrice?: { currencyCode?: string; units?: string; nanos?: number };
            endPrice?: { currencyCode?: string; units?: string; nanos?: number };
          }
        | undefined,
      rating: details.rating,
      userRatingCount: details.userRatingCount,
      attributionsJson: [{ provider: "Google" }],
      reviews: [],
      fieldMask:
        requestKind === "details_atmosphere_reviews"
          ? googlePlacesAtmosphereDetailsFieldMask
          : googlePlacesEnterpriseDetailsFieldMask,
      fetchedAt: captureFetchedAt,
    },
    requestKind,
  });
}

function readDisplayName(details: GooglePlaceDetailsInput) {
  const value = details.displayNameJson?.text;
  return typeof value === "string" ? value : "Kermit Surf Resort and Restaurant";
}

function expectSnapshot(capture: ReturnType<typeof createDetailsCapture>) {
  if (!capture.snapshot) {
    throw new Error("Governed Google Places detail capture must include a snapshot.");
  }
  return capture.snapshot;
}

function createDetailsInput(fetchedAt: string): GooglePlaceDetailsInput {
  return {
    displayNameJson: { text: "Kermit Surf Resort and Restaurant", languageCode: "en" },
    formattedAddress: "Tourism Road, General Luna, Siargao",
    locationJson: { latitude: 9.803, longitude: 126.161 },
    latitude: 9.803,
    longitude: 126.161,
    typesJson: ["restaurant", "food", "point_of_interest", "establishment"],
    primaryType: "restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=123",
    websiteUri: "https://kermit.example",
    internationalPhoneNumber: "+63 917 123 4567",
    openingHoursJson: { openNow: true },
    priceLevel: "PRICE_LEVEL_MODERATE",
    priceRangeJson: {
      startPrice: { currencyCode: "PHP", units: "300" },
      endPrice: { currencyCode: "PHP", units: "600" },
    },
    rating: 4.6,
    userRatingCount: 1240,
    attributionsJson: [{ provider: "Google" }],
    fetchedAt,
    staleAt: "2026-07-02T00:00:00.000Z",
    retentionExpiresAt: "2026-07-25T00:00:00.000Z",
  };
}
