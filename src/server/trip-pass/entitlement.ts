import { createHash } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  createTripPassMeterRows,
  type TripPassMeterRow,
  type TripPassRecord,
  type TripPassUsageMeter,
} from "@/server/payments/trip-pass";
import {
  getTripPassProductContract,
  type TripPassMeterType,
  tripPassMeterTypes as tripPassLedgerMeterTypes,
  tripPassProductCatalog,
} from "@/server/trip-pass/catalog";

const tripPassLedgerMeterTypeSet = new Set<string>(tripPassLedgerMeterTypes);

export const tripPassGrantSourceTypes = [
  "stripe_checkout",
  "manual_operator",
  "refund_adjustment",
  "dispute_adjustment",
] as const;

export type TripPassGrantSourceType = (typeof tripPassGrantSourceTypes)[number];

export type TripPassGrantRecord = {
  id: string;
  orderId: string | null;
  tripPassId: string;
  userId: string | null;
  sourceType: TripPassGrantSourceType;
  sourceEventId: string;
  productCode: string;
  productVersion: number;
  quantity: number;
  durationDays: number;
  meterLimits: Partial<Record<TripPassMeterType, number>>;
  startsAt: Date;
  expiresAt: Date;
  createdAt: Date;
};

export type GrantTripPassResult = {
  status: "granted" | "duplicate";
  pass: TripPassRecord;
  grant: TripPassGrantRecord;
  meters: TripPassUsageMeter[];
};

export type EffectiveTripPassDecision =
  | {
      status: "active";
      pass: TripPassRecord;
      meters: TripPassUsageMeter[];
    }
  | {
      status: "expired" | "revoked";
      pass: TripPassRecord;
      meters: TripPassUsageMeter[];
    }
  | { status: "none"; pass: null; meters: [] };

export class TripPassGrantOwnerMismatchError extends Error {
  constructor(message = "Trip Pass grant owner does not match the requested user.") {
    super(message);
    this.name = "TripPassGrantOwnerMismatchError";
  }
}

type GrantTripPassInput = {
  userId: string;
  email?: string | null;
  orderId?: string | null;
  sourceType: TripPassGrantSourceType;
  sourceEventId: string;
  passId?: string;
  now?: Date;
};

type TripPassGrantRow = {
  id: string;
  order_id: string | null;
  trip_pass_id: string;
  user_id: string | null;
  source_type: string;
  source_event_id: string;
  product_code: string;
  product_version: number;
  quantity: number;
  duration_days: number;
  meter_limits_json: Record<string, number> | string;
  starts_at: Date | string;
  expires_at: Date | string;
  created_at: Date | string;
};

type TripPassOrderRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  product_code: string;
  product_version: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

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

export async function grantTripPass(
  input: GrantTripPassInput,
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
): Promise<GrantTripPassResult> {
  const now = input.now ?? new Date();

  try {
    return await withDatabaseTransaction(db, async (transaction) => {
      const existingGrant = await loadGrantBySource(input, transaction);
      if (existingGrant) {
        await assertGrantOwner(existingGrant, input.userId);
        return buildGrantResult("duplicate", existingGrant, transaction);
      }

      const order = input.orderId ? await loadOrder(input.orderId, transaction) : null;
      if (order) {
        assertOrderOwner(order, input.userId);
      }

      const product = order
        ? getTripPassProductContract(order.product_code, order.product_version)
        : tripPassProductCatalog;
      if (!product) {
        throw new Error("Trip Pass order references an unsupported product contract.");
      }
      const startsAt = now;
      const expiresAt = addDays(startsAt, product.durationDays);
      const passId = input.passId ?? tripPassIdForSource(input.sourceType, input.sourceEventId);
      const grantId = tripPassGrantIdForSource(input.sourceType, input.sourceEventId);
      const meterRows = createTripPassMeterRows({
        tripPassId: passId,
        meterLimits: product.paidMeterLimits,
        resetAt: expiresAt,
        updatedAt: now,
      });

      await insertTripPass(
        {
          id: passId,
          userId: input.userId,
          email: null,
          stripeCheckoutSessionId: order?.stripe_checkout_session_id ?? null,
          stripePaymentIntentId: order?.stripe_payment_intent_id ?? null,
          stripeEventId: input.sourceEventId,
          startsAt,
          expiresAt,
          now,
        },
        transaction,
      );
      const grant = await insertTripPassGrant(
        {
          id: grantId,
          orderId: input.orderId ?? null,
          tripPassId: passId,
          userId: input.userId,
          sourceType: input.sourceType,
          sourceEventId: input.sourceEventId,
          startsAt,
          expiresAt,
          createdAt: now,
          product,
        },
        transaction,
      );
      await insertTripPassMeters(meterRows, transaction);

      return buildGrantResult("granted", grant, transaction);
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existingGrant = await loadGrantBySource(input, db);
      if (existingGrant) {
        await assertGrantOwner(existingGrant, input.userId);
        return buildGrantResult("duplicate", existingGrant, db);
      }
    }
    throw error;
  }
}

export async function getEffectiveTripPass(
  input: { userId: string; now?: Date },
  db: DatabaseQueryClient = getDefaultDatabaseQueryClient(),
): Promise<EffectiveTripPassDecision> {
  const now = input.now ?? new Date();
  const active = await loadEffectiveActivePass(input.userId, now, db);

  if (active) {
    return {
      status: "active",
      pass: active,
      meters: await loadTripPassMeters(active.id, db),
    };
  }

  const latest = await loadLatestPass(input.userId, db);
  if (!latest) {
    return { status: "none", pass: null, meters: [] };
  }

  return {
    status: latest.status === "cancelled" || latest.status === "refunded" ? "revoked" : "expired",
    pass: latest,
    meters: await loadTripPassMeters(latest.id, db),
  };
}

async function withDatabaseTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction) {
    return callback(db);
  }
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

