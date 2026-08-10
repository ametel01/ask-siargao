import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
  shouldUseRedisQuotaStore,
} from "@/server/security/rate-limit";
import { readTripPassEnvironment } from "@/server/trip-pass/catalog";

export type ModelCostCircuitProvider = "deepseek" | "openai";

export type ModelCostCircuitResult =
  | {
      status: "allowed";
      amountMicros: number;
      provider: ModelCostCircuitProvider;
      settle(actualAmountMicros: number): Promise<"settled" | "over_budget">;
    }
  | { status: "not_configured"; provider: ModelCostCircuitProvider }
  | {
      status: "blocked";
      provider: ModelCostCircuitProvider;
      reason: "provider_budget" | "global_budget";
    }
  | { status: "unavailable"; provider: ModelCostCircuitProvider };

export type ModelCostCircuitOptions = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  store?: QuotaStore;
};

const oneDayMs = 24 * 60 * 60 * 1_000;
const defaultReservationMicros = 2_000;
const productionGlobalModelDailyUsdLimit = 10;

let defaultStore: QuotaStore | undefined;

export async function reserveModelCost(
  input: {
    model: string;
    requestId: string;
  },
  options: ModelCostCircuitOptions = {},
): Promise<ModelCostCircuitResult> {
  const provider = providerForModel(input.model);
  const environment = readTripPassEnvironment(options.env);
  const providerLimitUsd =
    provider === "deepseek"
      ? environment.costBudgets.deepSeekDailyUsd
      : environment.costBudgets.openAiDailyUsd;
  const configuredGlobalLimitUsd = environment.costBudgets.globalDailyUsd;
  const globalLimitUsd = isProduction(options.env)
    ? Math.min(
        configuredGlobalLimitUsd ?? productionGlobalModelDailyUsdLimit,
        productionGlobalModelDailyUsdLimit,
      )
    : configuredGlobalLimitUsd;

  if (providerLimitUsd === null && globalLimitUsd === null) {
    return { status: "not_configured", provider };
  }

  const nowMs = (options.now?.() ?? new Date()).getTime();
  const store = options.store ?? defaultCostCircuitStore(options.env);
  const amountMicros = parseReservationMicros(options.env);
  const consumed: Array<{ amount: number; key: string }> = [];

  try {
    if (globalLimitUsd !== null) {
      const globalKey = `cost:global:daily:${utcDay(nowMs)}`;
      const globalBudget = await store.consumeBudget({
        key: globalKey,
        amount: amountMicros,
        limit: usdToMicros(globalLimitUsd),
        nowMs,
        windowMs: oneDayMs,
      });
      if (globalBudget.status === "exceeded") {
        return { status: "blocked", provider, reason: "global_budget" };
      }
      consumed.push({ key: globalKey, amount: amountMicros });
    }

    if (providerLimitUsd !== null) {
      const providerKey = `cost:${provider}:daily:${utcDay(nowMs)}`;
      const providerBudget = await store.consumeBudget({
        key: providerKey,
        amount: amountMicros,
        limit: usdToMicros(providerLimitUsd),
        nowMs,
        windowMs: oneDayMs,
      });
      if (providerBudget.status === "exceeded") {
        await releaseConsumedBudget(store, consumed);
        return { status: "blocked", provider, reason: "provider_budget" };
      }
      consumed.push({ key: providerKey, amount: amountMicros });
    }

    return {
      status: "allowed",
      amountMicros,
      provider,
      async settle(actualAmountMicros) {
        const actual = normalizeActualMicros(actualAmountMicros, amountMicros);
        const difference = actual - amountMicros;
        if (difference === 0) {
          return "settled";
        }
        if (difference < 0) {
          await releaseConsumedBudget(
            store,
            consumed.map((entry) => ({ ...entry, amount: -difference })),
          );
          return "settled";
        }

        const adjustments: Array<{ amount: number; key: string }> = [];
        for (const entry of consumed) {
          const limit = entry.key.includes(":global:") ? globalLimitUsd : providerLimitUsd;
          if (limit === null) {
            continue;
          }
          const adjustment = await store.consumeBudget({
            key: entry.key,
            amount: difference,
            limit: usdToMicros(limit),
            nowMs,
            windowMs: oneDayMs,
          });
          if (adjustment.status === "exceeded") {
            await releaseConsumedBudget(store, adjustments);
            return "over_budget";
          }
          adjustments.push({ key: entry.key, amount: difference });
        }
        return "settled";
      },
    };
  } catch {
    await releaseConsumedBudget(store, consumed);
    return { status: "unavailable", provider };
  }
}

export function assertModelCostCircuit(result: ModelCostCircuitResult) {
  if (result.status === "blocked" || result.status === "unavailable") {
    throw new ModelCostCircuitError(result);
  }
}

export class ModelCostCircuitError extends Error {
  readonly code = "model_cost_circuit_open";
  readonly result: ModelCostCircuitResult;

  constructor(result: ModelCostCircuitResult) {
    super(`Model cost circuit blocked ${result.provider}.`);
    this.name = "ModelCostCircuitError";
    this.result = result;
  }
}

function providerForModel(model: string): ModelCostCircuitProvider {
  return model.toLowerCase().includes("deepseek") ? "deepseek" : "openai";
}

function defaultCostCircuitStore(env: Record<string, string | undefined> = process.env) {
  if (!defaultStore) {
    defaultStore = shouldUseRedisQuotaStore(env)
      ? createRedisQuotaStore({ redisUrl: env.REDIS_URL })
      : createMemoryQuotaStore();
  }
  return defaultStore;
}

function parseReservationMicros(env: Record<string, string | undefined> = process.env) {
  const value = env.MODEL_COST_RESERVATION_MICRO_USD;
  if (!value?.trim()) {
    return defaultReservationMicros;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultReservationMicros;
}

function normalizeActualMicros(value: number, fallback: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isProduction(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

function usdToMicros(value: number) {
  return Math.floor(value * 1_000_000);
}

async function releaseConsumedBudget(
  store: QuotaStore,
  consumed: readonly { amount: number; key: string }[],
) {
  await Promise.all(
    consumed.map(async (entry) => {
      try {
        await store.releaseBudget(entry);
      } catch {
        // Best-effort cleanup: the caller still returns a controlled circuit result.
      }
    }),
  );
}

function utcDay(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 10);
}
