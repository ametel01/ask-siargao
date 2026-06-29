import type { DatabaseQueryClient } from "@/server/db/query-client";

export type ChatHistoryThread = {
  id: string;
  userId: string;
  title: string;
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
