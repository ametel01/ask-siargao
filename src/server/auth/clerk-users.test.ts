import { describe, expect, test } from "bun:test";
import type { UserJSON, UserWebhookEvent } from "@clerk/backend";
import { PGlite } from "@electric-sql/pglite";

import {
  anonymizeDeletedClerkUser,
  applyClerkUserWebhookEvent,
  ensureCurrentUser,
  getAuthenticatedClerkUserId,
  normalizeClerkUser,
  upsertClerkUser,
} from "@/server/auth/clerk-users";
import { runInitialMigration } from "@/server/db/test-database";

describe("Clerk user sync helpers", () => {
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

  test("anonymizes and soft-deletes local users for Clerk delete events", async () => {
    const db = await openClerkUserTestDatabase();
    await upsertClerkUser(normalizeClerkUser(clerkUser({ id: "user_delete" })), db);

    await anonymizeDeletedClerkUser("user_delete", db);

    const row = await loadUser(db, "user_delete");
    expect(row).toMatchObject({
      id: "user_delete",
      email: "deleted+user_delete@clerk.ask-siargao.local",
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
    });
    expect(row?.deleted_at).not.toBeNull();

    await db.close();
  });

  test("ensures the current authenticated user when webhooks are eventually consistent", async () => {
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
      email: "session@example.com",
      first_name: "Session",
      last_name: "Traveler",
      image_url: "https://img.clerk.test/session",
      deleted_at: null,
    });
    expect(toIsoString(row?.last_seen_at)).toBe("2026-06-29T03:00:00.000Z");

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
    email: string;
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
