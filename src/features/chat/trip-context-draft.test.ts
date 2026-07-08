import { describe, expect, test } from "bun:test";

import {
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

  test("does not send default draft context when nothing has been stored", () => {
    const storage = memoryStorage();

    expect(readStoredTripContext({ storage })).toMatchObject({
      nearbyArea: "Cloud 9",
    });
    expect(readStoredTripContextForRequest({ storage })).toBeUndefined();
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
