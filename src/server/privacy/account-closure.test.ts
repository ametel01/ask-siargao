import { describe, expect, test } from "bun:test";
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
