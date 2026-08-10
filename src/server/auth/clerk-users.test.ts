import { describe, expect, test } from "bun:test";
import type { UserJSON, UserWebhookEvent } from "@clerk/backend";
import { PGlite } from "@electric-sql/pglite";

import {
  accountClosureSubjectHash,
  anonymizeDeletedClerkUser,
  applyClerkUserWebhookEvent,
  ensureCurrentUser,
  getAuthenticatedClerkUserId,
  hasClosureTombstoneForClerkUser,
  normalizeClerkUser,
  recordClosureTombstoneForClerkUser,
  upsertClerkUser,
} from "@/server/auth/clerk-users";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";

describe("Clerk user sync helpers", () => {
  test("binds closure hash candidates as a JSON array for PostgreSQL drivers", async () => {
    let boundCandidates: unknown;
    const db: DatabaseQueryClient = {
      async query<T>(_query: string, params: unknown[] = []) {
        boundCandidates = params[0];
        return { rows: [] as T[] };
      },
    };

    await hasClosureTombstoneForClerkUser("user_json_array", db, {
      tombstoneHashKey: "current-key",
      tombstoneHashVersion: 2,
      tombstonePreviousHashKeys: [{ key: "previous-key", version: 1 }],
    });

    expect(boundCandidates).toEqual([
      { version: 2, hash: expect.any(String) },
      { version: 1, hash: expect.any(String) },
    ]);
  });

  test("normalizes Clerk users with primary email and identity cache fields", () => {
    const user = clerkUser({
      id: "user_primary",
      primaryEmailAddressId: "email_primary",
      updatedAt: Date.parse("2026-06-29T01:00:00.000Z"),
      lastActiveAt: Date.parse("2026-06-29T02:00:00.000Z"),
    });

    expect(normalizeClerkUser(user)).toEqual({
      id: "user_primary",
      email: "primary@example.com",
      firstName: "Alex",
      lastName: "Traveler",
      imageUrl: "https://img.clerk.test/user_primary",
      clerkUpdatedAt: new Date("2026-06-29T01:00:00.000Z"),
      lastSeenAt: new Date("2026-06-29T02:00:00.000Z"),
    });
  });

  test("upserts created and updated Clerk users into the local users table", async () => {
    const db = await openClerkUserTestDatabase();

    await applyClerkUserWebhookEvent(
      userEvent("user.created", clerkUser({ id: "user_upsert" })),
      db,
    );
    await applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_upsert",
          email: "updated@example.com",
          firstName: "Updated",
          imageUrl: "https://img.clerk.test/updated",
          updatedAt: Date.parse("2026-06-29T02:00:00.000Z"),
        }),
      ),
      db,
    );

    const row = await loadUser(db, "user_upsert");
    expect(row).toMatchObject({
      id: "user_upsert",
      email: "updated@example.com",
      first_name: "Updated",
      last_name: "Traveler",
      image_url: "https://img.clerk.test/updated",
      deleted_at: null,
    });

    await db.close();
  });

  test("applies only strictly newer verified Clerk identity events", async () => {
    const db = await openClerkUserTestDatabase();

    await applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_monotonic",
          email: "current@example.com",
          firstName: "Current",
          updatedAt: Date.parse("2026-06-29T02:00:00.000Z"),
        }),
      ),
      db,
    );
    await applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_monotonic",
          email: "stale@example.com",
          firstName: "Stale",
          updatedAt: Date.parse("2026-06-29T01:00:00.000Z"),
        }),
      ),
      db,
    );
    await applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_monotonic",
          email: "equal@example.com",
          firstName: "Equal",
          updatedAt: Date.parse("2026-06-29T02:00:00.000Z"),
        }),
      ),
      db,
    );

    const row = await loadUser(db, "user_monotonic");
    expect(row).toMatchObject({
      email: "current@example.com",
      first_name: "Current",
      deleted_at: null,
    });
    expect(toIsoString(row?.clerk_updated_at)).toBe("2026-06-29T02:00:00.000Z");

    await db.close();
  });

  test("anonymizes users, records a tombstone, and denies post-delete resurrection", async () => {
    const db = await openClerkUserTestDatabase();
    await upsertClerkUser(normalizeClerkUser(clerkUser({ id: "user_delete" })), db);

    await anonymizeDeletedClerkUser("user_delete", db);

    const row = await loadUser(db, "user_delete");
    expect(row).toMatchObject({
      id: "user_delete",
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
    });
    expect(row?.deleted_at).not.toBeNull();
    expect(await hasClosureTombstoneForClerkUser("user_delete", db)).toBe(true);

    await anonymizeDeletedClerkUser("user_delete", db);

    const repeatedDeletion = await loadUser(db, "user_delete");
    expect(repeatedDeletion).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
      deleted_at: row?.deleted_at,
    });

    await applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_delete",
          email: "resurrected@example.com",
          firstName: "Resurrected",
          updatedAt: Date.parse("2026-06-29T04:00:00.000Z"),
        }),
      ),
      db,
    );

    const afterPostDeleteEvent = await loadUser(db, "user_delete");
    expect(afterPostDeleteEvent).toMatchObject({
      email: null,
      first_name: null,
      deleted_at: row?.deleted_at,
    });

    await db.close();
  });

  test("honors the configured HMAC rotation grace after identity erasure across session and webhook writes", async () => {
    const db = await openClerkUserTestDatabase();
    const userId = "user_rotated_erased";
    const previousPolicy = {
      tombstoneHashKey: "previous-closure-key",
      tombstoneHashVersion: 7,
    };
    const rotatedPolicy = {
      tombstoneHashKey: "current-closure-key",
      tombstoneHashVersion: 8,
      tombstonePreviousHashKeys: [{ key: previousPolicy.tombstoneHashKey, version: 7 }],
    };
    await upsertClerkUser(normalizeClerkUser(clerkUser({ id: userId })), db, previousPolicy);
    await recordClosureTombstoneForClerkUser({ userId, hashPolicy: previousPolicy }, db);
    await db.query("delete from users where id = $1", [userId]);

    await expect(
      ensureCurrentUser({
        auth: async () => ({ userId }),
        closureSubjectHashPolicy: rotatedPolicy,
        db,
        now: () => new Date("2026-06-29T05:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    await expect(
      applyClerkUserWebhookEvent(
        userEvent(
          "user.updated",
          clerkUser({
            id: userId,
            email: "must-not-resurrect@example.com",
            updatedAt: Date.parse("2026-06-29T06:00:00.000Z"),
          }),
        ),
        db,
        rotatedPolicy,
      ),
    ).resolves.toEqual({ status: "closed", userId });
    expect(await loadUser(db, userId)).toBeNull();

    await db.close();
  });

  test("previous-release lifecycle SQL cannot resurrect an existing terminal row", async () => {
    const db = await openClerkUserTestDatabase();
    await upsertClerkUser(normalizeClerkUser(clerkUser({ id: "user_legacy_resurrection" })), db);
    await anonymizeDeletedClerkUser("user_legacy_resurrection", db);
    const terminal = await loadUser(db, "user_legacy_resurrection");

    await expect(
      runPreviousReleaseLifecycleUpsert(db, {
        userId: "user_legacy_resurrection",
        email: "legacy-resurrected@example.com",
        firstName: "Legacy",
        lastSeenAt: "2026-06-29T05:00:00.000Z",
        updatedAt: "2026-06-29T05:00:00.000Z",
      }),
    ).rejects.toThrow(/terminal user row cannot be resurrected/);

    const row = await loadUser(db, "user_legacy_resurrection");
    expect(row).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
      deleted_at: terminal?.deleted_at,
    });

    await db.close();
  });

  test("verified deletion creates a terminal row before previous-release inserts", async () => {
    const db = await openClerkUserTestDatabase();

    await anonymizeDeletedClerkUser("user_deleted_before_local_row", db);
    const terminal = await loadUser(db, "user_deleted_before_local_row");
    expect(terminal).toMatchObject({
      id: "user_deleted_before_local_row",
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
    });
    expect(terminal?.deleted_at).not.toBeNull();

    await expect(
      runPreviousReleaseLifecycleUpsert(db, {
        userId: "user_deleted_before_local_row",
        email: "legacy-insert-after-delete@example.com",
        firstName: "Inserted",
        lastSeenAt: "2026-06-29T05:00:00.000Z",
        updatedAt: "2026-06-29T05:00:00.000Z",
      }),
    ).rejects.toThrow(/terminal user row cannot be resurrected/);

    const row = await loadUser(db, "user_deleted_before_local_row");
    expect(row).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
      deleted_at: terminal?.deleted_at,
    });

    await db.close();
  });

  test("previous-release session SQL cannot clear terminal deletion state", async () => {
    const db = await openClerkUserTestDatabase();
    await anonymizeDeletedClerkUser("user_legacy_session", db);
    const terminal = await loadUser(db, "user_legacy_session");

    await expect(
      runPreviousReleaseSessionPresence(db, {
        userId: "user_legacy_session",
        lastSeenAt: "2026-06-29T05:00:00.000Z",
      }),
    ).rejects.toThrow(/terminal user row cannot be resurrected/);

    const row = await loadUser(db, "user_legacy_session");
    expect(row).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
      deleted_at: terminal?.deleted_at,
    });

    await db.close();
  });

  test("previous-release ensureCurrentUser fails before sentinel child writes", async () => {
    const db = await openClerkUserTestDatabase();
    await anonymizeDeletedClerkUser("user_legacy_authz", db);
    const terminal = await loadUser(db, "user_legacy_authz");

    await expect(
      runPreviousReleaseEnsureCurrentUserWithChildWrites(db, {
        userId: "user_legacy_authz",
        lastSeenAt: "2026-06-29T05:00:00.000Z",
      }),
    ).rejects.toThrow(/terminal user row cannot be resurrected/);

    const row = await loadUser(db, "user_legacy_authz");
    expect(row).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
      deleted_at: terminal?.deleted_at,
    });

    const childCounts = await db.query<{
      profiles: number;
      chat_threads: number;
      trip_passes: number;
    }>(
      `
        select
          (select count(*)::int from user_profiles where user_id = $1) as profiles,
          (select count(*)::int from chat_threads where user_id = $1) as chat_threads,
          (select count(*)::int from trip_passes where user_id = $1) as trip_passes
      `,
      ["user_legacy_authz"],
    );
    expect(childCounts.rows[0]).toEqual({
      profiles: 0,
      chat_threads: 0,
      trip_passes: 0,
    });

    await db.close();
  });

  test("ensures the current authenticated user with a presence-only placeholder", async () => {
    const db = await openClerkUserTestDatabase();
    const now = new Date("2026-06-29T03:00:00.000Z");

    const result = await ensureCurrentUser({
      auth: async () => ({
        userId: "user_session",
        sessionClaims: {
          email: "session@example.com",
          given_name: "Session",
          family_name: "Traveler",
          picture: "https://img.clerk.test/session",
        },
      }),
      db,
      now: () => now,
    });

    const row = await loadUser(db, "user_session");
    expect(result).toEqual({ userId: "user_session", lastSeenAt: now });
    expect(row).toMatchObject({
      id: "user_session",
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      deleted_at: null,
    });
    expect(toIsoString(row?.last_seen_at)).toBe("2026-06-29T03:00:00.000Z");

    await db.close();
  });

  test("updates session presence without overwriting webhook-managed identity fields", async () => {
    const db = await openClerkUserTestDatabase();
    await upsertClerkUser(
      normalizeClerkUser(
        clerkUser({
          id: "user_presence",
          email: "webhook@example.com",
          firstName: "Webhook",
          updatedAt: Date.parse("2026-06-29T01:00:00.000Z"),
        }),
      ),
      db,
    );

    await ensureCurrentUser({
      auth: async () => ({
        userId: "user_presence",
        sessionClaims: {
          email: "session@example.com",
          given_name: "Session",
          picture: "https://img.clerk.test/session",
        },
      }),
      db,
      now: () => new Date("2026-06-29T05:00:00.000Z"),
    });

    const row = await loadUser(db, "user_presence");
    expect(row).toMatchObject({
      email: "webhook@example.com",
      first_name: "Webhook",
      image_url: "https://img.clerk.test/user_presence",
    });
    expect(toIsoString(row?.last_seen_at)).toBe("2026-06-29T05:00:00.000Z");

    await db.close();
  });

  test("denies a current session that matches a closure tombstone before writing presence", async () => {
    const db = await openClerkUserTestDatabase();

    await recordClosureTombstoneForClerkUser(
      {
        userId: "user_closed_session",
        now: new Date("2026-06-29T01:00:00.000Z"),
      },
      db,
    );

    const result = await ensureCurrentUser({
      auth: async () => ({
        userId: "user_closed_session",
        sessionClaims: { email: "closed@example.com" },
      }),
      db,
      now: () => new Date("2026-06-29T03:00:00.000Z"),
    });

    expect(result).toBeNull();
    expect(await loadUser(db, "user_closed_session")).toBeNull();

    await db.close();
  });

  test("blocks a deferred closure barrier before writing session presence", async () => {
    const db = await openClerkUserTestDatabase();
    const barrierClient = createBarrierBeforeUserWriteClient(db, "user_deferred_session");

    const result = await ensureCurrentUser({
      auth: async () => ({
        userId: "user_deferred_session",
        sessionClaims: { email: "deferred-session@example.com" },
      }),
      db: barrierClient,
      now: () => new Date("2026-06-29T03:00:00.000Z"),
    });

    expect(result).toBeNull();
    expect(await loadUser(db, "user_deferred_session")).toBeNull();
    expect(await hasClosureTombstoneForClerkUser("user_deferred_session", db)).toBe(true);

    await db.close();
  });

  test("blocks a deferred closure barrier before applying a lifecycle write", async () => {
    const db = await openClerkUserTestDatabase();
    const barrierClient = createBarrierBeforeUserWriteClient(db, "user_deferred_lifecycle");

    const result = await applyClerkUserWebhookEvent(
      userEvent(
        "user.created",
        clerkUser({
          id: "user_deferred_lifecycle",
          email: "deferred-lifecycle@example.com",
        }),
      ),
      barrierClient,
    );

    expect(result).toEqual({ status: "closed", userId: "user_deferred_lifecycle" });
    expect(await loadUser(db, "user_deferred_lifecycle")).toBeNull();
    expect(await hasClosureTombstoneForClerkUser("user_deferred_lifecycle", db)).toBe(true);

    await db.close();
  });

  test("does not resurrect when account deletion wins a lifecycle precheck-write race", async () => {
    const db = await openClerkUserTestDatabase();
    await upsertClerkUser(
      normalizeClerkUser(
        clerkUser({
          id: "user_terminal_race",
          email: "before-terminal-race@example.com",
          updatedAt: Date.parse("2026-06-29T01:00:00.000Z"),
        }),
      ),
      db,
    );
    const releaseLifecycleWrite = deferred<void>();
    const lifecycleWritePending = deferred<void>();
    const delayedLifecycleClient = createDelayedTransactionClient(db, async () => {
      lifecycleWritePending.resolve();
      await releaseLifecycleWrite.promise;
    });

    const lifecycleResultPromise = applyClerkUserWebhookEvent(
      userEvent(
        "user.updated",
        clerkUser({
          id: "user_terminal_race",
          email: "after-terminal-race@example.com",
          firstName: "Resurrected",
          updatedAt: Date.parse("2026-06-29T03:00:00.000Z"),
        }),
      ),
      delayedLifecycleClient,
    );

    await lifecycleWritePending.promise;
    await anonymizeDeletedClerkUser("user_terminal_race", db);
    releaseLifecycleWrite.resolve();

    await expect(lifecycleResultPromise).resolves.toEqual({
      status: "closed",
      userId: "user_terminal_race",
    });
    const row = await loadUser(db, "user_terminal_race");
    expect(row).toMatchObject({
      email: null,
      first_name: null,
      deleted_at: row?.deleted_at,
    });
    expect(row?.deleted_at).not.toBeNull();

    await db.close();
  });

  test("keeps a new Clerk id with the same email distinct from a closed account", async () => {
    const db = await openClerkUserTestDatabase();

    await applyClerkUserWebhookEvent(
      userEvent("user.created", clerkUser({ id: "user_closed_old", email: "same@example.com" })),
      db,
    );
    await db.query(
      `
        insert into trip_passes (
          id,
          user_id,
          email,
          status,
          starts_at,
          expires_at
        )
        values ($1, $2, $3, 'active', $4, $5)
      `,
      [
        "trip_pass_closed_old",
        "user_closed_old",
        "same@example.com",
        "2026-06-29T01:00:00.000Z",
        "2026-07-13T01:00:00.000Z",
      ],
    );
    await anonymizeDeletedClerkUser("user_closed_old", db);
    await applyClerkUserWebhookEvent(
      userEvent(
        "user.created",
        clerkUser({ id: "user_same_email_new", email: "same@example.com" }),
      ),
      db,
    );

    const oldUser = await loadUser(db, "user_closed_old");
    const newUser = await loadUser(db, "user_same_email_new");
    const passOwners = await db.query<{ id: string; user_id: string | null }>(
      "select id, user_id from trip_passes order by id",
    );

    expect(oldUser?.deleted_at).not.toBeNull();
    expect(newUser).toMatchObject({
      id: "user_same_email_new",
      email: "same@example.com",
      deleted_at: null,
    });
    expect(passOwners.rows).toEqual([{ id: "trip_pass_closed_old", user_id: "user_closed_old" }]);

    await db.close();
  });

  test("returns null for signed-out requests without creating a local user", async () => {
    const db = await openClerkUserTestDatabase();

    const result = await ensureCurrentUser({
      auth: async () => ({ userId: null, sessionClaims: null }),
      db,
      now: () => new Date("2026-06-29T03:00:00.000Z"),
    });

    const rows = await db.query<{ count: number }>("select count(*)::int as count from users");
    expect(result).toBeNull();
    expect(rows.rows[0]?.count).toBe(0);

    await db.close();
  });

  test("derives the authenticated Clerk user id from auth state only", async () => {
    await expect(
      getAuthenticatedClerkUserId(async () => ({
        userId: "user_from_auth",
        sessionClaims: { sub: "user_from_auth" },
      })),
    ).resolves.toBe("user_from_auth");

    await expect(
      getAuthenticatedClerkUserId(async () => ({ userId: null, sessionClaims: null })),
    ).resolves.toBeNull();
  });
});

