import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { upsertChatResponseRating } from "@/server/chat/chat-response-ratings-store";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";

const reasonCodeSchema = z.enum([
  "helpful",
  "not_relevant",
  "incorrect",
  "stale",
  "unsafe",
  "missing_sources",
  "too_verbose",
  "other",
]);

const ratingRequestSchema = z.strictObject({
  messageId: z.string().trim().min(1),
  rating: z.enum(["up", "down"]),
  reasonCodes: z.array(reasonCodeSchema).max(8).optional(),
  comment: z.string().trim().max(1_000).optional(),
});

export type ChatRatingRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  now?: () => Date;
};

function createDefaultChatRatingRouteDependencies(): ChatRatingRouteDependencies {
  return {
    createId: (prefix) => `${prefix}_${crypto.randomUUID()}`,
    now: () => new Date(),
  };
}

export async function putChatRatingResponse(
  request: Request,
  dependencies: ChatRatingRouteDependencies = createDefaultChatRatingRouteDependencies(),
) {
  const currentUser = await ensureRatingUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRatingRequest([{ path: "", message: "Expected a valid JSON request body." }]);
  }

  const parsed = ratingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRatingRequest(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const result = await upsertChatResponseRating(ratingDatabase(dependencies), {
    id: ratingIdFactory(dependencies)("chat_rating"),
    messageId: parsed.data.messageId,
    userId: currentUser.userId,
    rating: parsed.data.rating,
    reasonCodes: parsed.data.reasonCodes ?? [],
    comment: parsed.data.comment || null,
    now: ratingNow(dependencies),
  });

  if (result.status === "not_found") {
    return Response.json({ error: "chat_message_not_found" }, { status: 404 });
  }
  if (result.status === "not_rateable") {
    return Response.json({ error: "chat_message_not_rateable" }, { status: 400 });
  }

  return Response.json({ rating: result.rating });
}

async function ensureRatingUser(dependencies: ChatRatingRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: ratingDatabase(dependencies),
    now: () => ratingNow(dependencies),
  });
}

function ratingDatabase(dependencies: ChatRatingRouteDependencies) {
  return dependencies.db ?? getDefaultDatabaseQueryClient();
}

function ratingIdFactory(dependencies: ChatRatingRouteDependencies) {
  return dependencies.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
}

function ratingNow(dependencies: ChatRatingRouteDependencies) {
  return (dependencies.now ?? (() => new Date()))();
}

function invalidRatingRequest(issues: Array<{ path: string; message: string }>) {
  return Response.json(
    {
      error: "invalid_chat_rating_request",
      issues,
    },
    { status: 400 },
  );
}
