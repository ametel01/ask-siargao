import { describe, expect, test } from "bun:test";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import {
  canConsumeTripPassMeter,
  createActiveTripPassWithMeters,
  createTripPassMeterRows,
  InvalidTripPassMeterIncrementError,
  initializeDefaultTripPassMeters,
  tripPassMeterLimits,
  tripPassMeterTypes,
  tryConsumeTripPassMeter,
} from "@/server/payments/trip-pass";

const startsAt = new Date("2026-06-30T00:00:00.000Z");
const expiresAt = new Date("2026-07-14T00:00:00.000Z");
const now = new Date("2026-06-30T08:00:00.000Z");

describe("trip pass meter defaults", () => {
  test("defines the initial meter types and explicit limits in deterministic order", () => {
    expect(tripPassMeterTypes).toEqual(["chat_message"]);
    expect(tripPassMeterLimits).toEqual({
      chat_message: 150,
    });
  });

  test("builds stable default meter rows", () => {
    const rows = createTripPassMeterRows({
      tripPassId: "trip_pass_123",
      resetAt: expiresAt,
      updatedAt: now,
    });

    expect(rows.map((row) => row.id)).toEqual(["trip_meter_trip_pass_123_chat_message"]);
    expect(rows.map((row) => [row.meterType, row.used, row.limit, row.resetAt])).toEqual([
      ["chat_message", 0, 150, expiresAt],
    ]);
  });

  test("validates positive integer consumption increments", () => {
    expect(canConsumeTripPassMeter({ used: 9, limit: 10, increment: 1 })).toBe(true);
    expect(canConsumeTripPassMeter({ used: 10, limit: 10, increment: 1 })).toBe(false);
    expect(() => canConsumeTripPassMeter({ used: 0, limit: 10, increment: 0 })).toThrow(
      InvalidTripPassMeterIncrementError,
    );
  });
});