async function openClerkUserTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

async function loadUser(db: PGlite, userId: string) {
  const result = await db.query<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
    clerk_updated_at: Date | string | null;
    last_seen_at: Date | string | null;
    deleted_at: Date | string | null;
  }>(
    `
      select
        id,
        email,
        first_name,
        last_name,
        image_url,
        clerk_updated_at,
        last_seen_at,
        deleted_at
      from users
      where id = $1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

function clerkUser(input: {
  id: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string;
  primaryEmailAddressId?: string;
  updatedAt?: number;
  lastActiveAt?: number | null;
}) {
  const primaryEmailId = input.primaryEmailAddressId ?? "email_primary";

  return {
    id: input.id,
    first_name: input.firstName ?? "Alex",
    last_name: input.lastName ?? "Traveler",
    image_url: input.imageUrl ?? `https://img.clerk.test/${input.id}`,
    primary_email_address_id: primaryEmailId,
    email_addresses: [
      {
        id: "email_secondary",
        email_address: "secondary@example.com",
      },
      {
        id: primaryEmailId,
        email_address: input.email ?? "primary@example.com",
      },
    ],
    updated_at: input.updatedAt ?? Date.parse("2026-06-29T01:00:00.000Z"),
    last_active_at:
      input.lastActiveAt === undefined
        ? Date.parse("2026-06-29T02:00:00.000Z")
        : input.lastActiveAt,
  } as unknown as UserJSON;
}

