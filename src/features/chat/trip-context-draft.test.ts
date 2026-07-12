import { describe, expect, test } from "bun:test";

import {
  clearStoredTripLocationContext,
  readStoredTripContext,
  readStoredTripContextForRequest,
  tripContextStorageKey,
  writeStoredTripContext,
} from "@/features/chat/trip-context-draft";

describe("trip context draft adapter", () => {
  test("preserves legacy localStorage draft compatibility", () => {
    const storage = memoryStorage({
      [tripContextStorageKey]: JSON.stringify({
        accommodation: "  Near Cloud 9 / Catangnan  ",
        dateRange: " Aug 1 - 6 ",
        travelerType: " Family with kids ",
        nearbyArea: "Cloud 9",
        ignoredNested: { arbitrary: true },
      }),
    });

    expect(readStoredTripContext({ storage })).toEqual({
      accommodation: "Near Cloud 9 / Catangnan",
      dateRange: "Aug 1 - 6",
      travelerType: "Family with kids",
      nearbyArea: "Cloud 9",
    });
    expect(readStoredTripContextForRequest({ storage })).toEqual({
      accommodation: "Near Cloud 9 / Catangnan",
      dateRange: "Aug 1 - 6",
      travelerType: "Family with kids",
      nearbyArea: "Cloud 9",
    });
  });

  test("keeps missing, malformed, and cleared storage free of demo trip details", () => {
    const storage = memoryStorage();

    expect(readStoredTripContext({ storage })).toEqual({
      accommodation: "",
      dateRange: "",
      travelerType: "",
      nearbyArea: "Siargao Island",
    });
    expect(readStoredTripContextForRequest({ storage })).toBeUndefined();

    storage.setItem(tripContextStorageKey, "{not-json");
    expect(readStoredTripContext({ storage })).toEqual({
      accommodation: "",
      dateRange: "",
      travelerType: "",
      nearbyArea: "Siargao Island",
    });
    expect(readStoredTripContextForRequest({ storage })).toBeUndefined();

    storage.setItem(
      tripContextStorageKey,
      JSON.stringify({
        accommodation: " ",
        dateRange: "",
        travelerType: " ",
        nearbyArea: "unknown",
      }),
    );
    expect(readStoredTripContextForRequest({ storage })).toEqual({
      accommodation: "",
      dateRange: "",
      travelerType: "",
      nearbyArea: "Siargao Island",
    });
  });

  test("writes normalized bounded draft values", () => {
    const storage = memoryStorage();

    writeStoredTripContext(
      {
        accommodation: "  ".concat("x".repeat(120)),
        dateRange: "  Sep 2 - 5 ",
        travelerType: " Couple ",
        nearbyArea: "General Luna",
      },
      { storage },
    );

    const stored = JSON.parse(storage.getItem(tripContextStorageKey) ?? "{}");
    expect(stored.accommodation).toHaveLength(80);
    expect(stored.dateRange).toBe("Sep 2 - 5");
    expect(stored.travelerType).toBe("Couple");
    expect(stored.nearbyArea).toBe("General Luna");
  });

  test("clears stored accommodation and nearby area while preserving other local trip context", () => {
    const storage = memoryStorage();
    writeStoredTripContext(
      {
        accommodation: "Cloud 9 stay",
        dateRange: "Sep 2 - 5",
        travelerType: "Couple",
        nearbyArea: "General Luna",
      },
      { storage },
    );

    clearStoredTripLocationContext({ storage });

    expect(readStoredTripContext({ storage })).toEqual({
      accommodation: "",
      dateRange: "Sep 2 - 5",
      travelerType: "Couple",
      nearbyArea: "Siargao Island",
    });
  });
});

function memoryStorage(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