async function loadGrantBySource(
  input: Pick<GrantTripPassInput, "sourceType" | "sourceEventId">,
  db: DatabaseQueryClient,
) {
  const result = await db.query<TripPassGrantRow>(
    `
      select
        id,
        order_id,
        trip_pass_id,
        user_id,
        source_type,
        source_event_id,
        product_code,
        product_version,
        quantity,
        duration_days,
        meter_limits_json,
        starts_at,
        expires_at,
        created_at
      from trip_pass_grants
      where source_type = $1 and source_event_id = $2
      limit 1
    `,
    [input.sourceType, input.sourceEventId],
  );

  const row = result.rows[0];
  return row ? mapGrantRow(row) : null;
}

async function loadOrder(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<TripPassOrderRow>(
    `
      select
        id,
        user_id,
        email,
        product_code,
        product_version,
        stripe_checkout_session_id,
        stripe_payment_intent_id
      from trip_pass_orders
      where id = $1
      limit 1
    `,
    [orderId],
  );

  return result.rows[0] ?? null;
}

async function insertTripPass(
  input: {
    id: string;
    userId: string;
    email: string | null;
    stripeCheckoutSessionId: string | null;
    stripePaymentIntentId: string | null;
    stripeEventId: string;
    startsAt: Date;
    expiresAt: Date;
    now: Date;
  },
  db: DatabaseQueryClient,
) {
  await db.query(
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
      input.userId,
      input.email,
      input.stripeCheckoutSessionId,
      input.stripePaymentIntentId,
      input.stripeEventId,
      input.startsAt,
      input.expiresAt,
      input.now,
    ],
  );
}

async function insertTripPassGrant(
  input: {
    id: string;
    orderId: string | null;
    tripPassId: string;
    userId: string;
    sourceType: TripPassGrantSourceType;
    sourceEventId: string;
    startsAt: Date;
    expiresAt: Date;
    createdAt: Date;
    product: {
      code: string;
      version: number;
      durationDays: number;
      paidMeterLimits: Partial<Record<TripPassMeterType, number>>;
    };
  },
  db: DatabaseQueryClient,
) {
  const result = await db.query<TripPassGrantRow>(
    `
      insert into trip_pass_grants (
        id,
        order_id,
        trip_pass_id,
        user_id,
        source_type,
        source_event_id,
        product_code,
        product_version,
        quantity,
        duration_days,
        meter_limits_json,
        starts_at,
        expires_at,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10::jsonb, $11, $12, $13)
      returning
        id,
        order_id,
        trip_pass_id,
        user_id,
        source_type,
        source_event_id,
        product_code,
        product_version,
        quantity,
        duration_days,
        meter_limits_json,
        starts_at,
        expires_at,
        created_at
    `,
    [
      input.id,
      input.orderId,
      input.tripPassId,
      input.userId,
      input.sourceType,
      input.sourceEventId,
      input.product.code,
      input.product.version,
      input.product.durationDays,
      JSON.stringify(input.product.paidMeterLimits),
      input.startsAt,
      input.expiresAt,
      input.createdAt,
    ],
  );

  return mapGrantRow(result.rows[0] ?? missingInsertedGrant(input.id));
}

