import { describe, expect, test } from "bun:test";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import {
  createMemoryQuotaStore,
  type QuotaStore,
  type RollingWindowReservationResult,
} from "@/server/security/rate-limit";
import { openChatUsageSession } from "@/server/trip-pass/usage";

const startsAt = new Date("2026-07-01T00:00:00.000Z");
const expiresAt = new Date("2026-07-15T00:00:00.000Z");
const now = new Date("2026-07-14T04:00:00.000Z");

describe("paid Trip Pass chat usage", () => {
  test("settles one successful chat unit exactly once per request idempotency key", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_once", "trip_pass_paid_once");
      const session = await openChatUsageSession({
        bodyHash: "body_hash_once",
        db,
        idempotencyKey: "token_hash_once",
        now,
        requestId: "request_paid_once",
        store: createMemoryQuotaStore(),
        userId: "user_paid_once",
      });
      expect(session.status).toBe("allowed");
      if (session.status !== "allowed") {
        return;
      }

      const first = await session.settle({
        success: true,
        providerRequestIds: ["deepseek_request_once"],
      });
      const duplicate = await session.settle({
        success: true,
        providerRequestIds: ["deepseek_request_once_duplicate"],
      });

      expect(first).toMatchObject({
        status: "settled",
        allowance: { chatMessages: { used: 1, remaining: 149, limit: 150 } },
      });
      expect(duplicate).toMatchObject({
        status: "duplicate",
        allowance: { chatMessages: { used: 1, remaining: 149, limit: 150 } },
      });
      await expectMeterUsed(db, "trip_pass_paid_once", 1);
      await expectUsageEvents(db, {
        eventType: "settled",
        providerRequestIds: ["deepseek_request_once"],
        requestHash: "body_hash_once",
      });
    });
  });

  test("releases pre-billable failures without consuming chat allowance", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_release", "trip_pass_paid_release");
      const store = createMemoryQuotaStore();
      const failed = await openChatUsageSession({
        bodyHash: "body_hash_release",
        db,
        idempotencyKey: "token_hash_release",
        now,
        requestId: "request_paid_release",
        store,
        userId: "user_paid_release",
      });
      expect(failed.status).toBe("allowed");
      if (failed.status !== "allowed") {
        return;
      }

      await expect(failed.settle({ success: false })).resolves.toMatchObject({
        status: "released",
      });
      await expectMeterUsed(db, "trip_pass_paid_release", 0);
      await expectUsageEvents(db, { eventType: "released", requestHash: "body_hash_release" });

      const retry = await openChatUsageSession({
        bodyHash: "body_hash_retry",
        db,
        idempotencyKey: "token_hash_retry",
        now,
        requestId: "request_paid_retry",
        store,
        userId: "user_paid_release",
      });
      expect(retry.status).toBe("allowed");
    });
  });

  test("does not overspend when parallel requests race for the final chat unit", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_final", "trip_pass_paid_final");
      await setMeterUsed(db, "trip_pass_paid_final", "chat_message", 149);
      const store = createMemoryQuotaStore();

      const results = await Promise.all([
        openChatUsageSession({
          bodyHash: "body_hash_final_a",
          db,
          idempotencyKey: "token_hash_final_a",
          now,
          requestId: "request_paid_final_a",
          store,
          userId: "user_paid_final",
        }),
        openChatUsageSession({
          bodyHash: "body_hash_final_b",
          db,
          idempotencyKey: "token_hash_final_b",
          now,
          requestId: "request_paid_final_b",
          store,
          userId: "user_paid_final",
        }),
      ]);

      expect(results.map((result) => result.status).toSorted()).toEqual([
        "allowed",
        "usage_limit_reached",
      ]);
      const allowed = results.find((result) => result.status === "allowed");
      if (allowed?.status === "allowed") {
        await allowed.settle({ success: true, providerRequestIds: ["deepseek_final"] });
      }
      await expectMeterUsed(db, "trip_pass_paid_final", 150);
    });
  });

  test("enforces paid chat concurrency before model execution", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_concurrency", "trip_pass_paid_concurrency");
      const store = createMemoryQuotaStore();

      const results = await Promise.all(
        ["a", "b", "c"].map((suffix) =>
          openChatUsageSession({
            bodyHash: `body_hash_concurrency_${suffix}`,
            db,
            idempotencyKey: `token_hash_concurrency_${suffix}`,
            now,
            requestId: `request_paid_concurrency_${suffix}`,
            store,
            userId: "user_paid_concurrency",
          }),
        ),
      );

      expect(results.map((result) => result.status).toSorted()).toEqual([
        "allowed",
        "allowed",
        "usage_limit_reached",
      ]);
      expect(results.find((result) => result.status === "usage_limit_reached")).toMatchObject({
        reason: "paid_chat_concurrency_exceeded",
      });
    });
  });

  test("fails closed and compensates earlier Redis reservations when shared storage breaks", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_store_down", "trip_pass_paid_store_down");
      const store = createFailingSharedQuotaStore();

      const result = await openChatUsageSession({
        bodyHash: "body_hash_store_down",
        db,
        env: {
          NODE_ENV: "production",
          REDIS_URL: "redis://redis.test.local:6379/0",
        },
        idempotencyKey: "token_hash_store_down",
        now,
        requestId: "request_paid_store_down",
        store,
        userId: "user_paid_store_down",
      });

      expect(result).toEqual({
        status: "unavailable",
        reason: "paid_usage_store_unavailable",
      });
      expect(store.releasedRollingReservations).toEqual([
        "paid:trip_pass_paid_store_down:chat-starts:1m:request_paid_store_down",
      ]);
      await expectMeterUsed(db, "trip_pass_paid_store_down", 0);
      await expectUsageEventCount(db, "body_hash_store_down", 0);
    });
  });

  test("enforces the paid successful-chat daily burst without changing entitlement limit", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_daily", "trip_pass_paid_daily");
      const store = createMemoryQuotaStore();

      for (let index = 0; index < 30; index += 1) {
        const requestNow = new Date(now.getTime() + index * 60_000);
        const session = await openChatUsageSession({
          bodyHash: `body_hash_daily_${index}`,
          db,
          idempotencyKey: `token_hash_daily_${index}`,
          now: requestNow,
          requestId: `request_paid_daily_${index}`,
          store,
          userId: "user_paid_daily",
        });
        expect(session.status).toBe("allowed");
        if (session.status === "allowed") {
          await expect(session.settle({ success: true })).resolves.toMatchObject({
            status: "settled",
          });
        }
      }

      const blocked = await openChatUsageSession({
        bodyHash: "body_hash_daily_blocked",
        db,
        idempotencyKey: "token_hash_daily_blocked",
        now: new Date(now.getTime() + 31 * 60_000),
        requestId: "request_paid_daily_blocked",
        store,
        userId: "user_paid_daily",
      });

      expect(blocked).toMatchObject({
        status: "usage_limit_reached",
        reason: "paid_chat_daily_limit_exceeded",
        allowance: { chatMessages: { used: 30, remaining: 120, limit: 150 } },
      });
      await expectMeterUsed(db, "trip_pass_paid_daily", 30);
    });
  });

  test("treats expired and other-owner passes as not paid-applicable", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_expired", "trip_pass_paid_expired", {
        expiresAt: new Date("2026-07-10T00:00:00.000Z"),
      });
      await seedActivePass(db, "user_paid_owner", "trip_pass_paid_owner");

      await expect(
        openChatUsageSession({
          db,
          now,
          requestId: "request_expired",
          store: createMemoryQuotaStore(),
          userId: "user_paid_expired",
        }),
      ).resolves.toMatchObject({ status: "not_applicable", reason: "expired" });
      await expect(
        openChatUsageSession({
          db,
          now,
          requestId: "request_owner_mismatch",
          store: createMemoryQuotaStore(),
          userId: "user_without_pass",
        }),
      ).resolves.toMatchObject({ status: "not_applicable", reason: "no_active_pass" });
    });
  });
});

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(db);
  } finally {
    await db.close();
  }
}

