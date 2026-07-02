import { afterEach, describe, expect, test } from "bun:test";
import type {
  FetchLike,
  ItineraryPlanArtifact,
  RecommendationCardArtifact,
  SavedTripItem,
  SavedTripState,
} from "@/features/chat/saved-trip-client";
import {
  buildSavedItemFromCard,
  buildSavedItemFromItinerary,
  buildSharedPlanTitle,
  deleteSavedTripItem,
  fetchAuthenticatedSavedTrip,
  getSavedTripSnapshot,
  postSavedTripItems,
  postSharedTripPlan,
  readSavedTripState,
  resetSavedTripClientForTests,
  savedItemIdForCard,
  savedItemIdForItinerary,
  savedTripStorageKey,
  saveSavedTripItems,
  subscribeSavedTripState,
  syncSavedTripItemsMutation,
  upsertSavedTripItem,
  writeAuthenticatedSavedTripState,
  writeSavedTripState,
} from "@/features/chat/saved-trip-client";
import {
  savedTripItemFromItineraryPlan,
  savedTripItemFromRecommendationCard,
} from "@/server/trips/shared-trip-types";

const fixedNow = "2026-06-30T08:00:00.000Z";
const fallbackTripId = "local_trip_test123";

describe("saved trip client storage", () => {
  afterEach(() => {
    resetSavedTripClientForTests();
  });

  test("falls back to an empty local trip for missing or malformed storage", () => {
    const storage = new MemoryStorage();

    expect(
      readSavedTripState({
        storage,
        now: () => fixedNow,
        createAnonymousTripId: () => fallbackTripId,
      }),
    ).toEqual({
      tripId: fallbackTripId,
      items: [],
      updatedAt: fixedNow,
    });

    storage.setItem(savedTripStorageKey, "{bad json");

    expect(
      readSavedTripState({
        storage,
        now: () => fixedNow,
        createAnonymousTripId: () => fallbackTripId,
      }),
    ).toEqual({
      tripId: fallbackTripId,
      items: [],
      updatedAt: fixedNow,
    });
  });

  test("round-trips valid storage and dedupes saved item ids", () => {
    const storage = new MemoryStorage();
    const savedItem = sampleSavedCard();
    const state: SavedTripState = {
      tripId: "local_trip_roundtrip",
      items: [savedItem],
      updatedAt: fixedNow,
    };

    writeSavedTripState(state, { storage });

    expect(JSON.parse(storage.getItem(savedTripStorageKey) ?? "{}")).toEqual(state);
    expect(getSavedTripSnapshot({ storage })).toEqual(state);

    storage.setItem(
      savedTripStorageKey,
      JSON.stringify({
        tripId: "local_trip_roundtrip",
        updatedAt: fixedNow,
        items: [savedItem, { ...savedItem, title: "Duplicate should be dropped" }],
      }),
    );
    resetSavedTripClientForTests();

    expect(readSavedTripState({ storage }).items).toEqual([savedItem]);
  });

  test("notifies local subscribers and invalidates snapshots for storage events", () => {
    const storage = new MemoryStorage();
    const eventTarget = new FakeStorageEventTarget();
    let notificationCount = 0;
    const unsubscribe = subscribeSavedTripState(
      () => {
        notificationCount += 1;
      },
      { eventTarget, storage },
    );

    writeSavedTripState(
      {
        tripId: "local_trip_notify",
        items: [],
        updatedAt: fixedNow,
      },
      { storage },
    );

    eventTarget.dispatch({ key: "other-key" });
    eventTarget.dispatch({ key: savedTripStorageKey });

    expect(notificationCount).toBe(2);

    unsubscribe();
    writeSavedTripState(
      {
        tripId: "local_trip_notify",
        items: [],
        updatedAt: "2026-06-30T09:00:00.000Z",
      },
      { storage },
    );
    eventTarget.dispatch({ key: savedTripStorageKey });

    expect(notificationCount).toBe(2);
  });

  test("hydrates authenticated saved trips with server ids and fallback trip ids", () => {
    const storage = new MemoryStorage();
    const savedItem = sampleSavedCard({ tripId: "local_trip_before_auth" });

    writeAuthenticatedSavedTripState(
      {
        tripId: "saved_trip_authenticated",
        items: [savedItem],
      },
      "local_trip_fallback",
      { storage, now: () => fixedNow },
    );

    expect(readSavedTripState({ storage })).toMatchObject({
      tripId: "saved_trip_authenticated",
      updatedAt: fixedNow,
      items: [{ ...savedItem, tripId: "saved_trip_authenticated" }],
    });
  });
});

