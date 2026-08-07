import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import {
  type AuthoritativeDisputeFact,
  type AuthoritativeRefundFact,
  applyAuthoritativeDisputeFact,
  applyAuthoritativeRefundFact,
} from "@/server/trip-pass/payment-lifecycle";

const activationTime = new Date("2026-08-08T00:00:00.000Z");
const expiry = new Date("2026-08-22T00:00:00.000Z");

describe("Trip Pass payment lifecycle", () => {
  test("counts only successful cumulative refunds and leaves review access/meters unchanged", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "partial");

      await expect(
        applyAuthoritativeRefundFact(refundFact("partial_pending", "partial", "pending", 0), db),
      ).resolves.toMatchObject({ status: "applied", action: "refund_review" });
      await expectLifecycle(db, "partial", {
        orderStatus: "paid",
        passStatus: "active",
        refundState: "review",
        refundedMinor: 0,
        meterUsed: 17,
      });

      await applyAuthoritativeRefundFact(refundFact("partial_pending", "partial", "failed", 0), db);
      await expectLifecycle(db, "partial", {
        orderStatus: "paid",
        passStatus: "active",
        refundState: "none",
        refundedMinor: 0,
        meterUsed: 17,
      });

      await applyAuthoritativeRefundFact(
        refundFact("partial_canceled", "partial", "canceled", 0),
        db,
      );
      await expectLifecycle(db, "partial", {
        orderStatus: "paid",
        passStatus: "active",
        refundState: "none",
        refundedMinor: 0,
        meterUsed: 17,
      });

      await applyAuthoritativeRefundFact(
        refundFact("partial_success_1", "partial", "succeeded", 10_000),
        db,
      );
      await applyAuthoritativeRefundFact(
        refundFact("partial_success_2", "partial", "succeeded", 30_000),
        db,
      );
      await expectLifecycle(db, "partial", {
        orderStatus: "paid",
        passStatus: "active",
        refundState: "review",
        refundedMinor: 30_000,
        meterUsed: 17,
      });
    });
  });

  test("full refund invalidates open reservations before terminal revocation and never restores", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "full");
      await installReservationFixture(db, "full");

      await expect(
        applyAuthoritativeRefundFact(refundFact("full_success", "full", "succeeded", 49_900), db),
      ).resolves.toMatchObject({
        status: "applied",
        action: "refunded",
        invalidatedReservations: 1,
      });
      await expectLifecycle(db, "full", {
        orderStatus: "refunded",
        passStatus: "refunded",
        refundState: "full",
        refundedMinor: 49_900,
        meterUsed: 17,
      });
      await expectReservationInvalidated(db, "full", "full_refund");

      await applyAuthoritativeDisputeFact(disputeFact("late_win", "full", "won"), db);
      await expectLifecycle(db, "full", {
        orderStatus: "refunded",
        passStatus: "refunded",
        refundState: "full",
        disputeState: "won",
        refundedMinor: 49_900,
        meterUsed: 17,
      });
    });
  });

  test("open disputes suspend, overlapping wins restore only after the last open dispute", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "overlap");

      await applyAuthoritativeDisputeFact(disputeFact("one", "overlap", "open"), db);
      await applyAuthoritativeDisputeFact(disputeFact("two", "overlap", "open"), db);
      await expectLifecycle(db, "overlap", {
        orderStatus: "disputed",
        passStatus: "suspended",
        disputeState: "open",
        meterUsed: 17,
      });

      await applyAuthoritativeDisputeFact(disputeFact("one", "overlap", "won"), db);
      await expectLifecycle(db, "overlap", {
        orderStatus: "disputed",
        passStatus: "suspended",
        disputeState: "open",
        meterUsed: 17,
      });

      await applyAuthoritativeDisputeFact(disputeFact("two", "overlap", "won"), db);
      await expectLifecycle(db, "overlap", {
        orderStatus: "paid",
        passStatus: "active",
        disputeState: "won",
        meterUsed: 17,
      });
      const pass = await db.query<{ expires_at: Date | string }>(
        "select expires_at from trip_passes where id = 'pass_overlap'",
      );
      expect(new Date(pass.rows[0]?.expires_at ?? 0)).toEqual(expiry);
    });
  });

  test("lost dispute is terminal, invalidates reservations, and reversed delivery cannot restore", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "lost");
      await installReservationFixture(db, "lost");

      await applyAuthoritativeDisputeFact(disputeFact("terminal", "lost", "lost"), db);
      await expectLifecycle(db, "lost", {
        orderStatus: "disputed",
        passStatus: "cancelled",
        disputeState: "lost",
        meterUsed: 17,
      });
      await expectReservationInvalidated(db, "lost", "dispute_lost");

      await applyAuthoritativeDisputeFact(disputeFact("terminal", "lost", "won"), db);
      await expectLifecycle(db, "lost", {
        orderStatus: "disputed",
        passStatus: "cancelled",
        disputeState: "lost",
        meterUsed: 17,
      });
    });
  });

  test("a dispute win after original expiry remains expired", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "expired_win");
      await applyAuthoritativeDisputeFact(disputeFact("expired", "expired_win", "open"), db);
      await db.query(
        `update trip_passes
         set starts_at = transaction_timestamp() - interval '2 seconds',
             expires_at = transaction_timestamp() - interval '1 second'
         where id = 'pass_expired_win'`,
      );

      await applyAuthoritativeDisputeFact(disputeFact("expired", "expired_win", "won"), db);
      await expectLifecycle(db, "expired_win", {
        orderStatus: "paid",
        passStatus: "expired",
        disputeState: "won",
        meterUsed: 17,
      });
    });
  });

  test("rolls back lifecycle evidence, invalidation, and revocation together", async () => {
    await withTestDb(async (db) => {
      await insertActiveLifecycle(db, "rollback");
      await installReservationFixture(db, "rollback");
      const failing = failAfterQuery(db, /update trip_pass_orders set status/i);

      await expect(
        applyAuthoritativeRefundFact(
          refundFact("rollback_full", "rollback", "succeeded", 49_900),
          failing,
        ),
      ).rejects.toThrow("forced lifecycle rollback");
      await expectLifecycle(db, "rollback", {
        orderStatus: "paid",
        passStatus: "active",
        refundState: "none",
        refundedMinor: 0,
        meterUsed: 17,
      });
      const facts = await db.query<{ count: string }>(
        "select count(*)::text as count from trip_pass_refund_facts where order_id = 'order_rollback'",
      );
      expect(facts.rows[0]?.count).toBe("0");
      const reservation = await db.query<{ status: string }>(
        "select status from paid_answer_reservations where trip_pass_id = 'pass_rollback'",
      );
      expect(reservation.rows[0]?.status).toBe("open");
    });
  });
});

