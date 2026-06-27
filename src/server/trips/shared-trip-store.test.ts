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
    expect(lookedUp?.items[0]?.sources).toEqual([placesSource]);
    expect(lookedUp?.items[0]?.sources[0]).toMatchObject({
      label: "live_checked",
      sourceName: "Google Places API",
      sourceProfileId: "source_google_places",
      fetchedAt: "2026-06-28T00:45:00.000Z",
      checked: ["place identity", "current opening status"],
      notChecked: ["review text", "table availability"],
    });
    expect(JSON.stringify(lookedUp)).not.toContain("rawProviderPayload");
    expect(JSON.stringify(lookedUp)).not.toContain("Best smoothie bowl");
    expect(JSON.stringify(lookedUp)).not.toContain("9.8116");

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