describe("saved trip item builders", () => {
  test("builds recommendation-card saved items with normalized ids, sources, and caveats", () => {
    const item = buildSavedItemFromCard(sampleRecommendationCard(), "local_trip_builder", {
      now: () => fixedNow,
    });

    expect(item).toMatchObject({
      id: "place:place_shaka",
      tripId: "local_trip_builder",
      kind: "place",
      title: "Shaka Siargao",
      createdAt: fixedNow,
      updatedAt: fixedNow,
      mapsUrl: "https://maps.google.com/?q=Shaka%20Siargao",
      caveats: ["Confirm the kitchen is still open", "Bring cash"],
      sources: [
        {
          label: "live_checked",
          sourceName: "Google Places",
          sourceProfileId: "google_places",
          fetchedAt: "2026-06-30T07:30:00.000Z",
          confidence: "high",
          checked: ["current opening status"],
          notChecked: ["review text", "table availability"],
        },
        {
          label: "not_verified",
          sourceName: "Forum tip",
          checked: [],
          notChecked: ["latest menu"],
        },
      ],
    });
    expect(item.payload).toEqual({
      type: "recommendation_card",
      card: {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Smoothies in General Luna",
        mapsUrl: "https://maps.google.com/?q=Shaka%20Siargao",
        distanceLabel: "8 min by scooter",
        openStatusLabel: "Open now",
        fitReasons: ["Good rainy-day stop"],
        caveats: ["Confirm the kitchen is still open", "Bring cash"],
        sourceLabel: "Google Places - live checked",
        decision: {
          label: "best_fit",
          bestAction: "Go before the lunch rush",
        },
      },
    });
  });

  test("builds itinerary saved items with route, source, decision, and caveat fields", () => {
    const item = buildSavedItemFromItinerary(sampleItineraryPlan(), "local_trip_itinerary", {
      now: () => fixedNow,
    });

    expect(item.id).toBe("itinerary:Rainy-Cloud-9-Afternoon:Half-day");
    expect(item.kind).toBe("itinerary");
    expect(item.title).toBe("Rainy Cloud 9 Afternoon");
    expect(item.createdAt).toBe(fixedNow);
    expect(item.sources).toEqual([
      {
        label: "weather_checked",
        sourceName: "Open-Meteo",
        checked: ["rain forecast"],
        notChecked: ["venue crowding"],
      },
    ]);
    expect(item.caveats).toEqual([
      "Skip boardwalk if lightning starts",
      "Puddles after heavy rain",
      "Confirm cafe hours",
    ]);
    expect(item.payload).toMatchObject({
      type: "itinerary_plan",
      plan: {
        title: "Rainy Cloud 9 Afternoon",
        durationLabel: "Half day",
        decision: {
          label: "good_now",
          bestAction: "Start with the indoor cafe",
        },
        skip: ["Skip boardwalk if lightning starts"],
        stops: [
          {
            title: "Cloud 9 Cafe",
            kind: "meal",
            sequence: 1,
            area: "Cloud 9",
            travelTimeFromPreviousMinutes: 12,
            mapsUrl: "https://maps.google.com/?q=Cloud%209%20Cafe",
            rationale: "Dry place to wait out showers",
            caveats: ["Puddles after heavy rain"],
          },
        ],
        fallbackStops: [
          {
            title: "General Luna coffee stop",
            kind: "meal",
            sequence: 2,
            rationale: "Backup if the first stop is full",
            caveats: ["Confirm cafe hours"],
          },
        ],
      },
    });
  });

  test("matches server recommendation-card construction for the same item-id policy", () => {
    const card = sampleRecommendationCard();
    const browserItem = buildSavedItemFromCard(card, "local_trip_equivalence", {
      now: () => fixedNow,
    });
    const serverItem = savedTripItemFromRecommendationCard({
      card,
      id: savedItemIdForCard(card),
      savedAt: fixedNow,
      sources: card.sources ?? [],
      tripId: "local_trip_equivalence",
    });

    expect(serverItem).toEqual(browserItem);
  });

  test("matches server itinerary construction for the same item-id policy", () => {
    const plan = sampleItineraryPlan();
    const browserItem = buildSavedItemFromItinerary(plan, "local_trip_equivalence", {
      now: () => fixedNow,
    });
    const serverItem = savedTripItemFromItineraryPlan({
      id: savedItemIdForItinerary(plan),
      plan,
      savedAt: fixedNow,
      tripId: "local_trip_equivalence",
    });

    expect(serverItem).toEqual(browserItem);
  });

  test("omits invalid map URLs from constructed saved artifacts", () => {
    const cardItem = buildSavedItemFromCard(
      {
        ...sampleRecommendationCard(),
        mapsUrl: "https://maps.google.evil/maps?q=Shaka",
      },
      "local_trip_maps",
      { now: () => fixedNow },
    );
    const itineraryItem = buildSavedItemFromItinerary(
      {
        ...sampleItineraryPlan(),
        stops: [
          {
            ...sampleItineraryPlan().stops[0],
            mapsUrl: "https://maps.example/cloud9-cafe",
          },
        ],
      },
      "local_trip_maps",
      { now: () => fixedNow },
    );

    expect(cardItem.mapsUrl).toBeUndefined();
    expect(
      cardItem.payload.type === "recommendation_card"
        ? cardItem.payload.card.mapsUrl
        : "wrong payload",
    ).toBeUndefined();
    expect(
      itineraryItem.payload.type === "itinerary_plan"
        ? itineraryItem.payload.plan.stops[0]?.mapsUrl
        : "wrong payload",
    ).toBeUndefined();
  });

  test("upserts saved items without changing the original created timestamp", () => {
    const original = sampleSavedCard({
      createdAt: "2026-06-29T01:00:00.000Z",
      updatedAt: "2026-06-29T01:00:00.000Z",
    });
    const replacement = { ...original, title: "Updated Shaka", updatedAt: fixedNow };
    const state = upsertSavedTripItem(
      {
        tripId: "local_trip_upsert",
        items: [original],
        updatedAt: "2026-06-29T02:00:00.000Z",
      },
      replacement,
      { now: () => fixedNow },
    );

    expect(state.items).toEqual([
      {
        ...replacement,
        createdAt: "2026-06-29T01:00:00.000Z",
      },
    ]);
    expect(state.updatedAt).toBe(fixedNow);
  });

  test("builds existing share titles", () => {
    expect(buildSharedPlanTitle([sampleSavedCard()])).toBe("Shaka Siargao saved plan");
    expect(buildSharedPlanTitle([sampleSavedCard(), sampleSavedItinerary()])).toBe(
      "Siargao saved plan - 2 items",
    );
  });
});

