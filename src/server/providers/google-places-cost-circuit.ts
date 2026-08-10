import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
} from "@/server/security/rate-limit";

export const productionGooglePlacesDailyUsdLimit = 15;
export const googlePlacesTextSearchEnterpriseReservationMicros = 35_000;
export const googlePlacesTextSearchProReservationMicros = 32_000;

export type GooglePlacesCostCircuitResult =
  | { status: "allowed"; amountMicros: number; sku: "text_search_enterprise" }
  | { status: "not_configured" }
  | { status: "blocked" }
  | { status: "unavailable" };

let defaultStore: QuotaStore | undefined;

export async function reserveGooglePlacesSearchCost({
  env = process.env,
  fieldMask,
  now = new Date(),
  store,
}: {
  env?: Record<string, string | undefined>;
  fieldMask: string;
  now?: Date;
  store?: QuotaStore;
}): Promise<GooglePlacesCostCircuitResult> {
  const production = env.NODE_ENV === "production" || env.APP_ENV === "production";
  const configuredLimit = optionalNonNegativeNumber(env.GOOGLE_PLACES_DAILY_USD_LIMIT);
  const limitUsd = production
    ? Math.min(
        configuredLimit ?? productionGooglePlacesDailyUsdLimit,
        productionGooglePlacesDailyUsdLimit,
      )
    : configuredLimit;
  if (limitUsd === null) {
    return { status: "not_configured" };
  }

  const quotaStore = store ?? resolveDefaultStore(env);
  if (!quotaStore || (production && quotaStore.scope !== "shared")) {
    return { status: "unavailable" };
  }
  const amountMicros = reservationMicrosForFieldMask(fieldMask, env);
  try {
    const result = await quotaStore.consumeBudget({
      amount: amountMicros,
      key: `cost:google-places:daily:${now.toISOString().slice(0, 10)}`,
      limit: Math.floor(limitUsd * 1_000_000),
      nowMs: now.getTime(),
      windowMs: 24 * 60 * 60 * 1_000,
    });
    return result.status === "exceeded"
      ? { status: "blocked" }
      : { status: "allowed", amountMicros, sku: "text_search_enterprise" };
  } catch {
    return { status: "unavailable" };
  }
}

export function assertGooglePlacesCostCircuit(result: GooglePlacesCostCircuitResult) {
  if (result.status === "blocked" || result.status === "unavailable") {
    throw new GooglePlacesCostCircuitError(result.status);
  }
}

export class GooglePlacesCostCircuitError extends Error {
  readonly code = "google_places_cost_circuit_open";

  constructor(readonly reason: "blocked" | "unavailable") {
    super("Google Places cost circuit is open.");
    this.name = "GooglePlacesCostCircuitError";
  }
}

function reservationMicrosForFieldMask(fieldMask: string, env: Record<string, string | undefined>) {
  const configured = Number(env.GOOGLE_PLACES_SEARCH_RESERVATION_MICRO_USD);
  if (Number.isSafeInteger(configured) && configured > 0) {
    return configured;
  }
  const enterpriseFields = ["rating", "userRatingCount", "priceLevel", "websiteUri"];
  return enterpriseFields.some((field) => fieldMask.includes(field))
    ? googlePlacesTextSearchEnterpriseReservationMicros
    : googlePlacesTextSearchProReservationMicros;
}

function optionalNonNegativeNumber(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveDefaultStore(env: Record<string, string | undefined>) {
  if (defaultStore) {
    return defaultStore;
  }
  const production = env.NODE_ENV === "production" || env.APP_ENV === "production";
  if (production) {
    if (!env.REDIS_URL?.trim()) {
      return undefined;
    }
    defaultStore = createRedisQuotaStore({ redisUrl: env.REDIS_URL });
  } else {
    defaultStore = createMemoryQuotaStore();
  }
  return defaultStore;
}
