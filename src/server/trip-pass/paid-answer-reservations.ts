import { createHash, randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { tripPassProductFamily } from "@/server/trip-pass/catalog";
import {
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
} from "@/server/trip-pass/payment-lifecycle";

export type PaidAnswerAllowance = {
  chatMessages: {
    limit: number;
    remaining: number;
    used: number;
  };
};

export type PaidAnswerReleaseReason =
  | "provider_failure"
  | "internal_failure"
  | "empty_output"
  | "safety_refusal"
  | "redis_unavailable"
  | "operational_limit"
  | "database_unavailable"
  | "pass_expired";

export type PaidAnswerReservationResult =
  | {
      status: "reserved";
      allowance: PaidAnswerAllowance;
      leaseToken: string;
      passId: string;
      reservationId: string;
    }
  | { status: "replay"; responseBody: Record<string, unknown> }
  | { status: "in_progress" }
  | { status: "conflict" }
  | { status: "not_applicable"; reason: "no_active_pass" | "expired" | "revoked" }
  | { status: "limit_reached"; allowance: PaidAnswerAllowance | null };

export type PaidAnswerFinalizationResult =
  | {
      status: "settled" | "duplicate";
      allowance: PaidAnswerAllowance;
      responseBody: Record<string, unknown>;
    }
  | { status: "released" | "invalidated" | "lease_lost"; allowance: PaidAnswerAllowance | null };

export type PaidAnswerPurgeFailure = {
  cause: unknown;
  reservationId: string;
};

export class PaidAnswerPurgeBatchError extends Error {
  readonly failures: PaidAnswerPurgeFailure[];
  readonly purgedCount: number;

  constructor(purgedCount: number, failures: PaidAnswerPurgeFailure[]) {
    const firstCause = failures[0]?.cause;
    const firstMessage = firstCause instanceof Error ? `: ${firstCause.message}` : "";
    super(
      `paid answer purge failed for ${failures.length} candidate(s) after purging ${purgedCount}${firstMessage}`,
    );
    this.name = "PaidAnswerPurgeBatchError";
    this.purgedCount = purgedCount;
    this.failures = failures;
  }
}

type ReservationRow = {
  id: string;
  trip_pass_id: string;
  usage_meter_id: string;
  account_id: string;
  idempotency_key_hash: string;
  request_body_hash: string;
  request_id: string;
  lease_token: string;
  status: "open" | "settled" | "released" | "invalidated";
  result_json: unknown;
  lease_expires_at: Date | string;
  details_purged_at: Date | string | null;
};

type MeterRow = {
  id: string;
  trip_pass_id: string;
  used: number;
  limit: number;
};

type EffectiveMeterRow = MeterRow & {
  pass_status: string;
  starts_at: Date | string;
  expires_at: Date | string;
};

type PaidAnswerPurgeCandidateRow = {
  id: string;
  account_id: string;
};

type PaidAnswerPurgeRow = PaidAnswerPurgeCandidateRow & {
  trip_pass_id: string;
  status: "invalidated" | "released" | "settled";
  usage_meter_id: string;
};

const reservationLeaseMinutes = 10;
const defaultDetailRetentionDays = 30;

export async function reservePaidAnswer(input: {
  accountId: string;
  bodyHash: string;
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  idempotencyKeyHash: string;
  requestId: string;
}): Promise<PaidAnswerReservationResult> {
  return withTransaction(input.db, async (transaction) => {
    await acquireAccountProductFamilyLocks(input.accountId, transaction);
    const databaseNow = await readDatabaseClock(transaction);
    const reservationId = paidAnswerReservationId(input.accountId, input.idempotencyKeyHash);
    const existing =
      (await loadReservationForUpdate(input.accountId, input.idempotencyKeyHash, transaction)) ??
      (await loadReservationByIdForUpdate(input.accountId, reservationId, transaction));

    if (existing) {
      if (existing.details_purged_at) {
        return existing.status === "invalidated"
          ? { status: "not_applicable", reason: "revoked" }
          : { status: "in_progress" };
      }
      if (existing.request_body_hash !== input.bodyHash) {
        return { status: "conflict" };
      }
      if (existing.status === "settled") {
        const responseBody = recordFromJson(existing.result_json);
        return responseBody ? { status: "replay", responseBody } : { status: "in_progress" };
      }
      if (existing.status === "invalidated") {
        return { status: "not_applicable", reason: "revoked" };
      }
      if (existing.status === "open" && new Date(existing.lease_expires_at) > databaseNow) {
        return { status: "in_progress" };
      }
      if (existing.status === "open") {
        await transaction.query(
          `update paid_answer_reservations
           set status = 'released', release_reason = 'stale_lease', released_at = $2,
             updated_at = $2
           where id = $1 and status = 'open'`,
          [existing.id, databaseNow],
        );
      }
    }

    const effective = await loadEffectiveMeterForUpdate(input.accountId, transaction);
    if (!effective) {
      return classifyUnavailablePass(input.accountId, transaction);
    }

    await releaseExpiredOpenReservations(effective.trip_pass_id, databaseNow, transaction);
    const openCount = await countOpenReservations(effective.trip_pass_id, transaction);
    if (effective.used + openCount >= effective.limit) {
      return {
        status: "limit_reached",
        allowance: projectAllowance(effective, openCount),
      };
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = addMinutes(databaseNow, reservationLeaseMinutes);
    const detailsPurgeAt = addDays(databaseNow, detailRetentionDays(input.env));
    if (existing) {
      await transaction.query(
        `update paid_answer_reservations
         set trip_pass_id = $2, usage_meter_id = $3, request_body_hash = $4, request_id = $5,
           lease_token = $6, status = 'open', release_reason = null, invalidation_reason = null,
           answer_message_id = null, result_json = null, provider_request_ids_json = '[]'::jsonb,
           lease_expires_at = $7, details_purge_at = $8, details_purged_at = null,
           reserved_at = $9, finalized_at = null, released_at = null, invalidated_at = null,
           updated_at = $9
         where id = $1`,
        [
          reservationId,
          effective.trip_pass_id,
          effective.id,
          input.bodyHash,
          input.requestId,
          leaseToken,
          leaseExpiresAt,
          detailsPurgeAt,
          databaseNow,
        ],
      );
    } else {
      await transaction.query(
        `insert into paid_answer_reservations (
           id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
           request_body_hash, request_id, lease_token, status, lease_expires_at,
           details_purge_at, reserved_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $11)`,
        [
          reservationId,
          effective.trip_pass_id,
          effective.id,
          input.accountId,
          input.idempotencyKeyHash,
          input.bodyHash,
          input.requestId,
          leaseToken,
          leaseExpiresAt,
          detailsPurgeAt,
          databaseNow,
        ],
      );
    }

    return {
      status: "reserved",
      allowance: projectAllowance(effective, openCount + 1),
      leaseToken,
      passId: effective.trip_pass_id,
      reservationId,
    };
  });
}

export async function finalizePaidAnswer(input: {
  accountId: string;
  answerMessageId: string;
  db: DatabaseQueryClient;
  leaseToken: string;
  providerRequestIds: readonly string[];
  reservationId: string;
  persistAnswer(
    transaction: DatabaseQueryClient,
    allowance: PaidAnswerAllowance,
  ): Promise<Record<string, unknown>>;
}): Promise<PaidAnswerFinalizationResult> {
  return withTransaction(input.db, async (transaction) => {
    await acquireAccountProductFamilyLocks(input.accountId, transaction);
    const reservation = await loadReservationByIdForUpdate(
      input.accountId,
      input.reservationId,
      transaction,
    );
    if (!reservation) {
      return { status: "lease_lost", allowance: null };
    }
    if (reservation.status === "settled") {
      const meter = await loadMeterForUpdate(reservation.usage_meter_id, transaction);
      const responseBody = recordFromJson(reservation.result_json);
      return meter && responseBody
        ? { status: "duplicate", allowance: projectAllowance(meter, 0), responseBody }
        : { status: "lease_lost", allowance: null };
    }
    if (reservation.status === "released" || reservation.status === "invalidated") {
      const meter = await loadMeterForUpdate(reservation.usage_meter_id, transaction);
      return {
        status: reservation.status,
        allowance: meter ? projectAllowance(meter, 0) : null,
      };
    }
    if (reservation.lease_token !== input.leaseToken) {
      return { status: "lease_lost", allowance: null };
    }

    const databaseNow = await readDatabaseClock(transaction);
    const pass = await transaction.query<{
      status: string;
      starts_at: Date | string;
      expires_at: Date | string;
      user_id: string | null;
    }>(
      `select status, starts_at, expires_at, user_id
       from trip_passes where id = $1 for update`,
      [reservation.trip_pass_id],
    );
    const passRow = pass.rows[0];
    if (
      !passRow ||
      passRow.user_id !== input.accountId ||
      passRow.status !== "active" ||
      new Date(passRow.starts_at) > databaseNow ||
      new Date(passRow.expires_at) <= databaseNow
    ) {
      await transaction.query(
        `update paid_answer_reservations
         set status = 'released', release_reason = 'pass_expired', released_at = $2,
           updated_at = $2
         where id = $1 and status = 'open' and lease_token = $3`,
        [reservation.id, databaseNow, input.leaseToken],
      );
      return { status: "released", allowance: null };
    }

    const meter = await loadMeterForUpdate(reservation.usage_meter_id, transaction);
    if (!meter || meter.used >= meter.limit) {
      return { status: "lease_lost", allowance: meter ? projectAllowance(meter, 0) : null };
    }
    const updatedMeter = await transaction.query<MeterRow>(
      `update trip_usage_meters
       set used = used + 1, updated_at = $2
       where id = $1 and used + 1 <= "limit"
       returning id, trip_pass_id, used, "limit"`,
      [meter.id, databaseNow],
    );
    const settledMeter = updatedMeter.rows[0];
    if (!settledMeter) {
      return { status: "lease_lost", allowance: projectAllowance(meter, 0) };
    }

    const allowance = projectAllowance(settledMeter, 0);
    const responseBody = await input.persistAnswer(transaction, allowance);
    await transaction.query(
      `insert into trip_usage_events (
         id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
         idempotency_key, request_id, request_hash, provider_request_ids_json,
         occurred_at, created_at
       ) values ($1, $2, $3, $4, 'settled', 'chat_message', 1, $5, $6, $7,
         $8::jsonb, $9, $9)
       on conflict (idempotency_key) do nothing`,
      [
        `trip_usage_event_${reservation.id}`,
        reservation.trip_pass_id,
        reservation.usage_meter_id,
        reservation.account_id,
        `paid-answer:${reservation.id}`,
        reservation.request_id,
        reservation.request_body_hash,
        JSON.stringify([...input.providerRequestIds]),
        databaseNow,
      ],
    );
    const finalized = await transaction.query<{ id: string }>(
      `update paid_answer_reservations
       set status = 'settled', answer_message_id = $2, result_json = $3::jsonb,
         provider_request_ids_json = $4::jsonb, finalized_at = $5, updated_at = $5
       where id = $1 and status = 'open' and lease_token = $6
       returning id`,
      [
        reservation.id,
        input.answerMessageId,
        JSON.stringify(responseBody),
        JSON.stringify([...input.providerRequestIds]),
        databaseNow,
        input.leaseToken,
      ],
    );
    if (!finalized.rows[0]) {
      throw new Error("paid_answer_reservation_lease_lost");
    }
    return { status: "settled", allowance, responseBody };
  });
}

export async function releasePaidAnswer(input: {
  accountId: string;
  db: DatabaseQueryClient;
  leaseToken: string;
  reason: PaidAnswerReleaseReason;
  reservationId: string;
}) {
  return withTransaction(input.db, async (transaction) => {
    await acquireAccountProductFamilyLocks(input.accountId, transaction);
    const now = await readDatabaseClock(transaction);
    const result = await transaction.query<{ id: string }>(
      `update paid_answer_reservations
       set status = 'released', release_reason = $4, released_at = $3, updated_at = $3
       where id = $1 and lease_token = $2 and account_id = $5 and status = 'open'
       returning id`,
      [input.reservationId, input.leaseToken, now, input.reason, input.accountId],
    );
    return result.rows[0] ? "released" : "unchanged";
  });
}

export async function purgeExpiredPaidAnswerDetails(
  db: DatabaseQueryClient,
  limit = 100,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("paid answer purge limit must be between 1 and 1000");
  }
  if (db.inTransaction) {
    throw new Error("paid answer purge requires a database client outside a transaction");
  }

  const candidates = await db.query<PaidAnswerPurgeCandidateRow>(
    `select id, account_id
     from paid_answer_reservations
     where details_purged_at is null and details_purge_at <= clock_timestamp()
       and status <> 'open'
     order by account_id, details_purge_at, id
     limit $1`,
    [limit],
  );
  let purged = 0;
  const failures: PaidAnswerPurgeFailure[] = [];
  for (const candidate of candidates.rows) {
    try {
      purged += await purgePaidAnswerCandidate(candidate, db);
    } catch (cause) {
      failures.push({ cause, reservationId: candidate.id });
    }
  }
  if (failures.length > 0) {
    throw new PaidAnswerPurgeBatchError(purged, failures);
  }
  return purged;
}

async function purgePaidAnswerCandidate(
  candidate: PaidAnswerPurgeCandidateRow,
  db: DatabaseQueryClient,
) {
  return withTransaction(db, async (transaction) => {
    await acquireAccountProductFamilyLocks(candidate.account_id, transaction);
    const locked = await transaction.query<PaidAnswerPurgeRow>(
      `select id, trip_pass_id, usage_meter_id, account_id, status
       from paid_answer_reservations
       where id = $1 and account_id = $2 and details_purged_at is null
         and details_purge_at <= clock_timestamp() and status <> 'open'
       for update`,
      [candidate.id, candidate.account_id],
    );
    const reservation = locked.rows[0];
    if (!reservation) return 0;

    if (reservation.status === "settled") {
      const scrubbedEvents = await transaction.query<{ id: string }>(
        `update trip_usage_events
         set request_id = null, request_hash = null, provider_request_ids_json = '[]'::jsonb
         where id = 'trip_usage_event_' || $1
           and trip_pass_id = $2
           and usage_meter_id = $3
           and user_id = $4
           and idempotency_key = 'paid-answer:' || $1
           and event_type = 'settled'
           and meter_type = 'chat_message'
         returning id`,
        [
          reservation.id,
          reservation.trip_pass_id,
          reservation.usage_meter_id,
          reservation.account_id,
        ],
      );
      if (scrubbedEvents.rows.length !== 1) {
        throw new Error(
          `paid answer usage event scrub expected 1 row, received ${scrubbedEvents.rows.length}`,
        );
      }
    } else {
      const unexpectedEvents = await transaction.query<{ id: string }>(
        `select id from trip_usage_events
         where id = 'trip_usage_event_' || $1 or idempotency_key = 'paid-answer:' || $1
         for update`,
        [reservation.id],
      );
      if (unexpectedEvents.rows.length !== 0) {
        throw new Error(
          `non-settled paid answer expected 0 usage events, received ${unexpectedEvents.rows.length}`,
        );
      }
    }
    const result = await transaction.query<{ id: string }>(
      `update paid_answer_reservations
       set request_body_hash = 'purged:' || id, request_id = 'purged:' || id,
         idempotency_key_hash = 'purged:' || id, answer_message_id = null, result_json = null,
         provider_request_ids_json = '[]'::jsonb, details_purged_at = clock_timestamp(),
         updated_at = clock_timestamp()
       where id = $1 and account_id = $2 and details_purged_at is null
       returning id`,
      [reservation.id, reservation.account_id],
    );
    return result.rows.length;
  });
}

async function loadEffectiveMeterForUpdate(accountId: string, db: DatabaseQueryClient) {
  const result = await db.query<EffectiveMeterRow>(
    `select m.id, m.trip_pass_id, m.used, m."limit", p.status as pass_status,
       p.starts_at, p.expires_at
     from trip_passes p
     join trip_usage_meters m on m.trip_pass_id = p.id and m.meter_type = 'chat_message'
     join users u on u.id = p.user_id and u.deleted_at is null
     where p.user_id = $1 and p.status = 'active'
       and p.starts_at <= clock_timestamp() and p.expires_at > clock_timestamp()
     order by p.expires_at, p.id
     limit 1
     for update of p, m`,
    [accountId],
  );
  return result.rows[0] ?? null;
}

async function classifyUnavailablePass(
  accountId: string,
  db: DatabaseQueryClient,
): Promise<Extract<PaidAnswerReservationResult, { status: "not_applicable" }>> {
  const result = await db.query<{ status: string; expires_at: Date | string }>(
    `select status, expires_at from trip_passes where user_id = $1
     order by created_at desc, id desc limit 1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) return { status: "not_applicable", reason: "no_active_pass" };
  if (row.status !== "active") return { status: "not_applicable", reason: "revoked" };
  return { status: "not_applicable", reason: "expired" };
}

async function loadReservationForUpdate(
  accountId: string,
  idempotencyKeyHash: string,
  db: DatabaseQueryClient,
) {
  const result = await db.query<ReservationRow>(
    `select id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, result_json, lease_expires_at,
       details_purged_at
     from paid_answer_reservations
     where account_id = $1 and idempotency_key_hash = $2
     limit 1 for update`,
    [accountId, idempotencyKeyHash],
  );
  return result.rows[0] ?? null;
}

async function loadReservationByIdForUpdate(
  accountId: string,
  id: string,
  db: DatabaseQueryClient,
) {
  const result = await db.query<ReservationRow>(
    `select id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
       request_body_hash, request_id, lease_token, status, result_json, lease_expires_at,
       details_purged_at
     from paid_answer_reservations where id = $1 and account_id = $2 for update`,
    [id, accountId],
  );
  return result.rows[0] ?? null;
}

async function loadMeterForUpdate(id: string, db: DatabaseQueryClient) {
  const result = await db.query<MeterRow>(
    `select id, trip_pass_id, used, "limit" from trip_usage_meters where id = $1 for update`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function countOpenReservations(passId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from paid_answer_reservations
     where trip_pass_id = $1 and status = 'open'`,
    [passId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function releaseExpiredOpenReservations(
  passId: string,
  databaseNow: Date,
  db: DatabaseQueryClient,
) {
  await db.query(
    `update paid_answer_reservations
     set status = 'released', release_reason = 'stale_lease', released_at = $2,
       updated_at = $2
     where trip_pass_id = $1 and status = 'open' and lease_expires_at <= $2`,
    [passId, databaseNow],
  );
}

async function acquireAccountProductFamilyLocks(accountId: string, db: DatabaseQueryClient) {
  await lockTripPassAccountFamily(accountId, tripPassProductFamily, db);
  await lockTripPassAccountWrites(accountId, db);
}

async function readDatabaseClock(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  const value = result.rows[0]?.now;
  if (!value) throw new Error("database_clock_unavailable");
  return value instanceof Date ? value : new Date(value);
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction) return callback(db);
  if (db.transaction) return db.transaction(callback);
  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

function projectAllowance(meter: Pick<MeterRow, "limit" | "used">, openReservations: number) {
  return {
    chatMessages: {
      limit: meter.limit,
      remaining: Math.max(meter.limit - meter.used - openReservations, 0),
      used: meter.used,
    },
  } satisfies PaidAnswerAllowance;
}

function paidAnswerReservationId(accountId: string, idempotencyKeyHash: string) {
  return `paid_answer_${createHash("sha256")
    .update(`${accountId}:${idempotencyKeyHash}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function recordFromJson(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function detailRetentionDays(env: Record<string, string | undefined> = process.env) {
  const raw = env.PAID_ANSWER_DETAIL_RETENTION_DAYS?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production" || env.APP_ENV === "production") {
      throw new Error("PAID_ANSWER_DETAIL_RETENTION_DAYS is required in production.");
    }
    return defaultDetailRetentionDays;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("PAID_ANSWER_DETAIL_RETENTION_DAYS must be a positive integer.");
  }
  return value;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}