function refundFact(
  id: string,
  suffix: string,
  status: AuthoritativeRefundFact["providerStatus"],
  successfulAmountMinor: number,
): AuthoritativeRefundFact {
  return {
    stripeRefundId: `re_${id}`,
    stripeChargeId: `ch_${suffix}`,
    stripeEventId: `evt_${id}_${status}`,
    paymentIntentId: `pi_${suffix}`,
    providerStatus: status,
    amountMinor: status === "succeeded" ? Math.max(successfulAmountMinor, 1) : 10_000,
    successfulAmountMinor,
    providerCreatedAt: activationTime,
  };
}

function disputeFact(
  id: string,
  suffix: string,
  status: AuthoritativeDisputeFact["applicationStatus"],
): AuthoritativeDisputeFact {
  return {
    stripeDisputeId: `du_${id}`,
    stripeChargeId: `ch_${suffix}`,
    stripeEventId: `evt_${id}_${status}`,
    paymentIntentId: `pi_${suffix}`,
    providerStatus: status === "open" ? "under_review" : status,
    applicationStatus: status,
    amountMinor: 49_900,
    providerCreatedAt: activationTime,
  };
}

async function insertActiveLifecycle(db: DatabaseQueryClient, suffix: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    `user_${suffix}`,
    `${suffix}@example.com`,
  ]);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, captured_amount_minor, currency,
       checkout_idempotency_key, stripe_payment_intent_id, metadata_json,
       completed_at, created_at, updated_at
     ) values ($1, $2, 'paid', 'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2,
       'price_trip_pass', 49900, 49900, 'usd', $3, $4, '{}'::jsonb, $5, $5, $5)`,
    [`order_${suffix}`, `user_${suffix}`, `checkout_${suffix}`, `pi_${suffix}`, activationTime],
  );
  await db.query(
    `insert into trip_passes (
       id, user_id, status, stripe_payment_intent_id, starts_at, expires_at, created_at, updated_at
     ) values ($1, $2, 'active', $3, $4, $5, $4, $4)`,
    [`pass_${suffix}`, `user_${suffix}`, `pi_${suffix}`, activationTime, expiry],
  );
  await db.query(
    `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at)
     values ($1, $2, 'chat_message', 17, 150, $3, $4)`,
    [`meter_${suffix}`, `pass_${suffix}`, expiry, activationTime],
  );
}

async function installReservationFixture(db: DatabaseQueryClient, suffix: string) {
  await db.query(
    `insert into paid_answer_reservations (
       id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, lease_expires_at,
       details_purge_at, reserved_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $11)`,
    [
      `reservation_${suffix}`,
      `pass_${suffix}`,
      `meter_${suffix}`,
      `user_${suffix}`,
      `idempotency_${suffix}`,
      `body_${suffix}`,
      `request_${suffix}`,
      `lease_${suffix}`,
      new Date(activationTime.getTime() + 10 * 60_000),
      new Date(activationTime.getTime() + 30 * 24 * 60 * 60_000),
      activationTime,
    ],
  );
}

async function expectReservationInvalidated(
  db: DatabaseQueryClient,
  suffix: string,
  reason: string,
) {
  const result = await db.query<{
    status: string;
    invalidation_reason: string | null;
    invalidated_at: Date | string | null;
  }>(
    `select status, invalidation_reason, invalidated_at from paid_answer_reservations
     where trip_pass_id = $1`,
    [`pass_${suffix}`],
  );
  expect(result.rows[0]).toMatchObject({ status: "invalidated", invalidation_reason: reason });
  expect(result.rows[0]?.invalidated_at).toBeTruthy();
}

async function expectLifecycle(
  db: DatabaseQueryClient,
  suffix: string,
  expected: {
    orderStatus: string;
    passStatus: string;
    refundState?: string;
    disputeState?: string;
    refundedMinor?: number;
    meterUsed: number;
  },
) {
  const result = await db.query<{
    order_status: string;
    pass_status: string;
    refund_state: string;
    dispute_state: string;
    successful_refund_amount_minor: number;
    used: number;
  }>(
    `select o.status as order_status, p.status as pass_status, o.refund_state,
       o.dispute_state, o.successful_refund_amount_minor, m.used
     from trip_pass_orders o
     join trip_passes p on p.stripe_payment_intent_id = o.stripe_payment_intent_id
     join trip_usage_meters m on m.trip_pass_id = p.id and m.meter_type = 'chat_message'
     where o.id = $1`,
    [`order_${suffix}`],
  );
  expect(result.rows[0]).toMatchObject({
    order_status: expected.orderStatus,
    pass_status: expected.passStatus,
    refund_state: expected.refundState ?? "none",
    dispute_state: expected.disputeState ?? "none",
    successful_refund_amount_minor: expected.refundedMinor ?? 0,
    used: expected.meterUsed,
  });
}

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const database = await openTestDatabase();
  try {
    await runInitialMigration(database);
    await work(createPgliteQueryClient(database));
  } finally {
    await database.close();
  }
}

function createPgliteQueryClient(database: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    query: (query, params = []) => database.query(query, params),
    async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
      await database.exec("begin");
      try {
        const result = await callback({ ...client, inTransaction: true });
        await database.exec("commit");
        return result;
      } catch (error) {
        await database.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}

function failAfterQuery(db: DatabaseQueryClient, pattern: RegExp): DatabaseQueryClient {
  let failed = false;
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const result = await db.query<T>(query, params);
      if (!failed && pattern.test(query)) {
        failed = true;
        throw new Error("forced lifecycle rollback");
      }
      return result;
    },
    async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
      if (!db.transaction) throw new Error("transaction support required");
      return db.transaction((transaction) =>
        callback({ ...failAfterQuery(transaction, pattern), inTransaction: true }),
      );
    },
  };
}
