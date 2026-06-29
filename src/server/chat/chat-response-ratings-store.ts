import type { DatabaseQueryClient } from "@/server/db/query-client";

export type ChatResponseRatingValue = "up" | "down";

export type ChatResponseRating = {
  id: string;
  messageId: string;
  threadId: string;
  userId: string;
  rating: ChatResponseRatingValue;
  reasonCodes: string[];
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertChatResponseRatingResult =
  | { status: "rated"; rating: ChatResponseRating }
  | { status: "not_found" }
  | { status: "not_rateable" };

export async function upsertChatResponseRating(
  db: DatabaseQueryClient,
  input: {
    id: string;
    messageId: string;
    userId: string;
    rating: ChatResponseRatingValue;
    reasonCodes: readonly string[];
    comment: string | null;
    now: Date;
  },
): Promise<UpsertChatResponseRatingResult> {
  const target = await db.query<{
    message_id: string;
    thread_id: string;
    user_id: string;
    role: "user" | "assistant";
  }>(
    `
      select
        chat_messages.id as message_id,
        chat_messages.thread_id,
        chat_messages.user_id,
        chat_messages.role
      from chat_messages
      inner join chat_threads on chat_threads.id = chat_messages.thread_id
      where chat_messages.id = $1
        and chat_messages.user_id = $2
        and chat_threads.user_id = $2
        and chat_threads.deleted_at is null
      limit 1
    `,
    [input.messageId, input.userId],
  );
  const message = target.rows[0];
  if (!message) {
    return { status: "not_found" };
  }
  if (message.role !== "assistant") {
    return { status: "not_rateable" };
  }

  const now = input.now.toISOString();
  await db.query(
    `
      insert into chat_response_ratings (
        id,
        message_id,
        thread_id,
        user_id,
        rating,
        reason_codes_json,
        comment,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8)
      on conflict (user_id, message_id) do update set
        rating = excluded.rating,
        reason_codes_json = excluded.reason_codes_json,
        comment = excluded.comment,
        updated_at = excluded.updated_at
    `,
    [
      input.id,
      input.messageId,
      message.thread_id,
      input.userId,
      input.rating,
      JSON.stringify(input.reasonCodes),
      input.comment,
      now,
    ],
  );

  const rating = await loadChatResponseRating(db, {
    messageId: input.messageId,
    userId: input.userId,
  });
  if (!rating) {
    return { status: "not_found" };
  }

  return { status: "rated", rating };
}

async function loadChatResponseRating(
  db: DatabaseQueryClient,
  input: {
    messageId: string;
    userId: string;
  },
) {
  const result = await db.query<{
    id: string;
    message_id: string;
    thread_id: string;
    user_id: string;
    rating: ChatResponseRatingValue;
    reason_codes_json: unknown;
    comment: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `
      select
        id,
        message_id,
        thread_id,
        user_id,
        rating,
        reason_codes_json,
        comment,
        created_at,
        updated_at
      from chat_response_ratings
      where message_id = $1
        and user_id = $2
      limit 1
    `,
    [input.messageId, input.userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    messageId: row.message_id,
    threadId: row.thread_id,
    userId: row.user_id,
    rating: row.rating,
    reasonCodes: arrayFromJson(row.reason_codes_json),
    comment: row.comment,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  } satisfies ChatResponseRating;
}

function arrayFromJson(value: unknown) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
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

function timestampToIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
