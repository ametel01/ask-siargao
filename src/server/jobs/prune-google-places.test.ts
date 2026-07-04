import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import {
  formatPruneSummary,
  parsePruneGooglePlacesArgs,
  pruneGooglePlacesContent,
} from "@/server/jobs/prune-google-places";
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
  type GooglePlacesStoreDatabase,
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
      batchSize: 500,
      dryRun: true,
      hasMore: true,
      maxBatches: 20,
      now: "2026-06-25T00:00:00.000Z",
      totalBatches: 0,
      totalRows: 3,
      reviews: { rows: 1, batches: 0, hasMore: true },
      reviewsDeleted: 1,
      details: { rows: 1, batches: 0, hasMore: true },
      detailsDeleted: 1,
      snapshots: { rows: 1, batches: 0, hasMore: true },
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
      batchSize: 500,
      dryRun: false,
      hasMore: false,
      maxBatches: 20,
      now: "2026-06-25T00:00:00.000Z",
      totalBatches: 3,
      totalRows: 3,
      reviews: { rows: 1, batches: 1, hasMore: false },
      reviewsDeleted: 1,
      details: { rows: 1, batches: 1, hasMore: false },
      detailsDeleted: 1,
      snapshots: { rows: 1, batches: 1, hasMore: false },
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

  test("deletes expired rows across repeated bounded runs and delays snapshots while reviews remain", async () => {
    const db = await openGooglePlacesPruneTestDatabase();

    for (const index of [1, 2, 3]) {
      const capture = createDetailsCapture({
        details: createDetailsInput({
          displayName: `Expired Cafe ${index}`,
          fetchedAt: "2026-05-01T00:00:00.000Z",
          retentionExpiresAt: "2026-05-31T00:00:00.000Z",
          staleAt: "2026-05-08T00:00:00.000Z",
        }),
        fetchedAt: "2026-05-01T00:00:00.000Z",
        place: {
          placeId: `place_expired_${index}`,
          resourceName: `places/place_expired_${index}`,
        },
        requestKind: "details_atmosphere_reviews",
        sourceRecord: createSourceRecord({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          name: `Expired Cafe ${index}`,
          placeId: `place_expired_${index}`,
        }),
      });

      await upsertGooglePlaceDetails(db, capture);
      await upsertGooglePlaceReviews(db, {
        place: capture.place,
        sourceRecord: capture.sourceRecord,
        snapshot: capture.snapshot,
        reviews: [
          {
            id: `review_expired_${index}`,
            fetchedAt: "2026-05-01T00:00:00.000Z",
            rating: 4,
            retentionExpiresAt: "2026-05-31T00:00:00.000Z",
            staleAt: "2026-05-08T00:00:00.000Z",
          },
        ],
      });
    }

    const firstRun = await pruneGooglePlacesContent({
      batchSize: 1,
      db,
      maxBatches: 2,
      now: "2026-06-25T00:00:00.000Z",
    });

    expect(firstRun).toMatchObject({
      reviews: { rows: 2, batches: 2, hasMore: true },
      details: { rows: 2, batches: 2, hasMore: true },
      snapshots: { rows: 0, batches: 0, hasMore: true },
      reviewsDeleted: 2,
      detailsDeleted: 2,
      snapshotsDeleted: 0,
      totalRows: 4,
      totalBatches: 4,
      hasMore: true,
    });
    expect(await readGooglePlacesCounts(db)).toEqual({
      googlePlaces: 3,
      snapshots: 3,
      details: 1,
      reviews: 1,
    });

    const secondRun = await pruneGooglePlacesContent({
      batchSize: 2,
      db,
      maxBatches: 5,
      now: "2026-06-25T00:00:00.000Z",
    });

    expect(secondRun).toMatchObject({
      reviews: { rows: 1, batches: 1, hasMore: false },
      details: { rows: 1, batches: 1, hasMore: false },
      snapshots: { rows: 3, batches: 2, hasMore: false },
      reviewsDeleted: 1,
      detailsDeleted: 1,
      snapshotsDeleted: 3,
      totalRows: 5,
      totalBatches: 4,
      hasMore: false,
    });
    expect(await readGooglePlacesCounts(db)).toEqual({
      googlePlaces: 3,
      snapshots: 0,
      details: 0,
      reviews: 0,
    });

    await db.close();
  });

  test("does not start snapshot deletes until the review cleanup reports no remaining expired rows", async () => {
    const calls: string[] = [];
    const db: GooglePlacesStoreDatabase = {
      async query<T>(query: string) {
        if (query.includes("delete from google_place_reviews")) {
          calls.push("delete-reviews");
          return { rows: [{ deleted_count: 1 }] as T[] };
        }
        if (query.includes("from google_place_reviews where")) {
          calls.push("check-reviews");
          return { rows: [{ has_more: true }] as T[] };
        }
        if (query.includes("delete from google_place_details")) {
          calls.push("delete-details");
          return { rows: [{ deleted_count: 0 }] as T[] };
        }
        if (query.includes("from google_place_details where")) {
          calls.push("check-details");
          return { rows: [{ has_more: false }] as T[] };
        }
        if (query.includes("delete from google_place_snapshots")) {
          throw new Error("Snapshot delete should not run while expired reviews remain.");
        }
        if (query.includes("from google_place_snapshots where")) {
          calls.push("check-snapshots");
          return { rows: [{ has_more: true }] as T[] };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    };

    const result = await pruneGooglePlacesContent({
      batchSize: 1,
      db,
      maxBatches: 1,
      now: "2026-06-25T00:00:00.000Z",
    });

    expect(result.snapshots).toEqual({ rows: 0, batches: 0, hasMore: true });
    expect(calls).toEqual([
      "delete-reviews",
      "check-reviews",
      "delete-details",
      "check-details",
      "check-snapshots",
    ]);
  });

  test("uses count-only bounded delete queries instead of unbounded returned ids", async () => {
    const queries: string[] = [];
    const db: GooglePlacesStoreDatabase = {
      async query<T>(query: string) {
        queries.push(query);

        if (query.includes("deleted_count")) {
          return { rows: [{ deleted_count: 0 }] as T[] };
        }
        if (query.includes("has_more")) {
          return { rows: [{ has_more: false }] as T[] };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    };

    await pruneGooglePlacesContent({
      batchSize: 50,
      db,
      maxBatches: 5,
      now: "2026-06-25T00:00:00.000Z",
    });

    expect(queries.join("\n")).not.toMatch(/\breturning\s+(id|place_id)\b/i);
    expect(queries.filter((query) => query.includes("limit $2")).length).toBe(3);
  });

  test("parses batch CLI controls and rejects invalid inputs", () => {
    expect(
      parsePruneGooglePlacesArgs(["--dry-run", "--batch-size", "25", "--max-batches=4"]),
    ).toEqual({
      batchSize: 25,
      dryRun: true,
      maxBatches: 4,
    });
    expect(parsePruneGooglePlacesArgs(["--batch-size=10", "--max-batches", "2"])).toEqual({
      batchSize: 10,
      dryRun: false,
      maxBatches: 2,
    });

    expect(() => parsePruneGooglePlacesArgs(["--batch-size", "0"])).toThrow(
      "--batch-size must be a positive integer.",
    );
    expect(() => parsePruneGooglePlacesArgs(["--max-batches", "1.5"])).toThrow(
      "--max-batches must be a positive integer.",
    );
    expect(() => parsePruneGooglePlacesArgs(["--batch-size"])).toThrow(
      "--batch-size requires a positive integer value.",
    );
    expect(() => parsePruneGooglePlacesArgs(["--unexpected"])).toThrow(
      "Unsupported Google Places prune argument: --unexpected.",
    );
  });

  test("formats operator progress with per-table totals, batches, and remaining-row status", () => {
    const output = formatPruneSummary(
      {
        batchSize: 10,
        details: { rows: 2, batches: 1, hasMore: false },
        detailsDeleted: 2,
        dryRun: false,
        hasMore: true,
        maxBatches: 3,
        now: "2026-06-25T00:00:00.000Z",
        reviews: { rows: 3, batches: 2, hasMore: true },
        reviewsDeleted: 3,
        snapshots: { rows: 1, batches: 1, hasMore: false },
        snapshotsDeleted: 1,
        totalBatches: 4,
        totalRows: 6,
      },
      "postgres://user:password@localhost:5432/siargao_portal",
    );

    expect(output).toContain("Database: postgres://user:***@localhost:5432/siargao_portal.");
    expect(output).toContain("Batch size: 10. Max batches per table: 3.");
    expect(output).toContain("Reviews: 3 deleted rows, 2 batches, more expired rows remain: yes.");
    expect(output).toContain("Details: 2 deleted rows, 1 batches, more expired rows remain: no.");
    expect(output).toContain("Snapshots: 1 deleted rows, 1 batches, more expired rows remain: no.");
    expect(output).toContain("Total: 6 deleted rows, 4 batches, more expired rows remain: yes.");
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
