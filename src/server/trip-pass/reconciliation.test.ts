import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import { buildAuditDiagnostics } from "@/server/admin/diagnostics";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";
import {
  buildTripPassReconciliationSnapshot,
  lookupTripPassSupportReference,
  reconcileTripPassState,
} from "@/server/trip-pass/reconciliation";

const now = new Date("2026-07-14T08:00:00.000Z");
const env = {
  DEEPSEEK_DAILY_USD_LIMIT: "10",
  GLOBAL_MODEL_DAILY_USD_LIMIT: "15",
  NEXT_PUBLIC_POSTHOG_KEY: "ph_project",
  REDIS_URL: "redis://localhost:6379",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
  TRIP_PASS_CHECKOUT_ENABLED: "true",
};

describe("Trip Pass reconciliation", () => {
  test("plans paid-without-pass and stale-reservation repairs without mutating dry-runs", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_paid_without_pass", "user_paid_without_pass");
      await insertPassWithStaleReservation(db, "trip_pass_stale", "user_stale");

      const snapshot = await buildTripPassReconciliationSnapshot({ db, env, now });

      expect(snapshot.mode).toBe("dry_run");
      expect(snapshot.issues.map((issue) => issue.code)).toContain("paid_without_pass");
      expect(snapshot.issues.map((issue) => issue.code)).toContain("stale_usage_reservation");
      expect(snapshot.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "grant_missing_trip_pass",
            localRef: "order_paid_without_pass",
            status: "planned",
          }),
          expect.objectContaining({
            action: "release_stale_reservation",
            localRef: "usage_event_stale",
            status: "planned",
          }),
        ]),
      );
      await expectCounts(db, { grants: "0", passes: "1" });
      await expectUsageEventType(db, "usage_event_stale", "reserved");
    });
  });

  test("applies idempotent safe repairs and does not duplicate grants on repeat", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_repair", "user_repair");
      await insertPassWithStaleReservation(db, "trip_pass_repair_stale", "user_repair_stale");

      const first = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
      });
      const second = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
      });

      expect(first.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "grant_missing_trip_pass",
            localRef: "order_repair",
            status: "applied",
          }),
          expect.objectContaining({
            action: "release_stale_reservation",
            localRef: "usage_event_stale",
            status: "applied",
          }),
        ]),
      );
      expect(second.actions).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "grant_missing_trip_pass", localRef: "order_repair" }),
        ]),
      );
      await expectCounts(db, { grants: "1", passes: "2" });
      await expectUsageEventType(db, "usage_event_stale", "released");
    });
  });

  test("does not persist legacy paid order email during missing-pass repair", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_repair_email", "user_repair_email");

      const repaired = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
      });

      expect(repaired.actions).toContainEqual(
        expect.objectContaining({
          action: "grant_missing_trip_pass",
          localRef: "order_repair_email",
          status: "applied",
        }),
      );
      const pass = await db.query<{ email: string | null }>(
        `
          select p.email
          from trip_passes p
          join trip_pass_grants g on g.trip_pass_id = p.id
          where g.order_id = $1
          limit 1
        `,
        ["order_repair_email"],
      );
      expect(pass.rows[0]?.email).toBeNull();
    });
  });

  test("reconciles legacy version 1 meters from the recorded grant contract", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_legacy", "user_legacy", "legacy");
      await reconcileTripPassState({ confirmMutation: true, db, env, mode: "repair", now });
      const grants = await db.query<{ trip_pass_id: string }>(
        "select trip_pass_id from trip_pass_grants where order_id = $1",
        ["order_legacy"],
      );
      const passId = grants.rows[0]?.trip_pass_id;
      expect(passId).toBeDefined();
      await db.query(
        "delete from trip_usage_meters where trip_pass_id = $1 and meter_type = 'route_lookup'",
        [passId],
      );

      const snapshot = await buildTripPassReconciliationSnapshot({ db, env, now });
      expect(snapshot.issues).toContainEqual(
        expect.objectContaining({
          code: "missing_usage_meters",
          localRef: passId,
          details: expect.objectContaining({ meterCount: 4, expectedMeters: 5 }),
        }),
      );

      const repaired = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
      });
      expect(repaired.actions).toContainEqual(
        expect.objectContaining({
          action: "initialize_missing_meters",
          localRef: passId,
          status: "applied",
        }),
      );
      const meters = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_usage_meters where trip_pass_id = $1",
        [passId],
      );
      expect(meters.rows[0]?.count).toBe("5");
    });
  });

  test("protects support lookup across users and flags ambiguous mixed references", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_owner", "user_owner");
      await insertUser(db, "user_intruder");
      await createActiveTripPassWithMeters(
        {
          expiresAt: new Date("2026-07-28T08:00:00.000Z"),
          id: "trip_pass_other",
          startsAt: now,
          userId: "user_intruder",
        },
        db,
      );

      await expect(
        lookupTripPassSupportReference({ orderId: "order_owner", userId: "user_intruder" }, { db }),
      ).resolves.toEqual({ status: "forbidden", reason: "cross_user_reference" });
      await expect(
        lookupTripPassSupportReference(
          { orderId: "order_owner", passId: "trip_pass_other" },
          { db },
        ),
      ).resolves.toEqual({
        status: "ambiguous",
        reason: "references_do_not_match_same_trip_pass_account",
      });
    });
  });

  test("returns safe support summaries without payment secrets or email addresses", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_lookup", "user_lookup");
      await reconcileTripPassState({ confirmMutation: true, db, env, mode: "repair", now });

      const lookup = await lookupTripPassSupportReference(
        { orderId: "order_lookup", userId: "user_lookup" },
        { db },
      );
      const serialized = JSON.stringify(lookup);

      expect(lookup.status).toBe("found");
      expect(serialized).toContain("order_lookup");
      expect(serialized).toContain("chat_message");
      expect(serialized).not.toContain("user_lookup@example.com");
      expect(serialized).not.toContain("cs_order_lookup");
      expect(serialized).not.toContain("pi_order_lookup");
    });
  });

  test("admin diagnostics redact Trip Pass reconciliation fields before rendering", () => {
    const snapshot = buildAuditDiagnostics({
      accommodationMatches: [],
      audits: [],
      completenessChecks: [],
      facts: [],
      jobs: [],
      llmRuns: [],
      now,
      providerErrors: [],
      reviewerResults: [],
      sourceProfiles: [],
      toolCalls: [],
      tripPassReconciliation: {
        actions: [],
        generatedAt: now.toISOString(),
        infrastructure: {
          analyticsSink: "available",
          costCircuits: {
            deepseek: "configured",
            global: "configured",
            openai: "unconfigured",
          },
          priceCatalog: {
            productCode: tripPassProductCode,
            productVersion: tripPassProductVersion,
            stripePriceConfigured: true,
          },
          sharedQuotaStore: "available",
        },
        issues: [
          {
            code: "paid_without_pass",
            localRef: "cs_test_should_not_render",
            reason: "sent to traveler@example.com with pi_test_should_not_render",
            repairable: true,
            severity: "repairable",
          },
        ],
        mode: "dry_run",
        scope: {},
        thresholds: {
          staleOrderMinutes: 30,
          staleReservationMinutes: 10,
        },
      },
    });
    const serialized = JSON.stringify(snapshot.tripPassReconciliation);

    expect(serialized).not.toContain("traveler@example.com");
    expect(serialized).not.toContain("cs_test");
    expect(serialized).not.toContain("pi_test");
    expect(serialized).toContain("[redacted");
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
  await db.query("insert into users (id, email) values ($1, $2) on conflict do nothing", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function insertPaidOrder(
  db: DatabaseQueryClient,
  orderId: string,
  userId: string,
  contract: "current" | "legacy" = "current",
) {
  const product =
    contract === "legacy"
      ? { code: "siargao_trip_pass_14d_v1", version: 1, amount: 49_900, currency: "php" }
      : {
          code: tripPassProductCode,
          version: tripPassProductVersion,
          amount: 999,
          currency: "usd",
        };
  await insertUser(db, userId);
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
        stripe_payment_intent_id,
        metadata_json,
        created_at,
        updated_at,
        completed_at
      )
      values ($1, $2, $3, 'paid', $8, $9, 'price_trip_pass',
        $10, $11, $4, $5, $6, '{}'::jsonb, $7, $7, $7)
    `,
    [
      orderId,
      userId,
      `${userId}@example.com`,
      `trip_pass_checkout:${orderId}`,
      `cs_${orderId}`,
      `pi_${orderId}`,
      now,
      product.code,
      product.version,
      product.amount,
      product.currency,
    ],
  );
}

async function insertPassWithStaleReservation(
  db: DatabaseQueryClient,
  tripPassId: string,
  userId: string,
) {
  await insertUser(db, userId);
  await createActiveTripPassWithMeters(
    {
      expiresAt: new Date("2026-07-28T08:00:00.000Z"),
      id: tripPassId,
      startsAt: now,
      userId,
    },
    db,
  );
  await db.query(
    `
      insert into trip_usage_events (
        id,
        trip_pass_id,
        usage_meter_id,
        user_id,
        event_type,
        meter_type,
        quantity,
        idempotency_key,
        request_id,
        request_hash,
        provider_request_ids_json,
        occurred_at,
        created_at
      )
      select $1, $2, id, $3, 'reserved', 'chat_message', 1, $4, $5, $6, '[]'::jsonb, $7, $7
      from trip_usage_meters
      where trip_pass_id = $2 and meter_type = 'chat_message'
      limit 1
    `,
    [
      "usage_event_stale",
      tripPassId,
      userId,
      `idem:${tripPassId}`,
      `request:${tripPassId}`,
      `hash:${tripPassId}`,
      new Date(now.getTime() - 60 * 60 * 1000),
    ],
  );
}

async function expectCounts(db: DatabaseQueryClient, expected: { grants: string; passes: string }) {
  const grants = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_grants",
  );
  const passes = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_passes",
  );

  expect(grants.rows[0]?.count).toBe(expected.grants);
  expect(passes.rows[0]?.count).toBe(expected.passes);
}

async function expectUsageEventType(
  db: DatabaseQueryClient,
  eventId: string,
  eventType: "released" | "reserved",
) {
  const result = await db.query<{ event_type: string }>(
    "select event_type from trip_usage_events where id = $1",
    [eventId],
  );

  expect(result.rows[0]?.event_type).toBe(eventType);
}
