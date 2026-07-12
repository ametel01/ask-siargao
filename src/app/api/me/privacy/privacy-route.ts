import { z } from "zod";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  clearOwnedLocationContext,
  defaultPrivacyAuditSink,
  deleteOwnedChatHistory,
  deleteOwnedSavedPlanningData,
  type PrivacyAction,
  type PrivacyAuditSink,
  recordPrivacyAudit,
} from "@/server/privacy/travel-data-controls";

export type PrivacyRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  auditSink?: PrivacyAuditSink;
  db: DatabaseQueryClient;
  now: () => Date;
  requestId: () => string;
};

const deleteChatHistorySchema = z.strictObject({
  action: z.literal("delete_chat_history"),
  confirmation: z.literal("DELETE CHAT HISTORY"),
});

const deleteSavedPlanningDataSchema = z.strictObject({
  action: z.literal("delete_saved_planning_data"),
  confirmation: z.literal("DELETE SAVED PLANNING DATA"),
});

const clearLocationContextSchema = z.strictObject({
  action: z.literal("clear_location_context"),
  clearFields: z
    .array(z.enum(["currentArea", "accommodation"]))
    .min(1)
    .max(2)
    .refine((fields) => new Set(fields).size === fields.length, {
      message: "Choose each location field once.",
    })
    .optional(),
  confirmation: z.literal("CLEAR LOCATION CONTEXT"),
});

const privacyActionSchema = z.discriminatedUnion("action", [
  deleteChatHistorySchema,
  deleteSavedPlanningDataSchema,
  clearLocationContextSchema,
]);

function createDefaultPrivacyRouteDependencies(): PrivacyRouteDependencies {
  return {
    auditSink: defaultPrivacyAuditSink,
    db: getDefaultDatabaseQueryClient(),
    now: () => new Date(),
    requestId: () => crypto.randomUUID(),
  };
}

export async function postPrivacyActionResponse(
  request: Request,
  dependencies: PrivacyRouteDependencies = createDefaultPrivacyRouteDependencies(),
) {
  // Correlation IDs are audit metadata. Never let a caller choose the value that is logged.
  const requestId = dependencies.requestId();
  const auditSink = dependencies.auditSink ?? defaultPrivacyAuditSink;
  const now = dependencies.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await recordPrivacyAudit(auditSink, {
      action: "delete_chat_history",
      actorRef: null,
      at: now,
      outcome: "validation_failed",
      requestId,
    });
    return invalidPrivacyRequest([{ path: "", message: "Expected a valid JSON request body." }]);
  }

  const parsed = privacyActionSchema.safeParse(body);
  if (!parsed.success) {
    await recordPrivacyAudit(auditSink, {
      action: actionFromBody(body) ?? "delete_chat_history",
      actorRef: null,
      at: now,
      outcome: "validation_failed",
      requestId,
    });
    return invalidPrivacyRequest(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const currentUser = await ensurePrivacyUser(dependencies);
  if (!currentUser) {
    await recordPrivacyAudit(auditSink, {
      action: parsed.data.action,
      actorRef: null,
      at: now,
      outcome: "authentication_failed",
      requestId,
    });
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    if (parsed.data.action === "delete_chat_history") {
      const result = await deleteOwnedChatHistory(dependencies.db, { userId: currentUser.userId });
      await recordPrivacyAudit(auditSink, {
        action: parsed.data.action,
        actorRef: currentUser.userId,
        at: now,
        counts: result.counts,
        outcome: result.status,
        requestId,
      });
      return Response.json({ action: parsed.data.action, ...result, requestId });
    }

    if (parsed.data.action === "delete_saved_planning_data") {
      const result = await deleteOwnedSavedPlanningData(dependencies.db, {
        userId: currentUser.userId,
      });
      await recordPrivacyAudit(auditSink, {
        action: parsed.data.action,
        actorRef: currentUser.userId,
        at: now,
        counts: result.counts,
        outcome: result.status,
        requestId,
      });
      return Response.json({ action: parsed.data.action, ...result, requestId });
    }

    const result = await clearOwnedLocationContext(dependencies.db, {
      userId: currentUser.userId,
      now,
    });
    await recordPrivacyAudit(auditSink, {
      action: parsed.data.action,
      actorRef: currentUser.userId,
      at: now,
      counts: result.counts,
      outcome: result.status,
      requestId,
    });
    return Response.json({ action: parsed.data.action, ...result, requestId });
  } catch {
    await recordPrivacyAudit(auditSink, {
      action: parsed.data.action,
      actorRef: currentUser.userId,
      at: now,
      outcome: "server_failed",
      requestId,
    });
    return Response.json({ error: "privacy_action_failed", requestId }, { status: 500 });
  }
}

async function ensurePrivacyUser(dependencies: PrivacyRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db,
    now: dependencies.now,
  });
}

function invalidPrivacyRequest(issues: Array<{ path: string; message: string }>) {
  return Response.json({ error: "invalid_privacy_request", issues }, { status: 400 });
}

function actionFromBody(body: unknown): PrivacyAction | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const action = (body as { action?: unknown }).action;
  return action === "delete_chat_history" ||
    action === "delete_saved_planning_data" ||
    action === "clear_location_context"
    ? action
    : null;
}
