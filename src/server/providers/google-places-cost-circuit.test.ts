import { describe, expect, test } from "bun:test";

import {
  googlePlacesTextSearchEnterpriseReservationMicros,
  productionGooglePlacesDailyUsdLimit,
  reserveGooglePlacesSearchCost,
} from "@/server/providers/google-places-cost-circuit";
import { createMemoryQuotaStore } from "@/server/security/rate-limit";

describe("Google Places cost circuit", () => {
  test("enforces the USD 15 production ceiling with field-mask SKU reservations", async () => {
    const result = await reserveGooglePlacesSearchCost({
      env: { NODE_ENV: "production", REDIS_URL: "rediss://redis.example.test" },
      fieldMask: "places.id,places.rating,places.userRatingCount",
      now: new Date("2026-08-10T04:00:00.000Z"),
      store: sharedMemoryStore(),
    });

    expect(productionGooglePlacesDailyUsdLimit).toBe(15);
    expect(result).toEqual({
      status: "allowed",
      amountMicros: googlePlacesTextSearchEnterpriseReservationMicros,
      sku: "text_search_enterprise",
    });
  });

  test("blocks atomically once the configured test budget is exhausted", async () => {
    const store = createMemoryQuotaStore();
    const input = {
      env: {
        GOOGLE_PLACES_DAILY_USD_LIMIT: "0.000001",
        GOOGLE_PLACES_SEARCH_RESERVATION_MICRO_USD: "1",
      },
      fieldMask: "places.id",
      now: new Date("2026-08-10T04:00:00.000Z"),
      store,
    };

    expect(await reserveGooglePlacesSearchCost(input)).toMatchObject({ status: "allowed" });
    expect(await reserveGooglePlacesSearchCost(input)).toEqual({ status: "blocked" });
  });
});

function sharedMemoryStore() {
  return { ...createMemoryQuotaStore(), scope: "shared" as const };
}
