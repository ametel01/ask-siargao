import { randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { riskReconciliationOrderCapacity } from "@/server/operations/operational-capacity";
import {
  readLemonSqueezyEnvironment,
  readTripPassEnvironment,
  tripPassProductFamily,
} from "@/server/trip-pass/catalog";
import { acquireFamilyReservationLock } from "@/server/trip-pass/commerce";
import {
  createLemonSqueezyCheckoutClient,
  type LemonSqueezyCheckoutClient,
  LemonSqueezyCheckoutCreationError,
  type LemonSqueezyCheckoutOrderSnapshot,
  type LemonSqueezyCheckoutSummary,
  tripPassLemonSqueezyProductSnapshot,
  validateLemonSqueezyCheckout,
} from "@/server/trip-pass/lemon-squeezy-adapter";

export type LemonTripPassCheckoutResult =
  | { status: "started" | "reused"; orderId: string; checkoutUrl: string }
  | { status: "blocked" | "disabled" | "unavailable"; reason: string };

export type LemonTripPassCheckoutOptions = {
  client?: LemonSqueezyCheckoutClient;
  createId?: (prefix: string) => string;
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now?: Date;
};

export const lemonCheckoutSettlementGraceMs = 5 * 60_000;

export async function startLemonSqueezyTripPassCheckout(
  input: { userId: string; email?: string | null; appUrl: string },
  options: LemonTripPassCheckoutOptions,
): Promise<LemonTripPassCheckoutResult> {
  const env = options.env ?? process.env;
  const tripPassEnvironment = readTripPassEnvironment(env);
  const lemonEnvironment = readLemonSqueezyEnvironment(env);
  if (tripPassEnvironment.checkout.mode === "off") {
    return { status: "disabled", reason: "trip_pass_checkout_disabled" };
  }
  if (
    tripPassEnvironment.checkout.mode === "canary" &&
    !tripPassEnvironment.checkout.canaryAccountIds.includes(input.userId)
  ) {
    return { status: "disabled", reason: "trip_pass_checkout_canary_only" };
  }
  if (!lemonEnvironment.configured || !lemonEnvironment.apiKeyConfigured) {
    return { status: "unavailable", reason: "lemon_squeezy_configuration_unavailable" };
  }
  if (!lemonEnvironment.storeId || !lemonEnvironment.variantId) {
    return { status: "unavailable", reason: "lemon_squeezy_variant_unavailable" };
  }

  const order = await ensureLemonOrder({
    userId: input.userId,
    email: input.email,
    storeId: lemonEnvironment.storeId,
    productId: lemonEnvironment.productId,
    variantId: lemonEnvironment.variantId,
    testMode: env.LEMON_SQUEEZY_ALLOW_TEST_MODE === "true",
    createId: options.createId ?? defaultCreateId,
    now: options.now,
    db: options.db,
  });
  if ("reason" in order) return { status: "blocked", reason: order.reason };

  const client = options.client ?? createLemonSqueezyCheckoutClient();
  let checkout: LemonSqueezyCheckoutSummary;
  try {
    checkout = await client.createCheckout(
      { order, appUrl: input.appUrl },
      { idempotencyKey: order.checkoutIdempotencyKey },
    );
  } catch (error) {
    if (error instanceof LemonSqueezyCheckoutCreationError && error.kind === "ambiguous") {
      try {
        checkout = await client.createCheckout(
          { order, appUrl: input.appUrl },
          { idempotencyKey: order.checkoutIdempotencyKey },
        );
      } catch (retryError) {
        if (
          retryError instanceof LemonSqueezyCheckoutCreationError &&
          retryError.kind === "definitive"
        ) {
          await markLemonOrderFailed(options.db, order.id, options.now ?? new Date());
        }
        throw retryError;
      }
    } else {
      if (error instanceof LemonSqueezyCheckoutCreationError && error.kind === "definitive") {
        await markLemonOrderFailed(options.db, order.id, options.now ?? new Date());
      }
      throw error;
    }
  }
  validateLemonSqueezyCheckout({ checkout, order });
  const now = options.now ?? new Date();
  await markLemonOrderCreated({ db: options.db, order, checkout, now });
  return {
    status: order.createdForRequest ? "started" : "reused",
    orderId: order.id,
    checkoutUrl: checkout.url,
  };
}

export async function cancelLemonSqueezyTripPassCheckout(
  input: { userId: string },
  options: { db: DatabaseQueryClient },
): Promise<
  | { status: "not_found"; reason: "no_effective_pending_order" }
  | { status: "unavailable"; reason: "checkout_cancellation_unavailable" }
> {
  const result = await options.db.query<{ id: string }>(
    `select id from trip_pass_orders where user_id = $1 and payment_provider = 'lemon_squeezy'
      and product_family = $2 and status in ('pending', 'checkout_created')
      and checkout_session_expires_at > now() order by created_at desc limit 1`,
    [input.userId, tripPassProductFamily],
  );
  return result.rows[0]
    ? { status: "unavailable", reason: "checkout_cancellation_unavailable" }
    : { status: "not_found", reason: "no_effective_pending_order" };
}

type LemonOrder = LemonSqueezyCheckoutOrderSnapshot & { createdForRequest: boolean };

async function ensureLemonOrder(input: {
  userId: string;
  email?: string | null;
  storeId: string;
  productId?: string;
  variantId: string;
  testMode: boolean;
  createId: (prefix: string) => string;
  now?: Date;
  db: DatabaseQueryClient;
}): Promise<LemonOrder | { reason: string }> {
  return withTransaction(input.db, async (db) => {
    await acquireFamilyReservationLock(
      { productFamily: tripPassProductFamily, userId: input.userId },
      db,
    );
    const now = input.now ?? (await readDatabaseNow(db));
    const blocking = await db.query<{ id: string }>(
      `select p.id from trip_passes p left join trip_usage_meters m on m.trip_pass_id = p.id and m.meter_type = 'chat_message'
       where p.user_id = $1 and p.status in ('active', 'suspended') and p.starts_at <= $2 and p.expires_at > $2
       and (p.status = 'suspended' or m.id is null or m.used < m."limit") limit 1`,
      [input.userId, now],
    );
    if (blocking.rows[0]) return { reason: "trip_pass_family_active" };
    const reusable = await db.query<LemonOrderRow>(
      `select id, user_id, product_family, checkout_idempotency_key, checkout_session_expires_at,
        provider_store_id, provider_product_id, provider_variant_id from trip_pass_orders
       where user_id = $1 and product_family = $2 and payment_provider = 'lemon_squeezy'
       and status in ('pending', 'checkout_created') and checkout_session_expires_at > $3
       order by created_at desc, id desc limit 1`,
      [input.userId, tripPassProductFamily, now],
    );
    if (reusable.rows[0]) {
      const row = reusable.rows[0];
      return {
        id: row.id,
        userId: input.userId,
        productFamily: row.product_family,
        customerEmail: input.email ?? null,
        checkoutIdempotencyKey: row.checkout_idempotency_key,
        checkoutSessionExpiresAt: new Date(row.checkout_session_expires_at),
        storeId: row.provider_store_id ?? input.storeId,
        productId: row.provider_product_id ?? input.productId,
        variantId: row.provider_variant_id ?? input.variantId,
        testMode: input.testMode,
        createdForRequest: false,
      };
    }
    const settlementFence = await db.query<{ id: string }>(
      `select o.id from trip_pass_orders o
       where o.user_id = $1 and o.product_family = $2
         and o.payment_provider = 'lemon_squeezy'
         and o.status in ('pending', 'checkout_created')
         and o.checkout_session_expires_at is not null
         and o.checkout_session_expires_at <= $3
         and o.accepted_payment_fact_id is null
         and coalesce(o.captured_amount_minor, 0) = 0
         and (
           o.checkout_session_expires_at > $4
           or exists (
             select 1 from trip_pass_payment_event_receipts receipt
             where receipt.order_id = o.id and receipt.status = 'pending'
           )
           or (
             o.checkout_return_lookup_attempts > 0
             and o.checkout_return_lookup_status = 'pending'
           )
         )
       order by o.created_at desc, o.id desc limit 1`,
      [
        input.userId,
        tripPassProductFamily,
        now,
        new Date(now.getTime() - lemonCheckoutSettlementGraceMs),
      ],
    );
    if (settlementFence.rows[0]) return { reason: "trip_pass_checkout_settling" };
    await acquireRiskReconciliationCapacityLock(db);
    const expiredOrders = await db.query<{ id: string }>(
      `update trip_pass_orders set status = 'expired', checkout_session_status = 'expired',
         updated_at = $1
       where payment_provider = 'lemon_squeezy'
         and status in ('pending', 'checkout_created')
         and checkout_session_expires_at is not null and checkout_session_expires_at <= $2
         and accepted_payment_fact_id is null and coalesce(captured_amount_minor, 0) = 0
         and not exists (
           select 1 from trip_pass_payment_event_receipts receipt
           where receipt.order_id = trip_pass_orders.id and receipt.status = 'pending'
         )
         and not (
           checkout_return_lookup_attempts > 0 and checkout_return_lookup_status = 'pending'
         )
       returning id`,
      [now, new Date(now.getTime() - lemonCheckoutSettlementGraceMs)],
    );
    if (expiredOrders.rows.length > 0) {
      await db.query(
        `update trip_pass_checkout_attempts set status = 'expired', updated_at = $2
         where order_id = any($1::text[]) and status = 'created'`,
        [expiredOrders.rows.map((order) => order.id), now],
      );
    }
    const riskPopulation = await db.query<{ count: number | string }>(
      `select count(*)::text as count from trip_pass_orders
       where status in ('pending', 'checkout_created', 'paid', 'disputed')`,
    );
    if (Number(riskPopulation.rows[0]?.count ?? 0) >= riskReconciliationOrderCapacity) {
      return { reason: "trip_pass_reconciliation_capacity_reached" };
    }
    const id = input.createId("trip_pass_order");
    const expiresAt = new Date(Math.floor(now.getTime() / 1_000) * 1_000 + 30 * 60_000);
    const idempotencyKey = `trip_pass_checkout:${id}`;
    await db.query(
      `insert into trip_pass_orders (
        id, user_id, email, status, product_code, product_family, product_version,
        stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
        checkout_session_expires_at, metadata_json, payment_provider, provider_store_id,
        provider_product_id, provider_variant_id, created_at, updated_at
      ) values ($1, $2, $3, 'pending', $4, $5, $6, null, $7, $8, $9, $10, $11::jsonb, 'lemon_squeezy', $12, $13, $14, $15, $15)`,
      [
        id,
        input.userId,
        input.email ?? null,
        tripPassLemonSqueezyProductSnapshot.productCode,
        tripPassLemonSqueezyProductSnapshot.productFamily,
        tripPassLemonSqueezyProductSnapshot.productVersion,
        tripPassLemonSqueezyProductSnapshot.amountTotalMinor,
        tripPassLemonSqueezyProductSnapshot.currency,
        idempotencyKey,
        expiresAt,
        JSON.stringify({
          durationHours: tripPassLemonSqueezyProductSnapshot.durationHours,
          meterLimits: tripPassLemonSqueezyProductSnapshot.meterLimits,
          policyVersions: tripPassLemonSqueezyProductSnapshot.policyVersions,
        }),
        input.storeId,
        input.productId,
        input.variantId,
        now,
      ],
    );
    return {
      id,
      userId: input.userId,
      productFamily: tripPassProductFamily,
      customerEmail: input.email ?? null,
      checkoutIdempotencyKey: idempotencyKey,
      checkoutSessionExpiresAt: expiresAt,
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId,
      testMode: input.testMode,
      createdForRequest: true,
    };
  });
}

async function acquireRiskReconciliationCapacityLock(db: DatabaseQueryClient) {
  try {
    await db.query(
      `select pg_advisory_xact_lock(
         hashtext('ask-siargao-reconciliation-capacity'), hashtext('siargao_trip_pass'))`,
    );
  } catch (error) {
    if (db.dialect === "pglite") return;
    throw error;
  }
}

async function markLemonOrderCreated(input: {
  db: DatabaseQueryClient;
  order: LemonOrder;
  checkout: LemonSqueezyCheckoutSummary;
  now: Date;
}) {
  await input.db.query(
    `update trip_pass_orders set status = 'checkout_created', provider_checkout_id = $2,
      checkout_commercial_terms_verified_at = $4,
      checkout_session_status = 'open', checkout_attempt_id = $3, updated_at = $4
     where id = $1 and status in ('pending', 'checkout_created')`,
    [
      input.order.id,
      input.checkout.id,
      `checkout_attempt_${input.order.id}_${input.checkout.id}`,
      input.now,
    ],
  );
  await input.db.query(
    `insert into trip_pass_checkout_attempts (
      id, order_id, provider, provider_checkout_id, idempotency_key, checkout_url, expires_at, status, created_at, updated_at
    ) values ($1, $2, 'lemon_squeezy', $3, $4, $5, $6, 'created', $7, $7)
    on conflict (id) do update set provider_checkout_id = excluded.provider_checkout_id,
      checkout_url = excluded.checkout_url, status = 'created', updated_at = excluded.updated_at`,
    [
      `checkout_attempt_${input.order.id}_${input.checkout.id}`,
      input.order.id,
      input.checkout.id,
      input.order.checkoutIdempotencyKey,
      input.checkout.url,
      input.order.checkoutSessionExpiresAt,
      input.now,
    ],
  );
}

async function markLemonOrderFailed(db: DatabaseQueryClient, orderId: string, now: Date) {
  await db.query(
    "update trip_pass_orders set status = 'failed', updated_at = $2 where id = $1 and status = 'pending'",
    [orderId, now],
  );
}

async function readDatabaseNow(db: DatabaseQueryClient) {
  const result = await db.query<{ database_now: Date | string }>("select now() as database_now");
  return result.rows[0]?.database_now instanceof Date
    ? result.rows[0].database_now
    : new Date(String(result.rows[0]?.database_now));
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction || !db.transaction) return callback(db);
  return db.transaction(callback);
}

function defaultCreateId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

type LemonOrderRow = {
  id: string;
  user_id: string | null;
  product_family: string;
  checkout_idempotency_key: string;
  checkout_session_expires_at: Date | string;
  provider_store_id: string | null;
  provider_product_id: string | null;
  provider_variant_id: string | null;
};
