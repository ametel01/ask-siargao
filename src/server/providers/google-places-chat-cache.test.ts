import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { Logger } from "pino";

import { runInitialMigration } from "@/server/db/test-database";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { createCachedGooglePlacesChatContextAdapter } from "@/server/providers/google-places-chat-cache";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";

const generalLunaRestaurantSearch: GooglePlacesChatSearch = {
  label: "agent_good_restaurant_in_general_luna_siargao",
  textQuery: "good restaurant in General Luna Siargao",
  includedType: "restaurant",
  center: { latitude: 9.8006, longitude: 126.1586 },
  radiusMeters: 12_000,
  pageSize: 8,
};

describe("Google Places chat cache", () => {
  test("persists live chat search results and reuses fresh cache on the next matching request", async () => {
    const db = await openGooglePlacesChatCacheTestDatabase();
    const logs: TestLog[] = [];
    let liveCalls = 0;
    const adapter = createCachedGooglePlacesChatContextAdapter({
      db,
      liveAdapter: async ({ fetchedAt, search }) => {
        liveCalls += 1;
        return googlePlacesContext({ fetchedAt, placeCount: 8, search });
      },
      logger: createTestLogger(logs),
    });

    const first = await adapter({
      fetchedAt: "2026-06-25T22:08:55.090Z",
      search: generalLunaRestaurantSearch,
    });
    const second = await adapter({
      fetchedAt: "2026-06-25T22:09:55.090Z",
      search: generalLunaRestaurantSearch,
    });
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

    expect(liveCalls).toBe(1);
    expect(first.places).toHaveLength(8);
    expect(second.places).toHaveLength(8);
    expect(first.freshness).toBe("live");
    expect(second.freshness).toBe("fresh_cache");
    expect(second.places.map((place) => place.displayName)).toEqual(
      first.places.map((place) => place.displayName),
    );
    expect(counts.rows[0]).toMatchObject({
      google_places: 8,
      google_place_snapshots: 8,
      google_place_details: 8,
      source_records: 8,
    });
    expect(counts.rows[0]?.facts).toBeGreaterThan(0);
    expect(counts.rows[0]?.evidence).toBeGreaterThan(0);
    expect(logs.filter((log) => log.message === "Google Places chat cache checked.")).toEqual([
      expect.objectContaining({
        level: "info",
        payload: expect.objectContaining({
          cacheCandidateCount: 0,
          cacheStatus: "miss",
        }),
      }),
      expect.objectContaining({
        level: "info",
        payload: expect.objectContaining({
          cacheCandidateCount: 8,
          cacheStatus: "hit",
        }),
      }),
    ]);
    expect(
      logs.filter((log) => log.message === "Google Places chat DB place write started."),
    ).toHaveLength(8);
    expect(
      logs.filter((log) => log.message === "Google Places chat DB place write completed."),
    ).toHaveLength(8);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: "Google Places chat live lookup persisted.",
        payload: expect.objectContaining({
          cacheStatus: "miss",
          googleApiCalled: true,
          persistedPlaceCount: 8,
          tableWriteSummary: expect.objectContaining({
            googlePlaceDetails: 8,
            googlePlaceSnapshots: 8,
            googlePlaces: 8,
            sourceRecords: 8,
          }),
        }),
      }),
    );

    await db.close();
  });

  test("treats stale cached rows as a miss and refreshes from live Google", async () => {
    const db = await openGooglePlacesChatCacheTestDatabase();
    let liveCalls = 0;
    const adapter = createCachedGooglePlacesChatContextAdapter({
      db,
      liveAdapter: async ({ fetchedAt, search }) => {
        liveCalls += 1;
        return googlePlacesContext({ fetchedAt, search });
      },
      minimumFreshCachePlaces: 1,
    });

    await adapter({
      fetchedAt: "2026-06-01T00:00:00.000Z",
      search: generalLunaRestaurantSearch,
    });
    await adapter({
      fetchedAt: "2026-07-02T00:00:00.000Z",
      search: generalLunaRestaurantSearch,
    });

    expect(liveCalls).toBe(2);

    await db.close();
  });

  test("treats partial fresh cache rows as a refreshable miss", async () => {
    const db = await openGooglePlacesChatCacheTestDatabase();
    let liveCalls = 0;
    const adapter = createCachedGooglePlacesChatContextAdapter({
      db,
      liveAdapter: async ({ fetchedAt, search }) => {
        liveCalls += 1;
        return googlePlacesContext({
          fetchedAt,
          placeCount: liveCalls === 1 ? 2 : 8,
          search,
        });
      },
      minimumFreshCachePlaces: 4,
    });

    const first = await adapter({
      fetchedAt: "2026-06-25T22:08:55.090Z",
      search: generalLunaRestaurantSearch,
    });
    const second = await adapter({
      fetchedAt: "2026-06-25T22:09:55.090Z",
      search: generalLunaRestaurantSearch,
    });

    expect(liveCalls).toBe(2);
    expect(first.places).toHaveLength(2);
    expect(second.places).toHaveLength(8);
    expect(second.freshness).toBe("live");

    await db.close();
  });

  test("refreshes fresh cache rows that cannot answer required live status", async () => {
    const db = await openGooglePlacesChatCacheTestDatabase();
    const logs: TestLog[] = [];
    let liveCalls = 0;
    const adapter = createCachedGooglePlacesChatContextAdapter({
      db,
      liveAdapter: async ({ fetchedAt, search }) => {
        liveCalls += 1;
        return googlePlacesContext({ fetchedAt, placeCount: 4, search });
      },
      logger: createTestLogger(logs),
      minimumFreshCachePlaces: 4,
    });

    await adapter({
      fetchedAt: "2026-06-25T22:08:55.090Z",
      search: generalLunaRestaurantSearch,
    });
    const liveStatusResponse = await adapter({
      fetchedAt: "2026-06-25T22:09:55.090Z",
      requiresLiveStatus: true,
      search: generalLunaRestaurantSearch,
    });

    expect(liveCalls).toBe(2);
    expect(liveStatusResponse.freshness).toBe("live");
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: "Google Places chat cache checked.",
        payload: expect.objectContaining({
          cacheCandidateCount: 4,
          cacheStatus: "partial",
          cacheSupportsLiveStatus: false,
          requiresLiveStatus: true,
        }),
      }),
    );

    await db.close();
  });
});

