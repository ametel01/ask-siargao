import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  createSharedTripResponse,
  deleteSavedTripItemResponse,
  savedTripsResponse,
  sharedTripTokenResponse,
  type TripRouteDependencies,
} from "@/app/api/trips/trip-routes";
import type { RecommendationCard } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { runInitialMigration } from "@/server/db/test-database";
import { deleteSharedTripPlanByToken } from "@/server/trips/shared-trip-store";
import { savedTripItemFromRecommendationCard } from "@/server/trips/shared-trip-types";

describe("saved trip API routes", () => {
  test("rejects malformed saved item payloads", async () => {
    const dependencies = await tripRouteDependencies();
    const response = await savedTripsResponse(
      jsonRequest("/api/trips/saved", { tripId: "x" }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_saved_trip_request");
    await dependencies.close();
  });

  test("rejects chat transcripts and geolocation in save and share request bodies", async () => {
    const dependencies = await tripRouteDependencies();
    const tripId = "local_trip_private_123456";
    const item = savedTripItemFromRecommendationCard({
      card: shakaCard,
      sources: [placesSource],
      savedAt: nowIso,
      tripId,
    });

    const saveResponse = await savedTripsResponse(
      jsonRequest("/api/trips/saved", {
        tripId,
        items: [item],
        messages: [{ role: "user", content: "Where should I eat near me?" }],
        clientContext: {
          geolocation: {
            latitude: 9.8116,
            longitude: 126.1651,
            capturedAt: nowIso,
            consentScope: "single_request",
          },
        },
      }),
      dependencies,
    );
    const shareResponse = await createSharedTripResponse(
      jsonRequest("/api/trips/share", {
        tripId,
        title: "Private fields should fail",
        itemIds: ["place_shaka"],
        messages: [{ role: "assistant", content: "Try this exact place." }],
        clientContext: {
          geolocation: {
            latitude: 9.8116,
            longitude: 126.1651,
            capturedAt: nowIso,
            consentScope: "single_request",
          },
        },
      }),
      dependencies,
    );

    expect(saveResponse.status).toBe(400);
    expect((await saveResponse.json()).error).toBe("invalid_saved_trip_request");
    expect(shareResponse.status).toBe(400);
    expect((await shareResponse.json()).error).toBe("invalid_shared_trip_request");
    await dependencies.close();
  });

  test("saves, lists, and deletes selected local saved items", async () => {
    const dependencies = await tripRouteDependencies();
    const tripId = "local_trip_route_123456";
    const item = savedTripItemFromRecommendationCard({
      card: shakaCard,
      sources: [placesSource],
      savedAt: nowIso,
      tripId,
    });

    const saveResponse = await savedTripsResponse(
      jsonRequest("/api/trips/saved", {
        tripId,
        items: [item],
      }),
      dependencies,
    );
    const saveBody = await saveResponse.json();
    expect(saveResponse.status).toBe(200);
    expect(saveBody.items).toHaveLength(1);
    expect(JSON.stringify(saveBody)).not.toContain("messages");

    const listResponse = await savedTripsResponse(
      new Request(`https://siargao.test/api/trips/saved?tripId=${tripId}`, { method: "GET" }),
      dependencies,
    );
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items.map((savedItem: { id: string }) => savedItem.id)).toEqual([
      "place_shaka",
    ]);

    const deleteResponse = await deleteSavedTripItemResponse(
      jsonRequest("/api/trips/saved/place_shaka", { tripId }, "DELETE"),
      { itemId: "place_shaka", dependencies },
    );
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.removed).toBe(true);

    const afterDeleteResponse = await savedTripsResponse(
      new Request(`https://siargao.test/api/trips/saved?tripId=${tripId}`, { method: "GET" }),
      dependencies,
    );
    const afterDeleteBody = await afterDeleteResponse.json();
    expect(afterDeleteBody.items).toEqual([]);

    await dependencies.close();
  });

  test("creates and looks up share URLs without exposing unrelated chat state", async () => {
    const dependencies = await tripRouteDependencies();
    const tripId = "local_trip_share_123456";
    await saveRouteItem(dependencies, tripId, shakaCard);

    const shareResponse = await createSharedTripResponse(
      jsonRequest("/api/trips/share", {
        tripId,
        title: "Cloud 9 food stop",
        itemIds: ["place_shaka"],
      }),
      dependencies,
    );
    const shareBody = await shareResponse.json();

    expect(shareResponse.status).toBe(200);
    expect(shareBody.shareUrl).toBe("https://siargao.test/trips/shared/public-token-1");
    expect(shareBody.plan.items.map((item: { title: string }) => item.title)).toEqual([
      "Shaka Siargao",
    ]);
    expect(shareBody.plan.items[0].sources).toEqual([placesSource]);
    expect(shareBody.plan.items[0].sources[0]).toMatchObject({
      sourceName: "Google Places API",
      sourceProfileId: "source_google_places",
      fetchedAt: "2026-06-28T00:45:00.000Z",
      checked: ["place identity", "current opening status"],
      notChecked: ["review text", "table availability"],
    });
    expect(JSON.stringify(shareBody)).not.toContain("Where should I eat?");
    expect(JSON.stringify(shareBody)).not.toContain("rawProviderPayload");
    expect(JSON.stringify(shareBody)).not.toContain("9.8116");
    expect(JSON.stringify(shareBody)).not.toContain("126.1651");

    const lookupResponse = await sharedTripTokenResponse(
      new Request("https://siargao.test/api/trips/share/public-token-1"),
      { token: "public-token-1", dependencies },
    );
    const lookupBody = await lookupResponse.json();

    expect(lookupResponse.status).toBe(200);
    expect(lookupBody.plan.title).toBe("Cloud 9 food stop");
    expect(lookupBody.plan.items).toHaveLength(1);

    await dependencies.close();
  });

  test("rejects cross-trip share item selection", async () => {
    const dependencies = await tripRouteDependencies();
    await saveRouteItem(dependencies, "local_trip_first_123456", shakaCard);
    await saveRouteItem(dependencies, "local_trip_second_123456", {
      ...shakaCard,
      id: "place_kermit",
      title: "Kermit Siargao",
    });

    const response = await createSharedTripResponse(
      jsonRequest("/api/trips/share", {
        tripId: "local_trip_first_123456",
        title: "Invalid mixed plan",
        itemIds: ["place_shaka", "place_kermit"],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("shared_trip_not_available");
    await dependencies.close();
  });

  test("does not return expired or deleted share tokens", async () => {
    const dependencies = await tripRouteDependencies();
    const tripId = "local_trip_expiring_123456";
    await saveRouteItem(dependencies, tripId, shakaCard);

    const expiringShare = await createSharedTripResponse(
      jsonRequest("/api/trips/share", {
        tripId,
        title: "Expiring plan",
        itemIds: ["place_shaka"],
        expiresAt: "2026-06-28T01:30:00.000Z",
      }),
      dependencies,
    );
    expect(expiringShare.status).toBe(200);

    dependencies.setNow("2026-06-28T01:31:00.000Z");
    const expiredLookup = await sharedTripTokenResponse(
      new Request("https://siargao.test/api/trips/share/public-token-1"),
      { token: "public-token-1", dependencies },
    );
    expect(expiredLookup.status).toBe(404);

    dependencies.setNow("2026-06-28T01:10:00.000Z");
    await createSharedTripResponse(
      jsonRequest("/api/trips/share", {
        tripId,
        title: "Deleted plan",
        itemIds: ["place_shaka"],
      }),
      dependencies,
    );
    await deleteSharedTripPlanByToken(dependencies.db, {
      publicToken: "public-token-2",
      now: "2026-06-28T01:20:00.000Z",
    });
    const deletedLookup = await sharedTripTokenResponse(
      new Request("https://siargao.test/api/trips/share/public-token-2"),
      { token: "public-token-2", dependencies },
    );
    expect(deletedLookup.status).toBe(404);

    await dependencies.close();
  });
});

async function saveRouteItem(
  dependencies: TestTripRouteDependencies,
  tripId: string,
  card: RecommendationCard,
) {
  const item = savedTripItemFromRecommendationCard({
    card,
    sources: [placesSource],
    savedAt: nowIso,
    tripId,
  });
  const response = await savedTripsResponse(
    jsonRequest("/api/trips/saved", {
      tripId,
      items: [item],
    }),
    dependencies,
  );
  expect(response.status).toBe(200);
}

type TestTripRouteDependencies = TripRouteDependencies & {
  close: () => Promise<void>;
  setNow: (value: string) => void;
};

async function tripRouteDependencies(): Promise<TestTripRouteDependencies> {
  const db = new PGlite();
  await runInitialMigration(db);
  let now = nowIso;
  let tokenCount = 0;

  return {
    db,
    now: () => new Date(now),
    createId: (prefix) => `${prefix}_${tokenCount + 1}`,
    createPublicToken: () => {
      tokenCount += 1;
      return `public-token-${tokenCount}`;
    },
    close: () => db.close(),
    setNow: (value: string) => {
      now = value;
    },
  };
}

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`https://siargao.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const nowIso = "2026-06-28T01:00:00.000Z";

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
};
