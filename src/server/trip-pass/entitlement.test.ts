import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import {
  getEffectiveTripPass,
  grantTripPass,
  TripPassGrantOwnerMismatchError,
} from "@/server/trip-pass/entitlement";

const now = new Date("2026-07-03T08:00:00.000Z");
const expiresAt = new Date("2026-07-17T08:00:00.000Z");

describe("Trip Pass entitlement grants", () => {
  test("grants a pass, grant record, and catalog-backed meters in one owner-scoped transaction", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_grant");
      await insertTripPassOrder(db, {
        id: "order_grant",
        userId: "user_grant",
        email: "grant@example.com",
      });

      const result = await grantTripPass(
        {
          userId: "user_grant",
          orderId: "order_grant",
          sourceType: "stripe_checkout",
          sourceEventId: "evt_grant",
          now,
        },
        db,
      );

      expect(result.status).toBe("granted");
      expect(result.pass).toMatchObject({
        userId: "user_grant",
        email: "grant@example.com",
        status: "active",
        stripeCheckoutSessionId: "cs_order_grant",
        stripePaymentIntentId: "pi_order_grant",
        stripeEventId: "evt_grant",
        startsAt: now,
        expiresAt,
      });
      expect(result.grant).toMatchObject({
        orderId: "order_grant",
        userId: "user_grant",
        sourceType: "stripe_checkout",
        sourceEventId: "evt_grant",
        productCode: "siargao_trip_pass_14d_v1",
        productVersion: 1,
        quantity: 1,
        durationDays: 14,
        startsAt: now,
        expiresAt,
      });
      expect(result.grant.meterLimits).toEqual({
        chat_message: 150,
        live_refresh: 40,
        heavy_recommendation: 8,
        weather_refresh: 20,
        route_lookup: 25,
      });
      expect(result.meters.map((meter) => [meter.meterType, meter.used, meter.limit])).toEqual([
        ["chat_message", 0, 150],
        ["live_refresh", 0, 40],
        ["heavy_recommendation", 0, 8],
        ["weather_refresh", 0, 20],
        ["route_lookup", 0, 25],
      ]);
    });
  });

  test("applies the same source reference repeatedly without a duplicate pass effect", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_duplicate");

      const first = await grantTripPass(
        {
          userId: "user_duplicate",
          email: "duplicate@example.com",
          sourceType: "stripe_checkout",
          sourceEventId: "evt_duplicate",
          now,
        },
        db,
      );
      const duplicate = await grantTripPass(
        {
          userId: "user_duplicate",
          email: "duplicate@example.com",
          sourceType: "stripe_checkout",
          sourceEventId: "evt_duplicate",
          now,
        },
        db,
      );

      expect(first.status).toBe("granted");
      expect(duplicate.status).toBe("duplicate");
      expect(duplicate.pass.id).toBe(first.pass.id);
      await expectCounts(db, { passes: "1", grants: "1", meters: "5" });
    });
  });

  test("treats concurrent duplicate grants as one effective grant", async () => {
    await resetTestDatabase();
    const firstDb = await openTestDatabase();
    await runInitialMigration(firstDb);
    const firstClient = createPgliteQueryClient(firstDb);
    await insertUser(firstClient, "user_race");
    const secondDb = await openTestDatabase();
    const secondClient = createPgliteQueryClient(secondDb);

    try {
      const [first, second] = await Promise.all([
        grantTripPass(
          {
            userId: "user_race",
            email: "race@example.com",
            sourceType: "stripe_checkout",
            sourceEventId: "evt_race",
            now,
          },
          firstClient,
        ),
        grantTripPass(
          {
            userId: "user_race",
            email: "race@example.com",
            sourceType: "stripe_checkout",
            sourceEventId: "evt_race",
            now,
          },
          secondClient,
        ),
      ]);

      expect([first.status, second.status].toSorted()).toEqual(["duplicate", "granted"]);
      expect(first.pass.id).toBe(second.pass.id);
      await expectCounts(firstClient, { passes: "1", grants: "1", meters: "5" });
    } finally {
      await firstDb.close();
      await secondDb.close();
    }
  });

  test("rejects source or order reuse for another owner", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_owner");
      await insertUser(db, "user_intruder");
      await insertTripPassOrder(db, {
        id: "order_owner",
        userId: "user_owner",
        email: "owner@example.com",
      });

      await grantTripPass(
        {
          userId: "user_owner",
          orderId: "order_owner",
          sourceType: "stripe_checkout",
          sourceEventId: "evt_owner",
          now,
        },
        db,
      );

      await expect(
        grantTripPass(
          {
            userId: "user_intruder",
            orderId: "order_owner",
            sourceType: "stripe_checkout",
            sourceEventId: "evt_owner",
            now,
          },
          db,
        ),
      ).rejects.toThrow(TripPassGrantOwnerMismatchError);
      await expect(
        grantTripPass(
          {
            userId: "user_intruder",
            orderId: "order_owner",
            sourceType: "manual_operator",
            sourceEventId: "manual_intruder",
            now,
          },
          db,
        ),
      ).rejects.toThrow(TripPassGrantOwnerMismatchError);
      await expectCounts(db, { passes: "1", grants: "1", meters: "5" });
    });
  });
});

