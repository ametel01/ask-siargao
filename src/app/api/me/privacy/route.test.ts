import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  type PrivacyRouteDependencies,
  postPrivacyActionResponse,
} from "@/app/api/me/privacy/privacy-route";
import {
  appendChatHistoryMessage,
  createChatThread,
  updateOwnedChatThread,
} from "@/server/chat/chat-history-store";
import { upsertChatResponseRating } from "@/server/chat/chat-response-ratings-store";
import { runInitialMigration } from "@/server/db/test-database";
import type { PrivacyAuditEvent } from "@/server/privacy/travel-data-controls";
import { hashClientTripKey, hashPublicToken } from "@/server/trips/shared-trip-store";

describe("privacy data controls route", () => {
  test("deletes only the authenticated user's complete chat graph and is repeat safe", async () => {
    const dependencies = await privacyDependencies({ userId: "user_privacy_chat" });
    await seedChatGraph(dependencies.db, "user_privacy_chat", "owner");
    await seedChatGraph(dependencies.db, "user_other_chat", "other");

    const invalidResponse = await postPrivacyActionResponse(
      privacyRequest({
        action: "delete_chat_history",
        confirmation: "DELETE CHAT HISTORY",
        userId: "user_other_chat",
      }),
      dependencies,
    );
    const invalidBody = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.error).toBe("invalid_privacy_request");

    const validResponse = await postPrivacyActionResponse(
      privacyRequest({ action: "delete_chat_history", confirmation: "DELETE CHAT HISTORY" }),
      dependencies,
    );
    const validBody = await validResponse.json();
    const retryResponse = await postPrivacyActionResponse(
      privacyRequest({ action: "delete_chat_history", confirmation: "DELETE CHAT HISTORY" }),
      dependencies,
    );
    const retryBody = await retryResponse.json();
    const counts = await tableCounts(dependencies.db, [
      "chat_threads",
      "chat_messages",
      "chat_response_ratings",
    ]);

    expect(validResponse.status).toBe(200);
    expect(validBody.status).toBe("success");
    expect(validBody.counts).toMatchObject({
      chatRatingsDeleted: 2,
      chatMessagesDeleted: 6,
      chatThreadsDeleted: 3,
    });
    expect(retryResponse.status).toBe(200);
    expect(retryBody).toMatchObject({
      status: "already_empty",
      counts: {
        chatRatingsDeleted: 0,
        chatMessagesDeleted: 0,
        chatThreadsDeleted: 0,
      },
    });
    expect(counts).toEqual({
      chat_threads: 3,
      chat_messages: 6,
      chat_response_ratings: 2,
    });
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("Private owner prompt");
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("DELETE CHAT HISTORY");

    await dependencies.close();
  });

  test("deletes owned saved planning data, invalidates affected shares, and preserves other users and anonymous trips", async () => {
    const dependencies = await privacyDependencies({ userId: "user_saved_owner" });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_owner_a",
      userId: "user_saved_owner",
      shareToken: "owner-token-a",
      itemId: "owner_item_a",
    });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_owner_b",
      userId: "user_saved_owner",
      shareToken: "owner-token-b",
      itemId: "owner_item_b",
    });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_other",
      userId: "user_saved_other",
      shareToken: "other-token",
      itemId: "other_item",
    });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_anon",
      userId: null,
      shareToken: "anonymous-token",
      itemId: "anonymous_item",
    });

    const response = await postPrivacyActionResponse(
      privacyRequest({
        action: "delete_saved_planning_data",
        confirmation: "DELETE SAVED PLANNING DATA",
      }),
      dependencies,
    );
    const body = await response.json();
    const retryResponse = await postPrivacyActionResponse(
      privacyRequest({
        action: "delete_saved_planning_data",
        confirmation: "DELETE SAVED PLANNING DATA",
      }),
      dependencies,
    );
    const ownerShare = await lookupShareByToken(dependencies.db, "owner-token-a");
    const otherShare = await lookupShareByToken(dependencies.db, "other-token");
    const anonymousShare = await lookupShareByToken(dependencies.db, "anonymous-token");
    const counts = await tableCounts(dependencies.db, [
      "saved_trips",
      "saved_trip_items",
      "shared_trip_plans",
    ]);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "success",
      counts: {
        savedTripsDeleted: 2,
        savedItemsDeleted: 2,
        sharedPlansInvalidated: 2,
      },
    });
    expect((await retryResponse.json()).status).toBe("already_empty");
    expect(ownerShare).toBeNull();
    expect(otherShare?.title).toBe("other_item share");
    expect(anonymousShare?.title).toBe("anonymous_item share");
    expect(counts).toEqual({
      saved_trips: 2,
      saved_trip_items: 2,
      shared_trip_plans: 2,
    });
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("owner-token");
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("private payload");

    await dependencies.close();
  });

  test("keeps saved planning data intact when the deletion transaction fails", async () => {
    const dependencies = await privacyDependencies({ userId: "user_saved_rollback" });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_rollback",
      userId: "user_saved_rollback",
      shareToken: "rollback-token",
      itemId: "rollback_item",
    });
    await dependencies.db.query(
      `
        create function block_saved_item_delete()
        returns trigger as $$
        begin
          raise exception 'blocked privacy delete';
        end;
        $$ language plpgsql;
      `,
    );
    await dependencies.db.query(
      `
        create trigger saved_item_delete_blocker
        before delete on saved_trip_items
        for each row execute function block_saved_item_delete()
      `,
    );

    const response = await postPrivacyActionResponse(
      privacyRequest({
        action: "delete_saved_planning_data",
        confirmation: "DELETE SAVED PLANNING DATA",
      }),
      dependencies,
    );
    const counts = await tableCounts(dependencies.db, [
      "saved_trips",
      "saved_trip_items",
      "shared_trip_plans",
    ]);
    const share = await lookupShareByToken(dependencies.db, "rollback-token");

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "privacy_action_failed" });
    expect(counts).toEqual({
      saved_trips: 1,
      saved_trip_items: 1,
      shared_trip_plans: 1,
    });
    expect(share?.title).toBe("rollback_item share");
    expect(dependencies.auditEvents.at(-1)).toMatchObject({
      action: "delete_saved_planning_data",
      outcome: "server_failed",
    });

    await dependencies.close();
  });

  test("clears only stored area and accommodation context while preserving profile fields and marketing consent", async () => {
    const dependencies = await privacyDependencies({ userId: "user_location_privacy" });
    await dependencies.db.query(
      `
        insert into user_profiles (
          user_id, display_name, marketing_consent, interests_json, trip_context_json,
          created_at, updated_at
        )
        values ($1, $2, true, $3::jsonb, $4::jsonb, $5, $5)
      `,
      [
        "user_location_privacy",
        "Location Traveler",
        JSON.stringify(["surf"]),
        JSON.stringify({
          accommodation: "Private villa",
          currentArea: "Cloud 9",
          dateRange: "Aug 1 - 6",
          notes: "Preserve this",
          geolocation: { latitude: 9.8116, longitude: 126.1651 },
        }),
        nowIso,
      ],
    );

    const invalidResponse = await postPrivacyActionResponse(
      privacyRequest({
        action: "clear_location_context",
        confirmation: "CLEAR LOCATION CONTEXT",
        clearFields: ["currentArea", "geolocation"],
      }),
      dependencies,
    );
    const response = await postPrivacyActionResponse(
      privacyRequest({
        action: "clear_location_context",
        confirmation: "CLEAR LOCATION CONTEXT",
        clearFields: ["currentArea", "accommodation"],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(invalidResponse.status).toBe(400);
    expect(response.status).toBe(200);
    expect(body.profile.profile).toMatchObject({
      displayName: "Location Traveler",
      interests: ["surf"],
      marketingConsent: true,
      tripContext: {
        dateRange: "Aug 1 - 6",
        notes: "Preserve this",
      },
    });
    expect(body.profile.profile.tripContext).not.toHaveProperty("accommodation");
    expect(body.profile.profile.tripContext).not.toHaveProperty("currentArea");
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("Private villa");
    expect(JSON.stringify(dependencies.auditEvents)).not.toContain("9.8116");

    await dependencies.close();
  });

  test("rejects unauthenticated, malformed, and duplicate concurrent privacy requests safely", async () => {
    const anonymous = await privacyDependencies({ userId: null });
    const unauthenticated = await postPrivacyActionResponse(
      privacyRequest({ action: "delete_chat_history", confirmation: "DELETE CHAT HISTORY" }),
      anonymous,
    );
    const invalid = await postPrivacyActionResponse(
      privacyRequest({ action: "delete_chat_history", confirmation: "delete chat history" }),
      anonymous,
    );

    expect(unauthenticated.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(anonymous.auditEvents.map((event) => event.outcome)).toEqual([
      "authentication_failed",
      "validation_failed",
    ]);
    await anonymous.close();

    const dependencies = await privacyDependencies({ userId: "user_concurrent_privacy" });
    await seedSavedPlanningGraph(dependencies.db, {
      tripId: "saved_trip_concurrent",
      userId: "user_concurrent_privacy",
      shareToken: "concurrent-token",
      itemId: "concurrent_item",
    });
    const [first, second] = await Promise.all([
      postPrivacyActionResponse(
        privacyRequest({
          action: "delete_saved_planning_data",
          confirmation: "DELETE SAVED PLANNING DATA",
        }),
        dependencies,
      ),
      postPrivacyActionResponse(
        privacyRequest({
          action: "delete_saved_planning_data",
          confirmation: "DELETE SAVED PLANNING DATA",
        }),
        dependencies,
      ),
    ]);
    const statuses = [(await first.json()).status, (await second.json()).status].toSorted();

    expect(statuses).toEqual(["already_empty", "success"]);
    expect(await lookupShareByToken(dependencies.db, "concurrent-token")).toBeNull();

    await dependencies.close();
  });
});

type TestPrivacyDependencies = Omit<PrivacyRouteDependencies, "db"> & {
  auditEvents: PrivacyAuditEvent[];
  close: () => Promise<void>;
  db: PGlite;
};

async function privacyDependencies(input: {
  userId: string | null;
}): Promise<TestPrivacyDependencies> {
  const db = new PGlite();
  await runInitialMigration(db);
  if (input.userId) {
    await insertUser(db, input.userId);
  }
  const auditEvents: PrivacyAuditEvent[] = [];
  return {
    auditEvents,
    auditSink: (event) => {
      auditEvents.push(event);
    },
    auth: async () => ({
      userId: input.userId,
      sessionClaims: input.userId ? { email: `${input.userId}@example.com` } : null,
    }),
    close: () => db.close(),
    db,
    now: () => new Date(nowIso),
    requestId: () => "privacy-request-id",
  };
}

async function seedChatGraph(db: PGlite, userId: string, prefix: string) {
  await insertUser(db, userId);
  for (const [index, state] of ["active", "archived", "deleted"].entries()) {
    const threadId = `${prefix}_thread_${state}`;
    await createChatThread(db, {
      id: threadId,
      now: new Date(Date.parse(nowIso) + index),
      title: `${state} thread`,
      userId,
    });
    await appendChatHistoryMessage(db, {
      id: `${threadId}_user`,
      content: `Private ${prefix} prompt`,
      createdAt: new Date(Date.parse(nowIso) + index + 1),
      role: "user",
      threadId,
      userId,
    });
    await appendChatHistoryMessage(db, {
      id: `${threadId}_assistant`,
      content: `Private ${prefix} answer`,
      createdAt: new Date(Date.parse(nowIso) + index + 2),
      role: "assistant",
      threadId,
      userId,
    });
    if (state === "archived") {
      await updateOwnedChatThread(db, {
        archived: true,
        now: new Date(Date.parse(nowIso) + index + 3),
        threadId,
        userId,
      });
    }
    if (state === "deleted") {
      await updateOwnedChatThread(db, {
        deleted: true,
        now: new Date(Date.parse(nowIso) + index + 3),
        threadId,
        userId,
      });
    }
    if (state !== "deleted") {
      await upsertChatResponseRating(db, {
        id: `${threadId}_rating`,
        comment: `Private ${prefix} rating`,
        messageId: `${threadId}_assistant`,
        now: new Date(Date.parse(nowIso) + index + 4),
        rating: "up",
        reasonCodes: ["helpful"],
        userId,
      });
    }
  }
}

async function seedSavedPlanningGraph(
  db: PGlite,
  input: { tripId: string; userId: string | null; itemId: string; shareToken: string },
) {
  if (input.userId) {
    await insertUser(db, input.userId);
  }
  await db.query(
    `
      insert into saved_trips (id, user_id, client_trip_key_hash, title, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $5)
    `,
    [input.tripId, input.userId, hashClientTripKey(input.tripId), `${input.itemId} trip`, nowIso],
  );
  await db.query(
    `
      insert into saved_trip_items (
        id, trip_id, kind, title, payload_json, sources_json, created_at, updated_at
      )
      values ($1, $2, 'place', $3, $4::jsonb, $5::jsonb, $6, $6)
    `,
    [
      input.itemId,
      input.tripId,
      `${input.itemId} private payload`,
      JSON.stringify({ type: "note", text: "private payload" }),
      JSON.stringify([{ label: "not_verified", notChecked: ["private provider observation"] }]),
      nowIso,
    ],
  );
  await db.query(
    `
      insert into shared_trip_plans (
        id, trip_id, public_token_hash, title, item_ids_json, items_json,
        expires_at, deleted_at, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, null, null, $7, $7)
    `,
    [
      `share_${input.itemId}`,
      input.tripId,
      hashPublicToken(input.shareToken),
      `${input.itemId} share`,
      JSON.stringify([input.itemId]),
      JSON.stringify([{ id: input.itemId, title: `${input.itemId} private payload` }]),
      nowIso,
    ],
  );
}

async function insertUser(db: PGlite, userId: string) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, $3, $3)
      on conflict (id) do nothing
    `,
    [userId, `${userId}@example.com`, nowIso],
  );
}

async function tableCounts(db: PGlite, tables: readonly string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await db.query<{ count: number | string }>(
      `select count(*) as count from ${table}`,
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }

  return counts;
}

async function lookupShareByToken(db: PGlite, token: string) {
  const result = await db.query<{ title: string }>(
    `
      select title
      from shared_trip_plans
      where public_token_hash = $1
      limit 1
    `,
    [hashPublicToken(token)],
  );

  return result.rows[0] ?? null;
}

function privacyRequest(body: unknown) {
  return new Request("https://siargao.test/api/me/privacy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const nowIso = "2026-07-12T04:00:00.000Z";
