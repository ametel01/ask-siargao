import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  createChatThreadResponse,
  deleteChatThreadResponse,
  getChatThreadResponse,
  listChatThreadsResponse,
  patchChatThreadResponse,
} from "@/app/api/chat/threads/thread-routes";
import { appendChatHistoryMessage, createChatThread } from "@/server/chat/chat-history-store";
import { upsertChatResponseRating } from "@/server/chat/chat-response-ratings-store";
import { runInitialMigration } from "@/server/db/test-database";

describe("chat thread API routes", () => {
  test("returns 401 for anonymous thread requests", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: null });

    const response = await listChatThreadsResponse(dependencies);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });

    await db.close();
  });

  test("lists owned threads newest first", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_threads" });
    await createThreadWithMessage(
      db,
      "user_threads",
      "thread_old",
      "Old plan",
      "2026-06-29T01:00:00.000Z",
    );
    await createThreadWithMessage(
      db,
      "user_threads",
      "thread_new",
      "New plan",
      "2026-06-29T02:00:00.000Z",
    );
    await createThreadWithMessage(
      db,
      "user_other",
      "thread_other",
      "Other plan",
      "2026-06-29T03:00:00.000Z",
    );

    const response = await listChatThreadsResponse(dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.threads.map((thread: { id: string }) => thread.id)).toEqual([
      "thread_new",
      "thread_old",
    ]);

    await db.close();
  });

  test("creates an empty owned thread", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_create" });

    const response = await createChatThreadResponse(
      jsonRequest({ title: "Fresh ideas" }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "chat_thread_1",
      title: "Fresh ideas",
      userId: "user_create",
    });

    await db.close();
  });

  test("loads one owned thread with messages", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_detail" });
    await createThreadWithMessage(
      db,
      "user_detail",
      "thread_detail",
      "Detail plan",
      "2026-06-29T01:00:00.000Z",
    );
    await upsertChatResponseRating(db, {
      id: "rating_detail",
      messageId: "thread_detail_assistant",
      userId: "user_detail",
      rating: "up",
      reasonCodes: ["helpful"],
      comment: null,
      now: new Date("2026-06-29T01:02:00.000Z"),
    });

    const response = await getChatThreadResponse("thread_detail", dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread.id).toBe("thread_detail");
    expect(body.messages).toHaveLength(2);
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(body.messages[1].cards).toEqual([{ id: "card_1", title: "Cloud 9" }]);
    expect(body.messages[1].rating).toMatchObject({
      rating: "up",
      reasonCodes: ["helpful"],
      comment: null,
    });

    await db.close();
  });

  test("returns 404 for another user's thread", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_intruder" });
    await createThreadWithMessage(
      db,
      "user_owner",
      "thread_private",
      "Private",
      "2026-06-29T01:00:00.000Z",
    );

    const response = await getChatThreadResponse("thread_private", dependencies);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "chat_thread_not_found" });

    await db.close();
  });

  test("renames, archives, and deletes owned threads", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_update" });
    await createThreadWithMessage(
      db,
      "user_update",
      "thread_update",
      "Original",
      "2026-06-29T01:00:00.000Z",
    );

    const renameResponse = await patchChatThreadResponse(
      jsonRequest({ title: "Renamed", archived: true }),
      "thread_update",
      dependencies,
    );
    const renameBody = await renameResponse.json();
    const deleteResponse = await deleteChatThreadResponse("thread_update", dependencies);
    const listResponse = await listChatThreadsResponse(dependencies);
    const listBody = await listResponse.json();

    expect(renameResponse.status).toBe(200);
    expect(renameBody.thread.title).toBe("Renamed");
    expect(renameBody.thread.archivedAt).not.toBeNull();
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ deleted: true });
    expect(listBody.threads).toEqual([]);

    await db.close();
  });
});

async function openThreadRouteTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

function threadDependencies(db: PGlite, input: { userId: string | null }) {
  let nextId = 0;
  return {
    auth: async () => ({
      userId: input.userId,
      sessionClaims: input.userId ? { email: `${input.userId}@example.com` } : null,
    }),
    createId: (prefix: string) => {
      nextId += 1;
      return `${prefix}_${nextId}`;
    },
    db,
    now: () => new Date("2026-06-29T04:00:00.000Z"),
  };
}

async function createThreadWithMessage(
  db: PGlite,
  userId: string,
  threadId: string,
  title: string,
  createdAt: string,
) {
  await insertUser(db, userId);
  await createChatThread(db, {
    id: threadId,
    userId,
    title,
    now: new Date(createdAt),
  });
  await appendChatHistoryMessage(db, {
    id: `${threadId}_user`,
    threadId,
    userId,
    role: "user",
    content: "Where should I go?",
    createdAt: new Date(createdAt),
  });
  await appendChatHistoryMessage(db, {
    id: `${threadId}_assistant`,
    threadId,
    userId,
    role: "assistant",
    content: "Try Cloud 9.",
    cards: [{ id: "card_1", title: "Cloud 9" }],
    createdAt: new Date(Date.parse(createdAt) + 1_000),
  });
}

async function insertUser(db: PGlite, userId: string) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (id) do nothing
    `,
    [userId, `${userId}@example.com`],
  );
}

function jsonRequest(body: unknown) {
  return new Request("https://siargao.test/api/chat/threads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
