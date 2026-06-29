import type { ChatResponseRatingValue } from "@/server/chat/chat-response-ratings-store";
import type { DatabaseQueryClient } from "@/server/db/query-client";

export type ChatHistoryThread = {
  id: string;
  userId: string;
  title: string;
  status?: string;
  lastMessageAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ChatHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  requestId: string | null;
  model: string | null;
  sources: unknown[];
  cards: unknown[];
  actions: unknown[];
  itineraries: unknown[];
  rating: {
    rating: ChatResponseRatingValue;
    reasonCodes: string[];
    comment: string | null;
  } | null;
  createdAt: string;
};

export type ChatHistoryMessageInput = {
  id: string;
  threadId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "error";
  requestId?: string | null;
  model?: string | null;
  clientMessageId?: string | null;
  sources?: readonly unknown[];
  cards?: readonly unknown[];
  actions?: readonly unknown[];
  itineraries?: readonly unknown[];
  toolCalls?: readonly unknown[];
  contextSummary?: Record<string, unknown>;
  errorCode?: string | null;
  createdAt: Date;
};

export async function createChatThread(
  db: DatabaseQueryClient,
  input: {
    id: string;
    userId: string;
    title: string;
    now: Date;
  },
) {
  const now = input.now.toISOString();
  await db.query(
    `
      insert into chat_threads (
        id,
        user_id,
        title,
        last_message_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $4, $4)
    `,
    [input.id, input.userId, input.title, now],
  );

  return {
    id: input.id,
    userId: input.userId,
    title: input.title,
  } satisfies ChatHistoryThread;
}

export async function loadOwnedChatThread(
  db: DatabaseQueryClient,
  input: {
    threadId: string;
    userId: string;
  },
) {
  const result = await db.query<{ id: string; user_id: string; title: string }>(
    `
      select id, user_id, title
      from chat_threads
      where id = $1
        and user_id = $2
        and deleted_at is null
      limit 1
    `,
    [input.threadId, input.userId],
  );
  const row = result.rows[0];

  return row
    ? ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
      } satisfies ChatHistoryThread)
    : null;
}

export async function listOwnedChatThreads(
  db: DatabaseQueryClient,
  input: {
    userId: string;
  },
) {
  const result = await db.query<{
    id: string;
    user_id: string;
    title: string;
    status: string;
    last_message_at: Date | string | null;
    archived_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `
      select id, user_id, title, status, last_message_at, archived_at, created_at, updated_at
      from chat_threads
      where user_id = $1
        and deleted_at is null
      order by coalesce(last_message_at, updated_at, created_at) desc, created_at desc
    `,
    [input.userId],
  );

  return result.rows.map(chatThreadFromRow);
}

export async function loadOwnedChatThreadWithMessages(
  db: DatabaseQueryClient,
  input: {
    threadId: string;
    userId: string;
  },
) {
  const thread = await loadOwnedChatThread(db, input);
  if (!thread) {
    return null;
  }

  const messages = await db.query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    status: string;
    request_id: string | null;
    model: string | null;
    sources_json: unknown;
    cards_json: unknown;
    actions_json: unknown;
    itineraries_json: unknown;
    response_rating: ChatResponseRatingValue | null;
    response_rating_reason_codes_json: unknown;
    response_rating_comment: string | null;
    created_at: Date | string;
  }>(
    `
      select
        chat_messages.id,
        chat_messages.role,
        chat_messages.content,
        chat_messages.status,
        chat_messages.request_id,
        chat_messages.model,
        chat_messages.sources_json,
        chat_messages.cards_json,
        chat_messages.actions_json,
        chat_messages.itineraries_json,
        chat_response_ratings.rating as response_rating,
        chat_response_ratings.reason_codes_json as response_rating_reason_codes_json,
        chat_response_ratings.comment as response_rating_comment,
        chat_messages.created_at
      from chat_messages
      left join chat_response_ratings
        on chat_response_ratings.message_id = chat_messages.id
        and chat_response_ratings.user_id = $2
      where chat_messages.thread_id = $1
        and chat_messages.user_id = $2
      order by chat_messages.created_at, chat_messages.id
    `,
    [input.threadId, input.userId],
  );

  return {
    thread,
    messages: messages.rows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      requestId: message.request_id,
      model: message.model,
      sources: arrayFromJson(message.sources_json),
      cards: arrayFromJson(message.cards_json),
      actions: arrayFromJson(message.actions_json),
      itineraries: arrayFromJson(message.itineraries_json),
      rating: message.response_rating
        ? {
            rating: message.response_rating,
            reasonCodes: stringArrayFromJson(message.response_rating_reason_codes_json),
            comment: message.response_rating_comment,
          }
        : null,
      createdAt: timestampToIso(message.created_at),
    })),
  };
}

