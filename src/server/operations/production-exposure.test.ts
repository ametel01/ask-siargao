import { describe, expect, test } from "bun:test";

import {
  beginTravelAnswerExposure,
  createExposureMemoryStoreForTests,
  productionDailyAccountLimit,
  productionDailyTravelAnswerLimit,
  reserveNewAccountExposure,
} from "@/server/operations/production-exposure";

describe("production exposure controller", () => {
  test("allows production Travel Answers at every hour when exposure is open", async () => {
    const env = {
      NODE_ENV: "production",
      APP_ENV: "staging",
      REDIS_URL: "rediss://redis.example.test",
      TRAVEL_ANSWER_EXPOSURE_MODE: "open",
    };
    const store = createExposureMemoryStoreForTests();

    for (const now of [
      new Date("2026-08-10T14:00:00.000Z"),
      new Date("2026-08-10T22:55:16.924Z"),
      new Date("2026-08-11T00:00:00.000Z"),
    ]) {
      expect(
        await beginTravelAnswerExposure(`request_${now.toISOString()}`, { env, now, store }),
      ).toMatchObject({ status: "allowed" });
    }
  });

  test("fails closed in production unless continuous exposure is explicitly open", async () => {
    for (const mode of [undefined, "staffed", "invalid"]) {
      const result = await beginTravelAnswerExposure("request_closed", {
        env: { NODE_ENV: "production", TRAVEL_ANSWER_EXPOSURE_MODE: mode },
        now: new Date("2026-08-10T04:00:00.000Z"),
      });
      expect(result).toMatchObject({
        status: "closed",
        reason: "emergency_exposure_off",
      });
    }
  });

  test("honors the emergency exposure-off switch", async () => {
    const result = await beginTravelAnswerExposure("request_emergency", {
      env: { NODE_ENV: "development", TRAVEL_ANSWER_EXPOSURE_MODE: "off" },
    });
    expect(result.status).toBe("closed");
  });

  test("stops the 1,001st Travel Answer in a UTC day", async () => {
    const store = createExposureMemoryStoreForTests();
    const env = {
      NODE_ENV: "production",
      REDIS_URL: "rediss://redis.example.test",
      TRAVEL_ANSWER_EXPOSURE_MODE: "open",
    };
    const now = new Date("2026-08-10T04:00:00.000Z");
    for (let index = 0; index < productionDailyTravelAnswerLimit; index += 1) {
      expect(await beginTravelAnswerExposure(`answer_${index}`, { env, now, store })).toMatchObject(
        {
          status: "allowed",
        },
      );
    }

    expect(await beginTravelAnswerExposure("answer_1001", { env, now, store })).toMatchObject({
      status: "limit_reached",
    });
  });

  test("deduplicates accounts and stops the 101st new account", async () => {
    const store = createExposureMemoryStoreForTests();
    const env = { NODE_ENV: "production", REDIS_URL: "rediss://redis.example.test" };
    const now = new Date("2026-08-10T04:00:00.000Z");
    for (let index = 0; index < productionDailyAccountLimit; index += 1) {
      expect(await reserveNewAccountExposure(`user_${index}`, { env, now, store })).toEqual({
        status: "allowed",
      });
    }
    expect(await reserveNewAccountExposure("user_0", { env, now, store })).toEqual({
      status: "allowed",
    });
    expect(await reserveNewAccountExposure("user_101", { env, now, store })).toEqual({
      status: "limit_reached",
    });
  });
});
