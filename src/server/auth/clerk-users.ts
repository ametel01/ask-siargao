import type { UserJSON, UserWebhookEvent } from "@clerk/backend";
import { auth } from "@clerk/nextjs/server";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { beginAccountClosure, readAccountClosurePolicy } from "@/server/privacy/account-closure";
import {
  type ClosureSubjectHashPolicy,
  closureSubjectHashCandidates,
  currentClosureSubjectHash,
  readClosureSubjectHashPolicy,
} from "@/server/privacy/closure-subject";

const accountClosurePolicyVersion = "account-closure-v1";

export type ClerkUserInput = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  clerkUpdatedAt: Date | null;
  lastSeenAt?: Date | null;
};

export type CurrentUserAuthSnapshot = {
  userId: string | null;
  sessionClaims?: Record<string, unknown> | null;
};

export type EnsureCurrentUserDependencies = {
  auth: () => Promise<CurrentUserAuthSnapshot>;
  closureTombstoneHashKey?: string | null;
  closureSubjectHashPolicy?: ClosureSubjectHashPolicy | null;
  db: DatabaseQueryClient;
  now: () => Date;
};

const defaultAuthReader = async () => {
  const authObject = await auth();
  return {
    userId: authObject.userId,
    sessionClaims: toRecord(authObject.sessionClaims),
  };
};

export async function ensureCurrentUser(dependencies: Partial<EnsureCurrentUserDependencies> = {}) {
  const authSnapshot = await (dependencies.auth ?? defaultAuthReader)();

  if (!authSnapshot.userId) {
    return null;
  }

  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const lastSeenAt = (dependencies.now ?? (() => new Date()))();
  const closureHashPolicy = resolveClosureHashPolicy(dependencies);
  const userIsClosed = closureHashPolicy
    ? await hasClosureTombstoneForClerkUser(authSnapshot.userId, db, closureHashPolicy)
    : false;

  if (userIsClosed) {
    return null;
  }

  const user = await touchClerkUserSessionPresence(
    {
      id: authSnapshot.userId,
      lastSeenAt,
      closureHashPolicy,
    },
    db,
  );

  if (!user) {
    return null;
  }

  return {
    userId: authSnapshot.userId,
    lastSeenAt,
  };
}

export async function getAuthenticatedClerkUserId(
  authReader: () => Promise<CurrentUserAuthSnapshot> = defaultAuthReader,
) {
  const authSnapshot = await authReader();
  return authSnapshot.userId;
}

export async function applyClerkUserWebhookEvent(
  event: UserWebhookEvent,
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
  hashPolicy: ClosureSubjectHashPolicy = readClosureSubjectHashPolicy(),
) {
  if (event.type === "user.deleted") {
    const userId = event.data.id;
    if (!userId) {
      throw new Error("Clerk user.deleted event did not include a user id.");
    }

    await anonymizeDeletedClerkUser(userId, db, hashPolicy);
    return { status: "deleted" as const, userId };
  }

  const user = normalizeClerkUser(event.data);
  if (await hasClosureTombstoneForClerkUser(user.id, db, hashPolicy)) {
    return { status: "closed" as const, userId: user.id };
  }

  const result = await upsertClerkUser(user, db, hashPolicy);
  return {
    status: result.status === "closed" ? ("closed" as const) : ("upserted" as const),
    userId: user.id,
  };
}

export function normalizeClerkUser(user: UserJSON): ClerkUserInput {
  return {
    id: user.id,
    email: primaryEmailAddress(user),
    firstName: user.first_name,
    lastName: user.last_name,
    imageUrl: user.image_url || null,
    clerkUpdatedAt: timestampFromClerkMs(user.updated_at),
    lastSeenAt: timestampFromClerkMs(user.last_active_at),
  };
}

