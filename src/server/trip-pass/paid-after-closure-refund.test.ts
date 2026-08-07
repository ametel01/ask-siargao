import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import type { StripeRefundClient } from "@/server/payments/stripe";
import {
  refundRetryDelayMs,
  runPaidAfterClosureRefundBatch,
} from "@/server/trip-pass/paid-after-closure-refund";

describe("Paid After Closure refund worker", () => {
  test("creates one idempotent full refund and completes only after Stripe confirmation", async () => {
    await withTestDb(async (db) => {
      await insertObligation(db, "confirmed");
      const calls: string[] = [];
      const stripe: StripeRefundClient = {
        createFullRefund: async (input) => {
          calls.push(
            `create:${input.paymentIntentId}:${input.amountMinor}:${input.idempotencyKey}`,
          );
          return { id: "re_confirmed", status: "succeeded" };
        },
        retrieveRefund: async (id) => {
          calls.push(`retrieve:${id}`);
          return { id, status: "succeeded" };
        },
      };

      await expect(
        runPaidAfterClosureRefundBatch({
          db,
          stripe,
          createLeaseToken: () => "lease_confirmed",
        }),
      ).resolves.toEqual({ claimed: 1, confirmed: 1, retrying: 0, stale: 0 });
      expect(calls).toEqual(["create:pi_confirmed:49900:paid_after_closure:refund_confirmed"]);
      await expectObligation(db, "confirmed", {
        status: "succeeded",
        stripe_refund_id: "re_confirmed",
        provider_status: "succeeded",
        attempts: 1,
        alerted_at: null,
      });
    });
  });

  test("persists a pending provider refund, retries by retrieval, and keeps page state until confirmation", async () => {
    await withTestDb(async (db) => {
      await insertObligation(db, "pending");
      let status: "pending" | "succeeded" = "pending";
      const calls: string[] = [];
      const stripe: StripeRefundClient = {
        createFullRefund: async (input) => {
          calls.push(`create:${input.idempotencyKey}`);
          return { id: "re_pending", status };
        },
        retrieveRefund: async (id) => {
          calls.push(`retrieve:${id}`);
          return { id, status };
        },
      };

      await runPaidAfterClosureRefundBatch({
        db,
        stripe,
        alertAfterAttempts: 1,
        jitterUnit: 0.5,
        createLeaseToken: () => "lease_pending_1",
      });
      await expectObligation(db, "pending", {
        status: "pending",
        stripe_refund_id: "re_pending",
        provider_status: "pending",
        attempts: 1,
      });
      const alerted = await db.query<{ alerted_at: Date | string | null }>(
        "select alerted_at from account_closure_refund_obligations where id = 'refund_pending'",
      );
      expect(alerted.rows[0]?.alerted_at).toBeTruthy();

      status = "succeeded";
      await db.query(
        "update account_closure_refund_obligations set next_attempt_at = clock_timestamp()",
      );
      await runPaidAfterClosureRefundBatch({
        db,
        stripe,
        alertAfterAttempts: 1,
        createLeaseToken: () => "lease_pending_2",
      });
      expect(calls).toEqual(["create:paid_after_closure:refund_pending", "retrieve:re_pending"]);
      await expectObligation(db, "pending", {
        status: "succeeded",
        stripe_refund_id: "re_pending",
        provider_status: "succeeded",
        attempts: 2,
      });
    });
  });

  test("retries ambiguous creation with the same idempotency key and sanitized errors", async () => {
    await withTestDb(async (db) => {
      await insertObligation(db, "ambiguous");
      const keys: string[] = [];
      const stripe: StripeRefundClient = {
        createFullRefund: async (input) => {
          keys.push(input.idempotencyKey);
          throw new TypeError("sensitive provider detail");
        },
        retrieveRefund: async (id) => ({ id, status: "pending" }),
      };
      await runPaidAfterClosureRefundBatch({
        db,
        stripe,
        createLeaseToken: () => "lease_ambiguous_1",
      });
      await db.query(
        "update account_closure_refund_obligations set next_attempt_at = clock_timestamp()",
      );
      await runPaidAfterClosureRefundBatch({
        db,
        stripe,
        createLeaseToken: () => "lease_ambiguous_2",
      });
      expect(keys).toEqual([
        "paid_after_closure:refund_ambiguous",
        "paid_after_closure:refund_ambiguous",
      ]);
      const row = await db.query<{ last_error_category: string; attempts: number }>(
        `select last_error_category, attempts from account_closure_refund_obligations
         where id = 'refund_ambiguous'`,
      );
      expect(row.rows[0]).toEqual({ last_error_category: "TypeError", attempts: 2 });
    });
  });

  test("an expired stale worker cannot confirm over a replacement lease", async () => {
    await withTestDb(async (db) => {
      await insertObligation(db, "stale");
      const providerStarted = deferred<void>();
      const releaseProvider = deferred<void>();
      const run = runPaidAfterClosureRefundBatch({
        db,
        stripe: {
          createFullRefund: async () => {
            providerStarted.resolve();
            await releaseProvider.promise;
            return { id: "re_stale", status: "succeeded" };
          },
          retrieveRefund: async (id) => ({ id, status: "succeeded" }),
        },
        leaseMs: 60_000,
        createLeaseToken: () => "lease_stale",
      });
      await providerStarted.promise;
      await db.query(
        `update account_closure_refund_obligations
         set lease_token = 'replacement_lease', lease_expires_at = clock_timestamp() + interval '1 minute'
         where id = 'refund_stale'`,
      );
      releaseProvider.resolve();
      await expect(run).resolves.toEqual({ claimed: 1, confirmed: 0, retrying: 0, stale: 1 });
      const row = await db.query<{
        status: string;
        lease_token: string;
        stripe_refund_id: string | null;
      }>(
        `select status, lease_token, stripe_refund_id from account_closure_refund_obligations
         where id = 'refund_stale'`,
      );
      expect(row.rows[0]).toEqual({
        status: "running",
        lease_token: "replacement_lease",
        stripe_refund_id: null,
      });
    });
  });

  test("reclaims a crashed running obligation only after its lease expires", async () => {
    await withTestDb(async (db) => {
      await insertObligation(db, "crashed");
      await db.query(
        `update account_closure_refund_obligations
         set status = 'running', attempts = 1, lease_token = 'crashed_lease',
           lease_expires_at = clock_timestamp() - interval '1 second'
         where id = 'refund_crashed'`,
      );

      await expect(
        runPaidAfterClosureRefundBatch({
          db,
          stripe: {
            createFullRefund: async () => ({ id: "re_recovered", status: "succeeded" }),
            retrieveRefund: async (id) => ({ id, status: "succeeded" }),
          },
          createLeaseToken: () => "recovery_lease",
        }),
      ).resolves.toEqual({ claimed: 1, confirmed: 1, retrying: 0, stale: 0 });
      await expectObligation(db, "crashed", {
        attempts: 2,
        status: "succeeded",
        stripe_refund_id: "re_recovered",
      });
    });
  });

  test("bounds exponential retry delay and deterministic jitter", () => {
    expect(refundRetryDelayMs(1, 0.5)).toBe(60_000);
    expect(refundRetryDelayMs(2, 0)).toBe(90_000);
    expect(refundRetryDelayMs(100, 1)).toBe(24 * 60 * 60_000);
  });
});

