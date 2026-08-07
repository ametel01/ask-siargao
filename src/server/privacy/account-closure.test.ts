import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import {
  accountClosureVerificationConfig,
  beginAccountClosure,
  purgeEligibleClosureTombstones,
  runClosureCleanupBatch,
} from "@/server/privacy/account-closure";

const now = new Date("2026-08-07T04:00:00.000Z");
const policy = {
  alertAfterAttempts: 2,
  closurePolicyVersion: "closure-test-v1",
  closureRetentionMs: 30 * 24 * 60 * 60 * 1_000,
  commercePolicyVersion: "commerce-test-v1",
  commerceRetentionMs: 365 * 24 * 60 * 60 * 1_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "closure-test-hmac-key",
  tombstoneHashVersion: 1,
};

describe("terminal Account Closure", () => {
  test("uses Clerk's signed factor verification age with an inclusive five-minute boundary", () => {
    expect(accountClosureVerificationConfig).toEqual({ level: "second_factor", afterMinutes: 6 });
  });

  test("commits phase one before dispatch and atomically denies access, sharing, and usage", async () => {
    const { db, query } = await openClosureDatabase();
    await seedOwnedData(db, "user_close");
    const dispatchSnapshots: Array<{ deletedAt: string | null; shares: number }> = [];

    const result = await beginAccountClosure(
      { now, userId: "user_close" },
      {
        afterCommit: async () => {
          const user = await query<{ deleted_at: string | null }>(
            "select deleted_at::text from users where id = $1",
            ["user_close"],
          );
          const shares = await query<{ count: string }>(
            "select count(*)::text from shared_trip_plans where trip_id = 'trip_close'",
          );
          dispatchSnapshots.push({
            deletedAt: user[0]?.deleted_at ?? null,
            shares: Number(shares[0]?.count ?? 0),
          });
        },
        createId: (prefix) => `${prefix}_fixed`,
        db,
        policy,
      },
    );

    expect(result).toEqual({
      status: "closed",
      operationRef: "closure_operation_fixed",
      tombstoneRef: "closure_tombstone_fixed",
    });
    expect(dispatchSnapshots).toHaveLength(1);
    expect(new Date(dispatchSnapshots[0]?.deletedAt ?? 0).toISOString()).toBe(now.toISOString());
    expect(dispatchSnapshots[0]?.shares).toBe(0);
    expect(
      await query("select subject_hash from account_closure_tombstones where id = $1", [
        result.tombstoneRef,
      ]),
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ subject_hash: "user_close" })]),
    );
    expect(
      await query<{ status: string }>("select status from trip_passes where id = 'pass_close'"),
    ).toEqual([{ status: "cancelled" }]);
    expect(
      await query<{ event_type: string }>(
        "select event_type from trip_usage_events where id = 'usage_close'",
      ),
    ).toEqual([{ event_type: "released" }]);
    expect(
      await query<{ count: string }>(
        "select count(*)::text from account_closure_steps where operation_id = $1",
        [result.operationRef],
      ),
    ).toEqual([{ count: "5" }]);

    await db.close();
  });

  test("rolls back every phase-one subeffect and starts no external work on failure", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedUser(db, "user_rollback");
    let dispatches = 0;

    await expect(
      beginAccountClosure(
        { now, userId: "user_rollback" },
        {
          afterCommit: () => {
            dispatches += 1;
          },
          beforeCommit: () => {
            throw new Error("injected phase-one failure");
          },
          createId: (prefix) => `${prefix}_rollback`,
          db: client,
          policy,
        },
      ),
    ).rejects.toThrow("injected phase-one failure");

    expect(dispatches).toBe(0);
    expect(await query("select id from account_closure_tombstones")).toEqual([]);
    expect(await query<{ deleted_at: string | null }>("select deleted_at from users")).toEqual([
      { deleted_at: null },
    ]);
    await db.close();
  });

  test("converges duplicate requests and database-enforces the post-commit write barrier", async () => {
    const { db, client } = await openClosureDatabase();
    await seedOwnedData(db, "user_barrier");
    const first = await beginAccountClosure(
      { now, userId: "user_barrier" },
      { createId: (prefix) => `${prefix}_barrier`, db: client, policy },
    );
    const duplicate = await beginAccountClosure(
      { now: new Date(now.getTime() + 1_000), userId: "user_barrier" },
      { createId: (prefix) => `${prefix}_duplicate`, db: client, policy },
    );
    expect(duplicate).toEqual({ ...first, status: "already_closed" });

    await expect(
      db.query("insert into user_profiles (user_id, display_name) values ($1, 'late')", [
        "user_barrier",
      ]),
    ).rejects.toThrow("account is terminally closed");
    await expect(
      db.query("insert into chat_threads (id, user_id, title) values ('late_thread', $1, 'late')", [
        "user_barrier",
      ]),
    ).rejects.toThrow("account is terminally closed");
    await expect(
      db.query(
        "insert into saved_trip_items (id, trip_id, kind, title, payload_json) values ('late_item', 'trip_close', 'place', 'late', '{}'::jsonb)",
      ),
    ).rejects.toThrow("account is terminally closed");
    await expect(
      db.query(
        "insert into trip_usage_meters (id, trip_pass_id, meter_type, used, \"limit\") values ('late_meter', 'pass_close', 'route_lookup', 0, 1)",
      ),
    ).rejects.toThrow("account is terminally closed");

    await db.query("insert into users (id, email) values ('user_new_same_email', $1)", [
      "user_barrier@example.com",
    ]);
    expect(
      (
        await db.query<{ deleted_at: Date | null }>(
          "select deleted_at from users where id = 'user_new_same_email'",
        )
      ).rows[0]?.deleted_at,
    ).toBeNull();
    await db.close();
  });

  test("atomically upgrades a pre-0012 closure when a signed request is repeated", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedOwnedData(db, "user_rolling");
    const subjectHash = createHashForTest("user_rolling");
    await db.query(
      `insert into account_closure_tombstones
       (id, subject_hash, subject_hash_version, subject_type, closure_policy_version,
        closed_at, purge_after, created_at, updated_at)
       values ('legacy_tombstone', $1, 1, 'clerk_user_id', 'legacy-v1', $2, $3, $2, $2)`,
      [subjectHash, now, new Date(now.getTime() + policy.closureRetentionMs)],
    );
    await db.query(
      `insert into account_closure_operations
       (id, tombstone_id, operation_type, status, created_at, updated_at)
       values ('legacy_operation', 'legacy_tombstone', 'traveler_requested_closure',
         'pending', $1, $1)`,
      [now],
    );

    const result = await beginAccountClosure(
      { now, userId: "user_rolling" },
      { createId: (prefix) => `${prefix}_unused`, db: client, policy },
    );

    expect(result).toEqual({
      status: "already_closed",
      operationRef: "legacy_operation",
      tombstoneRef: "legacy_tombstone",
    });
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from account_closure_steps where operation_id = 'legacy_operation'",
      ),
    ).toEqual([{ count: "5" }]);
    expect(
      await query(
        "select operation_id from account_closure_provider_subjects where operation_id = 'legacy_operation'",
      ),
    ).toEqual([{ operation_id: "legacy_operation" }]);
    expect(await query("select id from shared_trip_plans where trip_id = 'trip_close'")).toEqual(
      [],
    );
    const rollingUser = await query<{ deleted_at: Date | null }>(
      "select deleted_at from users where id = 'user_rolling'",
    );
    expect(new Date(rollingUser[0]?.deleted_at ?? 0).toISOString()).toBe(now.toISOString());
    await db.close();
  });

  test("matches an existing terminal tombstone during an explicit HMAC rotation grace period", async () => {
    const { db, client } = await openClosureDatabase();
    await seedUser(db, "user_rotation");
    const first = await beginAccountClosure(
      { now, userId: "user_rotation" },
      { createId: (prefix) => `${prefix}_rotation`, db: client, policy },
    );
    const rotatedPolicy = {
      ...policy,
      tombstoneHashKey: "new-closure-hmac-key",
      tombstoneHashVersion: 2,
      tombstonePreviousHashKeys: [{ key: policy.tombstoneHashKey, version: 1 }],
    };
    const repeated = await beginAccountClosure(
      { now: new Date(now.getTime() + 1_000), userId: "user_rotation" },
      { db: client, policy: rotatedPolicy },
    );
    expect(repeated).toEqual({ ...first, status: "already_closed" });
    expect(
      (
        await db.query<{ count: string }>(
          "select count(*)::text as count from account_closure_tombstones",
        )
      ).rows,
    ).toEqual([{ count: "1" }]);
    await db.close();
  });

  test("retries provider failure without blocking local erasure or commerce minimization", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedOwnedData(db, "user_retry");
    const closure = await beginAccountClosure(
      { now, userId: "user_retry" },
      { createId: (prefix) => `${prefix}_retry`, db: client, policy },
    );

    const first = await runClosureCleanupBatch({
      db: client,
      now,
      policy,
      providers: {
        deleteClerkUser: async () => {
          throw new Error("contains sensitive provider text");
        },
        expireCheckoutSession: async () => undefined,
      },
    });

    expect(first.attempted).toBeGreaterThanOrEqual(4);
    expect(
      await query<{ step_type: string; status: string; last_error_category: string | null }>(
        `select step_type, status, last_error_category
         from account_closure_steps
         where operation_id = $1
         order by step_type`,
        [closure.operationRef],
      ),
    ).toEqual(
      expect.arrayContaining([
        {
          step_type: "clerk_deletion",
          status: "pending",
          last_error_category: "provider_unavailable",
        },
        { step_type: "commerce_minimization", status: "succeeded", last_error_category: null },
        { step_type: "local_erasure", status: "succeeded", last_error_category: null },
      ]),
    );
    expect(JSON.stringify(await query("select * from account_closure_steps"))).not.toContain(
      "sensitive provider text",
    );
    expect(await query("select * from user_profiles where user_id = 'user_retry'")).toEqual([]);

    await runClosureCleanupBatch({
      db: client,
      now: new Date(now.getTime() + 60_000),
      policy,
      providers: {
        deleteClerkUser: async () => undefined,
        expireCheckoutSession: async () => undefined,
      },
    });
    expect(
      await query<{ status: string }>(
        "select status from account_closure_operations where id = $1",
        [closure.operationRef],
      ),
    ).toEqual([{ status: "succeeded" }]);
    expect(await query("select id from users where id = 'user_retry'")).toEqual([]);
    await db.close();
  });

  test("retains only policy-bounded commerce evidence with product, consent, and aggregate facts", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedRetainedCommerceData(db, "user_retained_boundary");
    await beginAccountClosure(
      { now, userId: "user_retained_boundary" },
      { createId: (prefix) => `${prefix}_retained_boundary`, db: client, policy },
    );

    await runClosureCleanupBatch({
      db: client,
      now,
      policy,
      providers: {
        deleteClerkUser: async () => undefined,
        expireCheckoutSession: async () => undefined,
      },
    });

    const retained = await query<{
      aggregate_service_facts: Record<string, unknown>;
      amount_minor: number | null;
      consent_policy_versions: Record<string, unknown>;
      currency: string | null;
      lifecycle_status: string;
      lifecycle_timestamps: Record<string, unknown>;
      occurred_at: string | null;
      product_code: string | null;
      product_family: string | null;
      product_version: number | null;
      retention_expires_at: string;
      source_type: string;
      stripe_checkout_session_id: string | null;
      stripe_event_id: string | null;
      stripe_payment_intent_id: string | null;
    }>(
      `select source_type, amount_minor, currency, product_code, product_version,
         product_family, lifecycle_status, lifecycle_timestamps, stripe_checkout_session_id,
         stripe_payment_intent_id, stripe_event_id, consent_policy_versions,
         aggregate_service_facts, occurred_at::text, retention_expires_at::text
       from retained_commerce_evidence order by source_type`,
    );

    expect(retained).toHaveLength(2);
    const order = retained.find((row) => row.source_type === "trip_pass_order");
    const pass = retained.find((row) => row.source_type === "trip_pass");
    expect(order).toMatchObject({
      amount_minor: 999,
      currency: "usd",
      product_code: "siargao_trip_pass_14d_v2",
      product_family: "siargao_trip_pass",
      product_version: 2,
      lifecycle_status: "paid",
      stripe_checkout_session_id: "cs_retained_allowed",
      stripe_payment_intent_id: "pi_retained_allowed",
      stripe_event_id: null,
      consent_policy_versions: {
        privacyPolicyVersion: "privacy-v1",
        refundPolicyVersion: "refund-v1",
        retentionPolicyVersion: "retention-v1",
        termsConsentPresentedAt: "2026-08-07T01:00:00+00:00",
        termsPolicyVersion: "terms-v1",
      },
      aggregate_service_facts: {},
    });
    expect(order?.lifecycle_timestamps).toEqual({
      checkoutCancellationConfirmedAt: "2026-08-07T03:00:00+00:00",
      checkoutSessionExpiresAt: "2026-08-07T02:00:00+00:00",
      completedAt: "2026-08-07T02:00:00+00:00",
      createdAt: "2026-08-07T01:00:00+00:00",
      updatedAt: "2026-08-07T04:00:00+00:00",
    });
    expect(pass).toMatchObject({
      amount_minor: 999,
      currency: "usd",
      product_code: "siargao_trip_pass_14d_v2",
      product_family: "siargao_trip_pass",
      product_version: 2,
      lifecycle_status: "cancelled",
      stripe_checkout_session_id: "cs_retained_allowed",
      stripe_payment_intent_id: "pi_retained_allowed",
      stripe_event_id: "evt_retained_allowed",
      consent_policy_versions: order?.consent_policy_versions,
      aggregate_service_facts: {
        durationDays: 14,
        meterTotals: { chat_message: { limit: 150, used: 37 } },
        quantity: 1,
      },
    });
    expect(pass?.lifecycle_timestamps).toEqual({
      createdAt: "2026-08-07T01:00:00+00:00",
      expiresAt: "2026-08-21T01:00:00+00:00",
      startsAt: "2026-08-07T01:00:00+00:00",
      updatedAt: "2026-08-07T04:00:00+00:00",
    });
    expect(new Date(order?.occurred_at ?? 0).toISOString()).toBe("2026-08-07T02:00:00.000Z");
    expect(new Date(pass?.occurred_at ?? 0).toISOString()).toBe("2026-08-07T01:00:00.000Z");
    const expectedExpiry = new Date(now.getTime() + policy.commerceRetentionMs).toISOString();
    expect(retained.map((row) => new Date(row.retention_expires_at).toISOString())).toEqual([
      expectedExpiry,
      expectedExpiry,
    ]);

    const retainedText = JSON.stringify(retained);
    for (const prohibited of [
      "traveler-retained@example.com",
      "cus_prohibited",
      "private trip notes",
      "checkout-secret-key",
      "request_prohibited",
      "request_hash_prohibited",
      "provider_request_prohibited",
      "user_retained_boundary",
    ]) {
      expect(retainedText).not.toContain(prohibited);
    }
    expect(
      await query(
        `select user_id, email, stripe_customer_id, metadata_json
         from trip_pass_orders where id = 'order_retained_boundary'`,
      ),
    ).toEqual([{ user_id: null, email: null, stripe_customer_id: null, metadata_json: {} }]);
    expect(
      await query(
        `select user_id, idempotency_key, request_id, request_hash, provider_request_ids_json
         from trip_usage_events where id = 'usage_retained_boundary'`,
      ),
    ).toEqual([
      {
        user_id: null,
        idempotency_key: null,
        request_id: null,
        request_hash: null,
        provider_request_ids_json: [],
      },
    ]);
    await db.close();
  });

  test("recovers expired leases and alerts without dead-lettering local cleanup", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedUser(db, "user_lease");
    const closure = await beginAccountClosure(
      { now, userId: "user_lease" },
      { createId: (prefix) => `${prefix}_lease`, db: client, policy },
    );
    await db.query(
      `update account_closure_steps set status = 'succeeded', completed_at = $2
       where operation_id = $1 and step_type <> 'clerk_deletion'`,
      [closure.operationRef, now],
    );
    await db.query(
      `update account_closure_steps set status = 'running', attempts = 1,
         lease_token = 'crashed-worker', lease_expires_at = $2
       where operation_id = $1 and step_type = 'clerk_deletion'`,
      [closure.operationRef, new Date(now.getTime() - 1)],
    );
    let clerkCalls = 0;
    await runClosureCleanupBatch({
      db: client,
      now,
      policy,
      providers: {
        deleteClerkUser: async () => {
          clerkCalls += 1;
        },
        expireCheckoutSession: async () => undefined,
      },
    });
    expect(clerkCalls).toBe(1);
    expect(
      await query<{ attempts: number; status: string }>(
        `select attempts, status from account_closure_steps
         where operation_id = $1 and step_type = 'clerk_deletion'`,
        [closure.operationRef],
      ),
    ).toEqual([{ attempts: 2, status: "succeeded" }]);
    await db.close();

    const failing = await openClosureDatabase();
    await seedUser(failing.db, "user_alert");
    const alertClosure = await beginAccountClosure(
      { now, userId: "user_alert" },
      { createId: (prefix) => `${prefix}_alert`, db: failing.client, policy },
    );
    await failing.db.query("drop table user_profiles");
    for (const attemptNow of [now, new Date(now.getTime() + 60_000)]) {
      await runClosureCleanupBatch({
        db: failing.client,
        now: attemptNow,
        policy,
        providers: {
          deleteClerkUser: async () => undefined,
          expireCheckoutSession: async () => undefined,
        },
      });
    }
    expect(
      await failing.query<{
        alerted_at: Date | null;
        attempts: number;
        last_error_category: string;
        status: string;
      }>(
        `select alerted_at, attempts, last_error_category, status
         from account_closure_steps
         where operation_id = $1 and step_type = 'local_erasure'`,
        [alertClosure.operationRef],
      ),
    ).toEqual([
      {
        alerted_at: new Date(now.getTime() + 60_000),
        attempts: 2,
        last_error_category: "local_cleanup_failed",
        status: "pending",
      },
    ]);
    await failing.db.close();
  });

  test("purges only expired completed tombstones and remains idempotent", async () => {
    const { db, client, query } = await openClosureDatabase();
    await seedUser(db, "user_purge");
    const closure = await beginAccountClosure(
      { now, userId: "user_purge" },
      { createId: (prefix) => `${prefix}_purge`, db: client, policy },
    );
    await runClosureCleanupBatch({
      db: client,
      now,
      policy,
      providers: {
        deleteClerkUser: async () => undefined,
        expireCheckoutSession: async () => undefined,
      },
    });

    expect(await purgeEligibleClosureTombstones(client, now)).toEqual({ purged: 0 });
    const afterRetention = new Date(now.getTime() + policy.closureRetentionMs + 1);
    expect(await purgeEligibleClosureTombstones(client, afterRetention)).toEqual({ purged: 1 });
    expect(await purgeEligibleClosureTombstones(client, afterRetention)).toEqual({ purged: 0 });
    expect(
      await query("select id from account_closure_tombstones where id = $1", [
        closure.tombstoneRef,
      ]),
    ).toEqual([]);
    await db.close();
  });
});

