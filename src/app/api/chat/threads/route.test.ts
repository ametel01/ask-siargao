import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  createChatThreadResponse,
  deleteChatThreadResponse,
  getChatThreadResponse,
  listChatThreadsResponse,
  patchChatThreadResponse,
} from "@/app/api/chat/threads/thread-routes";
import {
  appendChatHistoryMessage,
  CHAT_THREAD_LIST_DEFAULT_LIMIT,
  CHAT_THREAD_LIST_MAX_LIMIT,
  createChatThread,
} from "@/server/chat/chat-history-store";
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

  test("keeps no-parameter list calls compatible while applying the default page cap", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_default_limit" });
    await insertUser(db, "user_default_limit");
    for (let index = 1; index <= CHAT_THREAD_LIST_DEFAULT_LIMIT + 1; index += 1) {
      await createChatThread(db, {
        id: `thread_default_${String(index).padStart(2, "0")}`,
        userId: "user_default_limit",
        title: `Thread ${index}`,
        now: new Date(Date.UTC(2026, 5, 29, 0, index)),
      });
    }

    const response = await listChatThreadsResponse(dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.threads).toHaveLength(CHAT_THREAD_LIST_DEFAULT_LIMIT);
    expect(body.threads[0].id).toBe("thread_default_26");
    expect(body.threads.map((thread: { id: string }) => thread.id)).not.toContain(
      "thread_default_01",
    );
    expect(body.pagination).toMatchObject({
      limit: CHAT_THREAD_LIST_DEFAULT_LIMIT,
      hasMore: true,
    });
    expect(typeof body.pagination.nextCursor).toBe("string");

    await db.close();
  });

  test("applies custom bounded limits and traverses cursor pages deterministically", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_cursor" });
    await insertUser(db, "user_cursor");
    for (let index = 1; index <= 5; index += 1) {
      await createChatThread(db, {
        id: `thread_cursor_${index}`,
        userId: "user_cursor",
        title: `Cursor ${index}`,
        now: new Date(Date.UTC(2026, 5, 29, 1, index)),
      });
    }

    const firstResponse = await listChatThreadsResponse(
      new Request("https://siargao.test/api/chat/threads?limit=2"),
      dependencies,
    );
    const firstBody = await firstResponse.json();
    const secondResponse = await listChatThreadsResponse(
      new Request(
        `https://siargao.test/api/chat/threads?limit=2&cursor=${encodeURIComponent(
          firstBody.pagination.nextCursor,
        )}`,
      ),
      dependencies,
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.threads.map((thread: { id: string }) => thread.id)).toEqual([
      "thread_cursor_5",
      "thread_cursor_4",
    ]);
    expect(firstBody.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(secondResponse.status).toBe(200);
    expect(secondBody.threads.map((thread: { id: string }) => thread.id)).toEqual([
      "thread_cursor_3",
      "thread_cursor_2",
    ]);
    expect(secondBody.pagination).toMatchObject({ limit: 2, hasMore: true });

    await db.close();
  });

  test("uses thread id as a stable tiebreaker for equal recency timestamps", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_ties" });
    await insertUser(db, "user_ties");
    const tiedAt = new Date("2026-06-29T02:00:00.000Z");
    await createChatThread(db, {
      id: "thread_tie_a",
      userId: "user_ties",
      title: "Tie A",
      now: tiedAt,
    });
    await createChatThread(db, {
      id: "thread_tie_b",
      userId: "user_ties",
      title: "Tie B",
      now: tiedAt,
    });
    await createChatThread(db, {
      id: "thread_tie_c",
      userId: "user_ties",
      title: "Tie C",
      now: tiedAt,
    });

    const response = await listChatThreadsResponse(
      new Request("https://siargao.test/api/chat/threads?limit=2"),
      dependencies,
    );
    const body = await response.json();
    const nextResponse = await listChatThreadsResponse(
      new Request(
        `https://siargao.test/api/chat/threads?limit=2&cursor=${encodeURIComponent(
          body.pagination.nextCursor,
        )}`,
      ),
      dependencies,
    );
    const nextBody = await nextResponse.json();

    expect(body.threads.map((thread: { id: string }) => thread.id)).toEqual([
      "thread_tie_c",
      "thread_tie_b",
    ]);
    expect(nextBody.threads.map((thread: { id: string }) => thread.id)).toEqual(["thread_tie_a"]);
    expect(nextBody.pagination).toMatchObject({ hasMore: false, nextCursor: null });

    await db.close();
  });

  test("rejects invalid limits and clamps unsafe oversized limits", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_limit_validation" });

    const invalidResponse = await listChatThreadsResponse(
      new Request("https://siargao.test/api/chat/threads?limit=0"),
      dependencies,
    );
    const oversizedResponse = await listChatThreadsResponse(
      new Request("https://siargao.test/api/chat/threads?limit=9999"),
      dependencies,
    );
    const oversizedBody = await oversizedResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: "invalid_chat_thread_request",
      issues: [{ path: "limit" }],
    });
    expect(oversizedResponse.status).toBe(200);
    expect(oversizedBody.pagination.limit).toBe(CHAT_THREAD_LIST_MAX_LIMIT);

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
    expect(body.messages[1].cards).toEqual([
      { id: "card_1", title: "Cloud 9", fitReasons: [], caveats: [] },
    ]);
    expect(body.messages[1].decisionSummaries).toEqual([
      {
        id: "condition_decision:swimming:cloud_9:today",
        bestAction: "Keep swimming flexible.",
        basis: "Weather is usable, but surf reports are not checked.",
        timing: "today",
        area: "Cloud 9",
        sources: [
          {
            label: "weather_checked",
            sourceName: "Open-Meteo weather API",
            sourceProfileId: "source_open_meteo",
            confidence: "medium",
            checked: ["forecast for Siargao Island"],
            notChecked: ["surf reports"],
          },
        ],
      },
    ]);
    expect(body.messages[1].rating).toMatchObject({
      rating: "up",
      reasonCodes: ["helpful"],
      comment: null,
    });

    await db.close();
  });

  test("returns hydrated assistant messages as display-ready public turns", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_display" });
    await insertUser(db, "user_display");
    await createChatThread(db, {
      id: "thread_display",
      userId: "user_display",
      title: "Display-safe thread",
      now: new Date("2026-06-29T01:00:00.000Z"),
    });
    await appendChatHistoryMessage(db, {
      id: "thread_display_assistant",
      threadId: "thread_display",
      userId: "user_display",
      role: "assistant",
      content: "Try Shaka near Cloud 9. Not checked: table availability or menu changes.",
      sources: [
        {
          label: "live_checked",
          sourceName: "Google Places",
          sourceProfileId: "source_google_places",
          confidence: "high",
          checked: ["open-now result"],
          notChecked: ["review text"],
        },
        {
          label: "provider_unavailable",
          sourceName: "Google Places",
          sourceProfileId: "source_google_places",
          confidence: "low",
          checked: [],
          notChecked: ["Google Places lookup"],
        },
      ],
      cards: [
        {
          id: "place_shaka",
          kind: "place",
          title: "Shaka Siargao",
          fitReasons: ["Checked cafe.", "Use search_places before claiming reliability."],
          caveats: ["Review text was not checked.", "Bring cash."],
          sourceLabel: "Google Places - live checked",
          sources: [
            {
              label: "live_checked",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "high",
              checked: ["open-now result"],
              notChecked: ["review text"],
            },
          ],
        },
      ],
      createdAt: new Date("2026-06-29T01:00:01.000Z"),
    });

    const response = await getChatThreadResponse("thread_display", dependencies);
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.messages[0].content).toBe("Try Shaka near Cloud 9.");
    expect(body.messages[0].sources).toEqual([
      {
        label: "live_checked",
        sourceName: "Google Places",
        sourceProfileId: "source_google_places",
        confidence: "high",
        checked: ["open-now result"],
        notChecked: ["review text"],
      },
      {
        label: "provider_unavailable",
        sourceName: "Google Places",
        sourceProfileId: "source_google_places",
        confidence: "low",
        checked: [],
        notChecked: ["Google Places lookup"],
      },
    ]);
    expect(body.messages[0].cards).toEqual([]);
    expect(serializedBody).not.toContain("Review text");
    expect(serializedBody).not.toContain("table availability");

    await db.close();
  });

  test("preserves user source-like text while sanitizing hydrated assistant messages", async () => {
    const db = await openThreadRouteTestDatabase();
    const dependencies = threadDependencies(db, { userId: "user_verbatim" });
    const userPrompt = [
      "Not checked: can you compare Shaka and Kurvada?",
      "Checked: Traveler notes (pasted text) - this is part of my question.",
    ].join("\n");
    await insertUser(db, "user_verbatim");
    await createChatThread(db, {
      id: "thread_verbatim",
      userId: "user_verbatim",
      title: "Verbatim user text",
      now: new Date("2026-06-29T01:00:00.000Z"),
    });
    await appendChatHistoryMessage(db, {
      id: "thread_verbatim_user",
      threadId: "thread_verbatim",
      userId: "user_verbatim",
      role: "user",
      content: userPrompt,
      createdAt: new Date("2026-06-29T01:00:01.000Z"),
    });
    await appendChatHistoryMessage(db, {
      id: "thread_verbatim_assistant",
      threadId: "thread_verbatim",
      userId: "user_verbatim",
      role: "assistant",
      content: "Try Shaka first. Not checked: table availability or latest menu.",
      createdAt: new Date("2026-06-29T01:00:02.000Z"),
    });

    const response = await getChatThreadResponse("thread_verbatim", dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({
      role: "user",
      content: userPrompt,
    });
    expect(body.messages[1]).toMatchObject({
      role: "assistant",
      content: "Try Shaka first.",
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
    decisionSummaries:
      threadId === "thread_detail"
        ? [
            {
              id: "condition_decision:swimming:cloud_9:today",
              bestAction: "Keep swimming flexible.",
              basis: "Weather is usable, but surf reports are not checked.",
              timing: "today",
              area: "Cloud 9",
              sources: [
                {
                  label: "weather_checked",
                  sourceName: "Open-Meteo weather API",
                  sourceProfileId: "source_open_meteo",
                  confidence: "medium",
                  checked: ["forecast for Siargao Island"],
                  notChecked: ["surf reports"],
                },
              ],
            },
          ]
        : [],
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