export async function updateOwnedChatThread(
  db: DatabaseQueryClient,
  input: {
    threadId: string;
    userId: string;
    title?: string;
    archived?: boolean;
    deleted?: boolean;
    now: Date;
  },
) {
  const existing = await loadOwnedChatThread(db, {
    threadId: input.threadId,
    userId: input.userId,
  });
  if (!existing) {
    return null;
  }

  const now = input.now.toISOString();
  await db.query(
    `
      update chat_threads
      set title = coalesce($3, title),
          archived_at = case
            when $4::boolean is true then coalesce(archived_at, $6)
            when $4::boolean is false then null
            else archived_at
          end,
          deleted_at = case
            when $5::boolean is true then coalesce(deleted_at, $6)
            when $5::boolean is false then null
            else deleted_at
          end,
          updated_at = $6
      where id = $1
        and user_id = $2
    `,
    [
      input.threadId,
      input.userId,
      input.title ?? null,
      input.archived ?? null,
      input.deleted ?? null,
      now,
    ],
  );

  if (input.deleted === true) {
    return existing;
  }

  return loadOwnedChatThread(db, {
    threadId: input.threadId,
    userId: input.userId,
  });
}

export async function appendChatHistoryMessage(
  db: DatabaseQueryClient,
  input: ChatHistoryMessageInput,
) {
  await db.query(
    `
      insert into chat_messages (
        id,
        thread_id,
        user_id,
        role,
        content,
        status,
        request_id,
        model,
        client_message_id,
        sources_json,
        cards_json,
        actions_json,
        itineraries_json,
        tool_calls_json,
        context_summary_json,
        error_code,
        created_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11::jsonb,
        $12::jsonb,
        $13::jsonb,
        $14::jsonb,
        $15::jsonb,
        $16,
        $17
      )
    `,
    [
      input.id,
      input.threadId,
      input.userId,
      input.role,
      input.content,
      input.status ?? "complete",
      input.requestId ?? null,
      input.model ?? null,
      input.clientMessageId ?? null,
      JSON.stringify(input.sources ?? []),
      JSON.stringify(input.cards ?? []),
      JSON.stringify(input.actions ?? []),
      JSON.stringify(input.itineraries ?? []),
      JSON.stringify(input.toolCalls ?? []),
      JSON.stringify(input.contextSummary ?? {}),
      input.errorCode ?? null,
      input.createdAt.toISOString(),
    ],
  );
}

export async function touchChatThread(
  db: DatabaseQueryClient,
  input: {
    threadId: string;
    lastMessageAt: Date;
  },
) {
  await db.query(
    `
      update chat_threads
      set last_message_at = $2,
          updated_at = $2
      where id = $1
    `,
    [input.threadId, input.lastMessageAt.toISOString()],
  );
}

function chatThreadFromRow(row: {
  id: string;
  user_id: string;
  title: string;
  status: string;
  last_message_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    lastMessageAt: timestampToIso(row.last_message_at),
    archivedAt: timestampToIso(row.archived_at),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  } satisfies ChatHistoryThread;
}

function arrayFromJson(value: unknown) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function stringArrayFromJson(value: unknown) {
  return arrayFromJson(value).filter((item): item is string => typeof item === "string");
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function timestampToIso(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
