import { createHash } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { trackServerEvent } from "@/server/observability/events";
import type { TripPassUsageMeter } from "@/server/payments/trip-pass";
import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
  shouldUseRedisQuotaStore,
} from "@/server/security/rate-limit";
import { type TripPassMeterType, tripPassRateLimits } from "@/server/trip-pass/catalog";
import {
  finalizePaidAnswer,
  type PaidAnswerReleaseReason,
  releasePaidAnswer,
  reservePaidAnswer,
} from "@/server/trip-pass/paid-answer-reservations";

export type PaidDecisionMeterType = Exclude<TripPassMeterType, "chat_message">;

export type PaidChatUsageAllowance = {
  chatMessages: {
    limit: number;
    remaining: number;
    used: number;
  };
};

export type PaidChatUsageSessionResult =
  | {
      status: "allowed";
      allowance: PaidChatUsageAllowance;
      passId: string;
      release(): Promise<void>;
      reserveDecisionMeter(input: {
        meterType: PaidDecisionMeterType;
      }): Promise<PaidDecisionMeterReservation>;
      settle(input: {
        answerMessageId?: string;
        persistAnswer?: (
          transaction: DatabaseQueryClient,
          allowance: PaidChatUsageAllowance,
        ) => Promise<Record<string, unknown>>;
        providerRequestIds?: readonly string[];
        releaseReason?: PaidAnswerReleaseReason;
        success: boolean;
      }): Promise<PaidChatUsageSettlement>;
    }
  | {
      status: "not_applicable";
      reason: "no_active_pass" | "expired" | "revoked";
    }
  | { status: "replay"; responseBody: Record<string, unknown> }
  | { status: "in_progress" | "conflict" }
  | {
      status: "usage_limit_reached";
      allowance: PaidChatUsageAllowance | null;
      reason:
        | "paid_chat_concurrency_exceeded"
        | "paid_chat_meter_exhausted"
        | "paid_chat_start_limit_exceeded";
    }
  | {
      status: "unavailable";
      reason: "paid_usage_store_unavailable" | "paid_usage_database_unavailable";
    };

export type PaidChatUsageSettlement =
  | {
      status: "settled";
      allowance: PaidChatUsageAllowance;
      responseBody?: Record<string, unknown>;
    }
  | {
      status: "duplicate";
      allowance: PaidChatUsageAllowance | null;
      responseBody?: Record<string, unknown>;
    }
  | { status: "released"; allowance: PaidChatUsageAllowance | null }
  | { status: "invalidated" | "lease_lost"; allowance: PaidChatUsageAllowance | null }
  | { status: "usage_limit_reached"; allowance: PaidChatUsageAllowance | null };

export type PaidMeterAllowance = {
  limit: number;
  meterType: TripPassMeterType;
  remaining: number;
  used: number;
};

export type PaidDecisionMeterReservation =
  | {
      status: "reserved";
      meterType: PaidDecisionMeterType;
      release(): Promise<void>;
      settle(input: {
        providerRequestIds?: readonly string[];
        success: boolean;
      }): Promise<PaidDecisionMeterSettlement>;
    }
  | {
      status: "usage_limit_reached";
      allowance: PaidMeterAllowance | null;
      meterType: PaidDecisionMeterType;
    };

export type PaidDecisionMeterSettlement =
  | { status: "settled"; allowance: PaidMeterAllowance }
  | { status: "duplicate"; allowance: PaidMeterAllowance | null }
  | { status: "released"; allowance: PaidMeterAllowance | null }
  | { status: "usage_limit_reached"; allowance: PaidMeterAllowance | null };

export type OpenChatUsageSessionInput = {
  bodyHash?: string;
  db?: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  idempotencyKey?: string;
  now?: Date;
  requestId: string;
  store?: QuotaStore;
  userId: string;
};

type Reservation = {
  key: string;
  reservationId: string;
};

type UsageMeterRow = {
  id: string;
  trip_pass_id: string;
  meter_type: string;
  used: number;
  limit: number;
  reset_at: Date | string | null;
  updated_at: Date | string;
};

type UsageEventRow = {
  event_type: "reserved" | "settled" | "released" | "adjusted";
  usage_meter_id: string | null;
};

const oneMinuteMs = 60_000;

let defaultStore: QuotaStore | undefined;

