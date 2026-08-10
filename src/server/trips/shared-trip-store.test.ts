import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { RecommendationCard } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { runInitialMigration } from "@/server/db/test-database";
import {
  createSharedTripPlan,
  deleteSharedTripPlanByToken,
  hashClientTripKey,
  hashPublicToken,
  listSavedTripItems,
  lookupSharedTripPlanByToken,
  removeSavedTripItem,
  upsertSavedTrip,
  upsertSavedTripItems,
} from "@/server/trips/shared-trip-store";
import {
  savedTripItemFromItineraryPlan,
  savedTripItemFromRecommendationCard,
} from "@/server/trips/shared-trip-types";

describe("shared trip persistence store", () => {
  test("persists, lists, updates, and removes saved trip items", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await upsertSavedTrip(db, {
      id: "trip_cloud9",
      clientTripKey: "browser-trip-key-1",
      title: "Cloud 9 plan",
      now: "2026-06-28T01:00:00.000Z",
    });
    const items = await upsertSavedTripItems(db, {
      tripId: trip.id,
      now: "2026-06-28T01:01:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: shakaCard,
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
        savedTripItemFromItineraryPlan({
          id: "itinerary_cloud9_rain",
          plan: rainyPlan,
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
      ],
    });

    expect(trip.clientTripKeyHash).toBe(hashClientTripKey("browser-trip-key-1"));
    expect(items.map((item) => item.title)).toEqual([
      "Shaka Siargao",
      "Rain-aware Cloud 9 afternoon",
    ]);

    await upsertSavedTripItems(db, {
      tripId: trip.id,
      now: "2026-06-28T01:02:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: { ...shakaCard, subtitle: "Updated smoothie stop" },
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
      ],
    });

    const listedItems = await listSavedTripItems(db, { tripId: trip.id });
    const listedCard = listedItems.find((item) => item.id === "place_shaka");
    expect(listedItems).toHaveLength(2);
    expect(
      listedCard?.payload.type === "recommendation_card" ? listedCard.payload.card.subtitle : "",
    ).toBe("Updated smoothie stop");

    expect(
      await removeSavedTripItem(db, {
        tripId: trip.id,
        itemId: "place_shaka",
        now: "2026-06-28T01:03:00.000Z",
      }),
    ).toBe(true);
    expect(await listSavedTripItems(db, { tripId: trip.id })).toHaveLength(1);
    expect(await listSavedTripItems(db, { tripId: trip.id, includeDeleted: true })).toHaveLength(2);

    await db.close();
  });

  test("batch upserts saved trip items in deterministic request order", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const countedDb = countQueries(db);
    const trip = await upsertSavedTrip(countedDb, {
      id: "trip_batch_items",
      clientTripKey: "browser-trip-key-batch-items",
      title: "Batched plan",
      now: "2026-06-28T01:00:00.000Z",
    });

    const items = await upsertSavedTripItems(countedDb, {
      tripId: trip.id,
      now: "2026-06-28T01:01:00.000Z",
      items: [
        savedTripItemFromItineraryPlan({
          id: "itinerary_batch_rain",
          plan: rainyPlan,
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
        savedTripItemFromRecommendationCard({
          card: shakaCard,
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
      ],
    });

    expect(items.map((item) => item.id)).toEqual(["itinerary_batch_rain", "place_shaka"]);
    expect(countedDb.countInsertInto("saved_trip_items")).toBe(1);

    await db.close();
  });

  test("does not insert saved trip items for empty inputs", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const countedDb = countQueries(db);
    const trip = await upsertSavedTrip(countedDb, {
      id: "trip_empty_items",
      clientTripKey: "browser-trip-key-empty-items",
      title: "Empty plan",
      now: "2026-06-28T01:00:00.000Z",
    });

    await expect(
      upsertSavedTripItems(countedDb, {
        tripId: trip.id,
        now: "2026-06-28T01:01:00.000Z",
        items: [],
      }),
    ).resolves.toEqual([]);

    expect(countedDb.countInsertInto("saved_trip_items")).toBe(0);

    await db.close();
  });

  test("updates, undeletes, and deduplicates saved trip items with later entries winning", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const countedDb = countQueries(db);
    const trip = await upsertSavedTrip(countedDb, {
      id: "trip_duplicate_items",
      clientTripKey: "browser-trip-key-duplicate-items",
      title: "Duplicate plan",
      now: "2026-06-28T01:00:00.000Z",
    });

    await upsertSavedTripItems(countedDb, {
      tripId: trip.id,
      now: "2026-06-28T01:01:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: shakaCard,
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
      ],
    });
    await removeSavedTripItem(countedDb, {
      tripId: trip.id,
      itemId: "place_shaka",
      now: "2026-06-28T01:02:00.000Z",
    });

    const upserted = await upsertSavedTripItems(countedDb, {
      tripId: trip.id,
      now: "2026-06-28T01:03:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: { ...shakaCard, subtitle: "Earlier duplicate subtitle" },
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
        savedTripItemFromRecommendationCard({
          card: { ...shakaCard, subtitle: "Later duplicate subtitle" },
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: trip.id,
        }),
      ],
    });
    const activeItems = await listSavedTripItems(countedDb, { tripId: trip.id });

    expect(upserted).toHaveLength(1);
    expect(
      upserted[0]?.payload.type === "recommendation_card" ? upserted[0].payload.card.subtitle : "",
    ).toBe("Later duplicate subtitle");
    expect(activeItems).toHaveLength(1);
    expect(
      activeItems[0]?.payload.type === "recommendation_card"
        ? activeItems[0].payload.card.subtitle
        : "",
    ).toBe("Later duplicate subtitle");

    await db.close();
  });

  test("does not partially insert saved trip items after validation or database errors", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const countedDb = countQueries(db);
    const trip = await upsertSavedTrip(countedDb, {
      id: "trip_no_partial_items",
      clientTripKey: "browser-trip-key-no-partial-items",
      title: "No partial plan",
      now: "2026-06-28T01:00:00.000Z",
    });
    const validItem = savedTripItemFromRecommendationCard({
      card: shakaCard,
      sources: [placesSource],
      savedAt: "2026-06-28T01:01:00.000Z",
      tripId: trip.id,
    });

    await expect(
      upsertSavedTripItems(countedDb, {
        tripId: trip.id,
        now: "2026-06-28T01:01:00.000Z",
        items: [validItem, { ...validItem, id: "invalid id with spaces" }],
      }),
    ).rejects.toThrow();
    expect(await listSavedTripItems(countedDb, { tripId: trip.id })).toHaveLength(0);

    await expect(
      upsertSavedTripItems(countedDb, {
        tripId: "missing_trip_id",
        now: "2026-06-28T01:01:00.000Z",
        items: [
          { ...validItem, id: "valid_missing_trip_one" },
          { ...validItem, id: "valid_missing_trip_two" },
        ],
      }),
    ).rejects.toThrow();
    const rows = await countedDb.query<{ count: number }>(
      `
        select count(*)::int as count
        from saved_trip_items
        where id in ('valid_missing_trip_one', 'valid_missing_trip_two')
      `,
    );
    expect(rows.rows[0]?.count).toBe(0);

    await db.close();
  });

  test("migrates unowned browser trips but rejects owner conflicts", async () => {
    const db = await openSharedTripStoreTestDatabase();
    await insertUser(db, "user_trip_owner");
    await insertUser(db, "user_trip_intruder");

    await upsertSavedTrip(db, {
      id: "trip_migrate",
      clientTripKey: "browser-trip-key-migrate",
      title: "Anonymous plan",
      now: "2026-06-28T01:00:00.000Z",
    });
    const migrated = await upsertSavedTrip(db, {
      id: "trip_migrate_ignored",
      clientTripKey: "browser-trip-key-migrate",
      userId: "user_trip_owner",
      title: "Owned plan",
      now: "2026-06-28T01:01:00.000Z",
    });

    expect(migrated.id).toBe("trip_migrate");
    expect(migrated.userId).toBe("user_trip_owner");
    await expect(
      upsertSavedTrip(db, {
        id: "trip_migrate_intruder",
        clientTripKey: "browser-trip-key-migrate",
        userId: "user_trip_intruder",
        title: "Intruder plan",
        now: "2026-06-28T01:02:00.000Z",
      }),
    ).rejects.toThrow("another user");
    await expect(
      upsertSavedTrip(db, {
        id: "trip_migrate_anonymous",
        clientTripKey: "browser-trip-key-migrate",
        title: "Anonymous overwrite",
        now: "2026-06-28T01:03:00.000Z",
      }),
    ).rejects.toThrow("another user");

    await db.close();
  });

  test("creates share tokens with hashed storage and selected item lookup", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await seedTripWithItems(db, "trip_share", "browser-trip-key-share");
    const result = await createSharedTripPlan(db, {
      id: "share_cloud9",
      tripId: trip.id,
      title: "Cloud 9 highlights",
      itemIds: ["place_shaka"],
      publicToken: "raw-public-token",
      now: "2026-06-28T02:00:00.000Z",
    });

    expect(result.publicToken).toBe("raw-public-token");
    expect(result.plan.expiresAt).toBe("2026-07-28T02:00:00.000Z");
    expect(result.plan.items.map((item) => item.id)).toEqual(["place_shaka"]);

    const rows = await db.query<{ public_token_hash: string }>(
      "select public_token_hash from shared_trip_plans where id = $1",
      ["share_cloud9"],
    );
    expect(rows.rows[0]?.public_token_hash).toBe(hashPublicToken("raw-public-token"));
    expect(rows.rows[0]?.public_token_hash).not.toBe("raw-public-token");

    const lookedUp = await lookupSharedTripPlanByToken(db, {
      publicToken: "raw-public-token",
      now: "2026-06-28T02:01:00.000Z",
    });
    expect(lookedUp?.title).toBe("Cloud 9 highlights");
    expect(lookedUp?.items.map((item) => item.title)).toEqual(["Shaka Siargao"]);
    expect(lookedUp?.items[0]?.tripId).toBeUndefined();
    expect(lookedUp?.items[0]?.sources).toEqual([placesSource, browserSavedNotReverifiedSource]);
    expect(
      lookedUp?.items[0]?.payload.type === "recommendation_card"
        ? lookedUp.items[0].payload.card.sourceLabel
        : "",
    ).toBe("Google Places - live checked");
    expect(
      lookedUp?.items[0]?.payload.type === "recommendation_card"
        ? lookedUp.items[0].payload.card.openStatusLabel
        : "",
    ).toBe("Open now from Google Places");
    expect(JSON.stringify(lookedUp)).not.toContain("rawProviderPayload");
    expect(JSON.stringify(lookedUp)).not.toContain("Best smoothie bowl");
    expect(JSON.stringify(lookedUp)).not.toContain("9.8116");
    expect(JSON.stringify(lookedUp)).toContain("live_checked");
    expect(JSON.stringify(lookedUp)).toContain("current opening status");

    await db.close();
  });

  test("rejects Shared Trip Link expiry beyond 30 days", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await seedTripWithItems(db, "trip_long_expiry", "browser-trip-key-long-expiry");

    await expect(
      createSharedTripPlan(db, {
        id: "share_long_expiry",
        tripId: trip.id,
        title: "Too long",
        itemIds: ["place_shaka"],
        publicToken: "long-expiry-token",
        expiresAt: "2026-07-28T02:00:00.001Z",
        now: "2026-06-28T02:00:00.000Z",
      }),
    ).rejects.toThrow("expire within 30 days");
    await db.close();
  });

  test("orders shared snapshot items by requested item ids", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await seedTripWithItems(db, "trip_share_order", "browser-trip-key-share-order");
    const result = await createSharedTripPlan(db, {
      id: "share_order",
      tripId: trip.id,
      title: "Reverse order",
      itemIds: ["trip_share_order_itinerary", "place_shaka"],
      publicToken: "order-token",
      now: "2026-06-28T02:00:00.000Z",
    });

    expect(result.plan.items.map((item) => item.id)).toEqual([
      "trip_share_order_itinerary",
      "place_shaka",
    ]);

    const lookedUp = await lookupSharedTripPlanByToken(db, {
      publicToken: "order-token",
      now: "2026-06-28T02:01:00.000Z",
    });
    expect(lookedUp?.items.map((item) => item.id)).toEqual([
      "trip_share_order_itinerary",
      "place_shaka",
    ]);

    await db.close();
  });

  test("keeps shared links stable after selected saved items are removed", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await seedTripWithItems(db, "trip_snapshot", "browser-trip-key-snapshot");
    await createSharedTripPlan(db, {
      id: "share_snapshot",
      tripId: trip.id,
      title: "Snapshot plan",
      itemIds: ["place_shaka", "trip_snapshot_itinerary"],
      publicToken: "snapshot-token",
      now: "2026-06-28T02:00:00.000Z",
    });

    expect(
      await removeSavedTripItem(db, {
        tripId: trip.id,
        itemId: "place_shaka",
        now: "2026-06-28T02:05:00.000Z",
      }),
    ).toBe(true);
    expect(await listSavedTripItems(db, { tripId: trip.id })).toHaveLength(1);

    const lookedUp = await lookupSharedTripPlanByToken(db, {
      publicToken: "snapshot-token",
      now: "2026-06-28T02:06:00.000Z",
    });

    expect(lookedUp?.items.map((item) => item.title)).toEqual([
      "Shaka Siargao",
      "Rain-aware Cloud 9 afternoon",
    ]);
    expect(lookedUp?.items[0]?.sources).toEqual([placesSource, browserSavedNotReverifiedSource]);
    expect(
      lookedUp?.items[1]?.payload.type === "itinerary_plan"
        ? lookedUp.items[1].payload.plan.sources
        : [],
    ).toEqual([weatherSource, browserSavedNotReverifiedSource]);

    await db.close();
  });

  test("does not return expired or deleted shared plans", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const trip = await seedTripWithItems(db, "trip_expiry", "browser-trip-key-expiry");
    await createSharedTripPlan(db, {
      id: "share_expiring",
      tripId: trip.id,
      title: "Expiring plan",
      itemIds: ["place_shaka"],
      publicToken: "expiring-token",
      expiresAt: "2026-06-28T03:00:00.000Z",
      now: "2026-06-28T02:00:00.000Z",
    });
    await createSharedTripPlan(db, {
      id: "share_deleted",
      tripId: trip.id,
      title: "Deleted plan",
      itemIds: ["place_shaka"],
      publicToken: "deleted-token",
      now: "2026-06-28T02:00:00.000Z",
    });

    expect(
      await lookupSharedTripPlanByToken(db, {
        publicToken: "expiring-token",
        now: "2026-06-28T02:59:00.000Z",
      }),
    ).not.toBeNull();
    expect(
      await lookupSharedTripPlanByToken(db, {
        publicToken: "expiring-token",
        now: "2026-06-28T03:00:01.000Z",
      }),
    ).toBeNull();

    expect(
      await deleteSharedTripPlanByToken(db, {
        publicToken: "deleted-token",
        now: "2026-06-28T02:30:00.000Z",
      }),
    ).toBe(true);
    expect(
      await lookupSharedTripPlanByToken(db, {
        publicToken: "deleted-token",
        now: "2026-06-28T02:31:00.000Z",
      }),
    ).toBeNull();

    await db.close();
  });

  test("rejects cross-trip item selection for shared plans", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const firstTrip = await seedTripWithItems(db, "trip_first", "browser-trip-key-first");
    const secondTrip = await seedTripWithItems(db, "trip_second", "browser-trip-key-second", {
      card: { ...shakaCard, id: "place_kermit", title: "Kermit Siargao" },
    });

    await expect(
      createSharedTripPlan(db, {
        id: "share_cross_trip",
        tripId: firstTrip.id,
        title: "Invalid cross-trip plan",
        itemIds: ["place_shaka", "place_kermit"],
        publicToken: "cross-trip-token",
        now: "2026-06-28T02:00:00.000Z",
      }),
    ).rejects.toThrow("selected trip");

    expect(await listSavedTripItems(db, { tripId: secondTrip.id })).toHaveLength(2);

    await db.close();
  });

  test("keeps deterministic item ids scoped to their trip", async () => {
    const db = await openSharedTripStoreTestDatabase();
    const firstTrip = await upsertSavedTrip(db, {
      id: "trip_first_same_item",
      clientTripKey: "browser-trip-key-first-same-item",
      title: "First seeded saved plan",
      now: "2026-06-28T01:00:00.000Z",
    });
    const secondTrip = await upsertSavedTrip(db, {
      id: "trip_second_same_item",
      clientTripKey: "browser-trip-key-second-same-item",
      title: "Second seeded saved plan",
      now: "2026-06-28T01:00:00.000Z",
    });

    await upsertSavedTripItems(db, {
      tripId: firstTrip.id,
      now: "2026-06-28T01:01:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: shakaCard,
          sources: [placesSource],
          savedAt: "2026-06-28T01:01:00.000Z",
          tripId: firstTrip.id,
        }),
      ],
    });
    await createSharedTripPlan(db, {
      id: "share_first_same_item",
      tripId: firstTrip.id,
      title: "First same item plan",
      itemIds: ["place_shaka"],
      publicToken: "first-same-item-token",
      now: "2026-06-28T01:02:00.000Z",
    });
    await upsertSavedTripItems(db, {
      tripId: secondTrip.id,
      now: "2026-06-28T01:03:00.000Z",
      items: [
        savedTripItemFromRecommendationCard({
          card: { ...shakaCard, subtitle: "Saved from the second anonymous trip" },
          sources: [placesSource],
          savedAt: "2026-06-28T01:03:00.000Z",
          tripId: secondTrip.id,
        }),
      ],
    });

    expect((await listSavedTripItems(db, { tripId: firstTrip.id })).map((item) => item.id)).toEqual(
      ["place_shaka"],
    );
    expect(
      (await listSavedTripItems(db, { tripId: secondTrip.id })).map((item) => item.id),
    ).toEqual(["place_shaka"]);

    const firstShare = await lookupSharedTripPlanByToken(db, {
      publicToken: "first-same-item-token",
      now: "2026-06-28T01:04:00.000Z",
    });
    expect(firstShare?.items.map((item) => item.title)).toEqual(["Shaka Siargao"]);
    expect(
      firstShare?.items[0]?.payload.type === "recommendation_card"
        ? firstShare.items[0].payload.card.subtitle
        : "",
    ).toBe("Smoothie bowls near Cloud 9");

    await db.close();
  });
});

