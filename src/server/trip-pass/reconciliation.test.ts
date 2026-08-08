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
import { grantTripPass } from "@/server/trip-pass/entitlement";
import { purgeExpiredPaidAnswerDetails } from "@/server/trip-pass/paid-answer-reservations";
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
  TRIP_PASS_CHECKOUT_MODE: "on",
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

  test("cannot mutate through historical repair flags", async () => {
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

      for (const snapshot of [first, second]) {
        expect(snapshot.mode).toBe("dry_run");
        expect(snapshot.actions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ localRef: "order_repair", status: "planned" }),
            expect.objectContaining({ localRef: "usage_event_stale", status: "planned" }),
          ]),
        );
      }
      await expectCounts(db, { grants: "0", passes: "1" });
      await expectUsageEventType(db, "usage_event_stale", "reserved");
    });
  });

  test("does not persist legacy paid order email while detect-only", async () => {
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
        expect.objectContaining({ localRef: "order_repair_email", status: "planned" }),
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
      expect(pass.rows).toEqual([]);
    });
  });

  test("reconciles legacy version 1 meters from the recorded grant contract", async () => {
    await withTestDb(async (db) => {
      await insertPaidOrder(db, "order_legacy", "user_legacy", "legacy");
      await grantOrderForTest(db, "order_legacy", "user_legacy");
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
          status: "planned",
        }),
      );
      const meters = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_usage_meters where trip_pass_id = $1",
        [passId],
      );
      expect(meters.rows[0]?.count).toBe("4");
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
      await grantOrderForTest(db, "order_lookup", "user_lookup");

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

  test("accepts only an exactly linked, policy-purged paid-answer aggregate", async () => {
    await withTestDb(async (db) => {
      await insertSettledPaidAnswerWithoutProviderIds(db, "purged_clean");

      const before = await buildTripPassReconciliationSnapshot({
        db,
        env,
        now,
        scope: { passId: "trip_pass_purged_clean" },
      });
      expect(missingProviderIssues(before)).toEqual(["trip_usage_event_reservation_purged_clean"]);

      await expirePaidAnswerDetails(db, "reservation_purged_clean");
      await expect(purgeExpiredPaidAnswerDetails(db)).resolves.toBe(1);

      const dryRun = await buildTripPassReconciliationSnapshot({
        db,
        env,
        now,
        scope: { passId: "trip_pass_purged_clean" },
      });
      const repair = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
        scope: { passId: "trip_pass_purged_clean" },
      });
      expect(missingProviderIssues(dryRun)).toEqual([]);
      expect(missingProviderIssues(repair)).toEqual([]);
      expect(repair.actions).toEqual([]);
      await expectMeterAggregate(db, "trip_pass_purged_clean", 1, 1);
    });
  });

  test("keeps warning after purge rollback and for mismatched paid-answer identity", async () => {
    await withTestDb(async (db) => {
      await insertSettledPaidAnswerWithoutProviderIds(db, "purged_adversarial");
      await expirePaidAnswerDetails(db, "reservation_purged_adversarial");
      await db.query(`
        create function fail_reconciliation_event_purge() returns trigger language plpgsql as $$
        begin raise exception 'forced reconciliation purge failure'; end $$
      `);
      await db.query(`
        create trigger fail_reconciliation_event_purge
          before update of request_id on trip_usage_events
          for each row execute function fail_reconciliation_event_purge()
      `);

      await expect(purgeExpiredPaidAnswerDetails(db)).rejects.toThrow(
        "forced reconciliation purge failure",
      );
      const rolledBack = await buildTripPassReconciliationSnapshot({
        db,
        env,
        now,
        scope: { passId: "trip_pass_purged_adversarial" },
      });
      expect(missingProviderIssues(rolledBack)).toEqual([
        "trip_usage_event_reservation_purged_adversarial",
      ]);

      await db.query("drop trigger fail_reconciliation_event_purge on trip_usage_events");
      await db.query("drop function fail_reconciliation_event_purge()");
      await db.query(
        `update paid_answer_reservations set purge_retry_at = clock_timestamp() - interval '1 second'`,
      );
      await expect(purgeExpiredPaidAnswerDetails(db)).resolves.toBe(1);
      await db.query(`update trip_usage_events set idempotency_key = $2 where id = $1`, [
        "trip_usage_event_reservation_purged_adversarial",
        "paid-answer:unrelated_reservation",
      ]);

      const mismatchedDryRun = await buildTripPassReconciliationSnapshot({
        db,
        env,
        now,
        scope: { passId: "trip_pass_purged_adversarial" },
      });
      const mismatchedRepair = await reconcileTripPassState({
        confirmMutation: true,
        db,
        env,
        mode: "repair",
        now,
        scope: { passId: "trip_pass_purged_adversarial" },
      });
      expect(missingProviderIssues(mismatchedDryRun)).toEqual([]);
      expect(paidAnswerIntegrityIssues(mismatchedDryRun)).toEqual([
        "reservation_purged_adversarial",
      ]);
      expect(missingProviderIssues(mismatchedRepair)).toEqual([]);
      expect(paidAnswerIntegrityIssues(mismatchedRepair)).toEqual([
        "reservation_purged_adversarial",
      ]);
      await expectMeterAggregate(db, "trip_pass_purged_adversarial", 1, 1);
    });
  });

  test("audits every settled paid answer without an exact usage event in dry-run and repair", async () => {
    await withTestDb(async (db) => {
      for (const suffix of [
        "integrity_valid",
        "integrity_purged",
        "integrity_missing",
        "integrity_mismatch",
        "integrity_conflict",
      ]) {
        await insertSettledPaidAnswerWithoutProviderIds(db, suffix);
      }
      await db.query(
        `update trip_usage_events set provider_request_ids_json = '["provider-valid"]'::jsonb
         where id = $1`,
        ["trip_usage_event_reservation_integrity_valid"],
      );
      await expirePaidAnswerDetails(db, "reservation_integrity_purged");
      await expect(purgeExpiredPaidAnswerDetails(db)).resolves.toBe(1);
      await db.query(`delete from trip_usage_events where id = $1`, [
        "trip_usage_event_reservation_integrity_missing",
      ]);
      await db.query(`update trip_usage_events set idempotency_key = $2 where id = $1`, [
        "trip_usage_event_reservation_integrity_mismatch",
        "paid-answer:unrelated_integrity_reservation",
      ]);
      await db.query(`delete from trip_usage_events where id = $1`, [
        "trip_usage_event_reservation_integrity_conflict",
      ]);
      await db.query(
        `insert into trip_usage_events (
           id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
           idempotency_key, request_id, request_hash, provider_request_ids_json,
           occurred_at, created_at
         ) select $1, trip_pass_id, usage_meter_id, account_id, 'settled', 'chat_message', 1,
           $2, request_id, request_body_hash, '[]'::jsonb, finalized_at, finalized_at
         from paid_answer_reservations where id = $3`,
        [
          "unrelated_usage_event_integrity_conflict",
          "paid-answer:reservation_integrity_conflict",
          "reservation_integrity_conflict",
        ],
      );

      for (const mode of ["dry_run", "repair"] as const) {
        const snapshot = await reconcileTripPassState({
          confirmMutation: mode === "repair",
          db,
          env,
          mode,
          now,
        });
        expect(paidAnswerIntegrityIssues(snapshot)).toEqual([
          "reservation_integrity_conflict",
          "reservation_integrity_mismatch",
          "reservation_integrity_missing",
        ]);
        expect(missingProviderIssues(snapshot)).not.toContain(
          "trip_usage_event_reservation_integrity_mismatch",
        );
        expect(missingProviderIssues(snapshot)).not.toContain(
          "unrelated_usage_event_integrity_conflict",
        );
        expect(snapshot.actions).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ localRef: "reservation_integrity_missing" }),
          ]),
        );
      }

      await db.query(
        `insert into trip_usage_events (
           id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
           idempotency_key, request_id, request_hash, provider_request_ids_json,
           occurred_at, created_at
         ) select $1, trip_pass_id, usage_meter_id, account_id, 'settled', 'chat_message', 1,
           $2, request_id, request_body_hash, '["provider-repaired"]'::jsonb,
           finalized_at, finalized_at
         from paid_answer_reservations where id = $3`,
        [
          "trip_usage_event_reservation_integrity_missing",
          "paid-answer:reservation_integrity_missing",
          "reservation_integrity_missing",
        ],
      );
      const afterAuditedRepair = await buildTripPassReconciliationSnapshot({ db, env, now });
      expect(paidAnswerIntegrityIssues(afterAuditedRepair)).toEqual([
        "reservation_integrity_conflict",
        "reservation_integrity_mismatch",
      ]);
    });
  });

  test("keyset-pages every settled paid answer and usage event without an audit blind spot", async () => {
    await withTestDb(async (db) => {
      await insertSettledPaidAnswerWithoutProviderIds(db, "pagination_seed");
      await db.query(
        `update trip_usage_events
         set provider_request_ids_json = '["provider-pagination"]'::jsonb
         where id = 'trip_usage_event_reservation_pagination_seed'`,
      );
      await db.query(
        `insert into paid_answer_reservations (
           id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
           request_body_hash, request_id, lease_token, status, provider_request_ids_json,
           lease_expires_at, details_purge_at, reserved_at, finalized_at, updated_at
         )
         select 'reservation_page_' || lpad(page::text, 4, '0'), trip_pass_id,
           usage_meter_id, account_id, 'key_page_' || page, 'body_page_' || page,
           'request_page_' || page, 'lease_page_' || page, 'settled',
           '["provider-pagination"]'::jsonb, lease_expires_at, details_purge_at,
           reserved_at, finalized_at, updated_at
         from paid_answer_reservations cross join generate_series(0, 501) page
         where id = 'reservation_pagination_seed'`,
      );
      await db.query(
        `insert into trip_usage_events (
           id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
           idempotency_key, request_id, request_hash, provider_request_ids_json,
           occurred_at, created_at
         )
         select 'trip_usage_event_' || id, trip_pass_id, usage_meter_id, account_id,
           'settled', 'chat_message', 1, 'paid-answer:' || id, request_id,
           request_body_hash, '["provider-pagination"]'::jsonb, finalized_at, finalized_at
         from paid_answer_reservations
         where id like 'reservation_page_%'
           and id not in ('reservation_page_0000', 'reservation_page_0499')`,
      );
      await db.query(
        `update paid_answer_reservations
         set request_body_hash = 'purged:' || id, request_id = 'purged:' || id,
           idempotency_key_hash = 'purged:' || id, provider_request_ids_json = '[]'::jsonb,
           details_purged_at = clock_timestamp()
         where id = 'reservation_page_0501'`,
      );
      await db.query(
        `update trip_usage_events
         set request_id = null, request_hash = null, provider_request_ids_json = '[]'::jsonb
         where id = 'trip_usage_event_reservation_page_0501'`,
      );

      for (const mode of ["dry_run", "repair"] as const) {
        const snapshot = await reconcileTripPassState({
          confirmMutation: mode === "repair",
          db,
          env,
          mode,
          now,
          scope: { passId: "trip_pass_pagination_seed" },
        });
        expect(paidAnswerIntegrityIssues(snapshot)).toEqual([
          "reservation_page_0000",
          "reservation_page_0499",
        ]);
        expect(missingProviderIssues(snapshot)).toEqual([]);
      }
    });
  });
});

