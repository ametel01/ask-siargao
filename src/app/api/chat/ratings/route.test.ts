import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { putChatRatingResponse } from "@/app/api/chat/ratings/rating-route";
import { appendChatHistoryMessage, createChatThread } from "@/server/chat/chat-history-store";
import { runInitialMigration } from "@/server/db/test-database";

describe("chat rating API route", () => {
  test("returns 401 for anonymous rating requests", async () => {
    const db = await openRatingRouteTestDatabase();
    const dependencies = ratingDependencies(db, { userId: null });

    const response = await putChatRatingResponse(
      jsonRequest({ messageId: "message_1", rating: "up" }),
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });

    await db.close();
  });

  test("creates and updates one rating per assistant message", async () => {
    const db = await openRatingRouteTestDatabase();
    const dependencies = ratingDependencies(db, { userId: "user_rating" });
    const messageIds = await createRatingThread(db, "user_rating", "thread_rating");

    const createResponse = await putChatRatingResponse(
      jsonRequest({ messageId: messageIds.assistant, rating: "up" }),
      dependencies,
    );
    const updateResponse = await putChatRatingResponse(
      jsonRequest({
        messageId: messageIds.assistant,
        rating: "down",
        reasonCodes: ["incorrect", "missing_sources"],
        comment: "The place was closed.",
      }),
      dependencies,
    );
    const updateBody = await updateResponse.json();
    const count = await db.query<{ count: string }>(
      "select count(*)::text as count from chat_response_ratings where message_id = $1",
      [messageIds.assistant],
    );

    expect(createResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(updateBody.rating).toMatchObject({
      id: "chat_rating_1",
      messageId: messageIds.assistant,
      threadId: "thread_rating",
      userId: "user_rating",
      rating: "down",
      reasonCodes: ["incorrect", "missing_sources"],
      comment: "The place was closed.",
    });
    expect(count.rows[0]?.count).toBe("1");

    await db.close();
  });

  test("rejects ratings for user messages", async () => {
    const db = await openRatingRouteTestDatabase();
    const dependencies = ratingDependencies(db, { userId: "user_target" });
    const messageIds = await createRatingThread(db, "user_target", "thread_user_message");

    const response = await putChatRatingResponse(
      jsonRequest({ messageId: messageIds.user, rating: "up" }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "chat_message_not_rateable" });

    await db.close();
  });

  test("returns 404 for another user's message", async () => {
    const db = await openRatingRouteTestDatabase();
    const dependencies = ratingDependencies(db, { userId: "user_intruder" });
    const messageIds = await createRatingThread(db, "user_owner", "thread_private_rating");

    const response = await putChatRatingResponse(
      jsonRequest({ messageId: messageIds.assistant, rating: "down" }),
      dependencies,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "chat_message_not_found" });

    await db.close();
  });

  test("rejects oversized comments and invalid reason codes", async () => {
    const db = await openRatingRouteTestDatabase();
    const dependencies = ratingDependencies(db, { userId: "user_validation" });

    const longCommentResponse = await putChatRatingResponse(
      jsonRequest({
        messageId: "message_validation",
        rating: "down",
        comment: "x".repeat(1_001),
      }),
      dependencies,
    );
    const reasonResponse = await putChatRatingResponse(
      jsonRequest({
        messageId: "message_validation",
        rating: "down",
        reasonCodes: ["made_up_reason"],
      }),
      dependencies,
    );

    expect(longCommentResponse.status).toBe(400);
    expect(await longCommentResponse.json()).toMatchObject({
      error: "invalid_chat_rating_request",
    });
    expect(reasonResponse.status).toBe(400);
    expect(await reasonResponse.json()).toMatchObject({
      error: "invalid_chat_rating_request",
    });

    await db.close();
  });
});

async function openRatingRouteTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

function ratingDependencies(db: PGlite, input: { userId: string | null }) {
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
    now: () => new Date("2026-06-29T05:00:00.000Z"),
  };
}

async function createRatingThread(db: PGlite, userId: string, threadId: string) {
  await insertUser(db, userId);
  await createChatThread(db, {
    id: threadId,
    userId,
    title: "Rating thread",
    now: new Date("2026-06-29T01:00:00.000Z"),
  });

  const userMessageId = `${threadId}_user`;
  const assistantMessageId = `${threadId}_assistant`;
  await appendChatHistoryMessage(db, {
    id: userMessageId,
    threadId,
    userId,
    role: "user",
    content: "Where should I eat?",
    createdAt: new Date("2026-06-29T01:00:00.000Z"),
  });
  await appendChatHistoryMessage(db, {
    id: assistantMessageId,
    threadId,
    userId,
    role: "assistant",
    content: "Try Bravo.",
    createdAt: new Date("2026-06-29T01:01:00.000Z"),
  });

  return {
    user: userMessageId,
    assistant: assistantMessageId,
  };
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
  return new Request("https://siargao.test/api/chat/ratings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
