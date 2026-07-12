import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";

import { sharedTripPageForToken } from "@/app/trips/shared/[token]/page";
import type { RecommendationCard } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { runInitialMigration } from "@/server/db/test-database";
import {
  createSharedTripPlan,
  deleteSharedTripPlanByToken,
  lookupSharedTripPlanByToken,
  upsertSavedTrip,
  upsertSavedTripItems,
} from "@/server/trips/shared-trip-store";
import { savedTripItemFromRecommendationCard } from "@/server/trips/shared-trip-types";

describe("shared trip page route", () => {
  test("renders a persisted public shared plan from its real share token", async () => {
    const db = await openSharedTripPageTestDatabase();
    const trip = await seedTripWithCard(db, "trip_shared_page", "browser-trip-shared-page");
    await createSharedTripPlan(db, {
      id: "share_shared_page",
      tripId: trip.id,
      title: "Cloud 9 food stop",
      itemIds: ["place_shaka"],
      publicToken: "page-token",
      now: "2026-06-28T02:00:00.000Z",
    });

    const html = await renderSharedTripPageHtml(db, "page-token", "2026-06-28T02:01:00.000Z");

    expect(html).toContain("Cloud 9 food stop");
    expect(html).toContain("Shaka Siargao");
    expect(html).toContain("Open now from Google Places");
    expect(html).toContain("Google Places · Places checked");
    expect(html).toContain(
      "Google Places: Checked details: place identity, current opening status",
    );
    expect(html).not.toContain("Google Places - live checked");
    expect(html).not.toContain("trip_shared_page");
    expect(html).not.toContain("browser-trip-shared-page");

    await db.close();
  });

  test("renders the generic unavailable page for expired or deleted share tokens", async () => {
    const db = await openSharedTripPageTestDatabase();
    const trip = await seedTripWithCard(
      db,
      "trip_shared_page_unavailable",
      "browser-trip-shared-page-unavailable",
    );
    await createSharedTripPlan(db, {
      id: "share_expired_page",
      tripId: trip.id,
      title: "Expired Cloud 9 food stop",
      itemIds: ["place_shaka"],
      publicToken: "expired-page-token",
      expiresAt: "2026-06-28T02:30:00.000Z",
      now: "2026-06-28T02:00:00.000Z",
    });
    await createSharedTripPlan(db, {
      id: "share_deleted_page",
      tripId: trip.id,
      title: "Deleted Cloud 9 food stop",
      itemIds: ["place_shaka"],
      publicToken: "deleted-page-token",
      now: "2026-06-28T02:00:00.000Z",
    });
    await deleteSharedTripPlanByToken(db, {
      publicToken: "deleted-page-token",
      now: "2026-06-28T02:10:00.000Z",
    });

    const expiredHtml = await renderSharedTripPageHtml(
      db,
      "expired-page-token",
      "2026-06-28T02:31:00.000Z",
    );
    const deletedHtml = await renderSharedTripPageHtml(
      db,
      "deleted-page-token",
      "2026-06-28T02:11:00.000Z",
    );

    expect(expiredHtml).toContain("Shared plan unavailable");
    expect(deletedHtml).toContain("Shared plan unavailable");
    expect(expiredHtml).not.toContain("Expired Cloud 9 food stop");
    expect(deletedHtml).not.toContain("Deleted Cloud 9 food stop");

    await db.close();
  });
});

async function openSharedTripPageTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

async function renderSharedTripPageHtml(db: PGlite, token: string, now: string) {
  const page = await sharedTripPageForToken(token, {
    lookupPlanByToken: (publicToken) => lookupSharedTripPlanByToken(db, { publicToken, now }),
  });
  return renderToStaticMarkup(page);
}

async function seedTripWithCard(db: PGlite, tripId: string, clientTripKey: string) {
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
        card: shakaCard,
        sources: [placesSource],
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
  sources: [placesSource],
};
