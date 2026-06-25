import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { AnswerContextStore } from "@/server/chat/answer-context-store";
import { runInitialMigration } from "@/server/db/test-database";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import {
  createGooglePlaceSnapshotInput,
  type GooglePlacesStoreDatabase,
  upsertGooglePlaceDetails,
} from "@/server/providers/google-places-store";

describe("AnswerContextStore", () => {
  test("uses fresh stored Google facts without calling the provider", async () => {
    const db = await openAnswerContextTestDatabase();
    await seedStoredPlace(db, {
      fetchedAt: "2026-06-25T00:00:00.000Z",
      staleAt: "2026-07-02T00:00:00.000Z",
      retentionExpiresAt: "2026-07-25T00:00:00.000Z",
    });
    let googleCalls = 0;
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      googlePlacesAdapter: async () => {
        googleCalls += 1;
        return googlePlacesContext();
      },
    });

    const context = await store.getOrRefresh({
      messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
    });

    expect(googleCalls).toBe(0);
    expect(context.liveRefreshCount).toBe(0);
    expect(context.facts.some((fact) => fact.claim.includes("Kermit"))).toBe(true);
    expect(context.facts.map((fact) => fact.type)).toContain("google_price_signal");
    expect(context.facts.map((fact) => fact.type)).toContain("google_review_count_signal");
    expect(context.sourceFreshness[0]).toMatchObject({
      sourceName: "Google Places",
      status: "fresh",
    });

    await db.close();
  });

  test("refreshes stale stored Google facts and persists the replacement", async () => {
    const db = await openAnswerContextTestDatabase();
    await seedStoredPlace(db, {
      fetchedAt: "2026-06-01T00:00:00.000Z",
      staleAt: "2026-06-08T00:00:00.000Z",
      retentionExpiresAt: "2026-07-01T00:00:00.000Z",
    });
    let googleCalls = 0;
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      googlePlacesAdapter: async ({ fetchedAt, search }) => {
        googleCalls += 1;
        return googlePlacesContext({ fetchedAt, search });
      },
    });

    const context = await store.getOrRefresh({
      messages: [{ role: "user", content: "find me the best restaurant around cloud9" }],
    });
    const fresh = await db.query<{ fetched_at: Date; stale_at: Date }>(
      "select fetched_at, stale_at from google_place_details where place_id = 'place_kermit'",
    );

    expect(googleCalls).toBe(1);
    expect(context.liveRefreshCount).toBe(1);
    expect(context.sourceFreshness[0]).toMatchObject({ status: "refreshed" });
    expect(fresh.rows[0]?.fetched_at.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(fresh.rows[0]?.stale_at.toISOString()).toBe("2026-07-03T00:00:00.000Z");

    await db.close();
  });

  test("does not pass expired stored Google facts when refresh is blocked", async () => {
    const db = await openAnswerContextTestDatabase();
    await seedStoredPlace(db, {
      fetchedAt: "2026-05-01T00:00:00.000Z",
      staleAt: "2026-05-08T00:00:00.000Z",
      retentionExpiresAt: "2026-05-31T00:00:00.000Z",
    });
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      canUseLiveRefresh: () => false,
      googlePlacesAdapter: async () => googlePlacesContext(),
    });

    const context = await store.getOrRefresh({
      messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
    });

    expect(context.facts).toHaveLength(0);
    expect(context.gaps[0]).toMatchObject({ reason: "refresh_blocked" });
    expect(context.sourceFreshness[0]).toMatchObject({ status: "blocked" });

    await db.close();
  });

  test("returns gaps for missing Google facts when live refresh policy blocks provider calls", async () => {
    const db = await openAnswerContextTestDatabase();
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      canUseLiveRefresh: () => false,
      googlePlacesAdapter: async () => {
        throw new Error("Provider should not be called.");
      },
    });

    const context = await store.getOrRefresh({
      messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
    });

    expect(context.facts).toHaveLength(0);
    expect(context.gaps).toEqual([
      {
        type: "google_places",
        reason: "refresh_blocked",
        message:
          "Stored Google Places data is missing, stale, or expired, and live refresh is not allowed.",
      },
    ]);

    await db.close();
  });
});

async function openAnswerContextTestDatabase() {
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

async function seedStoredPlace(
  db: GooglePlacesStoreDatabase,
  {
    fetchedAt,
    retentionExpiresAt,
    staleAt,
  }: {
    fetchedAt: string;
    staleAt: string;
    retentionExpiresAt: string;
  },
) {
  const snapshot = createGooglePlaceSnapshotInput({
    placeId: "place_kermit",
    requestKind: "chat_search",
    fieldMask: googlePlacesChatSearchFieldMask,
    fetchedAt,
    payloadJson: { googleMapsUri: "https://maps.google.com/?cid=123" },
  });
  await upsertGooglePlaceDetails(db, {
    place: { placeId: "place_kermit", resourceName: "places/place_kermit" },
    sourceRecord: {
      id: "record_google_places_chat_place_kermit",
      sourceProfileId: googlePlacesDiscoverySourceProfileId,
      providerEntityId: "place_kermit",
      entityType: "restaurant",
      name: "Kermit Surf Resort and Restaurant",
      normalizedPayload: { placeId: "place_kermit" },
      sourceUrl: "https://maps.google.com/?cid=123",
      fetchedAt,
      allowedUse: "citation_only",
    },
    snapshot: {
      ...snapshot,
      staleAt,
      retentionExpiresAt,
    },
    details: {
      displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
      formattedAddress: "Tourism Road, General Luna, Siargao",
      latitude: 9.803,
      longitude: 126.161,
      typesJson: ["restaurant", "food"],
      primaryType: "restaurant",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=123",
      rating: 4.6,
      userRatingCount: 1240,
      priceLevel: "PRICE_LEVEL_MODERATE",
      fetchedAt,
      staleAt,
      retentionExpiresAt,
    },
  });
}

function googlePlacesContext({
  fetchedAt = "2026-06-28T00:00:00.000Z",
  search = {
    label: "chat_restaurant_cloud_9",
    textQuery: "Where should we eat near Cloud 9 Siargao Philippines",
    includedType: "restaurant",
    center: { latitude: 9.8116, longitude: 126.1651 },
    radiusMeters: 4_000,
    pageSize: 8,
  },
}: {
  fetchedAt?: string;
  search?: GooglePlacesChatSearch;
} = {}): GooglePlacesChatContext {
  return {
    status: "available" as const,
    sourceName: "Google Places" as const,
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt,
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    caveats: ["No review text."],
    places: [
      {
        placeId: "place_kermit",
        resourceName: "places/place_kermit",
        displayName: "Kermit Surf Resort and Restaurant",
        formattedAddress: "Tourism Road, General Luna, Siargao",
        latitude: 9.803,
        longitude: 126.161,
        types: ["restaurant", "food"],
        primaryType: "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=123",
        rating: 4.6,
        userRatingCount: 1240,
        priceLevel: "PRICE_LEVEL_MODERATE",
        captureJson: {
          placeId: "place_kermit",
          resourceName: "places/place_kermit",
          displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
          formattedAddress: "Tourism Road, General Luna, Siargao",
          locationJson: { latitude: 9.803, longitude: 126.161 },
          typesJson: ["restaurant", "food"],
          primaryType: "restaurant",
          businessStatus: "OPERATIONAL",
          googleMapsUri: "https://maps.google.com/?cid=123",
          rating: 4.6,
          userRatingCount: 1240,
          priceLevel: "PRICE_LEVEL_MODERATE",
        },
      },
    ],
  };
}