export async function openChatUsageSession(
  input: OpenChatUsageSessionInput,
): Promise<PaidChatUsageSessionResult> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const db = input.db ?? getDefaultDatabaseQueryClient();
  const environment = input.env ?? process.env;

  if (!input.store && isProductionEnvironment(environment) && !environment.REDIS_URL) {
    return { status: "unavailable", reason: "paid_usage_store_unavailable" };
  }

  const idempotencyKeyHash = input.idempotencyKey ?? hashText(`request:${input.requestId}`);
  let reservation: Awaited<ReturnType<typeof reservePaidAnswer>>;
  try {
    reservation = await reservePaidAnswer({
      accountId: input.userId,
      bodyHash: input.bodyHash ?? hashText(input.requestId),
      db,
      env: environment,
      idempotencyKeyHash,
      requestId: input.requestId,
    });
  } catch {
    return { status: "unavailable", reason: "paid_usage_database_unavailable" };
  }
  if (reservation.status === "replay") return reservation;
  if (reservation.status === "in_progress" || reservation.status === "conflict") return reservation;
  if (reservation.status === "not_applicable") return reservation;
  if (reservation.status === "limit_reached") {
    trackMeterTelemetry("trip_pass_meter_exhausted", "chat_message", reservation.allowance, now, {
      reason: "paid_chat_meter_exhausted",
    });
    return {
      status: "usage_limit_reached",
      reason: "paid_chat_meter_exhausted",
      allowance: reservation.allowance,
    };
  }

  const store = input.store ?? getDefaultPaidUsageStore(environment);
  const passId = reservation.passId;
  const allowance = reservation.allowance;
  const releaseDurableReservation = (reason: PaidAnswerReleaseReason) =>
    releasePaidAnswer({
      accountId: input.userId,
      db,
      leaseToken: reservation.leaseToken,
      reason,
      reservationId: reservation.reservationId,
    });
  const startReservation = {
    key: `paid:${passId}:chat-starts:1m`,
    reservationId: input.requestId,
  } satisfies Reservation;
  const concurrencyKey = `paid:${passId}:chat-concurrency`;
  const acquiredRollingReservations: Reservation[] = [];
  let acquiredConcurrency = false;

  try {
    const start = await store.reserveRollingWindow({
      ...startReservation,
      limit: tripPassRateLimits.paid.chatStartsPerMinute,
      nowMs,
      windowMs: oneMinuteMs,
    });
    if (start.status === "rejected") {
      await releaseDurableReservation("operational_limit");
      return { status: "usage_limit_reached", reason: "paid_chat_start_limit_exceeded", allowance };
    }
    acquiredRollingReservations.push(startReservation);

    const lease = await store.reserveConcurrency({
      key: concurrencyKey,
      leaseId: input.requestId,
      limit: tripPassRateLimits.paid.concurrentChatRequests,
      nowMs,
      ttlMs: 2 * oneMinuteMs,
    });
    if (lease.status === "rejected") {
      await releaseDurableReservation("operational_limit");
      return {
        status: "usage_limit_reached",
        reason: "paid_chat_concurrency_exceeded",
        allowance,
      };
    }
    acquiredConcurrency = true;
  } catch {
    await safeReleaseReservations(store, acquiredRollingReservations);
    if (acquiredConcurrency) {
      await safeReleaseConcurrency(store, concurrencyKey, input.requestId);
    }
    await releaseDurableReservation("redis_unavailable").catch(() => undefined);
    return { status: "unavailable", reason: "paid_usage_store_unavailable" };
  }

  let closed = false;
  const decisionReservations = new Map<
    PaidDecisionMeterType,
    Promise<PaidDecisionMeterReservation>
  >();

  async function closeConcurrency() {
    if (closed) {
      return;
    }
    closed = true;
    await safeReleaseConcurrency(store, concurrencyKey, input.requestId);
  }

  return {
    status: "allowed",
    allowance: reservation.allowance,
    passId,
    async release() {
      try {
        await releaseDurableReservation("internal_failure");
      } finally {
        await closeConcurrency();
      }
    },
    reserveDecisionMeter(decisionInput) {
      const existing = decisionReservations.get(decisionInput.meterType);
      if (existing) {
        return existing;
      }
      const promise = reserveDecisionMeterEventHandle({
        db,
        idempotencyKey: `paid-chat:${passId}:${idempotencyKeyHash}:${decisionInput.meterType}`,
        meterType: decisionInput.meterType,
        now,
        passId,
        requestHash: input.bodyHash ?? hashText(input.requestId),
        requestId: `${input.requestId}:${decisionInput.meterType}`,
        userId: input.userId,
      });
      decisionReservations.set(decisionInput.meterType, promise);
      return promise;
    },
    async settle(settleInput) {
      if (!settleInput.success) {
        try {
          await releasePaidAnswer({
            accountId: input.userId,
            db,
            leaseToken: reservation.leaseToken,
            reason: settleInput.releaseReason ?? "provider_failure",
            reservationId: reservation.reservationId,
          });
        } finally {
          await closeConcurrency();
        }
        return { status: "released", allowance: reservation.allowance };
      }
      if (!settleInput.answerMessageId || !settleInput.persistAnswer) {
        try {
          await releasePaidAnswer({
            accountId: input.userId,
            db,
            leaseToken: reservation.leaseToken,
            reason: "internal_failure",
            reservationId: reservation.reservationId,
          });
        } finally {
          await closeConcurrency();
        }
        return { status: "released", allowance: reservation.allowance };
      }
      const settled = await finalizePaidAnswer({
        accountId: input.userId,
        answerMessageId: settleInput.answerMessageId,
        db,
        leaseToken: reservation.leaseToken,
        persistAnswer: settleInput.persistAnswer,
        providerRequestIds: settleInput.providerRequestIds ?? [],
        reservationId: reservation.reservationId,
      });
      await closeConcurrency();
      if (settled.status === "settled") {
        trackMeterTelemetry("trip_pass_meter_warning", "chat_message", settled.allowance, now);
      }
      return settled;
    },
  };
}