describe("Trip Pass effective entitlement selection", () => {
  test("selects exactly one active owner pass by latest expiry and deterministic tie-break", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_effective");
      await insertUser(db, "user_other");
      await insertPass(db, {
        id: "pass_old",
        userId: "user_effective",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-10T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      });
      await insertPass(db, {
        id: "pass_tie_a",
        userId: "user_effective",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-20T00:00:00.000Z",
        createdAt: "2026-07-02T00:00:00.000Z",
      });
      await insertPass(db, {
        id: "pass_tie_b",
        userId: "user_effective",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-20T00:00:00.000Z",
        createdAt: "2026-07-02T00:00:00.000Z",
      });
      await insertPass(db, {
        id: "pass_other_user",
        userId: "user_other",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-20T00:00:00.000Z",
        createdAt: "2026-07-02T00:00:00.000Z",
      });

      const decision = await getEffectiveTripPass(
        { userId: "user_effective", now: new Date("2026-07-05T00:00:00.000Z") },
        db,
      );

      expect(decision).toMatchObject({
        status: "active",
        pass: { id: "pass_tie_b", userId: "user_effective" },
      });
    });
  });

  test("computes expiry at the boundary without waiting for cron status updates", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_boundary");
      await insertPass(db, {
        id: "pass_boundary",
        userId: "user_boundary",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-14T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      });

      await expect(
        getEffectiveTripPass(
          { userId: "user_boundary", now: new Date("2026-07-13T23:59:59.999Z") },
          db,
        ),
      ).resolves.toMatchObject({ status: "active", pass: { id: "pass_boundary" } });
      await expect(
        getEffectiveTripPass(
          { userId: "user_boundary", now: new Date("2026-07-14T00:00:00.000Z") },
          db,
        ),
      ).resolves.toMatchObject({ status: "expired", pass: { id: "pass_boundary" } });
    });
  });

  test("keeps revoked access distinct from expired and never leaks across owners", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_revoked");
      await insertUser(db, "user_empty");
      await insertPass(db, {
        id: "pass_refunded",
        userId: "user_revoked",
        status: "refunded",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-20T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      });

      await expect(
        getEffectiveTripPass(
          { userId: "user_revoked", now: new Date("2026-07-05T00:00:00.000Z") },
          db,
        ),
      ).resolves.toMatchObject({ status: "revoked", pass: { id: "pass_refunded" } });
      await expect(
        getEffectiveTripPass(
          { userId: "user_empty", now: new Date("2026-07-05T00:00:00.000Z") },
          db,
        ),
      ).resolves.toEqual({ status: "none", pass: null, meters: [] });
    });
  });
});

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(createPgliteQueryClient(db));
  } finally {
    await db.close();
  }
}

function createPgliteQueryClient(db: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback(client);
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };

  return client;
}

async function insertUser(db: DatabaseQueryClient, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function insertTripPassOrder(
  db: DatabaseQueryClient,
  input: { id: string; userId: string; email: string },
) {
  await db.query(
    `
      insert into trip_pass_orders (
        id,
        user_id,
        email,
        status,
        product_code,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_payment_intent_id
      )
      values ($1, $2, $3, 'paid', 'siargao_trip_pass_14d_v1', 1, $4, 900, 'usd', $5, $6, $7)
    `,
    [
      input.id,
      input.userId,
      input.email,
      "price_trip_pass",
      `checkout_${input.id}`,
      `cs_${input.id}`,
      `pi_${input.id}`,
    ],
  );
}

async function insertPass(
  db: DatabaseQueryClient,
  input: {
    id: string;
    userId: string;
    status?: "active" | "expired" | "cancelled" | "refunded";
    startsAt: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.query(
    `
      insert into trip_passes (
        id,
        user_id,
        status,
        starts_at,
        expires_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $6)
    `,
    [
      input.id,
      input.userId,
      input.status ?? "active",
      input.startsAt,
      input.expiresAt,
      input.createdAt,
    ],
  );
}

async function expectCounts(
  db: DatabaseQueryClient,
  expected: { passes: string; grants: string; meters: string },
) {
  const passes = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_passes",
  );
  const grants = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_grants",
  );
  const meters = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_usage_meters",
  );

  expect(passes.rows[0]?.count).toBe(expected.passes);
  expect(grants.rows[0]?.count).toBe(expected.grants);
  expect(meters.rows[0]?.count).toBe(expected.meters);
}
