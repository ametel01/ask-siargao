import type { DatabaseQueryClient } from "@/server/db/query-client";
import { createComponentLogger } from "@/server/observability/logger";
import {
  loadUserProfile,
  type UserProfileResponse,
  upsertUserProfile,
} from "@/server/profile/user-profile-store";

export type PrivacyAction =
  | "delete_chat_history"
  | "delete_saved_planning_data"
  | "clear_location_context";

export type PrivacyActionOutcome =
  | "success"
  | "already_empty"
  | "validation_failed"
  | "authentication_failed"
  | "server_failed";

export type PrivacyAuditEvent = {
  action: PrivacyAction;
  actorRef: string;
  requestId: string;
  at: string;
  outcome: PrivacyActionOutcome;
  counts: PrivacyActionCounts;
};

export type PrivacyActionCounts = {
  chatRatingsDeleted?: number;
  chatMessagesDeleted?: number;
  chatThreadsDeleted?: number;
  savedTripsDeleted?: number;
  savedItemsDeleted?: number;
  sharedPlansInvalidated?: number;
  profileFieldsCleared?: number;
};

export type PrivacyAuditSink = (event: PrivacyAuditEvent) => void | Promise<void>;

export type DeleteChatHistoryResult = {
  status: "success" | "already_empty";
  counts: Required<
    Pick<PrivacyActionCounts, "chatRatingsDeleted" | "chatMessagesDeleted" | "chatThreadsDeleted">
  >;
};

export type DeleteSavedPlanningDataResult = {
  status: "success" | "already_empty";
  counts: Required<
    Pick<PrivacyActionCounts, "savedTripsDeleted" | "savedItemsDeleted" | "sharedPlansInvalidated">
  >;
};

export type ClearLocationContextResult = {
  status: "success" | "already_empty";
  counts: Required<Pick<PrivacyActionCounts, "profileFieldsCleared">>;
  profile: UserProfileResponse;
};

const privacyLogger = createComponentLogger("privacy-actions");

export const defaultPrivacyAuditSink: PrivacyAuditSink = (event) => {
  privacyLogger.info(
    {
      privacyAction: event,
    },
    "Privacy action recorded.",
  );
};

export async function deleteOwnedChatHistory(
  db: DatabaseQueryClient,
  input: { userId: string },
): Promise<DeleteChatHistoryResult> {
  const result = await runTransaction(db, async (tx) => {
    const deleted = await tx.query<{
      ratings_deleted: number | string;
      messages_deleted: number | string;
      threads_deleted: number | string;
    }>(
      `
        with owned_threads as (
          select id
          from chat_threads
          where user_id = $1
          for update
        ),
        deleted_ratings as (
          delete from chat_response_ratings
          where user_id = $1
             or thread_id in (select id from owned_threads)
          returning id
        ),
        deleted_messages as (
          delete from chat_messages
          where user_id = $1
             or thread_id in (select id from owned_threads)
          returning id
        ),
        deleted_threads as (
          delete from chat_threads
          where id in (select id from owned_threads)
          returning id
        )
        select
          (select count(*) from deleted_ratings) as ratings_deleted,
          (select count(*) from deleted_messages) as messages_deleted,
          (select count(*) from deleted_threads) as threads_deleted
      `,
      [input.userId],
    );

    const row = deleted.rows[0];
    return {
      chatRatingsDeleted: numberFromSql(row?.ratings_deleted),
      chatMessagesDeleted: numberFromSql(row?.messages_deleted),
      chatThreadsDeleted: numberFromSql(row?.threads_deleted),
    };
  });

  return {
    status:
      result.chatRatingsDeleted + result.chatMessagesDeleted + result.chatThreadsDeleted > 0
        ? "success"
        : "already_empty",
    counts: result,
  };
}

export async function deleteOwnedSavedPlanningData(
  db: DatabaseQueryClient,
  input: { userId: string },
): Promise<DeleteSavedPlanningDataResult> {
  const result = await runTransaction(db, async (tx) => {
    const deleted = await tx.query<{
      shared_plans_invalidated: number | string;
      saved_items_deleted: number | string;
      saved_trips_deleted: number | string;
    }>(
      `
        with owned_trips as (
          select id
          from saved_trips
          where user_id = $1
          for update
        ),
        deleted_shared_plans as (
          delete from shared_trip_plans
          where trip_id in (select id from owned_trips)
          returning id
        ),
        deleted_saved_items as (
          delete from saved_trip_items
          where trip_id in (select id from owned_trips)
          returning id
        ),
        deleted_saved_trips as (
          delete from saved_trips
          where id in (select id from owned_trips)
          returning id
        )
        select
          (select count(*) from deleted_shared_plans) as shared_plans_invalidated,
          (select count(*) from deleted_saved_items) as saved_items_deleted,
          (select count(*) from deleted_saved_trips) as saved_trips_deleted
      `,
      [input.userId],
    );

    const row = deleted.rows[0];
    return {
      sharedPlansInvalidated: numberFromSql(row?.shared_plans_invalidated),
      savedItemsDeleted: numberFromSql(row?.saved_items_deleted),
      savedTripsDeleted: numberFromSql(row?.saved_trips_deleted),
    };
  });

  return {
    status:
      result.sharedPlansInvalidated + result.savedItemsDeleted + result.savedTripsDeleted > 0
        ? "success"
        : "already_empty",
    counts: result,
  };
}

export async function clearOwnedLocationContext(
  db: DatabaseQueryClient,
  input: { userId: string; now: Date },
): Promise<ClearLocationContextResult> {
  const existing = await loadUserProfile(db, input.userId);
  const existingContext = existing?.profile.tripContext ?? {};
  const nextTripContext = { ...existingContext };
  let profileFieldsCleared = 0;

  if ("currentArea" in nextTripContext && nextTripContext.currentArea !== undefined) {
    delete nextTripContext.currentArea;
    profileFieldsCleared += 1;
  }
  if ("accommodation" in nextTripContext && nextTripContext.accommodation !== undefined) {
    delete nextTripContext.accommodation;
    profileFieldsCleared += 1;
  }

  const profile = await upsertUserProfile(db, {
    userId: input.userId,
    patch: { tripContext: nextTripContext },
    now: input.now,
  });

  return {
    status: profileFieldsCleared > 0 ? "success" : "already_empty",
    counts: { profileFieldsCleared },
    profile,
  };
}

export async function recordPrivacyAudit(
  sink: PrivacyAuditSink,
  input: {
    action: PrivacyAction;
    actorRef: string | null;
    requestId: string;
    at: Date;
    outcome: PrivacyActionOutcome;
    counts?: PrivacyActionCounts;
  },
) {
  await sink({
    action: input.action,
    actorRef: input.actorRef ?? "anonymous",
    requestId: input.requestId,
    at: input.at.toISOString(),
    outcome: input.outcome,
    counts: input.counts ?? {},
  });
}

async function runTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transactionClient: DatabaseQueryClient) => Promise<T>,
) {
  if (db.transaction) {
    return db.transaction(callback);
  }

  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

function numberFromSql(value: number | string | undefined) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }

  return 0;
}