async function openSharedTripStoreTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

async function seedTripWithItems(
  db: PGlite,
  tripId: string,
  clientTripKey: string,
  options: { card?: RecommendationCard } = {},
) {
  const trip = await upsertSavedTrip(db, {
    id: tripId,
    clientTripKey,
    title: "Seeded saved plan",
    now: "2026-06-28T01:00:00.000Z",
  });
  await upsertSavedTripItems(db, {
    tripId: trip.id,
    now: "2026-06-28T01:01:00.000Z",
    items: [
      savedTripItemFromRecommendationCard({
        card: options.card ?? shakaCard,
        sources: [placesSource],
        savedAt: "2026-06-28T01:01:00.000Z",
        tripId: trip.id,
      }),
      savedTripItemFromItineraryPlan({
        id: `${trip.id}_itinerary`,
        plan: rainyPlan,
        savedAt: "2026-06-28T01:01:00.000Z",
        tripId: trip.id,
      }),
    ],
  });
  return trip;
}

async function insertUser(db: PGlite, userId: string) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (id) do nothing
    `,
    [userId, `${userId}@example.com`],
  );
}

function countQueries(db: PGlite) {
  const queries: string[] = [];

  return {
    queries,
    async query<T>(query: string, params?: unknown[]) {
      queries.push(query);
      return db.query<T>(query, params);
    },
    countInsertInto(tableName: string) {
      return queries.filter((query) =>
        new RegExp(`insert\\s+into\\s+${tableName}`, "i").test(query),
      ).length;
    },
  };
}

const placesSource: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places API",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-28T00:45:00.000Z",
  confidence: "high",
  checked: ["place identity", "current opening status"],
  notChecked: ["review text", "table availability"],
};

const weatherSource: AnswerSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-28T00:30:00.000Z",
  confidence: "medium",
  checked: ["forecast for General Luna"],
  notChecked: ["surf reports", "road flooding"],
};

const browserSavedNotReverifiedSource: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Browser saved trip",
  confidence: "low",
  checked: [],
  notChecked: ["Saved from browser and not reverified by Ask Siargao before sharing."],
};

const shakaCard: RecommendationCard = {
  id: "place_shaka",
  kind: "place",
  title: "Shaka Siargao",
  subtitle: "Smoothie bowls near Cloud 9",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Shaka%20Siargao",
  distanceLabel: "8 min from Cloud 9",
  openStatusLabel: "Open now from Google Places",
  fitReasons: ["Near Cloud 9", "Good light breakfast stop"],
  caveats: ["Open-now can change quickly."],
  sourceLabel: "Google Places - live checked",
};

const rainyPlan = {
  title: "Rain-aware Cloud 9 afternoon",
  durationLabel: "3 hours",
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity" as const,
      sequence: 1,
      area: "Cloud 9",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Cloud%209%20Siargao",
      rationale: "Quick photo stop before heavier rain.",
      caveats: ["Skip exposed boardwalk time if lightning is nearby."],
    },
    {
      title: "Covered cafe backup",
      kind: "meal" as const,
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 12,
      rationale: "Keeps the plan useful during passing rain.",
      caveats: ["Live open status should be checked before leaving."],
    },
  ],
  fallbackStops: [],
  skip: ["Long exposed scooter loops in heavy rain."],
  sources: [weatherSource],
};
