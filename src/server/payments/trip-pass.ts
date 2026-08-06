import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  type TripPassMeterType,
  tripPassMeterTypes as tripPassLedgerMeterTypes,
  tripPassPaidMeterLimits as tripPassMeterLimits,
  tripPassEntitlementMeterTypes as tripPassMeterTypes,
} from "@/server/trip-pass/catalog";

export { type TripPassMeterType, tripPassMeterLimits, tripPassMeterTypes };

export const tripPassStatuses = ["active", "expired", "cancelled", "refunded"] as const;

export type TripPassStatus = (typeof tripPassStatuses)[number];

export type TripPassRecord = {
  id: string;
  userId: string | null;
  email: string | null;
  status: TripPassStatus;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeEventId: string | null;
  startsAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type TripPassUsageMeter = {
  id: string;
  tripPassId: string;
  meterType: TripPassMeterType;
  used: number;
  limit: number;
  resetAt: Date | null;
  updatedAt: Date;
};

export type TripPassMeterRow = {
  id: string;
  tripPassId: string;
  meterType: TripPassMeterType;
  used: number;
  limit: number;
  resetAt: Date | null;
  updatedAt: Date;
};

export type TripPassConsumptionResult =
  | { status: "consumed"; meter: TripPassUsageMeter }
  | { status: "limit_exceeded"; meter: TripPassUsageMeter }
  | { status: "meter_not_found"; tripPassId: string; meterType: TripPassMeterType }
  | { status: "pass_not_found"; tripPassId: string }
  | { status: "pass_inactive"; pass: TripPassRecord }
  | { status: "pass_not_started"; pass: TripPassRecord }
  | { status: "pass_expired"; pass: TripPassRecord };

export class InvalidTripPassMeterIncrementError extends Error {
  constructor(increment: number) {
    super(`Trip pass meter increment must be a positive integer. Received ${increment}.`);
    this.name = "InvalidTripPassMeterIncrementError";
  }
}

type TripPassRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  status: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_event_id: string | null;
  starts_at: Date | string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type TripPassUsageMeterRow = {
  id: string;
  trip_pass_id: string;
  meter_type: string;
  used: number;
  limit: number;
  reset_at: Date | string | null;
  updated_at: Date | string;
};

export function createTripPassMeterRows(input: {
  tripPassId: string;
  meterLimits?: Partial<Record<TripPassMeterType, number>>;
  resetAt?: Date | null;
  updatedAt?: Date;
}): TripPassMeterRow[] {
  const resetAt = input.resetAt ?? null;
  const updatedAt = input.updatedAt ?? new Date();

  const meterLimits = input.meterLimits ?? tripPassMeterLimits;
  return Object.entries(meterLimits).map(([meterType, limit]) => ({
    id: tripPassMeterId(input.tripPassId, meterType as TripPassMeterType),
    tripPassId: input.tripPassId,
    meterType: meterType as TripPassMeterType,
    used: 0,
    limit,
    resetAt,
    updatedAt,
  }));
}

export function canConsumeTripPassMeter(input: { used: number; limit: number; increment: number }) {
  assertValidIncrement(input.increment);
  return input.used + input.increment <= input.limit;
}

export async function createActiveTripPassWithMeters(
  input: {
    id: string;
    userId?: string | null;
    email?: string | null;
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeEventId?: string | null;
    startsAt: Date;
    expiresAt: Date;
    now?: Date;
  },
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  const now = input.now ?? new Date();
  const meterRows = createTripPassMeterRows({
    tripPassId: input.id,
    resetAt: input.expiresAt,
    updatedAt: now,
  });

  await withDatabaseTransaction(db, async (transaction) => {
    await transaction.query(
      `
        insert into trip_passes (
          id,
          user_id,
          email,
          status,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          stripe_event_id,
          starts_at,
          expires_at,
          created_at,
          updated_at
        )
        values ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $9)
      `,
      [
        input.id,
        input.userId ?? null,
        input.email ?? null,
        input.stripeCheckoutSessionId ?? null,
        input.stripePaymentIntentId ?? null,
        input.stripeEventId ?? null,
        input.startsAt,
        input.expiresAt,
        now,
      ],
    );
    await insertMeterRows(meterRows, transaction);
  });

  return {
    pass: (await getTripPass(input.id, db)) ?? missingCreatedPass(input.id),
    usage: await getTripPassUsage(input.id, db),
  };
}

export async function initializeDefaultTripPassMeters(
  input: {
    tripPassId: string;
    resetAt?: Date | null;
    now?: Date;
  },
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  return initializeTripPassMeters(
    {
      ...input,
      meterLimits: tripPassMeterLimits,
    },
    db,
  );
}

export async function initializeTripPassMeters(
  input: {
    tripPassId: string;
    meterLimits: Partial<Record<TripPassMeterType, number>>;
    resetAt?: Date | null;
    now?: Date;
  },
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  const now = input.now ?? new Date();
  const meterRows = createTripPassMeterRows({
    tripPassId: input.tripPassId,
    meterLimits: input.meterLimits,
    resetAt: input.resetAt ?? null,
    updatedAt: now,
  });

  await insertMeterRows(meterRows, db, true);

  return getTripPassUsage(input.tripPassId, db);
}

async function getTripPassUsage(
  tripPassId: string,
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
) {
  const result = await db.query<TripPassUsageMeterRow>(
    `
      select id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
      from trip_usage_meters
      where trip_pass_id = $1
      order by ${meterTypeOrderCaseExpression("meter_type")}
    `,
    [tripPassId],
  );

  return result.rows.map(mapMeterRow);
}

export async function tryConsumeTripPassMeter(
  input: {
    tripPassId: string;
    meterType: TripPassMeterType;
    increment?: number;
    now?: Date;
  },
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
): Promise<TripPassConsumptionResult> {
  const increment = input.increment ?? 1;
  assertValidIncrement(increment);
  const now = input.now ?? new Date();

  const update = await db.query<TripPassUsageMeterRow>(
    `
      update trip_usage_meters
      set used = used + $3::integer,
          updated_at = $4
      where trip_pass_id = $1
        and meter_type = $2
        and used + $3::integer <= "limit"
        and exists (
          select 1
          from trip_passes
          where trip_passes.id = trip_usage_meters.trip_pass_id
            and trip_passes.status = 'active'
            and trip_passes.starts_at <= $4
            and trip_passes.expires_at > $4
        )
      returning id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
    `,
    [input.tripPassId, input.meterType, increment, now],
  );

  const consumed = update.rows[0];
  if (consumed) {
    return { status: "consumed", meter: mapMeterRow(consumed) };
  }

  const pass = await getTripPass(input.tripPassId, db);
  if (!pass) {
    return { status: "pass_not_found", tripPassId: input.tripPassId };
  }
  if (pass.status !== "active") {
    return { status: "pass_inactive", pass };
  }
  if (pass.startsAt > now) {
    return { status: "pass_not_started", pass };
  }
  if (pass.expiresAt <= now) {
    return { status: "pass_expired", pass };
  }

  const meter = await getTripPassMeter(input.tripPassId, input.meterType, db);
  if (!meter) {
    return {
      status: "meter_not_found",
      tripPassId: input.tripPassId,
      meterType: input.meterType,
    };
  }

  return { status: "limit_exceeded", meter };
}

async function getTripPass(
  tripPassId: string,
  db: DatabaseQueryClient,
): Promise<TripPassRecord | null> {
  const result = await db.query<TripPassRow>(
    `
      select
        id,
        user_id,
        email,
        status,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        stripe_event_id,
        starts_at,
        expires_at,
        created_at,
        updated_at
      from trip_passes
      where id = $1
      limit 1
    `,
    [tripPassId],
  );

  const row = result.rows[0];
  return row ? mapPassRow(row) : null;
}

async function getTripPassMeter(
  tripPassId: string,
  meterType: TripPassMeterType,
  db: DatabaseQueryClient,
): Promise<TripPassUsageMeter | null> {
  const result = await db.query<TripPassUsageMeterRow>(
    `
      select id, trip_pass_id, meter_type, used, "limit", reset_at, updated_at
      from trip_usage_meters
      where trip_pass_id = $1 and meter_type = $2
      limit 1
    `,
    [tripPassId, meterType],
  );

  const row = result.rows[0];
  return row ? mapMeterRow(row) : null;
}

function mapPassRow(row: TripPassRow): TripPassRecord {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    status: parseTripPassStatus(row.status),
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeEventId: row.stripe_event_id,
    startsAt: toDate(row.starts_at),
    expiresAt: toDate(row.expires_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapMeterRow(row: TripPassUsageMeterRow): TripPassUsageMeter {
  return {
    id: row.id,
    tripPassId: row.trip_pass_id,
    meterType: parseTripPassMeterType(row.meter_type),
    used: row.used,
    limit: row.limit,
    resetAt: row.reset_at ? toDate(row.reset_at) : null,
    updatedAt: toDate(row.updated_at),
  };
}

function parseTripPassMeterType(value: string): TripPassMeterType {
  if (tripPassLedgerMeterTypes.includes(value as TripPassMeterType)) {
    return value as TripPassMeterType;
  }

  throw new Error(`Unknown trip pass meter type: ${value}`);
}

async function insertMeterRows(
  meterRows: TripPassMeterRow[],
  db: DatabaseQueryClient,
  ignoreConflicts = false,
) {
  if (meterRows.length === 0) {
    return;
  }
  const values = meterRows
    .map((_, index) => {
      const offset = index * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, 0, $${offset + 4}::integer, $${offset + 5}, $${offset + 6})`;
    })
    .join(", ");
  await db.query(
    `
      insert into trip_usage_meters (
        id,
        trip_pass_id,
        meter_type,
        used,
        "limit",
        reset_at,
        updated_at
      )
      values ${values}
      ${ignoreConflicts ? "on conflict (trip_pass_id, meter_type) do nothing" : ""}
    `,
    meterRows.flatMap((row) => [
      row.id,
      row.tripPassId,
      row.meterType,
      row.limit,
      row.resetAt,
      row.updatedAt,
    ]),
  );
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

function parseTripPassStatus(value: string): TripPassStatus {
  if (tripPassStatuses.includes(value as TripPassStatus)) {
    return value as TripPassStatus;
  }

  throw new Error(`Unknown trip pass status: ${value}`);
}

function tripPassMeterId(tripPassId: string, meterType: TripPassMeterType) {
  return `trip_meter_${tripPassId}_${meterType}`;
}

function meterTypeOrderCaseExpression(columnName: string) {
  return `case ${columnName}
    when 'chat_message' then 0
    when 'live_refresh' then 1
    when 'heavy_recommendation' then 2
    when 'weather_refresh' then 3
    when 'route_lookup' then 4
    else 99
  end`;
}

function assertValidIncrement(increment: number) {
  if (!Number.isInteger(increment) || increment <= 0) {
    throw new InvalidTripPassMeterIncrementError(increment);
  }
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function missingCreatedPass(id: string): never {
  throw new Error(`Trip pass ${id} was inserted but could not be loaded.`);
}