describe("saved trip API helpers", () => {
  test("uses the expected method, path, body, and cache behavior", async () => {
    const savedItem = sampleSavedCard();
    const fetcher = createRecordingFetch([
      { tripId: "local_trip_api", items: [savedItem] },
      { tripId: "local_trip_api", items: [savedItem] },
      { tripId: "local_trip_api", items: [savedItem] },
      {},
      { shareUrl: "https://siargao.test/trips/shared/public-token" },
    ]);

    await expect(fetchAuthenticatedSavedTrip("/api/trips/saved", fetcher.fetch)).resolves.toEqual({
      tripId: "local_trip_api",
      items: [savedItem],
    });
    await expect(
      syncSavedTripItemsMutation(
        "/api/trips/saved",
        { arg: { tripId: "local_trip_api", items: [savedItem] } },
        fetcher.fetch,
      ),
    ).resolves.toEqual({ tripId: "local_trip_api", items: [savedItem] });
    await postSavedTripItems({ tripId: "local_trip_api", items: [savedItem] }, fetcher.fetch);
    await deleteSavedTripItem(
      { tripId: "local_trip_api", itemId: "place:place_shaka" },
      fetcher.fetch,
    );
    await expect(
      postSharedTripPlan(
        {
          tripId: "local_trip_api",
          itemIds: ["place:place_shaka"],
          title: "Shaka Siargao saved plan",
        },
        fetcher.fetch,
      ),
    ).resolves.toEqual({ shareUrl: "https://siargao.test/trips/shared/public-token" });

    expect(fetcher.requests).toEqual([
      {
        input: "/api/trips/saved",
        init: { cache: "no-store" },
      },
      {
        input: "/api/trips/saved",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tripId: "local_trip_api", items: [savedItem] }),
        },
      },
      {
        input: "/api/trips/saved",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tripId: "local_trip_api", items: [savedItem] }),
        },
      },
      {
        input: "/api/trips/saved/place%3Aplace_shaka",
        init: {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tripId: "local_trip_api" }),
        },
      },
      {
        input: "/api/trips/share",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tripId: "local_trip_api",
            itemIds: ["place:place_shaka"],
            title: "Shaka Siargao saved plan",
          }),
        },
      },
    ]);
  });

  test("handles non-OK responses without exposing stale saved-trip state", async () => {
    await expect(
      fetchAuthenticatedSavedTrip(
        "/api/trips/saved",
        createRecordingFetch([{ error: "server_error" }], [500]).fetch,
      ),
    ).resolves.toBeNull();

    await expect(
      saveSavedTripItems(
        "/api/trips/saved",
        { tripId: "local_trip_api", items: [sampleSavedCard()] },
        createRecordingFetch([{ error: "invalid_saved_trip_request" }], [400]).fetch,
      ),
    ).rejects.toThrow("Saved trip items could not be synced.");

    await expect(
      deleteSavedTripItem(
        { tripId: "local_trip_api", itemId: "place_shaka" },
        createRecordingFetch([{ error: "saved_trip_not_found" }], [404]).fetch,
      ),
    ).rejects.toThrow("Saved item could not be deleted.");

    await expect(
      postSharedTripPlan(
        {
          tripId: "local_trip_api",
          itemIds: ["place_shaka"],
          title: "Shaka Siargao saved plan",
        },
        createRecordingFetch([{ error: "shared_trip_not_available" }], [404]).fetch,
      ),
    ).rejects.toThrow("Share link could not be created.");
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeStorageEventTarget {
  private listeners = new Set<EventListener>();

  addEventListener(type: "storage", listener: EventListener) {
    if (type === "storage") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "storage", listener: EventListener) {
    if (type === "storage") {
      this.listeners.delete(listener);
    }
  }

  dispatch(event: { key: string | null }) {
    for (const listener of this.listeners) {
      listener(event as StorageEvent);
    }
  }
}

type RecordedFetchRequest = {
  input: string;
  init: RequestInit | undefined;
};

function createRecordingFetch(bodies: readonly unknown[], statuses: readonly number[] = []) {
  const requests: RecordedFetchRequest[] = [];
  let requestIndex = 0;
  const fetch: FetchLike = async (input, init) => {
    requests.push({ input: input.toString(), init });
    const body = bodies[requestIndex] ?? {};
    const status = statuses[requestIndex] ?? 200;
    requestIndex += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetch, requests };
}

function sampleRecommendationCard(): RecommendationCardArtifact {
  return {
    id: "place_shaka",
    kind: "place",
    title: "  Shaka   Siargao  ",
    subtitle: "Smoothies in General Luna",
    mapsUrl: "https://maps.google.com/?q=Shaka%20Siargao",
    distanceLabel: "8 min by scooter",
    openStatusLabel: "Open now",
    fitReasons: ["Good rainy-day stop", ""],
    caveats: [" Confirm the kitchen is still open ", "Bring cash"],
    sourceLabel: "Google Places - live checked",
    decision: {
      label: "best_fit",
      bestAction: "Go before the lunch rush",
    },
    sources: [
      {
        label: "live_checked",
        sourceName: "Google Places",
        sourceProfileId: "google_places",
        fetchedAt: "2026-06-30T07:30:00.000Z",
        confidence: "high",
        checked: ["current opening status"],
        notChecked: ["review text", "table availability"],
      },
      {
        label: "unknown_source_label",
        sourceName: "Forum tip",
        checked: [],
        notChecked: ["latest menu"],
      },
    ],
  };
}

function sampleItineraryPlan(): ItineraryPlanArtifact {
  return {
    title: "Rainy Cloud 9 Afternoon",
    durationLabel: "Half day",
    decision: {
      label: "good_now",
      bestAction: "Start with the indoor cafe",
    },
    stops: [
      {
        title: "Cloud 9 Cafe",
        kind: "meal",
        sequence: 1,
        area: "Cloud 9",
        travelTimeFromPreviousMinutes: 12,
        mapsUrl: "https://maps.google.com/?q=Cloud%209%20Cafe",
        rationale: "Dry place to wait out showers",
        caveats: ["Puddles after heavy rain"],
      },
    ],
    fallbackStops: [
      {
        title: "General Luna coffee stop",
        kind: "meal",
        sequence: 2,
        rationale: "Backup if the first stop is full",
        caveats: ["Confirm cafe hours"],
      },
    ],
    skip: ["Skip boardwalk if lightning starts"],
    sources: [
      {
        label: "weather_checked",
        sourceName: "Open-Meteo",
        checked: ["rain forecast"],
        notChecked: ["venue crowding"],
      },
    ],
  };
}

function sampleSavedCard(overrides: Partial<SavedTripItem> = {}): SavedTripItem {
  return {
    ...buildSavedItemFromCard(sampleRecommendationCard(), "local_trip_sample", {
      now: () => fixedNow,
    }),
    ...overrides,
  };
}

function sampleSavedItinerary(overrides: Partial<SavedTripItem> = {}): SavedTripItem {
  return {
    ...buildSavedItemFromItinerary(sampleItineraryPlan(), "local_trip_sample", {
      now: () => fixedNow,
    }),
    ...overrides,
  };
}
