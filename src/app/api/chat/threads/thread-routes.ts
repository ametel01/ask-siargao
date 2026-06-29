import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import {
  createChatThread,
  listOwnedChatThreads,
  loadOwnedChatThreadWithMessages,
  updateOwnedChatThread,
} from "@/server/chat/chat-history-store";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";

const createThreadSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
});

const updateThreadSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export type ChatThreadRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  now?: () => Date;
};

function createDefaultChatThreadRouteDependencies(): ChatThreadRouteDependencies {
  return {
    createId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
    now: () => new Date(),
  };
}

export async function listChatThreadsResponse(
  dependencies: ChatThreadRouteDependencies = createDefaultChatThreadRouteDependencies(),
) {
  const currentUser = await ensureThreadUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const threads = await listOwnedChatThreads(threadDatabase(dependencies), {
    userId: currentUser.userId,
  });
  return Response.json({ threads });
}

export async function createChatThreadResponse(
  request: Request,
  dependencies: ChatThreadRouteDependencies = createDefaultChatThreadRouteDependencies(),
) {
  const currentUser = await ensureThreadUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = createThreadSchema.safeParse(body);
  if (!parsed.success) {
    return invalidThreadRequest(parsed.error.issues);
  }

  const thread = await createChatThread(threadDatabase(dependencies), {
    id: threadIdFactory(dependencies)("chat_thread"),
    userId: currentUser.userId,
    title: parsed.data.title ?? "New Siargao chat",
    now: threadNow(dependencies),
  });

  return Response.json({ thread });
}

export async function getChatThreadResponse(
  threadId: string,
  dependencies: ChatThreadRouteDependencies = createDefaultChatThreadRouteDependencies(),
) {
  const currentUser = await ensureThreadUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const thread = await loadOwnedChatThreadWithMessages(threadDatabase(dependencies), {
    threadId,
    userId: currentUser.userId,
  });
  if (!thread) {
    return Response.json({ error: "chat_thread_not_found" }, { status: 404 });
  }

  return Response.json(thread);
}

export async function patchChatThreadResponse(
  request: Request,
  threadId: string,
  dependencies: ChatThreadRouteDependencies = createDefaultChatThreadRouteDependencies(),
) {
  const currentUser = await ensureThreadUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidThreadRequest([{ path: [], message: "Expected a valid JSON request body." }]);
  }

  const parsed = updateThreadSchema.safeParse(body);
  if (!parsed.success) {
    return invalidThreadRequest(parsed.error.issues);
  }

  const thread = await updateOwnedChatThread(threadDatabase(dependencies), {
    threadId,
    userId: currentUser.userId,
    ...parsed.data,
    now: threadNow(dependencies),
  });
  if (!thread) {
    return Response.json({ error: "chat_thread_not_found" }, { status: 404 });
  }

  return Response.json({ thread });
}

export async function deleteChatThreadResponse(
  threadId: string,
  dependencies: ChatThreadRouteDependencies = createDefaultChatThreadRouteDependencies(),
) {
  const currentUser = await ensureThreadUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const thread = await updateOwnedChatThread(threadDatabase(dependencies), {
    threadId,
    userId: currentUser.userId,
    deleted: true,
    now: threadNow(dependencies),
  });
  if (!thread) {
    return Response.json({ error: "chat_thread_not_found" }, { status: 404 });
  }

  return Response.json({ deleted: true });
}

async function ensureThreadUser(dependencies: ChatThreadRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: threadDatabase(dependencies),
    now: () => threadNow(dependencies),
  });
}

function threadDatabase(dependencies: ChatThreadRouteDependencies) {
  return dependencies.db ?? getDefaultDatabaseQueryClient();
}

function threadIdFactory(dependencies: ChatThreadRouteDependencies) {
  return dependencies.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
}

function threadNow(dependencies: ChatThreadRouteDependencies) {
  return (dependencies.now ?? (() => new Date()))();
}

function invalidThreadRequest(issues: Array<{ path: readonly PropertyKey[]; message: string }>) {
  return Response.json(
    {
      error: "invalid_chat_thread_request",
      issues: issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}