async function openClosureDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  const client: DatabaseQueryClient = {
    query: async <T>(sql: string, params: unknown[] = []) => {
      const result = await db.query<T>(sql, params);
      return { rows: result.rows };
    },
    transaction: async <T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) =>
      db.transaction(async (transaction) =>
        callback({
          query: async <Row>(sql: string, params: unknown[] = []) => {
            const result = await transaction.query<Row>(sql, params);
            return { rows: result.rows };
          },
        }),
      ),
  };
  return {
    client,
    db,
    query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
  };
}

async function seedUser(db: PGlite, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function seedOwnedData(db: PGlite, userId: string) {
  await seedUser(db, userId);
  await db.query("insert into user_profiles (user_id, display_name) values ($1, 'Traveler')", [
    userId,
  ]);
  await db.query(
    "insert into saved_trips (id, user_id, client_trip_key_hash, title) values ('trip_close', $1, $2, 'Private trip')",
    [userId, `key_${userId}`],
  );
  await db.query(
    "insert into shared_trip_plans (id, trip_id, public_token_hash, title) values ('share_close', 'trip_close', $1, 'Shared trip')",
    [`token_${userId}`],
  );
  await db.query(
    `insert into trip_passes (id, user_id, email, status, starts_at, expires_at)
     values ('pass_close', $1, $2, 'active', $3, $4)`,
    [userId, `${userId}@example.com`, now, new Date(now.getTime() + 86_400_000)],
  );
  await db.query(
    "insert into trip_usage_meters (id, trip_pass_id, meter_type, used, \"limit\") values ('meter_close', 'pass_close', 'chat_message', 0, 150)",
  );
  await db.query(
    `insert into trip_usage_events
      (id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
       idempotency_key, request_id, occurred_at, created_at)
     values ('usage_close', 'pass_close', 'meter_close', $1, 'reserved', 'chat_message', 1,
       $2, $3, $4, $4)`,
    [userId, `idem_${userId}`, `request_${userId}`, now],
  );
}

async function seedRetainedCommerceData(db: PGlite, userId: string) {
  await seedUser(db, userId);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, email, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, checkout_session_expires_at, checkout_session_status,
       checkout_cancellation_confirmed_at, stripe_payment_intent_id, stripe_customer_id,
       terms_policy_version, refund_policy_version, privacy_policy_version,
       retention_policy_version, terms_consent_presented_at, metadata_json,
       created_at, updated_at, completed_at
     ) values (
       'order_retained_boundary', $1, 'traveler-retained@example.com', 'paid',
       'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 'price_retained', 999, 'usd',
       'checkout-secret-key', 'cs_retained_allowed', $2, 'complete', $3,
       'pi_retained_allowed', 'cus_prohibited', 'terms-v1', 'refund-v1', 'privacy-v1',
       'retention-v1', $4, $5::jsonb, $4, $3, $2
     )`,
    [
      userId,
      new Date("2026-08-07T02:00:00.000Z"),
      new Date("2026-08-07T03:00:00.000Z"),
      new Date("2026-08-07T01:00:00.000Z"),
      JSON.stringify({ notes: "private trip notes" }),
    ],
  );
  await db.query(
    `insert into trip_passes (
       id, user_id, email, status, stripe_checkout_session_id, stripe_payment_intent_id,
       stripe_event_id, starts_at, expires_at, created_at, updated_at
     ) values (
       'pass_retained_boundary', $1, 'traveler-retained@example.com', 'active',
       'cs_retained_allowed', 'pi_retained_allowed', 'evt_retained_allowed', $2, $3, $2, $2
     )`,
    [userId, new Date("2026-08-07T01:00:00.000Z"), new Date("2026-08-21T01:00:00.000Z")],
  );
  await db.query(
    `insert into trip_pass_grants (
       id, order_id, trip_pass_id, user_id, source_type, source_event_id,
       product_code, product_version, quantity, duration_days, meter_limits_json,
       starts_at, expires_at, created_at
     ) values (
       'grant_retained_boundary', 'order_retained_boundary', 'pass_retained_boundary', $1,
       'stripe_checkout', 'evt_retained_allowed', 'siargao_trip_pass_14d_v2', 2, 1, 14,
       '{"chat_message":150}'::jsonb, $2, $3, $2
     )`,
    [userId, new Date("2026-08-07T01:00:00.000Z"), new Date("2026-08-21T01:00:00.000Z")],
  );
  await db.query(
    `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
     values ('meter_retained_boundary', 'pass_retained_boundary', 'chat_message', 37, 150)`,
  );
  await db.query(
    `insert into trip_usage_events (
       id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
       idempotency_key, request_id, request_hash, provider_request_ids_json, occurred_at, created_at
     ) values (
       'usage_retained_boundary', 'pass_retained_boundary', 'meter_retained_boundary', $1,
       'settled', 'chat_message', 1, 'idem_prohibited', 'request_prohibited',
       'request_hash_prohibited', '["provider_request_prohibited"]'::jsonb, $2, $2
     )`,
    [userId, now],
  );
}

function createHashForTest(userId: string) {
  return createHmac("sha256", policy.tombstoneHashKey)
    .update(`clerk_user_id:${policy.tombstoneHashVersion}:${userId}`)
    .digest("base64url");
}
