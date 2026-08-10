import { describe, expect, test } from "bun:test";

import {
  assertModelCostCircuit,
  ModelCostCircuitError,
  reserveModelCost,
} from "@/server/chat/cost-circuits";
import { createMemoryQuotaStore, type QuotaStore } from "@/server/security/rate-limit";

describe("model cost circuits", () => {
  test("allows calls when provider and global budgets have room", async () => {
    const store = createMemoryQuotaStore();
    const env = {
      DEEPSEEK_DAILY_USD_LIMIT: "0.000002",
      GLOBAL_MODEL_DAILY_USD_LIMIT: "0.000002",
      MODEL_COST_RESERVATION_MICRO_USD: "1",
    };

    await expect(
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "request_a" },
        { env, store, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
    ).resolves.toMatchObject({ status: "allowed", provider: "deepseek" });
  });

  test("defaults production to a USD 10 global circuit and a 2,000 micro-USD reservation", async () => {
    const result = await reserveModelCost(
      { model: "deepseek-v4-flash", requestId: "production_default" },
      {
        env: { NODE_ENV: "production" },
        store: createMemoryQuotaStore(),
        now: () => new Date("2026-07-14T00:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({ status: "allowed", amountMicros: 2_000 });
  });

  test("reconciles conservative reservations to actual modeled cost", async () => {
    const store = createMemoryQuotaStore();
    const env = {
      GLOBAL_MODEL_DAILY_USD_LIMIT: "0.002001",
      MODEL_COST_RESERVATION_MICRO_USD: "2000",
    };
    const first = await reserveModelCost(
      { model: "deepseek-v4-flash", requestId: "reconcile_first" },
      { env, store, now: () => new Date("2026-07-14T00:00:00.000Z") },
    );
    expect(first.status).toBe("allowed");
    if (first.status === "allowed") {
      expect(await first.settle(1)).toBe("settled");
    }
    await expect(
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "reconcile_second" },
        { env, store, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  test("blocks provider and global circuit races atomically", async () => {
    const providerStore = createMemoryQuotaStore();
    const providerEnv = {
      DEEPSEEK_DAILY_USD_LIMIT: "0.000001",
      MODEL_COST_RESERVATION_MICRO_USD: "1",
    };

    const providerResults = await Promise.all([
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "provider_a" },
        { env: providerEnv, store: providerStore, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "provider_b" },
        { env: providerEnv, store: providerStore, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
    ]);
    expect(providerResults.map((result) => result.status).toSorted()).toEqual([
      "allowed",
      "blocked",
    ]);
    expect(providerResults.find((result) => result.status === "blocked")).toMatchObject({
      reason: "provider_budget",
    });

    const globalStore = createMemoryQuotaStore();
    const globalEnv = {
      GLOBAL_MODEL_DAILY_USD_LIMIT: "0.000001",
      MODEL_COST_RESERVATION_MICRO_USD: "1",
    };
    const globalResults = await Promise.all([
      reserveModelCost(
        { model: "gpt-5.4-mini", requestId: "global_a" },
        { env: globalEnv, store: globalStore, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "global_b" },
        { env: globalEnv, store: globalStore, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
    ]);
    expect(globalResults.map((result) => result.status).toSorted()).toEqual(["allowed", "blocked"]);
    expect(globalResults.find((result) => result.status === "blocked")).toMatchObject({
      reason: "global_budget",
    });
  });

  test("releases earlier reservations when a later circuit blocks", async () => {
    const store = createMemoryQuotaStore();
    const env = {
      DEEPSEEK_DAILY_USD_LIMIT: "0",
      GLOBAL_MODEL_DAILY_USD_LIMIT: "0.000001",
      MODEL_COST_RESERVATION_MICRO_USD: "1",
    };

    await expect(
      reserveModelCost(
        { model: "deepseek-v4-flash", requestId: "blocked_provider" },
        { env, store, now: () => new Date("2026-07-14T00:00:00.000Z") },
      ),
    ).resolves.toMatchObject({ status: "blocked", reason: "provider_budget" });

    await expect(
      reserveModelCost(
        { model: "gpt-5.4-mini", requestId: "global_still_has_room" },
        {
          env: {
            GLOBAL_MODEL_DAILY_USD_LIMIT: "0.000001",
            MODEL_COST_RESERVATION_MICRO_USD: "1",
          },
          store,
          now: () => new Date("2026-07-14T00:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  test("throws a controlled error for blocked costly work", async () => {
    const result = await reserveModelCost(
      { model: "deepseek-v4-flash", requestId: "request_blocked" },
      {
        env: {
          DEEPSEEK_DAILY_USD_LIMIT: "0",
          MODEL_COST_RESERVATION_MICRO_USD: "1",
        },
        store: createMemoryQuotaStore(),
        now: () => new Date("2026-07-14T00:00:00.000Z"),
      },
    );

    expect(() => assertModelCostCircuit(result)).toThrow(ModelCostCircuitError);
  });

  test("fails closed when the quota store is unavailable", async () => {
    const result = await reserveModelCost(
      { model: "deepseek-v4-flash", requestId: "request_unavailable" },
      {
        env: {
          DEEPSEEK_DAILY_USD_LIMIT: "1",
        },
        store: unavailableStore(),
        now: () => new Date("2026-07-14T00:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({ status: "unavailable", provider: "deepseek" });
  });
});

function unavailableStore() {
  const fail = async () => {
    throw new Error("quota store unavailable");
  };

  return {
    scope: "shared",
    consumeBudget: fail,
    incrementFixedWindow: fail,
    recordIdempotency: fail,
    releaseBudget: fail,
    releaseConcurrency: fail,
    releaseRollingWindow: fail,
    reserveConcurrency: fail,
    reserveRollingWindow: fail,
  } satisfies QuotaStore;
}
