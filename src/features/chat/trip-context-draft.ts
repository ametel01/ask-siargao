import {
  type ForecastLocationLabel,
  forecastLocationLabels,
  tripContextStorageKey,
} from "@/server/chat/trip-context";

export { type ForecastLocationLabel, forecastLocationLabels, tripContextStorageKey };

export type TripContextDraft = {
  accommodation: string;
  dateRange: string;
  travelerType: string;
  nearbyArea: ForecastLocationLabel;
};

export const defaultTripContextDraft: TripContextDraft = {
  accommodation: "",
  dateRange: "",
  travelerType: "",
  nearbyArea: "Siargao Island",
};

export type TripContextDraftStorage = Pick<Storage, "getItem" | "setItem">;
export type TripContextDraftStorageEventTarget = {
  addEventListener: (type: "storage", listener: EventListener) => void;
  removeEventListener: (type: "storage", listener: EventListener) => void;
};

const tripContextListeners = new Set<() => void>();
let tripContextSnapshotCache: { rawValue: string | null; state: TripContextDraft } | null = null;

export function getTripContextServerSnapshot() {
  return defaultTripContextDraft;
}

export function getTripContextSnapshot() {
  const storage = browserTripContextStorage();
  if (!storage) {
    return defaultTripContextDraft;
  }

  const rawValue = storage.getItem(tripContextStorageKey);
  if (tripContextSnapshotCache?.rawValue === rawValue) {
    return tripContextSnapshotCache.state;
  }

  const state = readStoredTripContext({ storage });
  tripContextSnapshotCache = { rawValue, state };
  return state;
}

export function subscribeTripContextState(callback: () => void) {
  tripContextListeners.add(callback);
  const eventTarget = browserTripContextEventTarget();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === tripContextStorageKey) {
      tripContextSnapshotCache = null;
      callback();
    }
  };

  eventTarget?.addEventListener("storage", handleStorage as EventListener);
  return () => {
    tripContextListeners.delete(callback);
    eventTarget?.removeEventListener("storage", handleStorage as EventListener);
  };
}

export function readStoredTripContext({
  storage = browserTripContextStorage(),
}: {
  storage?: TripContextDraftStorage | null;
} = {}): TripContextDraft {
  if (!storage) {
    return defaultTripContextDraft;
  }

  try {
    const rawValue = storage.getItem(tripContextStorageKey);
    const draft = readTripContextDraftFromRawValue(rawValue);
    return draft ?? defaultTripContextDraft;
  } catch {
    return defaultTripContextDraft;
  }
}

export function readStoredTripContextForRequest({
  storage = browserTripContextStorage(),
}: {
  storage?: TripContextDraftStorage | null;
} = {}): TripContextDraft | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    return readTripContextDraftFromRawValue(storage.getItem(tripContextStorageKey));
  } catch {
    return undefined;
  }
}

export function writeStoredTripContext(
  context: TripContextDraft,
  {
    storage = browserTripContextStorage(),
  }: {
    storage?: TripContextDraftStorage | null;
  } = {},
) {
  if (!storage) {
    return;
  }

  const state = normalizeTripContextDraft(context);
  const rawValue = JSON.stringify(state);
  storage.setItem(tripContextStorageKey, rawValue);
  tripContextSnapshotCache = { rawValue, state };
  for (const listener of tripContextListeners) {
    listener();
  }
}

function readTripContextDraftFromRawValue(rawValue: string | null) {
  if (!rawValue) {
    return undefined;
  }
  const parsed = JSON.parse(rawValue) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? normalizeTripContextDraft(parsed)
    : undefined;
}

export function normalizeTripContextDraft(
  context: Partial<TripContextDraft> | null | undefined = undefined,
) {
  return {
    accommodation: normalizedTripContextText(context?.accommodation),
    dateRange: normalizedTripContextText(context?.dateRange),
    travelerType: normalizedTripContextText(context?.travelerType),
    nearbyArea: isForecastLocationLabel(context?.nearbyArea)
      ? context.nearbyArea
      : defaultTripContextDraft.nearbyArea,
  } satisfies TripContextDraft;
}

function normalizedTripContextText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function isForecastLocationLabel(value: unknown): value is ForecastLocationLabel {
  return (
    typeof value === "string" &&
    forecastLocationLabels.includes(value as (typeof forecastLocationLabels)[number])
  );
}

function browserTripContextStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function browserTripContextEventTarget() {
  return typeof window === "undefined" ? null : window;
}
