import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { pruneGooglePlacesContent } from "@/server/jobs/prune-google-places";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  type GooglePlacesRequestKind,
  googlePlacesRequestPolicies,
} from "@/server/providers/google-places-policy";
import {
  createGooglePlaceSnapshotInput,
  type GooglePlaceDetailsInput,
  type GooglePlaceIdentityInput,
  type GooglePlacesSourceRecordInput,
  upsertGooglePlaceDetails,
  upsertGooglePlaceReviews,
} from "@/server/providers/google-places-store";

describe("Google Places retention pruning", () => {
  test("dry-runs expired counts and deletes only expired Google content", async () => {
    const db = await openGooglePlacesPruneTestDatabase();
    const expiredCapture = createDetailsCapture({
      details: createDetailsInput({
        displayName: "Expired Cafe",
        fetchedAt: "2026-05-01T00:00:00.000Z",
        retentionExpiresAt: "2026-05-31T00:00:00.000Z",
        staleAt: "2026-05-08T00:00:00.000Z",
      }),
      fetchedAt: "2026-05-01T00:00:00.000Z",
      place: {
        placeId: "place_expired",
        resourceName: "places/place_expired",
      },
      requestKind: "details_atmosphere_reviews",
      sourceRecord: createSourceRecord({
        fetchedAt: "2026-05-01T00:00:00.000Z",
        name: "Expired Cafe",
        placeId: "place_expired",
      }),
    });
    const freshCapture = createDetailsCapture({
      requestKind: "details_atmosphere_reviews",
    });

    await upsertGooglePlaceDetails(db, expiredCapture);
    await upsertGooglePlaceReviews(db, {
      place: expiredCapture.place,
      sourceRecord: expiredCapture.sourceRecord,
      snapshot: expiredCapture.snapshot,
      reviews: [
        {
          id: "review_expired",
          fetchedAt: "2026-05-01T00:00:00.000Z",
          rating: 4,
          retentionExpiresAt: "2026-05-31T00:00:00.000Z",
          staleAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    });
    await upsertGooglePlaceDetails(db, freshCapture);
    await upsertGooglePlaceReviews(db, {
      place: freshCapture.place,
      sourceRecord: freshCapture.sourceRecord,
      snapshot: freshCapture.snapshot,
      reviews: [
        {
          id: "review_fresh",
          fetchedAt: "2026-06-25T00:00:00.000Z",
          rating: 5,
          retentionExpiresAt: "2026-07-02T00:00:00.000Z",
          staleAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    const dryRun = await pruneGooglePlacesContent({
      db,
      dryRun: true,
      now: "2026-06-25T00:00:00.000Z",
    });
    const afterDryRun = await readGooglePlacesCounts(db);

    expect(dryRun).toEqual({
      dryRun: true,
      now: "2026-06-25T00:00:00.000Z",
      reviewsDeleted: 1,
      detailsDeleted: 1,
      snapshotsDeleted: 1,
    });
    expect(afterDryRun).toEqual({
      googlePlaces: 2,
      snapshots: 2,
      details: 2,
      reviews: 2,
    });

    const pruned = await pruneGooglePlacesContent({
      db,
      now: "2026-06-25T00:00:00.000Z",
    });
    const afterPrune = await readGooglePlacesCounts(db);

    expect(pruned).toEqual({
      dryRun: false,
      now: "2026-06-25T00:00:00.000Z",
      reviewsDeleted: 1,
      detailsDeleted: 1,
      snapshotsDeleted: 1,
    });
    expect(afterPrune).toEqual({
      googlePlaces: 2,
      snapshots: 1,
      details: 1,
      reviews: 1,
    });

    await db.close();
  });
});

async function openGooglePlacesPruneTestDatabase() {
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
  details = createDetailsInput({}),
  fetchedAt = "2026-06-25T00:00:00.000Z",
  place = {
    placeId: "place_kermit",
    resourceName: "places/place_kermit",
  },
  requestKind = "details_enterprise",
  sourceRecord = createSourceRecord({ fetchedAt, placeId: place.placeId }),
}: {
  place?: GooglePlaceIdentityInput;
  sourceRecord?: GooglePlacesSourceRecordInput;
  details?: GooglePlaceDetailsInput;
  fetchedAt?: string;
  requestKind?: GooglePlacesRequestKind;
} = {}) {
  const snapshot = createGooglePlaceSnapshotInput({
    placeId: place.placeId,
    requestKind,
    fieldMask: googlePlacesRequestPolicies[requestKind].fieldMask,
    fetchedAt,
    payloadJson: {
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [{ provider: "Google" }],
    },
  });

  return {
    place,
    sourceRecord,
    snapshot: {
      ...snapshot,
      retentionExpiresAt: details.retentionExpiresAt,
      staleAt: details.staleAt,
    },
    details,
  };
}

function createSourceRecord({
  fetchedAt,
  name = "Kermit Surf Resort and Restaurant",
  placeId,
}: {
  fetchedAt: string;
  name?: string;
  placeId: string;
}): GooglePlacesSourceRecordInput {
  return {
    id: `record_google_place_${placeId}`,
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    providerEntityId: placeId,
    entityType: "restaurant",
    name,
    normalizedPayload: { placeId },
    sourceUrl: "https://maps.google.com/?cid=123",
    fetchedAt,
    allowedUse: "citation_only",
  };
}

function createDetailsInput({
  displayName = "Kermit Surf Resort and Restaurant",
  fetchedAt = "2026-06-25T00:00:00.000Z",
  retentionExpiresAt = "2026-07-25T00:00:00.000Z",
  staleAt = "2026-07-02T00:00:00.000Z",
}: {
  displayName?: string;
  fetchedAt?: string;
  retentionExpiresAt?: string;
  staleAt?: string;
}): GooglePlaceDetailsInput {
  return {
    displayNameJson: { text: displayName, languageCode: "en" },
    formattedAddress: "Tourism Road, General Luna, Siargao",
    locationJson: { latitude: 9.803, longitude: 126.161 },
    primaryType: "restaurant",
    fetchedAt,
    staleAt,
    retentionExpiresAt,
  };
}

async function readGooglePlacesCounts(db: PGlite) {
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
  const row = counts.rows[0];

  return {
    googlePlaces: row?.google_places ?? 0,
    snapshots: row?.google_place_snapshots ?? 0,
    details: row?.google_place_details ?? 0,
    reviews: row?.google_place_reviews ?? 0,
  };
}
