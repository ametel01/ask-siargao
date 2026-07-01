import type { SavedTripItem } from "@/server/trips/shared-trip-types";

export type { SavedTripItem };

export const savedTripStorageKey = "ask-siargao:saved-trip:v1";

export type ChatClientGeolocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: string;
  consentScope: "single_request" | "trip_session";
};

export type ChatClientContext = {
  geolocation: ChatClientGeolocation;
};

export type ArtifactDecisionMetadata = {
  label: "best_fit" | "good_now" | "fallback" | "avoid_today" | "needs_confirmation";
  bestAction: string;
};

export type ChatSourceArtifact = {
  label: string;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: readonly string[];
  notChecked: readonly string[];
};

export type RecommendationCardArtifact = {
  id: string;
  kind: "place" | "beach";
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: readonly string[];
  caveats: readonly string[];
  sourceLabel: string;
  decision?: ArtifactDecisionMetadata;
  sources?: readonly ChatSourceArtifact[];
};

export type ItineraryStopArtifact = {
  title: string;
  kind: "place" | "beach" | "activity" | "meal" | "transfer";
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: readonly string[];
};

export type ItineraryPlanArtifact = {
  title: string;
  durationLabel: string;
  decision?: ArtifactDecisionMetadata;
  stops: readonly ItineraryStopArtifact[];
  fallbackStops: readonly ItineraryStopArtifact[];
  skip: readonly string[];
  sources: readonly ChatSourceArtifact[];
};

export type SavedTripState = {
  tripId: string;
  items: SavedTripItem[];
  updatedAt: string;
};

