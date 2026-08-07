import { randomUUID } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { readTripPassEnvironment } from "@/server/trip-pass/catalog";
import {
  buildTripPassCheckoutSessionParams,
  createTripPassCheckoutClient,
  type TripPassCheckoutClient,
  type TripPassCheckoutOrderSnapshot,
  type TripPassCheckoutSessionSummary,
  tripPassCheckoutProductSnapshot,
  validateTripPassCheckoutSession,
} from "@/server/trip-pass/stripe-adapter";

const pendingOrderReuseMs = 30 * 60 * 1000;

export type TripPassCheckoutResult =
  | {
      status: "started" | "reused";
      orderId: string;
      checkoutUrl: string;
    }
  | {
      status: "disabled" | "unavailable";
      reason: string;
    };

export type StartTripPassCheckoutInput = {
  userId: string;
  email?: string | null;
  appUrl: string;
};

export type StartTripPassCheckoutOptions = {
  checkoutClient?: TripPassCheckoutClient;
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now?: Date;
};

type TripPassOrderRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  status: string;
  product_code: string;
  product_version: number;
  stripe_price_id: string;
  amount_total_minor: number | null;
  currency: string | null;
  checkout_idempotency_key: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  metadata_json: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

export async function startTripPassCheckout(
  input: StartTripPassCheckoutInput,
  options: StartTripPassCheckoutOptions = {},
): Promise<TripPassCheckoutResult> {
  const environment = readTripPassEnvironment(options.env);
  if (!environment.checkout.enabled) {
    return { status: "disabled", reason: "trip_pass_checkout_disabled" };
  }
  if (environment.checkout.status !== "available" || !environment.checkout.priceId) {
    return {
      status: "unavailable",
      reason: environment.checkout.unavailableReason ?? "trip_pass_checkout_unavailable",
    };
  }

  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = options.now ?? new Date();
  const order = await ensurePendingCheckoutOrder(
    {
      userId: input.userId,
      stripePriceId: environment.checkout.priceId,
      now,
      createId: options.createId ?? defaultCreateId,
    },
    db,
  );
  const checkoutClient = options.checkoutClient ?? createTripPassCheckoutClient();
  const session = await checkoutClient.createCheckoutSession(
    buildTripPassCheckoutSessionParams({ order, appUrl: input.appUrl }),
    { idempotencyKey: order.checkoutIdempotencyKey },
  );

  validateTripPassCheckoutSession({ session, order });
  await markOrderCheckoutCreated({ orderId: order.id, session, now }, db);

  return {
    status: order.createdForRequest ? "started" : "reused",
    orderId: order.id,
    checkoutUrl: session.url,
  };
}

async function ensurePendingCheckoutOrder(
  input: {
    userId: string;
    stripePriceId: string;
    now: Date;
    createId: (prefix: string) => string;
  },
  db: DatabaseQueryClient,
): Promise<TripPassCheckoutOrderSnapshot & { createdForRequest: boolean }> {
  return withDatabaseTransaction(db, async (transaction) => {
    const reusableOrder = await loadReusableOrder(
      { userId: input.userId, stripePriceId: input.stripePriceId },
      transaction,
    );
    if (reusableOrder && !isStalePendingOrder(reusableOrder, input.now)) {
      return {
        id: reusableOrder.id,
        userId: input.userId,
        customerEmail: null,
        checkoutIdempotencyKey: reusableOrder.checkout_idempotency_key,
        stripePriceId: reusableOrder.stripe_price_id,
        createdForRequest: false,
      };
    }

    if (reusableOrder) {
      await expireOrder(reusableOrder.id, input.now, transaction);
    }

    const orderId = input.createId("trip_pass_order");
    const checkoutIdempotencyKey = `trip_pass_checkout:${orderId}`;
    await transaction.query(
      `
        insert into trip_pass_orders (
          id,
          user_id,
          email,
          status,
          product_code,
          product_version,
          stripe_price_id,
          amount_total_minor,
          currency,
          checkout_idempotency_key,
          metadata_json,
          created_at,
          updated_at
        )
        values ($1, $2, $3, 'pending', $4, $5, $6, null, null, $7, $8::jsonb, $9, $9)
      `,
      [
        orderId,
        input.userId,
        null,
        tripPassCheckoutProductSnapshot.productCode,
        tripPassCheckoutProductSnapshot.productVersion,
        input.stripePriceId,
        checkoutIdempotencyKey,
        JSON.stringify({
          durationDays: tripPassCheckoutProductSnapshot.durationDays,
          meterLimits: tripPassCheckoutProductSnapshot.meterLimits,
        }),
        input.now,
      ],
    );

    return {
      id: orderId,
      userId: input.userId,
      customerEmail: null,
      checkoutIdempotencyKey,
      stripePriceId: input.stripePriceId,
      createdForRequest: true,
    };
  });
}

async function loadReusableOrder(
  input: { userId: string; stripePriceId: string },
  db: DatabaseQueryClient,
) {
  const result = await db.query<TripPassOrderRow>(
    `
      select
        id,
        user_id,
        email,
        status,
        product_code,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        stripe_customer_id,
        metadata_json,
        created_at,
        updated_at,
        completed_at
      from trip_pass_orders
      where user_id = $1
        and product_code = $2
        and product_version = $3
        and stripe_price_id = $4
        and status in ('pending', 'checkout_created')
      order by created_at desc, id desc
      limit 1
    `,
    [
      input.userId,
      tripPassCheckoutProductSnapshot.productCode,
      tripPassCheckoutProductSnapshot.productVersion,
      input.stripePriceId,
    ],
  );

  return result.rows[0] ?? null;
}

async function expireOrder(orderId: string, now: Date, db: DatabaseQueryClient) {
  await db.query(
    `
      update trip_pass_orders
      set status = 'expired',
          updated_at = $2
      where id = $1
        and status in ('pending', 'checkout_created')
    `,
    [orderId, now],
  );
}

async function markOrderCheckoutCreated(
  input: { orderId: string; session: TripPassCheckoutSessionSummary; now: Date },
  db: DatabaseQueryClient,
) {
  await db.query(
    `
      update trip_pass_orders
      set status = 'checkout_created',
          stripe_checkout_session_id = $2,
          amount_total_minor = $3,
          currency = $4,
          updated_at = $5
      where id = $1
        and status in ('pending', 'checkout_created')
    `,
    [
      input.orderId,
      input.session.id,
      input.session.amountTotalMinor,
      input.session.currency,
      input.now,
    ],
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

function isStalePendingOrder(order: TripPassOrderRow, now: Date) {
  return toDate(order.created_at).getTime() + pendingOrderReuseMs <= now.getTime();
}

function defaultCreateId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}
