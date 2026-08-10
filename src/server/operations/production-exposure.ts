import { createHash } from "node:crypto";

import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
} from "@/server/security/rate-limit";

export const productionDailyAccountLimit = 100;
export const productionDailyTravelAnswerLimit = 1_000;

export type ExposureOptions = {
  env?: Record<string, string | undefined>;
  now?: Date;
  store?: QuotaStore;
};

export type TravelAnswerExposureResult =
  | { status: "allowed"; remaining: number }
  | {
      status: "closed" | "limit_reached" | "unavailable";
      reason: string;
      response: Response;
    };

let defaultProductionStore: QuotaStore | undefined;

export async function beginTravelAnswerExposure(
  _requestId: string,
  options: ExposureOptions = {},
): Promise<TravelAnswerExposureResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const production = isProduction(env);
  const mode = env.TRAVEL_ANSWER_EXPOSURE_MODE?.trim().toLowerCase();

  if (mode === "off" || (production && mode !== "open")) {
    return denied("closed", "emergency_exposure_off", 503);
  }
  if (!production) {
    return { status: "allowed", remaining: productionDailyTravelAnswerLimit };
  }

  const store = resolveProductionStore(env, options.store);
  if (store?.scope !== "shared") {
    return denied("unavailable", "shared_exposure_store_unavailable", 503);
  }

  try {
    const result = await store.consumeBudget({
      amount: 1,
      key: `exposure:travel-answers:${utcDay(now)}`,
      limit: productionDailyTravelAnswerLimit,
      nowMs: now.getTime(),
      windowMs: millisecondsUntilNextUtcDay(now),
    });
    if (result.status === "exceeded") {
      return denied("limit_reached", "daily_travel_answer_limit_reached", 429);
    }
    return {
      status: "allowed",
      remaining: Math.max(result.limit - result.used, 0),
    };
  } catch {
    return denied("unavailable", "shared_exposure_store_unavailable", 503);
  }
}

export async function reserveNewAccountExposure(userId: string, options: ExposureOptions = {}) {
  const env = options.env ?? process.env;
  if (!isProduction(env)) {
    return { status: "allowed" as const };
  }
  const now = options.now ?? new Date();
  const store = resolveProductionStore(env, options.store);
  if (store?.scope !== "shared") {
    return { status: "unavailable" as const };
  }

  try {
    const result = await store.reserveRollingWindow({
      key: `exposure:new-accounts:${utcDay(now)}`,
      limit: productionDailyAccountLimit,
      nowMs: now.getTime(),
      reservationId: createHash("sha256").update(userId).digest("hex"),
      windowMs: millisecondsUntilNextUtcDay(now),
    });
    return result.status === "rejected"
      ? { status: "limit_reached" as const }
      : { status: "allowed" as const };
  } catch {
    return { status: "unavailable" as const };
  }
}

function resolveProductionStore(
  env: Record<string, string | undefined>,
  injected: QuotaStore | undefined,
) {
  if (injected) {
    return injected;
  }
  if (!env.REDIS_URL?.trim()) {
    return undefined;
  }
  defaultProductionStore ??= createRedisQuotaStore({ redisUrl: env.REDIS_URL });
  return defaultProductionStore;
}

function denied(
  status: "closed" | "limit_reached" | "unavailable",
  reason: string,
  httpStatus: number,
): Exclude<TravelAnswerExposureResult, { status: "allowed" }> {
  return {
    status,
    reason,
    response: Response.json(
      { error: "travel_answers_unavailable", reason },
      { status: httpStatus, headers: { "cache-control": "private, no-store" } },
    ),
  };
}

function isProduction(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function millisecondsUntilNextUtcDay(now: Date) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(next - now.getTime(), 1);
}

export function createExposureMemoryStoreForTests() {
  return { ...createMemoryQuotaStore(), scope: "shared" as const };
}