async function insertTripPassMeters(meterRows: TripPassMeterRow[], db: DatabaseQueryClient) {
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

async function buildGrantResult(
  status: GrantTripPassResult["status"],
  grant: TripPassGrantRecord,
  db: DatabaseQueryClient,
): Promise<GrantTripPassResult> {
  const pass = await loadTripPass(grant.tripPassId, db);
  if (!pass) {
    throw new Error(`Trip Pass grant ${grant.id} references missing pass ${grant.tripPassId}.`);
  }

  return {
    status,
    pass,
    grant,
    meters: await loadTripPassMeters(pass.id, db),
  };
}

async function loadEffectiveActivePass(userId: string, now: Date, db: DatabaseQueryClient) {
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
      where user_id = $1
        and status = 'active'
        and starts_at <= $2
        and expires_at > $2
      order by expires_at desc, created_at desc, id desc
      limit 1
    `,
    [userId, now],
  );

  const row = result.rows[0];
  return row ? mapPassRow(row) : null;
}

async function loadLatestPass(userId: string, db: DatabaseQueryClient) {
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
      where user_id = $1
      order by expires_at desc, created_at desc, id desc
      limit 1
    `,
    [userId],
  );

  const row = result.rows[0];
  return row ? mapPassRow(row) : null;
}

async function loadTripPass(tripPassId: string, db: DatabaseQueryClient) {
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

async function loadTripPassMeters(tripPassId: string, db: DatabaseQueryClient) {
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

async function assertGrantOwner(grant: TripPassGrantRecord, userId: string) {
  if (grant.userId !== userId) {
    throw new TripPassGrantOwnerMismatchError(
      "Trip Pass grant source reference is already owned by another user.",
    );
  }
}

function assertOrderOwner(order: TripPassOrderRow, userId: string) {
  if (order.user_id !== userId) {
    throw new TripPassGrantOwnerMismatchError("Trip Pass order is owned by another user.");
  }
}

function mapGrantRow(row: TripPassGrantRow): TripPassGrantRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    tripPassId: row.trip_pass_id,
    userId: row.user_id,
    sourceType: parseGrantSourceType(row.source_type),
    sourceEventId: row.source_event_id,
    productCode: row.product_code,
    productVersion: row.product_version,
    quantity: row.quantity,
    durationDays: row.duration_days,
    meterLimits: parseMeterLimits(row.meter_limits_json),
    startsAt: toDate(row.starts_at),
    expiresAt: toDate(row.expires_at),
    createdAt: toDate(row.created_at),
  };
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

function parseGrantSourceType(value: string): TripPassGrantSourceType {
  if (tripPassGrantSourceTypes.includes(value as TripPassGrantSourceType)) {
    return value as TripPassGrantSourceType;
  }

  throw new Error(`Unknown trip pass grant source type: ${value}`);
}

function parseTripPassMeterType(value: string): TripPassMeterType {
  if (tripPassLedgerMeterTypeSet.has(value)) {
    return value as TripPassMeterType;
  }

  throw new Error(`Unknown trip pass meter type: ${value}`);
}

function parseTripPassStatus(value: string): TripPassRecord["status"] {
  if (["active", "expired", "cancelled", "refunded"].includes(value)) {
    return value as TripPassRecord["status"];
  }

  throw new Error(`Unknown trip pass status: ${value}`);
}

function parseMeterLimits(
  value: Record<string, number> | string,
): Partial<Record<TripPassMeterType, number>> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([meterType, limit]) =>
      tripPassLedgerMeterTypeSet.has(meterType) ? [[meterType, Number(limit)]] : [],
    ),
  ) as Partial<Record<TripPassMeterType, number>>;
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

function tripPassIdForSource(sourceType: TripPassGrantSourceType, sourceEventId: string) {
  return `trip_pass_${stableSourceDigest(sourceType, sourceEventId)}`;
}

function tripPassGrantIdForSource(sourceType: TripPassGrantSourceType, sourceEventId: string) {
  return `trip_grant_${stableSourceDigest(sourceType, sourceEventId)}`;
}

function stableSourceDigest(sourceType: TripPassGrantSourceType, sourceEventId: string) {
  return createHash("sha256").update(`${sourceType}:${sourceEventId}`).digest("hex").slice(0, 24);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function isUniqueConflict(error: unknown) {
  return error instanceof Error && /unique|duplicate/i.test(error.message);
}

function missingInsertedGrant(id: string): TripPassGrantRow {
  throw new Error(`Trip Pass grant insert returned no row for ${id}.`);
}