export type SavedTripApiResponse = {
  tripId?: string;
  items?: SavedTripItem[];
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type StorageEventLike = {
  key: string | null;
};

export type StorageEventTargetLike = {
  addEventListener: (type: "storage", listener: EventListener) => void;
  removeEventListener: (type: "storage", listener: EventListener) => void;
};

export type SavedTripClientOptions = {
  storage?: StorageLike | null;
  eventTarget?: StorageEventTargetLike | null;
  now?: () => Date | string;
  createAnonymousTripId?: () => string;
};

const serverSavedTripSnapshot: SavedTripState = {
  tripId: "local_trip_pending",
  items: [],
  updatedAt: "1970-01-01T00:00:00.000Z",
};

let savedTripSnapshotCache: { rawValue: string | null; state: SavedTripState } | null = null;
const savedTripListeners = new Set<() => void>();

function createEmptySavedTripState(options: SavedTripClientOptions = {}): SavedTripState {
  const now = getNowIso(options);
  return {
    tripId: createAnonymousTripId(options),
    items: [],
    updatedAt: now,
  };
}

export function readSavedTripState(options: SavedTripClientOptions = {}): SavedTripState {
  const storage = resolveStorage(options);
  if (!storage) {
    return serverSavedTripSnapshot;
  }

  try {
    const storedValue = storage.getItem(savedTripStorageKey);
    if (!storedValue) {
      return createEmptySavedTripState(options);
    }

    const parsedValue = JSON.parse(storedValue) as Partial<SavedTripState>;
    const tripId = isUsableIdentifier(parsedValue.tripId)
      ? parsedValue.tripId
      : createAnonymousTripId(options);
    const items = Array.isArray(parsedValue.items)
      ? dedupeSavedItems(parsedValue.items.filter(isSavedTripItemLike))
      : [];

    return {
      tripId,
      items,
      updatedAt:
        typeof parsedValue.updatedAt === "string" ? parsedValue.updatedAt : getNowIso(options),
    };
  } catch {
    return createEmptySavedTripState(options);
  }
}

export function getSavedTripServerSnapshot() {
  return serverSavedTripSnapshot;
}

export function getSavedTripSnapshot(options: SavedTripClientOptions = {}) {
  const storage = resolveStorage(options);
  if (!storage) {
    return serverSavedTripSnapshot;
  }

  const rawValue = storage.getItem(savedTripStorageKey);
  if (savedTripSnapshotCache && savedTripSnapshotCache.rawValue === rawValue) {
    return savedTripSnapshotCache.state;
  }

  const state = readSavedTripState(options);
  savedTripSnapshotCache = { rawValue, state };
  return state;
}

export function subscribeSavedTripState(
  callback: () => void,
  options: SavedTripClientOptions = {},
) {
  savedTripListeners.add(callback);
  const eventTarget = resolveStorageEventTarget(options);
  const handleStorage: EventListener = (event) => {
    const storageEvent = event as unknown as StorageEventLike;
    if (storageEvent.key === savedTripStorageKey) {
      savedTripSnapshotCache = null;
      callback();
    }
  };

  eventTarget?.addEventListener("storage", handleStorage);
  return () => {
    savedTripListeners.delete(callback);
    eventTarget?.removeEventListener("storage", handleStorage);
  };
}

export function writeSavedTripState(state: SavedTripState, options: SavedTripClientOptions = {}) {
  const storage = resolveStorage(options);
  if (!storage) {
    return;
  }

  const rawValue = JSON.stringify(state);
  storage.setItem(savedTripStorageKey, rawValue);
  savedTripSnapshotCache = { rawValue, state };
  for (const listener of savedTripListeners) {
    listener();
  }
}

export function writeAuthenticatedSavedTripState(
  savedTrip: SavedTripApiResponse | null,
  fallbackTripId: string,
  options: SavedTripClientOptions = {},
) {
  if (!savedTrip?.items?.length) {
    return;
  }
  const tripId = savedTrip.tripId ?? fallbackTripId;

  writeSavedTripState(
    {
      tripId,
      items: savedTrip.items.map((item) => ({ ...item, tripId })),
      updatedAt: getNowIso(options),
    },
    options,
  );
}

export function upsertSavedTripItem(
  state: SavedTripState,
  nextItem: SavedTripItem,
  options: Pick<SavedTripClientOptions, "now"> = {},
): SavedTripState {
  let replacedExistingItem = false;
  const items: SavedTripItem[] = [];

  for (const item of state.items) {
    if (item.id !== nextItem.id) {
      items.push(item);
      continue;
    }

    if (!replacedExistingItem) {
      items.push({ ...nextItem, createdAt: item.createdAt });
      replacedExistingItem = true;
    }
  }

  if (!replacedExistingItem) {
    items.push(nextItem);
  }

  return {
    ...state,
    items,
    updatedAt: getNowIso(options),
  };
}

function dedupeSavedItems(items: readonly SavedTripItem[]) {
  const seenItemIds = new Set<string>();
  const results: SavedTripItem[] = [];

  for (const item of items) {
    if (seenItemIds.has(item.id)) {
      continue;
    }
    seenItemIds.add(item.id);
    results.push(item);
  }

  return results;
}

export async function fetchAuthenticatedSavedTrip(
  url: string,
  fetcher: FetchLike = fetch,
): Promise<SavedTripApiResponse | null> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as SavedTripApiResponse;
}

export async function syncSavedTripItemsMutation(
  url: string,
  {
    arg,
  }: {
    arg: {
      tripId: string;
      items: readonly SavedTripItem[];
    };
  },
  fetcher: FetchLike = fetch,
) {
  return saveSavedTripItems(url, arg, fetcher);
}

export async function postSavedTripItems(
  {
    items,
    tripId,
  }: {
    tripId: string;
    items: readonly SavedTripItem[];
  },
  fetcher: FetchLike = fetch,
) {
  await saveSavedTripItems("/api/trips/saved", { items, tripId }, fetcher);
}

export async function saveSavedTripItems(
  url: string,
  {
    items,
    tripId,
  }: {
    tripId: string;
    items: readonly SavedTripItem[];
  },
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, items }),
  });

  if (!response.ok) {
    throw new Error("Saved trip items could not be synced.");
  }

  return (await response.json()) as SavedTripApiResponse;
}