describe("trip pass usage meter store", () => {
  test("creates an active pass with default meters and Stripe lifecycle fields", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_123");

      const created = await createActiveTripPassWithMeters(
        {
          id: "trip_pass_123",
          userId: "user_123",
          email: "traveler@example.com",
          stripeCheckoutSessionId: "cs_trip_pass_123",
          stripePaymentIntentId: "pi_trip_pass_123",
          stripeEventId: "evt_trip_pass_123",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );

      expect(created.pass).toMatchObject({
        id: "trip_pass_123",
        userId: "user_123",
        email: null,
        status: "active",
        stripeCheckoutSessionId: "cs_trip_pass_123",
        stripePaymentIntentId: "pi_trip_pass_123",
        stripeEventId: "evt_trip_pass_123",
      });
      expect(created.usage.map((meter) => [meter.meterType, meter.used, meter.limit])).toEqual([
        ["chat_message", 0, 150],
      ]);
      await expectPassEmail(db, "trip_pass_123", null);
    });
  });

  test("initializes default meters idempotently for retry-safe callers", async () => {
    await withTestDb(async (db) => {
      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_retry",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );

      await initializeDefaultTripPassMeters(
        { tripPassId: "trip_pass_retry", resetAt: expiresAt, now },
        db,
      );
      const usage = await initializeDefaultTripPassMeters(
        { tripPassId: "trip_pass_retry", resetAt: expiresAt, now },
        db,
      );
      const count = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_usage_meters where trip_pass_id = $1",
        ["trip_pass_retry"],
      );

      expect(count.rows[0]?.count).toBe("1");
      expect(usage.map((meter) => meter.meterType)).toEqual([...tripPassMeterTypes]);
    });
  });

  test("atomically consumes a meter and leaves usage unchanged when the limit is exceeded", async () => {
    await withTestDb(async (db) => {
      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_limits",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );

      const first = await tryConsumeTripPassMeter(
        {
          tripPassId: "trip_pass_limits",
          meterType: "chat_message",
          increment: 2,
          now,
        },
        db,
      );
      const fillsLimit = await tryConsumeTripPassMeter(
        {
          tripPassId: "trip_pass_limits",
          meterType: "chat_message",
          increment: 148,
          now,
        },
        db,
      );
      const exceeded = await tryConsumeTripPassMeter(
        {
          tripPassId: "trip_pass_limits",
          meterType: "chat_message",
          increment: 1,
          now,
        },
        db,
      );

      expect(first).toMatchObject({ status: "consumed", meter: { used: 2, limit: 150 } });
      expect(fillsLimit).toMatchObject({ status: "consumed", meter: { used: 150, limit: 150 } });
      expect(exceeded).toMatchObject({
        status: "limit_exceeded",
        meter: { used: 150, limit: 150 },
      });
      await expectMeterUsed(db, "trip_pass_limits", "chat_message", 150);
    });
  });

  test("does not overrun a meter when competing calls race at the boundary", async () => {
    await withTestDb(async (db) => {
      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_concurrent",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );
      await tryConsumeTripPassMeter(
        {
          tripPassId: "trip_pass_concurrent",
          meterType: "chat_message",
          increment: 149,
          now,
        },
        db,
      );

      const results = await Promise.all([
        tryConsumeTripPassMeter(
          {
            tripPassId: "trip_pass_concurrent",
            meterType: "chat_message",
            increment: 1,
            now,
          },
          db,
        ),
        tryConsumeTripPassMeter(
          {
            tripPassId: "trip_pass_concurrent",
            meterType: "chat_message",
            increment: 1,
            now,
          },
          db,
        ),
      ]);

      expect(results.map((result) => result.status).toSorted()).toEqual([
        "consumed",
        "limit_exceeded",
      ]);
      await expectMeterUsed(db, "trip_pass_concurrent", "chat_message", 150);
    });
  });

  test("rejects invalid increments before mutating usage", async () => {
    await withTestDb(async (db) => {
      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_invalid",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );

      await expect(
        tryConsumeTripPassMeter(
          {
            tripPassId: "trip_pass_invalid",
            meterType: "chat_message",
            increment: -1,
            now,
          },
          db,
        ),
      ).rejects.toThrow(InvalidTripPassMeterIncrementError);
      await expectMeterUsed(db, "trip_pass_invalid", "chat_message", 0);
    });
  });

  test("blocks inactive, expired, and missing passes from consuming meters", async () => {
    await withTestDb(async (db) => {
      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_cancelled",
          startsAt,
          expiresAt,
          now,
        },
        db,
      );
      await db.query("update trip_passes set status = 'cancelled' where id = $1", [
        "trip_pass_cancelled",
      ]);

      await createActiveTripPassWithMeters(
        {
          id: "trip_pass_expired",
          startsAt: new Date("2026-06-01T00:00:00.000Z"),
          expiresAt: new Date("2026-06-10T00:00:00.000Z"),
          now: new Date("2026-06-01T00:00:00.000Z"),
        },
        db,
      );

      await expect(
        tryConsumeTripPassMeter(
          { tripPassId: "trip_pass_cancelled", meterType: "chat_message", now },
          db,
        ),
      ).resolves.toMatchObject({ status: "pass_inactive", pass: { status: "cancelled" } });
      await expect(
        tryConsumeTripPassMeter(
          { tripPassId: "trip_pass_expired", meterType: "chat_message", now },
          db,
        ),
      ).resolves.toMatchObject({ status: "pass_expired" });
      await expect(
        tryConsumeTripPassMeter(
          { tripPassId: "trip_pass_missing", meterType: "chat_message", now },
          db,
        ),
      ).resolves.toMatchObject({ status: "pass_not_found" });
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

async function insertUser(db: DatabaseQueryClient, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function expectMeterUsed(
  db: DatabaseQueryClient,
  tripPassId: string,
  meterType: string,
  used: number,
) {
  const result = await db.query<{ used: number }>(
    "select used from trip_usage_meters where trip_pass_id = $1 and meter_type = $2",
    [tripPassId, meterType],
  );

  expect(result.rows[0]?.used).toBe(used);
}

async function expectPassEmail(
  db: DatabaseQueryClient,
  tripPassId: string,
  expectedEmail: string | null,
) {
  const result = await db.query<{ email: string | null }>(
    "select email from trip_passes where id = $1",
    [tripPassId],
  );

  expect(result.rows[0]?.email).toBe(expectedEmail);
}