function userEvent(type: "user.created" | "user.updated", data: UserJSON) {
  return {
    type,
    object: "event",
    data,
    event_attributes: {
      http_request: { client_ip: "127.0.0.1", user_agent: "bun-test" },
    },
  } satisfies UserWebhookEvent;
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function createBarrierBeforeUserWriteClient(db: PGlite, userId: string): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      let subjectLockSeen = false;
      let barrierInserted = false;
      const transactionClient: DatabaseQueryClient = {
        async query<R>(query: string, params: unknown[] = []) {
          if (query.includes("pg_advisory_xact_lock")) {
            subjectLockSeen = true;
          }
          if (subjectLockSeen && !barrierInserted && query.includes("insert into users")) {
            barrierInserted = true;
            await insertClosureBarrierRows(db, userId);
          }

          return db.query<R>(query, params);
        },
      };

      try {
        const result = await callback(transactionClient);
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

function createDelayedTransactionClient(
  db: PGlite,
  beforeTransaction: () => Promise<void>,
): DatabaseQueryClient {
  return {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await beforeTransaction();
      await db.exec("begin");
      const transactionClient: DatabaseQueryClient = {
        async query<R>(query: string, params: unknown[] = []) {
          return db.query<R>(query, params);
        },
      };

      try {
        const result = await callback(transactionClient);
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
}

async function insertClosureBarrierRows(db: PGlite, userId: string) {
  const now = "2026-06-29T02:30:00.000Z";
  const subjectHash = accountClosureSubjectHash(userId);
  const tombstoneId = `closure_tombstone_${subjectHash.slice(0, 32)}`;
  await db.query(
    `
      insert into account_closure_tombstones (
        id,
        subject_hash,
        subject_hash_version,
        subject_type,
        closure_policy_version,
        closed_at,
        created_at,
        updated_at
      )
      values ($1, $2, 1, 'clerk_user_id', 'account-closure-v1', $3, $3, $3)
      on conflict (subject_hash) do nothing
    `,
    [tombstoneId, subjectHash, now],
  );
  await db.query(
    `
      insert into account_closure_write_barriers (
        id,
        tombstone_id,
        subject_hash,
        subject_hash_version,
        subject_type,
        status,
        opened_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 1, 'clerk_user_id', 'active', $4, $4, $4)
      on conflict (subject_hash) do update set
        status = 'active',
        updated_at = excluded.updated_at
    `,
    [`closure_barrier_${subjectHash.slice(0, 32)}`, tombstoneId, subjectHash, now],
  );
}

async function runPreviousReleaseLifecycleUpsert(
  db: PGlite,
  input: {
    userId: string;
    email: string;
    firstName: string;
    updatedAt: string;
    lastSeenAt: string;
  },
) {
  await db.query(
    `
      insert into users (
        id,
        email,
        first_name,
        last_name,
        image_url,
        clerk_updated_at,
        last_seen_at,
        deleted_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 'Traveler', 'https://img.clerk.test/legacy', $4, $5, null, now(), now())
      on conflict (id) do update set
        email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        image_url = excluded.image_url,
        clerk_updated_at = excluded.clerk_updated_at,
        last_seen_at = excluded.last_seen_at,
        deleted_at = null,
        updated_at = now()
    `,
    [input.userId, input.email, input.firstName, input.updatedAt, input.lastSeenAt],
  );
}

async function runPreviousReleaseSessionPresence(
  db: PGlite,
  input: {
    userId: string;
    lastSeenAt: string;
  },
) {
  await db.query(
    `
      insert into users (
        id,
        last_seen_at,
        deleted_at,
        created_at,
        updated_at
      )
      values ($1, $2, null, now(), now())
      on conflict (id) do update set
        last_seen_at = excluded.last_seen_at,
        deleted_at = null,
        updated_at = now()
    `,
    [input.userId, input.lastSeenAt],
  );
}

async function runPreviousReleaseEnsureCurrentUserWithChildWrites(
  db: PGlite,
  input: {
    userId: string;
    lastSeenAt: string;
  },
) {
  await db.exec("begin");
  try {
    await db.query(
      `
        insert into users (
          id,
          last_seen_at,
          deleted_at,
          created_at,
          updated_at
        )
        values ($1, $2, null, now(), now())
        on conflict (id) do update set
          last_seen_at = excluded.last_seen_at,
          deleted_at = null,
          updated_at = now()
      `,
      [input.userId, input.lastSeenAt],
    );
    await db.query(
      `
        insert into user_profiles (user_id, display_name)
        values ($1, 'Legacy Authz')
      `,
      [input.userId],
    );
    await db.query(
      `
        insert into chat_threads (id, user_id)
        values ('thread_legacy_authz', $1)
      `,
      [input.userId],
    );
    await db.query(
      `
        insert into trip_passes (
          id,
          user_id,
          status,
          starts_at,
          expires_at
        )
        values (
          'pass_legacy_authz',
          $1,
          'active',
          '2026-06-29T05:00:00.000Z',
          '2026-07-13T05:00:00.000Z'
        )
      `,
      [input.userId],
    );
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