export function paidChatUsageJson(
  result: Extract<PaidChatUsageSessionResult, { status: "unavailable" | "usage_limit_reached" }>,
) {
  if (result.status === "unavailable") {
    return Response.json(
      {
        error: "unavailable",
        reason: result.reason,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: "usage_limit_reached",
      reason: result.reason,
      allowance: result.allowance,
    },
    { status: 402 },
  );
}

async function reserveDecisionMeterEventHandle(input: {
  db: DatabaseQueryClient;
  idempotencyKey: string;
  meterType: PaidDecisionMeterType;
  now: Date;
  passId: string;
  requestHash: string;
  requestId: string;
  userId: string;
}): Promise<PaidDecisionMeterReservation> {
  const reservation = await reserveGenericMeterEvent(
    {
      idempotencyKey: input.idempotencyKey,
      meterType: input.meterType,
      now: input.now,
      passId: input.passId,
      requestHash: input.requestHash,
      requestId: input.requestId,
      userId: input.userId,
    },
    input.db,
  );
  if (reservation.status === "limit_reached" || reservation.status === "unavailable") {
    if (reservation.status === "limit_reached") {
      trackMeterTelemetry(
        "trip_pass_meter_exhausted",
        input.meterType,
        reservation.allowance,
        input.now,
      );
    }
    return {
      status: "usage_limit_reached",
      allowance: reservation.allowance,
      meterType: input.meterType,
    };
  }

  let closed = false;
  let finalSettlement: PaidDecisionMeterSettlement | null = null;

  async function release() {
    if (closed) {
      return;
    }
    closed = true;
    await releaseGenericMeterEvent(input.idempotencyKey, input.db);
    finalSettlement = { status: "released", allowance: reservation.allowance };
  }

  return {
    status: "reserved",
    meterType: input.meterType,
    release,
    async settle(settleInput) {
      if (!settleInput.success) {
        await release();
        return finalSettlement ?? { status: "released", allowance: reservation.allowance };
      }
      if (closed) {
        return finalSettlement ?? { status: "released", allowance: reservation.allowance };
      }
      closed = true;
      finalSettlement = await settleGenericMeterEvent(
        {
          idempotencyKey: input.idempotencyKey,
          now: input.now,
          providerRequestIds: settleInput.providerRequestIds ?? [],
        },
        input.db,
      );
      if (finalSettlement.status === "settled") {
        trackMeterTelemetry(
          "trip_pass_meter_warning",
          input.meterType,
          finalSettlement.allowance,
          input.now,
        );
      }
      return finalSettlement;
    },
  };
}

async function reserveGenericMeterEvent(
  input: {
    idempotencyKey: string;
    meterType: PaidDecisionMeterType;
    now: Date;
    passId: string;
    requestHash: string;
    requestId: string;
    userId: string;
  },
  db: DatabaseQueryClient,
): Promise<
  | { status: "reserved"; allowance: PaidMeterAllowance }
  | { status: "limit_reached"; allowance: PaidMeterAllowance | null }
  | { status: "unavailable"; allowance: null }
> {
  try {
    return await withDatabaseTransaction(db, async (transaction) => {
      const existing = await loadUsageEvent(input.idempotencyKey, transaction);
      if (existing) {
        const meter = existing.usage_meter_id
          ? await loadMeterById(existing.usage_meter_id, transaction)
          : await loadMeter(input.passId, input.meterType, transaction);
        return meter
          ? { status: "reserved", allowance: projectMeterAllowance(meter) }
          : { status: "unavailable", allowance: null };
      }

      const meter = await loadMeter(input.passId, input.meterType, transaction);
      if (!meter) {
        return { status: "limit_reached", allowance: null };
      }

      const pending = await countReservedMeterEvents(input.passId, input.meterType, transaction);
      if (meter.used + pending >= meter.limit) {
        return { status: "limit_reached", allowance: projectMeterAllowance(meter) };
      }

      await transaction.query(
        `
          insert into trip_usage_events (
            id,
            trip_pass_id,
            usage_meter_id,
            user_id,
            event_type,
            meter_type,
            quantity,
            idempotency_key,
            request_id,
            request_hash,
            provider_request_ids_json,
            occurred_at,
            created_at
          )
          values ($1, $2, $3, $4, 'reserved', $5, 1, $6, $7, $8, '[]'::jsonb, $9, $9)
        `,
        [
          usageEventId(input.idempotencyKey),
          input.passId,
          meter.id,
          input.userId,
          input.meterType,
          input.idempotencyKey,
          input.requestId,
          input.requestHash,
          input.now,
        ],
      );

      return { status: "reserved", allowance: projectMeterAllowance(meter) };
    });
  } catch {
    return { status: "unavailable", allowance: null };
  }
}

async function settleGenericMeterEvent(
  input: {
    idempotencyKey: string;
    now: Date;
    providerRequestIds: readonly string[];
  },
  db: DatabaseQueryClient,
): Promise<PaidDecisionMeterSettlement> {
  return withDatabaseTransaction(db, async (transaction) => {
    const existing = await loadUsageEvent(input.idempotencyKey, transaction);
    if (!existing?.usage_meter_id) {
      return { status: "usage_limit_reached", allowance: null };
    }
    if (existing.event_type === "settled") {
      const meter = await loadMeterById(existing.usage_meter_id, transaction);
      return {
        status: "duplicate",
        allowance: meter ? projectMeterAllowance(meter) : null,
      };
    }
    if (existing.event_type === "released") {
      const meter = await loadMeterById(existing.usage_meter_id, transaction);
      return {
        status: "released",
        allowance: meter ? projectMeterAllowance(meter) : null,
      };
    }

    const consumed = await transaction.query<UsageMeterRow>(
      `
        update trip_usage_meters
        set used = used + 1,
            updated_at = $2
        where id = $1
          and used + 1 <= "limit"
        returning id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
      `,
      [existing.usage_meter_id, input.now],
    );
    const meter = consumed.rows[0] ? mapMeterRow(consumed.rows[0]) : null;
    if (!meter) {
      return {
        status: "usage_limit_reached",
        allowance: await loadMeterById(existing.usage_meter_id, transaction).then((row) =>
          row ? projectMeterAllowance(row) : null,
        ),
      };
    }

    await transaction.query(
      `
        update trip_usage_events
        set event_type = 'settled',
            provider_request_ids_json = $2::jsonb,
            occurred_at = $3
        where idempotency_key = $1
          and event_type = 'reserved'
      `,
      [input.idempotencyKey, JSON.stringify([...input.providerRequestIds]), input.now],
    );

    return { status: "settled", allowance: projectMeterAllowance(meter) };
  });
}

async function releaseGenericMeterEvent(idempotencyKey: string, db: DatabaseQueryClient) {
  await db.query(
    `
      update trip_usage_events
      set event_type = 'released'
      where idempotency_key = $1
        and event_type = 'reserved'
    `,
    [idempotencyKey],
  );
}

async function loadUsageEvent(idempotencyKey: string, db: DatabaseQueryClient) {
  const result = await db.query<UsageEventRow>(
    `
      select event_type, usage_meter_id
      from trip_usage_events
      where idempotency_key = $1
      limit 1
    `,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function loadMeter(
  tripPassId: string,
  meterType: TripPassMeterType,
  db: DatabaseQueryClient,
) {
  const result = await db.query<UsageMeterRow>(
    `
      select id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
      from trip_usage_meters
      where trip_pass_id = $1
        and meter_type = $2
      limit 1
    `,
    [tripPassId, meterType],
  );
  return result.rows[0] ? mapMeterRow(result.rows[0]) : null;
}

async function loadMeterById(meterId: string, db: DatabaseQueryClient) {
  const result = await db.query<UsageMeterRow>(
    `
      select id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
      from trip_usage_meters
      where id = $1
      limit 1
    `,
    [meterId],
  );
  return result.rows[0] ? mapMeterRow(result.rows[0]) : null;
}

async function countReservedMeterEvents(
  tripPassId: string,
  meterType: TripPassMeterType,
  db: DatabaseQueryClient,
) {
  const result = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from trip_usage_events
      where trip_pass_id = $1
        and meter_type = $2
        and event_type = 'reserved'
    `,
    [tripPassId, meterType],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function withDatabaseTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
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
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function safeReleaseReservations(store: QuotaStore, reservations: readonly Reservation[]) {
  await Promise.allSettled(
    reservations.map((reservation) => store.releaseRollingWindow(reservation)),
  );
}

async function safeReleaseConcurrency(store: QuotaStore, key: string, leaseId: string) {
  await store.releaseConcurrency({ key, leaseId }).catch(() => undefined);
}

function projectMeterAllowance(meter: Pick<TripPassUsageMeter, "limit" | "meterType" | "used">) {
  return {
    limit: meter.limit,
    meterType: meter.meterType,
    remaining: Math.max(meter.limit - meter.used, 0),
    used: meter.used,
  } satisfies PaidMeterAllowance;
}

function mapMeterRow(row: UsageMeterRow): TripPassUsageMeter {
  return {
    id: row.id,
    tripPassId: row.trip_pass_id,
    meterType: parseTripPassMeterType(row.meter_type),
    used: row.used,
    limit: row.limit,
    resetAt: row.reset_at ? new Date(row.reset_at) : null,
    updatedAt: new Date(row.updated_at),
  };
}

function parseTripPassMeterType(value: string): TripPassMeterType {
  const meterTypes = [
    "chat_message",
    "live_refresh",
    "heavy_recommendation",
    "weather_refresh",
    "route_lookup",
  ] as const satisfies readonly TripPassMeterType[];
  if (meterTypes.includes(value as TripPassMeterType)) {
    return value as TripPassMeterType;
  }
  throw new Error(`Unknown trip pass meter type: ${value}`);
}

function getDefaultPaidUsageStore(env: Record<string, string | undefined> = process.env) {
  if (!defaultStore) {
    defaultStore = shouldUseRedisQuotaStore(env)
      ? createRedisQuotaStore({ redisUrl: env.REDIS_URL })
      : createMemoryQuotaStore();
  }
  return defaultStore;
}

function isProductionEnvironment(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

function usageEventId(idempotencyKey: string) {
  return `trip_usage_event_${hashText(idempotencyKey).slice(0, 32)}`;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function trackMeterTelemetry(
  name: "trip_pass_meter_exhausted" | "trip_pass_meter_warning",
  meterType: TripPassMeterType,
  allowance: PaidChatUsageAllowance | PaidMeterAllowance | null,
  now: Date,
  extra: { reason?: string } = {},
) {
  const projected = meterTelemetryPayload(meterType, allowance);
  if (!projected) {
    return;
  }
  if (
    name === "trip_pass_meter_warning" &&
    projected.remaining > warningThresholdForMeter(meterType)
  ) {
    return;
  }

  trackServerEvent({
    name,
    now,
    payload: {
      ...extra,
      ...projected,
      status: name === "trip_pass_meter_exhausted" ? "exhausted" : "warning",
    },
  });
}

function meterTelemetryPayload(
  meterType: TripPassMeterType,
  allowance: PaidChatUsageAllowance | PaidMeterAllowance | null,
) {
  if (!allowance) {
    return null;
  }
  if ("chatMessages" in allowance) {
    return {
      limit: allowance.chatMessages.limit,
      meterType,
      remaining: allowance.chatMessages.remaining,
      used: allowance.chatMessages.used,
    };
  }
  return {
    limit: allowance.limit,
    meterType: allowance.meterType,
    remaining: allowance.remaining,
    used: allowance.used,
  };
}

function warningThresholdForMeter(meterType: TripPassMeterType) {
  if (meterType === "chat_message") {
    return 20;
  }
  if (meterType === "live_refresh") {
    return 5;
  }
  return 1;
}