async function seedActivePass(
  db: DatabaseQueryClient,
  userId: string,
  tripPassId: string,
  input: { expiresAt?: Date } = {},
) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
  await createActiveTripPassWithMeters(
    {
      id: tripPassId,
      userId,
      email: `${userId}@example.com`,
      startsAt,
      expiresAt: input.expiresAt ?? expiresAt,
      now,
    },
    db,
  );
}

async function setMeterUsed(
  db: DatabaseQueryClient,
  tripPassId: string,
  meterType: string,
  used: number,
) {
  await db.query(
    `
      update trip_usage_meters
      set used = $2
      where trip_pass_id = $1
        and meter_type = $3
    `,
    [tripPassId, used, meterType],
  );
}

async function expectMeterUsed(
  db: DatabaseQueryClient,
  tripPassId: string,
  used: number,
  meterType = "chat_message",
) {
  const result = await db.query<{ used: number }>(
    `
      select used
      from trip_usage_meters
      where trip_pass_id = $1
        and meter_type = $2
    `,
    [tripPassId, meterType],
  );

  expect(result.rows[0]?.used).toBe(used);
}

async function expectUsageEvents(
  db: DatabaseQueryClient,
  expected: {
    eventType: string;
    meterType?: string;
    providerRequestIds?: readonly string[];
    requestHash: string;
  },
) {
  const result = await db.query<{
    event_type: string;
    provider_request_ids_json: string[] | string;
    request_hash: string | null;
  }>(
    `
      select event_type, provider_request_ids_json, request_hash
      from trip_usage_events
      where request_hash = $1
        and ($2::text is null or meter_type = $2)
    `,
    [expected.requestHash, expected.meterType ?? null],
  );
  const row = result.rows[0];
  expect(row?.event_type).toBe(expected.eventType);
  expect(row?.request_hash).toBe(expected.requestHash);
  if (expected.providerRequestIds) {
    const providerRequestIds =
      typeof row?.provider_request_ids_json === "string"
        ? JSON.parse(row.provider_request_ids_json)
        : row?.provider_request_ids_json;
    expect(providerRequestIds).toEqual([...expected.providerRequestIds]);
  }
}

