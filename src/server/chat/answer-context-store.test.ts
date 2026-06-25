import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  AnswerContextStore,
  planGooglePlacesRequirement,
} from "@/server/chat/answer-context-store";
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
    expect(context.places[0]).toMatchObject({
      name: "Kermit Surf Resort and Restaurant",
      googleMapsUri: "https://maps.google.com/?cid=123",
      rating: 4.6,
      userRatingCount: 1240,
    });
    expect(context.facts.some((fact) => fact.claim.includes("Kermit"))).toBe(true);
    expect(context.facts.map((fact) => fact.type)).toContain("google_price_signal");
    expect(context.facts.map((fact) => fact.type)).toContain("google_review_count_signal");
    expect(context.sourceFreshness[0]).toMatchObject({
      sourceName: "Google Places",
      status: "fresh",
    });

    await db.close();
  });

  test("does not expose Google Place IDs as fallback display names", async () => {
    const db = await openAnswerContextTestDatabase();
    await seedStoredPlace(db, {
      fetchedAt: "2026-06-25T00:00:00.000Z",
      placeName: "",
      staleAt: "2026-07-02T00:00:00.000Z",
      retentionExpiresAt: "2026-07-25T00:00:00.000Z",
    });
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      googlePlacesAdapter: async () => googlePlacesContext(),
    });

    const context = await store.getOrRefresh({
      messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
    });

    expect(context.places).toHaveLength(0);
    expect(JSON.stringify(context.facts)).not.toContain("place_kermit");

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
    expect(context.places[0]?.name).toBe("Kermit Surf Resort and Restaurant");
    expect(fresh.rows[0]?.fetched_at.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(fresh.rows[0]?.stale_at.toISOString()).toBe("2026-07-03T00:00:00.000Z");

    await db.close();
  });

  test("plans lodging lookup from accommodation rating follow-ups and prior Cloud 9 context", () => {
    const requirement = planGooglePlacesRequirement([
      {
        role: "user",
        content:
          "I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants, and easy airport transfer.",
      },
      {
        role: "assistant",
        content: "Cloud 9 is convenient for surf and General Luna restaurants.",
      },
      { role: "user", content: "what about accomodations? i want to know the rating also" },
    ]);

    expect(requirement).toMatchObject({
      primaryType: "lodging",
      search: {
        label: "chat_lodging_cloud_9",
        includedType: "lodging",
        center: { latitude: 9.8116, longitude: 126.1651 },
        radiusMeters: 4_000,
      },
    });
    expect(requirement?.search.textQuery).toContain("near Cloud 9");
  });

  test("plans restaurant lookup from date-night follow-ups and prior General Luna food context", () => {
    const requirement = planGooglePlacesRequirement([
      { role: "user", content: "Where should I eat in General Luna tonight?" },
      { role: "assistant", content: "What kind of dinner are you after?" },
      { role: "user", content: "nice date-night" },
    ]);

    expect(requirement).toMatchObject({
      primaryType: "restaurant",
      search: {
        label: "chat_restaurant_general_luna",
        includedType: "restaurant",
        center: { latitude: 9.8006, longitude: 126.1586 },
        radiusMeters: 7_000,
      },
    });
    expect(requirement?.search.textQuery).toBe(
      "nice date-night near General Luna Siargao Philippines",
    );
  });

  test("falls back to Google Places when the internal DB lookup fails", async () => {
    const db: GooglePlacesStoreDatabase = {
      async query() {
        throw new Error("database unavailable");
      },
    };
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
      messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
    });

    expect(googleCalls).toBe(1);
    expect(context.liveRefreshCount).toBe(1);
    expect(context.sourceFreshness[0]).toMatchObject({ status: "refreshed" });
    expect(context.places[0]?.name).toBe("Kermit Surf Resort and Restaurant");
  });

  test("matches stored lodging rows by Google type when primary type is hotel", async () => {
    const db = await openAnswerContextTestDatabase();
    await seedStoredPlace(db, {
      entityType: "hotel",
      fetchedAt: "2026-06-25T00:00:00.000Z",
      placeId: "place_quiet_resort",
      placeName: "Quiet Cloud 9 Resort",
      primaryType: "hotel",
      staleAt: "2026-07-02T00:00:00.000Z",
      retentionExpiresAt: "2026-07-25T00:00:00.000Z",
      types: ["lodging", "hotel", "point_of_interest", "establishment"],
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
      messages: [
        { role: "user", content: "I am staying near Cloud 9." },
        { role: "user", content: "what about accommodations? i want to know the rating also" },
      ],
    });

    expect(googleCalls).toBe(0);
    expect(context.facts.some((fact) => fact.claim.includes("Quiet Cloud 9 Resort"))).toBe(true);
    expect(context.facts.map((fact) => fact.type)).toContain("google_rating_signal");

    await db.close();
  });

  test("returns bounded live Google facts when persistence is unavailable", async () => {
    const db = await openAnswerContextTestDatabase();
    const store = new AnswerContextStore({
      db,
      clock: () => new Date("2026-06-28T00:00:00.000Z"),
      googlePlacesAdapter: async ({ fetchedAt, search }) =>
        googlePlacesContext({
          fetchedAt,
          search,
          placeId: "place_ephemeral_resort",
          placeName: "Ephemeral Cloud 9 Resort",
          primaryType: "hotel",
          types: ["lodging", "hotel"],
        }),
    });
    await db.query("delete from source_profiles where id = $1", [
      googlePlacesDiscoverySourceProfileId,
    ]);

    const context = await store.getOrRefresh({
      messages: [
        { role: "user", content: "I am staying near Cloud 9." },
        { role: "user", content: "what about accommodations? i want to know the rating also" },
      ],
    });

    expect(context.liveRefreshCount).toBe(1);
    expect(context.sourceFreshness[0]).toMatchObject({ status: "refreshed" });
    expect(context.places[0]).toMatchObject({
      name: "Ephemeral Cloud 9 Resort",
      primaryType: "hotel",
    });
    expect(context.facts.some((fact) => fact.claim.includes("Ephemeral Cloud 9 Resort"))).toBe(
      true,
    );
    expect(context.facts.map((fact) => fact.type)).toContain("google_review_count_signal");

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
    entityType = "restaurant",
    fetchedAt,
    placeId = "place_kermit",
    placeName = "Kermit Surf Resort and Restaurant",
    primaryType = "restaurant",
    retentionExpiresAt,
    staleAt,
    types = ["restaurant", "food"],
  }: {
    entityType?: string;
    fetchedAt: string;
    placeId?: string;
    placeName?: string;
    primaryType?: string;
    staleAt: string;
    retentionExpiresAt: string;
    types?: string[];
  },
) {
  const snapshot = createGooglePlaceSnapshotInput({
    placeId,
    requestKind: "chat_search",
    fieldMask: googlePlacesChatSearchFieldMask,
    fetchedAt,
    payloadJson: { googleMapsUri: "https://maps.google.com/?cid=123" },
  });
  await upsertGooglePlaceDetails(db, {
    place: { placeId, resourceName: `places/${placeId}` },
    sourceRecord: {
      id: `record_google_places_chat_${placeId}`,
      sourceProfileId: googlePlacesDiscoverySourceProfileId,
      providerEntityId: placeId,
      entityType,
      name: placeName,
      normalizedPayload: { placeId },
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
      displayNameJson: placeName ? { text: placeName } : {},
      formattedAddress: "Tourism Road, General Luna, Siargao",
      latitude: 9.803,
      longitude: 126.161,
      typesJson: types,
      primaryType,
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
  placeId = "place_kermit",
  placeName = "Kermit Surf Resort and Restaurant",
  primaryType = "restaurant",
  search = {
    label: "chat_restaurant_cloud_9",
    textQuery: "Where should we eat near Cloud 9 Siargao Philippines",
    includedType: "restaurant",
    center: { latitude: 9.8116, longitude: 126.1651 },
    radiusMeters: 4_000,
    pageSize: 8,
  },
  types = ["restaurant", "food"],
}: {
  fetchedAt?: string;
  placeId?: string;
  placeName?: string;
  primaryType?: string;
  search?: GooglePlacesChatSearch;
  types?: string[];
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
        placeId,
        resourceName: `places/${placeId}`,
        displayName: placeName,
        formattedAddress: "Tourism Road, General Luna, Siargao",
        latitude: 9.803,
        longitude: 126.161,
        types,
        primaryType,
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=123",
        rating: 4.6,
        userRatingCount: 1240,
        priceLevel: "PRICE_LEVEL_MODERATE",
        captureJson: {
          placeId,
          resourceName: `places/${placeId}`,
          displayNameJson: { text: placeName },
          formattedAddress: "Tourism Road, General Luna, Siargao",
          locationJson: { latitude: 9.803, longitude: 126.161 },
          typesJson: types,
          primaryType,
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
