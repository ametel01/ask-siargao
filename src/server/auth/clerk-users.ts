import type { UserDeletedJSON, UserJSON, UserWebhookEvent } from "@clerk/backend";
import { auth } from "@clerk/nextjs/server";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";

const fallbackEmailDomain = "clerk.ask-siargao.local";

export type ClerkUserInput = {
  id: string;
  email: string;
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
  const user = normalizeSessionUser(authSnapshot, lastSeenAt);
  await upsertClerkUser(user, db);

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
) {
  if (event.type === "user.deleted") {
    const userId = event.data.id;
    if (!userId) {
      throw new Error("Clerk user.deleted event did not include a user id.");
    }

    await anonymizeDeletedClerkUser(userId, db);
    return { status: "deleted" as const, userId };
  }

  const user = normalizeClerkUser(event.data);
  await upsertClerkUser(user, db);
  return { status: "upserted" as const, userId: user.id };
}

export function normalizeClerkUser(user: UserJSON): ClerkUserInput {
  return {
    id: user.id,
    email: primaryEmailAddress(user) ?? fallbackActiveEmail(user.id),
    firstName: user.first_name,
    lastName: user.last_name,
    imageUrl: user.image_url || null,
    clerkUpdatedAt: timestampFromClerkMs(user.updated_at),
    lastSeenAt: timestampFromClerkMs(user.last_active_at),
  };
}

export function normalizeDeletedClerkUser(user: UserDeletedJSON) {
  if (!user.id) {
    throw new Error("Deleted Clerk user payload did not include a user id.");
  }

  return {
    id: user.id,
    email: fallbackDeletedEmail(user.id),
    deletedAt: new Date(),
  };
}

export async function upsertClerkUser(user: ClerkUserInput, db: DatabaseQueryClient) {
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
      values ($1, $2, $3, $4, $5, $6, $7, null, now(), now())
      on conflict (id) do update set
        email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        image_url = excluded.image_url,
        clerk_updated_at = excluded.clerk_updated_at,
        last_seen_at = coalesce(excluded.last_seen_at, users.last_seen_at),
        deleted_at = null,
        updated_at = now()
    `,
    [
      user.id,
      user.email,
      user.firstName,
      user.lastName,
      user.imageUrl,
      user.clerkUpdatedAt?.toISOString() ?? null,
      user.lastSeenAt?.toISOString() ?? null,
    ],
  );
}

export async function anonymizeDeletedClerkUser(userId: string, db: DatabaseQueryClient) {
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
      values ($1, $2, null, null, null, null, null, now(), now(), now())
      on conflict (id) do update set
        email = excluded.email,
        first_name = null,
        last_name = null,
        image_url = null,
        clerk_updated_at = null,
        deleted_at = coalesce(users.deleted_at, now()),
        updated_at = now()
    `,
    [userId, fallbackDeletedEmail(userId)],
  );
}

function normalizeSessionUser(authSnapshot: CurrentUserAuthSnapshot, lastSeenAt: Date) {
  if (!authSnapshot.userId) {
    throw new Error("Cannot normalize a session user without a Clerk user id.");
  }

  const claims = authSnapshot.sessionClaims ?? {};

  return {
    id: authSnapshot.userId,
    email:
      stringClaim(claims, ["email", "primary_email", "email_address"]) ??
      fallbackActiveEmail(authSnapshot.userId),
    firstName: stringClaim(claims, ["first_name", "given_name"]),
    lastName: stringClaim(claims, ["last_name", "family_name"]),
    imageUrl: stringClaim(claims, ["image_url", "picture"]),
    clerkUpdatedAt: null,
    lastSeenAt,
  } satisfies ClerkUserInput;
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

function stringClaim(claims: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function fallbackActiveEmail(userId: string) {
  return `unavailable+${userId}@${fallbackEmailDomain}`;
}

function fallbackDeletedEmail(userId: string) {
  return `deleted+${userId}@${fallbackEmailDomain}`;
}