async function expectUsageEventCount(db: DatabaseQueryClient, requestHash: string, count: number) {
  const result = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from trip_usage_events
      where request_hash = $1
    `,
    [requestHash],
  );

  expect(Number(result.rows[0]?.count ?? 0)).toBe(count);
}

function createFailingSharedQuotaStore() {
  const releasedRollingReservations: string[] = [];
  let rollingAttempts = 0;
  const store: QuotaStore & { releasedRollingReservations: string[] } = {
    scope: "shared",
    releasedRollingReservations,
    async consumeBudget() {
      throw new Error("not used");
    },
    async incrementFixedWindow() {
      throw new Error("not used");
    },
    async recordIdempotency() {
      throw new Error("not used");
    },
    async releaseBudget() {
      throw new Error("not used");
    },
    async releaseConcurrency() {
      throw new Error("not used");
    },
    async releaseRollingWindow(input) {
      releasedRollingReservations.push(`${input.key}:${input.reservationId}`);
    },
    async reserveConcurrency() {
      throw new Error("configured Redis unavailable");
    },
    async reserveRollingWindow(input): Promise<RollingWindowReservationResult> {
      rollingAttempts += 1;
      if (rollingAttempts > 1) {
        throw new Error("not used");
      }
      return {
        status: "reserved",
        count: 1,
        reservationId: input.reservationId,
        resetAt: input.nowMs + input.windowMs,
      };
    },
  };
  return store;
}