type TestLog = {
  bindings: Record<string, unknown>;
  level: "debug" | "error" | "info";
  message: string;
  payload: Record<string, unknown>;
};

function createTestLogger(logs: TestLog[], bindings: Record<string, unknown> = {}) {
  const logger = {
    child(childBindings: Record<string, unknown>) {
      return createTestLogger(logs, { ...bindings, ...childBindings });
    },
    debug(payload: Record<string, unknown>, message: string) {
      logs.push({ bindings, level: "debug", message, payload });
    },
    error(payload: Record<string, unknown>, message: string) {
      logs.push({ bindings, level: "error", message, payload });
    },
    info(payload: Record<string, unknown>, message: string) {
      logs.push({ bindings, level: "info", message, payload });
    },
  };

  return logger as unknown as Logger;
}

async function openGooglePlacesChatCacheTestDatabase() {
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

function googlePlacesContext({
  fetchedAt,
  openNow,
  placeCount = 2,
  search,
}: {
  fetchedAt: string;
  openNow?: boolean;
  placeCount?: number;
  search: GooglePlacesChatSearch;
}): GooglePlacesChatContext {
  const seedPlaces = [
    {
      placeId: "place_las_barricas",
      displayName: "Las Barricas Siargao",
      primaryType: "spanish_restaurant",
      types: ["spanish_restaurant", "restaurant", "food"],
      rating: 4.9,
      userRatingCount: 1131,
      priceLevel: "PRICE_LEVEL_MODERATE",
    },
    {
      placeId: "place_alma",
      displayName: "Alma Siargao",
      primaryType: "restaurant",
      types: ["restaurant", "food"],
      rating: 4.8,
      userRatingCount: 673,
    },
    {
      placeId: "place_haruna",
      displayName: "Haruna Surf Resort Restaurant",
      primaryType: "restaurant",
      types: ["restaurant", "food"],
      rating: 4.7,
      userRatingCount: 311,
    },
    {
      placeId: "place_kermit",
      displayName: "Kermit Siargao",
      primaryType: "italian_restaurant",
      types: ["italian_restaurant", "restaurant", "food"],
      rating: 4.6,
      userRatingCount: 2200,
    },
    {
      placeId: "place_shaka",
      displayName: "Shaka Cafe",
      primaryType: "cafe",
      types: ["cafe", "restaurant", "food"],
      rating: 4.5,
      userRatingCount: 820,
    },
    {
      placeId: "place_bulaloan",
      displayName: "Bulaloan sa Isla",
      primaryType: "restaurant",
      types: ["restaurant", "food"],
      rating: 4.4,
      userRatingCount: 180,
    },
    {
      placeId: "place_white_beard",
      displayName: "White Beard Coffee",
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", "food"],
      rating: 4.6,
      userRatingCount: 490,
    },
    {
      placeId: "place_cev",
      displayName: "CEV Ceviche and Kinilaw",
      primaryType: "seafood_restaurant",
      types: ["seafood_restaurant", "restaurant", "food"],
      rating: 4.9,
      userRatingCount: 950,
    },
  ];

  return {
    status: "available",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt,
    freshness: "live",
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    caveats: [],
    places: seedPlaces.slice(0, placeCount).map((place, index) => ({
      ...place,
      resourceName: `places/${place.placeId}`,
      formattedAddress: index === 1 ? "Purok 1, General Luna" : "General Luna, Siargao",
      latitude: 9.799 + index / 1000,
      longitude: 126.16 + index / 1000,
      businessStatus: "OPERATIONAL",
      ...(openNow === undefined ? {} : { currentOpeningHours: { openNow } }),
      googleMapsUri: `https://maps.google.com/?cid=${place.placeId}`,
    })),
  };
}