function missingProviderIssues(snapshot: Awaited<ReturnType<typeof reconcileTripPassState>>) {
  return snapshot.issues
    .filter((issue) => issue.code === "provider_usage_missing_request_id")
    .map((issue) => issue.localRef);
}

function paidAnswerIntegrityIssues(snapshot: Awaited<ReturnType<typeof reconcileTripPassState>>) {
  return snapshot.issues
    .filter((issue) => issue.code === "paid_answer_usage_event_missing")
    .map((issue) => issue.localRef)
    .sort();
}

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

async function grantOrderForTest(db: DatabaseQueryClient, orderId: string, userId: string) {
  await grantTripPass(
    {
      now,
      orderId,
      sourceEventId: `test-grant:${orderId}`,
      sourceType: "manual_operator",
      userId,
    },
    db,
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

async function insertSettledPaidAnswerWithoutProviderIds(db: DatabaseQueryClient, suffix: string) {
  const userId = `user_${suffix}`;
  const tripPassId = `trip_pass_${suffix}`;
  const meterId = `meter_${suffix}`;
  const reservationId = `reservation_${suffix}`;
  await insertUser(db, userId);
  await createActiveTripPassWithMeters(
    {
      expiresAt: new Date("2026-08-28T08:00:00.000Z"),
      id: tripPassId,
      startsAt: new Date("2026-07-01T08:00:00.000Z"),
      userId,
    },
    db,
  );
  const meter = await db.query<{ id: string }>(
    `select id from trip_usage_meters where trip_pass_id = $1 and meter_type = 'chat_message'`,
    [tripPassId],
  );
  const actualMeterId = meter.rows[0]?.id;
  expect(actualMeterId).toBeDefined();
  await db.query(`update trip_usage_meters set id = $2, used = 1 where id = $1`, [
    actualMeterId,
    meterId,
  ]);
  await db.query(
    `insert into paid_answer_reservations (
       id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, provider_request_ids_json,
       lease_expires_at, details_purge_at, reserved_at, finalized_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'settled', '[]'::jsonb,
       $9, $10, $11, $12, $12)`,
    [
      reservationId,
      tripPassId,
      meterId,
      userId,
      `key_${suffix}`,
      `body_${suffix}`,
      `request_${suffix}`,
      `lease_${suffix}`,
      new Date("2026-07-14T07:10:00.000Z"),
      new Date("2026-09-14T08:00:00.000Z"),
      new Date("2026-07-14T07:00:00.000Z"),
      new Date("2026-07-14T07:30:00.000Z"),
    ],
  );
  await db.query(
    `insert into trip_usage_events (
       id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
       idempotency_key, request_id, request_hash, provider_request_ids_json,
       occurred_at, created_at
     ) values ($1, $2, $3, $4, 'settled', 'chat_message', 1, $5, $6, $7, '[]'::jsonb,
       $8, $8)`,
    [
      `trip_usage_event_${reservationId}`,
      tripPassId,
      meterId,
      userId,
      `paid-answer:${reservationId}`,
      `request_${suffix}`,
      `body_${suffix}`,
      new Date("2026-07-14T07:30:00.000Z"),
    ],
  );
}

async function expirePaidAnswerDetails(db: DatabaseQueryClient, reservationId: string) {
  await db.query(
    `update paid_answer_reservations
     set reserved_at = clock_timestamp() - interval '40 days',
       details_purge_at = clock_timestamp() - interval '1 second'
     where id = $1`,
    [reservationId],
  );
}

async function expectMeterAggregate(
  db: DatabaseQueryClient,
  tripPassId: string,
  expectedUsed: number,
  expectedSettledQuantity: number,
) {
  const result = await db.query<{ settled_quantity: string; used: number }>(
    `select m.used,
       coalesce(sum(e.quantity) filter (where e.event_type = 'settled'), 0)::text
         as settled_quantity
     from trip_usage_meters m
     left join trip_usage_events e on e.usage_meter_id = m.id
     where m.trip_pass_id = $1 and m.meter_type = 'chat_message'
     group by m.used`,
    [tripPassId],
  );
  expect(result.rows[0]).toEqual({
    settled_quantity: String(expectedSettledQuantity),
    used: expectedUsed,
  });
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