async function insertObligation(db: DatabaseQueryClient, suffix: string) {
  await db.query(
    `insert into account_closure_tombstones (
       id, subject_hash, subject_hash_version, subject_type, closure_policy_version,
       closed_at, created_at, updated_at
     ) values ($1, $2, 1, 'clerk_user_id', 'closure-v1', clock_timestamp(),
       clock_timestamp(), clock_timestamp())`,
    [`tombstone_${suffix}`, `hash_${suffix}`],
  );
  await db.query(
    `insert into account_closure_refund_obligations (
       id, tombstone_id, order_id, reason, status, attempts, policy_version,
       stripe_payment_intent_id, expected_amount_minor, created_at, updated_at
     ) values ($1, $2, $3, 'paid_after_closure', 'pending', 0, 'commerce-v1',
       $4, 49900, clock_timestamp(), clock_timestamp())`,
    [`refund_${suffix}`, `tombstone_${suffix}`, `order_${suffix}`, `pi_${suffix}`],
  );
}

async function expectObligation(
  db: DatabaseQueryClient,
  suffix: string,
  expected: Partial<{
    status: string;
    stripe_refund_id: string | null;
    provider_status: string | null;
    attempts: number;
    alerted_at: Date | string | null;
  }>,
) {
  const result = await db.query<{
    status: string;
    stripe_refund_id: string | null;
    provider_status: string | null;
    attempts: number;
    alerted_at: Date | string | null;
  }>(
    `select status, stripe_refund_id, provider_status, attempts, alerted_at
     from account_closure_refund_obligations where id = $1`,
    [`refund_${suffix}`],
  );
  expect(result.rows[0]).toMatchObject(expected);
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