export async function upsertClerkUser(
  user: ClerkUserInput,
  db: DatabaseQueryClient,
  hashPolicy: ClosureSubjectHashPolicy = readClosureSubjectHashPolicy(),
) {
  return withDatabaseTransaction(db, async (transaction) => {
    await lockClerkUserClosureSubject(user.id, transaction);
    const subjectCandidates = JSON.stringify(closureSubjectHashCandidates(user.id, hashPolicy));
    const result = await transaction.query<{ id: string }>(
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
        select $1, $2, $3, $4, $5, $6, $7, null, now(), now()
        where not exists (
          select 1
          from account_closure_tombstones t
          join jsonb_to_recordset($8::jsonb) as c(version integer, hash text)
            on c.version = t.subject_hash_version and c.hash = t.subject_hash
          where t.subject_type = 'clerk_user_id'
        )
          and not exists (
            select 1
            from account_closure_write_barriers b
            join jsonb_to_recordset($8::jsonb) as c(version integer, hash text)
              on c.version = b.subject_hash_version and c.hash = b.subject_hash
            where b.subject_type = 'clerk_user_id' and b.status = 'active'
          )
        on conflict (id) do update set
          email = excluded.email,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          image_url = excluded.image_url,
          clerk_updated_at = excluded.clerk_updated_at,
          last_seen_at = coalesce(excluded.last_seen_at, users.last_seen_at),
          updated_at = now()
        where users.deleted_at is null
          and not exists (
            select 1
            from account_closure_tombstones t
            join jsonb_to_recordset($8::jsonb) as c(version integer, hash text)
              on c.version = t.subject_hash_version and c.hash = t.subject_hash
            where t.subject_type = 'clerk_user_id'
          )
          and not exists (
            select 1
            from account_closure_write_barriers b
            join jsonb_to_recordset($8::jsonb) as c(version integer, hash text)
              on c.version = b.subject_hash_version and c.hash = b.subject_hash
            where b.subject_type = 'clerk_user_id' and b.status = 'active'
          )
          and excluded.clerk_updated_at is not null
          and (
            users.clerk_updated_at is null
            or excluded.clerk_updated_at > users.clerk_updated_at
          )
        returning id
      `,
      [
        user.id,
        user.email,
        user.firstName,
        user.lastName,
        user.imageUrl,
        user.clerkUpdatedAt?.toISOString() ?? null,
        user.lastSeenAt?.toISOString() ?? null,
        subjectCandidates,
      ],
    );

    if (result.rows[0]) {
      return { status: "upserted" as const };
    }
    if (await hasClosureTombstoneForClerkUser(user.id, transaction, hashPolicy)) {
      return { status: "closed" as const };
    }

    return { status: "stale" as const };
  });
}

export async function anonymizeDeletedClerkUser(
  userId: string,
  db: DatabaseQueryClient,
  hashPolicy: ClosureSubjectHashPolicy = readClosureSubjectHashPolicy(),
) {
  await beginAccountClosure(
    {
      allowMissingUser: true,
      clerkDeletionConfirmed: true,
      now: new Date(),
      operationType: "clerk_deletion_identity_sync",
      userId,
    },
    { db, policy: { ...readAccountClosurePolicy(), ...hashPolicy } },
  );
}

export async function touchClerkUserSessionPresence(
  input: {
    id: string;
    lastSeenAt: Date;
    closureHashKey?: string | null;
    closureHashPolicy?: ClosureSubjectHashPolicy | null;
  },
  db: DatabaseQueryClient,
) {
  if (input.closureHashKey === null) {
    const result = await db.query<{ id: string; last_seen_at: Date | string; deleted_at: null }>(
      `
        insert into users (
          id,
          last_seen_at,
          created_at,
          updated_at
        )
        values ($1, $2, now(), now())
        on conflict (id) do update set
          last_seen_at = greatest(coalesce(users.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
          updated_at = now()
        where users.deleted_at is null
        returning id, last_seen_at, deleted_at
      `,
      [input.id, input.lastSeenAt.toISOString()],
    );

    return result.rows[0] ?? null;
  }

  const closureHashPolicy =
    input.closureHashPolicy ??
    (input.closureHashKey
      ? { tombstoneHashKey: input.closureHashKey, tombstoneHashVersion: 1 }
      : readClosureSubjectHashPolicy());
  const result = await withDatabaseTransaction(db, async (transaction) => {
    await lockClerkUserClosureSubject(input.id, transaction);
    const subjectCandidates = JSON.stringify(
      closureSubjectHashCandidates(input.id, closureHashPolicy),
    );
    return transaction.query<{ id: string; last_seen_at: Date | string; deleted_at: null }>(
      `
        insert into users (
          id,
          last_seen_at,
          created_at,
          updated_at
        )
        select $1, $2, now(), now()
        where not exists (
          select 1
          from account_closure_tombstones t
          join jsonb_to_recordset($3::jsonb) as c(version integer, hash text)
            on c.version = t.subject_hash_version and c.hash = t.subject_hash
          where t.subject_type = 'clerk_user_id'
        )
          and not exists (
            select 1
            from account_closure_write_barriers b
            join jsonb_to_recordset($3::jsonb) as c(version integer, hash text)
              on c.version = b.subject_hash_version and c.hash = b.subject_hash
            where b.subject_type = 'clerk_user_id' and b.status = 'active'
          )
        on conflict (id) do update set
          last_seen_at = greatest(coalesce(users.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
          updated_at = now()
        where users.deleted_at is null
          and not exists (
            select 1
            from account_closure_tombstones t
            join jsonb_to_recordset($3::jsonb) as c(version integer, hash text)
              on c.version = t.subject_hash_version and c.hash = t.subject_hash
            where t.subject_type = 'clerk_user_id'
          )
          and not exists (
            select 1
            from account_closure_write_barriers b
            join jsonb_to_recordset($3::jsonb) as c(version integer, hash text)
              on c.version = b.subject_hash_version and c.hash = b.subject_hash
            where b.subject_type = 'clerk_user_id' and b.status = 'active'
          )
        returning id, last_seen_at, deleted_at
      `,
      [input.id, input.lastSeenAt.toISOString(), subjectCandidates],
    );
  });

  return result.rows[0] ?? null;
}

export async function hasClosureTombstoneForClerkUser(
  userId: string,
  db: DatabaseQueryClient,
  keyOrPolicy: string | ClosureSubjectHashPolicy = readClosureSubjectHashPolicy(),
) {
  const policy =
    typeof keyOrPolicy === "string"
      ? { tombstoneHashKey: keyOrPolicy, tombstoneHashVersion: 1 }
      : keyOrPolicy;
  const candidates = JSON.stringify(closureSubjectHashCandidates(userId, policy));
  const result = await db.query<{ id: string }>(
    `
      select id
      from account_closure_tombstones t
      join jsonb_to_recordset($1::jsonb) as c(version integer, hash text)
        on c.version = t.subject_hash_version and c.hash = t.subject_hash
      where t.subject_type = 'clerk_user_id'
      limit 1
    `,
    [candidates],
  );

  return Boolean(result.rows[0]);
}

export async function recordClosureTombstoneForClerkUser(
  input: {
    userId: string;
    now?: Date;
    purgeAfter?: Date | null;
    key?: string;
    hashPolicy?: ClosureSubjectHashPolicy;
  },
  db: DatabaseQueryClient,
) {
  return withDatabaseTransaction(db, async (transaction) =>
    recordClosureTombstoneForClerkUserInTransaction(input, transaction),
  );
}

async function recordClosureTombstoneForClerkUserInTransaction(
  input: {
    userId: string;
    now?: Date;
    purgeAfter?: Date | null;
    key?: string;
    hashPolicy?: ClosureSubjectHashPolicy;
  },
  db: DatabaseQueryClient,
) {
  const hashPolicy =
    input.hashPolicy ??
    (input.key
      ? { tombstoneHashKey: input.key, tombstoneHashVersion: 1 }
      : readClosureSubjectHashPolicy());
  const currentSubject = currentClosureSubjectHash(input.userId, hashPolicy);
  const subjectHash = currentSubject.hash;
  const now = input.now ?? new Date();
  const id = `closure_tombstone_${subjectHash.slice(0, 32)}`;
  await lockClerkUserClosureSubject(input.userId, db);

  await db.query(
    `
      insert into account_closure_tombstones (
        id,
        subject_hash,
        subject_hash_version,
        subject_type,
        closure_policy_version,
        closed_at,
        purge_after,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 'clerk_user_id', $4, $5, $6, $5, $5)
      on conflict (subject_hash) do update set
        closed_at = least(account_closure_tombstones.closed_at, excluded.closed_at),
        purge_after = coalesce(account_closure_tombstones.purge_after, excluded.purge_after),
        updated_at = excluded.updated_at
    `,
    [
      id,
      subjectHash,
      currentSubject.version,
      accountClosurePolicyVersion,
      now,
      input.purgeAfter ?? null,
    ],
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
      values ($1, $2, $3, $4, 'clerk_user_id', 'active', $5, $5, $5)
      on conflict (subject_hash) do update set
        status = 'active',
        opened_at = least(account_closure_write_barriers.opened_at, excluded.opened_at),
        updated_at = excluded.updated_at
    `,
    [`closure_barrier_${subjectHash.slice(0, 32)}`, id, subjectHash, currentSubject.version, now],
  );

  return { id, subjectHash };
}

export function accountClosureSubjectHash(userId: string, key?: string, version?: number) {
  const policy = key
    ? { tombstoneHashKey: key, tombstoneHashVersion: version ?? 1 }
    : readClosureSubjectHashPolicy();
  return currentClosureSubjectHash(userId, policy).hash;
}

function primaryEmailAddress(user: UserJSON) {
  const primaryEmail = user.email_addresses.find(
    (emailAddress) => emailAddress.id === user.primary_email_address_id,
  );

  return primaryEmail?.email_address ?? user.email_addresses[0]?.email_address ?? null;
}

function timestampFromClerkMs(value: number | null) {
  return typeof value === "number" ? new Date(value) : null;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

async function withDatabaseTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.transaction) {
    return db.transaction(callback);
  }

  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function lockClerkUserClosureSubject(userId: string, db: DatabaseQueryClient) {
  await db.query(
    "select pg_advisory_xact_lock(hashtext('ask-siargao-account-write'), hashtext($1))",
    [userId],
  );
}

function resolveClosureHashPolicy(
  dependencies: Partial<EnsureCurrentUserDependencies>,
): ClosureSubjectHashPolicy | null {
  if (
    dependencies.closureSubjectHashPolicy === null ||
    dependencies.closureTombstoneHashKey === null
  ) {
    return null;
  }
  if (dependencies.closureSubjectHashPolicy) return dependencies.closureSubjectHashPolicy;
  if (dependencies.closureTombstoneHashKey) {
    return {
      tombstoneHashKey: dependencies.closureTombstoneHashKey,
      tombstoneHashVersion: 1,
    };
  }
  return readClosureSubjectHashPolicy();
}