export async function deleteSavedTripItem(
  { itemId, tripId }: { tripId: string; itemId: string },
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(`/api/trips/saved/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId }),
  });

  if (!response.ok) {
    throw new Error("Saved item could not be deleted.");
  }
}

export async function postSharedTripPlan(
  {
    itemIds,
    title,
    tripId,
  }: {
    tripId: string;
    itemIds: readonly string[];
    title: string;
  },
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher("/api/trips/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId, itemIds, title }),
  });
  const body = (await response.json()) as { shareUrl?: unknown };

  if (!response.ok || typeof body.shareUrl !== "string") {
    throw new Error("Share link could not be created.");
  }

  return { shareUrl: body.shareUrl };
}

export function buildSharedPlanTitle(items: readonly SavedTripItem[]) {
  if (items.length === 1) {
    return `${items[0]?.title ?? "Siargao"} saved plan`;
  }

  return `Siargao saved plan - ${items.length} items`;
}

export function buildSavedItemFromCard(
  card: RecommendationCardArtifact,
  tripId: string,
  options: Pick<SavedTripClientOptions, "now"> = {},
): SavedTripItem {
  const now = getNowIso(options);
  const itemId = savedItemIdForCard(card);
  const title = normalizeSavedText(card.title, 180);
  const caveats = normalizeSavedTextArray(card.caveats, 16);
  const sources = normalizeSavedSources(card.sources ?? []);

  return {
    id: itemId,
    tripId,
    kind: card.kind,
    title,
    createdAt: now,
    updatedAt: now,
    payload: {
      type: "recommendation_card",
      card: {
        id: normalizeSavedIdentifier(card.id),
        kind: card.kind,
        title,
        ...(card.subtitle ? { subtitle: normalizeSavedText(card.subtitle, 180) } : {}),
        ...(card.mapsUrl ? { mapsUrl: card.mapsUrl } : {}),
        ...(card.distanceLabel
          ? { distanceLabel: normalizeSavedText(card.distanceLabel, 80) }
          : {}),
        ...(card.openStatusLabel
          ? { openStatusLabel: normalizeSavedText(card.openStatusLabel, 80) }
          : {}),
        fitReasons: normalizeSavedTextArray(card.fitReasons, 8),
        caveats,
        sourceLabel: normalizeSavedText(card.sourceLabel, 180),
        ...(card.decision ? { decision: normalizeSavedDecision(card.decision) } : {}),
      },
    },
    sources,
    ...(card.mapsUrl ? { mapsUrl: card.mapsUrl } : {}),
    caveats,
  };
}

export function buildSavedItemFromItinerary(
  plan: ItineraryPlanArtifact,
  tripId: string,
  options: Pick<SavedTripClientOptions, "now"> = {},
): SavedTripItem {
  const now = getNowIso(options);
  const itemId = savedItemIdForItinerary(plan);
  const title = normalizeSavedText(plan.title, 180);
  const sources = normalizeSavedSources(plan.sources);

  return {
    id: itemId,
    tripId,
    kind: "itinerary",
    title,
    createdAt: now,
    updatedAt: now,
    payload: {
      type: "itinerary_plan",
      plan: {
        title,
        durationLabel: normalizeSavedText(plan.durationLabel, 80),
        ...(plan.decision ? { decision: normalizeSavedDecision(plan.decision) } : {}),
        stops: plan.stops.map(normalizeSavedItineraryStop),
        fallbackStops: plan.fallbackStops.map(normalizeSavedItineraryStop),
        skip: normalizeSavedTextArray(plan.skip, 12),
        sources,
      },
    },
    sources,
    caveats: normalizeSavedTextArray(
      [
        ...plan.skip,
        ...plan.stops.flatMap((stop) => stop.caveats),
        ...plan.fallbackStops.flatMap((stop) => stop.caveats),
      ],
      16,
    ),
  };
}

export function resetSavedTripClientForTests() {
  savedTripSnapshotCache = null;
  savedTripListeners.clear();
}

export function savedItemIdForCard(card: RecommendationCardArtifact) {
  return normalizeSavedIdentifier(`${card.kind}:${card.id}`);
}

export function savedItemIdForItinerary(plan: ItineraryPlanArtifact) {
  return normalizeSavedIdentifier(`itinerary:${plan.title}:${plan.durationLabel}`);
}

function createAnonymousTripId(
  options: Pick<SavedTripClientOptions, "createAnonymousTripId"> = {},
) {
  if (options.createAnonymousTripId) {
    return normalizeSavedIdentifier(options.createAnonymousTripId());
  }

  const randomValue =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return normalizeSavedIdentifier(`local_trip_${randomValue}`);
}

function normalizeSavedItineraryStop(stop: ItineraryStopArtifact) {
  return {
    title: normalizeSavedText(stop.title, 180),
    kind: stop.kind,
    sequence: stop.sequence,
    ...(stop.area ? { area: normalizeSavedText(stop.area, 120) } : {}),
    ...(typeof stop.travelTimeFromPreviousMinutes === "number"
      ? { travelTimeFromPreviousMinutes: stop.travelTimeFromPreviousMinutes }
      : {}),
    ...(stop.mapsUrl ? { mapsUrl: stop.mapsUrl } : {}),
    rationale: normalizeSavedText(stop.rationale, 500),
    caveats: normalizeSavedTextArray(stop.caveats, 12),
  };
}

function normalizeSavedSources(sources: readonly ChatSourceArtifact[]): SavedTripItem["sources"] {
  return sources.map((source) => ({
    label: normalizeSavedSourceLabel(source.label),
    sourceName: normalizeSavedText(source.sourceName, 180),
    ...(source.sourceProfileId
      ? { sourceProfileId: normalizeSavedText(source.sourceProfileId, 180) }
      : {}),
    ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}),
    ...(source.confidence ? { confidence: source.confidence } : {}),
    checked: normalizeSavedTextArray(source.checked, 12, 180),
    notChecked: normalizeSavedTextArray(source.notChecked, 16, 180),
  }));
}

function normalizeSavedDecision(decision: ArtifactDecisionMetadata) {
  return {
    label: decision.label,
    bestAction: normalizeSavedText(decision.bestAction, 180),
  };
}

function normalizeSavedTextArray(values: readonly string[], maxItems: number, maxLength = 500) {
  const results: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeSavedText(value, maxLength);
    if (normalizedValue.length === 0) {
      continue;
    }

    results.push(normalizedValue);
    if (results.length >= maxItems) {
      break;
    }
  }

  return results;
}

function normalizeSavedText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeSavedIdentifier(value: string) {
  const normalizedValue = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
  return normalizedValue.length > 0 ? normalizedValue : "saved_item";
}

function isUsableIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/.test(value);
}

function normalizeSavedSourceLabel(value: string): SavedTripItem["sources"][number]["label"] {
  return isSavedSourceLabel(value) ? value : "not_verified";
}

function isSavedSourceLabel(value: string): value is SavedTripItem["sources"][number]["label"] {
  return (
    value === "live_checked" ||
    value === "fresh_cache" ||
    value === "event_checked" ||
    value === "venue_checked" ||
    value === "curated_local_guide" ||
    value === "weather_checked" ||
    value === "marine_checked" ||
    value === "tide_forecast_checked" ||
    value === "community_signal" ||
    value === "not_verified" ||
    value === "provider_unavailable"
  );
}

function isSavedTripItemLike(value: unknown): value is SavedTripItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<SavedTripItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    (item.kind === "place" ||
      item.kind === "beach" ||
      item.kind === "itinerary" ||
      item.kind === "note") &&
    typeof item.payload === "object" &&
    Array.isArray(item.sources) &&
    Array.isArray(item.caveats)
  );
}

function getNowIso(options: Pick<SavedTripClientOptions, "now"> = {}) {
  const now = options.now ? options.now() : new Date();
  return typeof now === "string" ? now : now.toISOString();
}

function resolveStorage(options: Pick<SavedTripClientOptions, "storage"> = {}) {
  if ("storage" in options) {
    return options.storage ?? null;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function resolveStorageEventTarget(options: Pick<SavedTripClientOptions, "eventTarget"> = {}) {
  if ("eventTarget" in options) {
    return options.eventTarget ?? null;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window;
}
