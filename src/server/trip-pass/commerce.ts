import { randomUUID } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  readLemonSqueezyEnvironment,
  readTripPassEnvironment,
  tripPassProductFamily,
} from "@/server/trip-pass/catalog";
import {
  cancelLemonSqueezyTripPassCheckout,
  type LemonTripPassCheckoutOptions,
  startLemonSqueezyTripPassCheckout,
} from "@/server/trip-pass/lemon-commerce";
import {
  buildTripPassCheckoutSessionParams,
  createTripPassCheckoutClient,
  isDefinitiveTripPassCheckoutSessionCreationError,
  type TripPassCheckoutClient,
  type TripPassCheckoutOrderSnapshot,
  type TripPassCheckoutSessionSummary,
  tripPassCheckoutProductSnapshot,
  validateTripPassCheckoutSession,
} from "@/server/trip-pass/stripe-adapter";

export type TripPassCheckoutResult =
  | {
      status: "started" | "reused";
      orderId: string;
      checkoutUrl: string;
    }
  | {
      status: "blocked" | "disabled" | "unavailable";
      reason: string;
    };

export type CancelTripPassCheckoutResult =
  | { status: "cancelled" | "already_terminal"; orderId: string }
  | { status: "not_found"; reason: "no_effective_pending_order" }
  | { status: "unavailable"; reason: "checkout_cancellation_unavailable" };

export type StartTripPassCheckoutInput = {
  userId: string;
  email?: string | null;
  appUrl: string;
};

export type CancelTripPassCheckoutInput = {
  userId: string;
};

export type StartTripPassCheckoutOptions = {
  checkoutClient?: TripPassCheckoutClient;
  createId?: (prefix: string) => string;
  db?: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now?: Date;
  lemonCheckoutClient?: LemonTripPassCheckoutOptions["client"];
};

export type CancelTripPassCheckoutOptions = {
  checkoutClient?: TripPassCheckoutClient;
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
  product_family: string;
  product_version: number;
  stripe_price_id: string | null;
  amount_total_minor: number | null;
  currency: string | null;
  checkout_idempotency_key: string;
  stripe_checkout_session_id: string | null;
  checkout_session_expires_at: Date | string | null;
  checkout_session_status: string | null;
  checkout_cancellation_confirmed_at: Date | string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  terms_policy_version: string | null;
  refund_policy_version: string | null;
  privacy_policy_version: string | null;
  retention_policy_version: string | null;
  terms_consent_presented_at: Date | string | null;
  metadata_json: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

type DatabaseNowRow = {
  database_now: Date | string;
};

type BlockingPassRow = {
  id: string;
};

export async function startTripPassCheckout(
  input: StartTripPassCheckoutInput,
  options: StartTripPassCheckoutOptions = {},
): Promise<TripPassCheckoutResult> {
  const lemonEnvironment = readLemonSqueezyEnvironment(options.env);
  if (lemonEnvironment.configured) {
    return startLemonSqueezyTripPassCheckout(input, {
      db: options.db ?? getDefaultDatabaseQueryClient(),
      env: options.env,
      now: options.now,
      client: options.lemonCheckoutClient,
      createId: options.createId,
    });
  }
  if (!legacyStripeCompatibilityAllowed(options.env)) {
    return { status: "unavailable", reason: "lemon_squeezy_configuration_unavailable" };
  }
  const environment = readTripPassEnvironment(options.env);
  const checkoutAvailability = checkoutAvailabilityForAccount(input.userId, environment.checkout);
  if (checkoutAvailability) {
    return checkoutAvailability;
  }
  if (!environment.checkout.priceId) {
    return { status: "unavailable", reason: "trip_pass_checkout_unavailable" };
  }

  const db = options.db ?? getDefaultDatabaseQueryClient();
  const order = await ensurePendingCheckoutOrder(
    {
      userId: input.userId,
      stripePriceId: environment.checkout.priceId,
      createId: options.createId ?? defaultCreateId,
    },
    db,
  );
  if ("reason" in order) {
    return { status: "blocked", reason: order.reason };
  }

  const checkoutClient = options.checkoutClient ?? createTripPassCheckoutClient();
  let session: TripPassCheckoutSessionSummary;
  try {
    session = await checkoutClient.createCheckoutSession(
      buildTripPassCheckoutSessionParams({ order, appUrl: input.appUrl }),
      { idempotencyKey: order.checkoutIdempotencyKey },
    );
  } catch (error) {
    if (isDefinitiveTripPassCheckoutSessionCreationError(error)) {
      await markOrderCheckoutCreationFailed({ orderId: order.id, now: options.now }, db);
    }
    throw error;
  }

  validateTripPassCheckoutSession({ session, order });
  const checkoutDisposition = await markOrderCheckoutCreated(
    { orderId: order.id, session, userId: input.userId, now: options.now },
    db,
  );
  if (checkoutDisposition === "closed") {
    return { status: "blocked", reason: "account_closed_during_checkout" };
  }

  return {
    status: order.createdForRequest ? "started" : "reused",
    orderId: order.id,
    checkoutUrl: session.url,
  };
}

export async function cancelTripPassCheckout(
  input: CancelTripPassCheckoutInput,
  options: CancelTripPassCheckoutOptions = {},
): Promise<CancelTripPassCheckoutResult> {
  if (readLemonSqueezyEnvironment(options.env).configured) {
    return cancelLemonSqueezyTripPassCheckout(input, {
      db: options.db ?? getDefaultDatabaseQueryClient(),
    });
  }
  if (!legacyStripeCompatibilityAllowed(options.env)) {
    return { status: "unavailable", reason: "checkout_cancellation_unavailable" };
  }
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const checkoutClient = options.checkoutClient ?? createTripPassCheckoutClient();
  const order = await loadLatestEffectivePendingOrder(
    { userId: input.userId, productFamily: tripPassProductFamily },
    db,
  );

  if (!order) {
    return { status: "not_found", reason: "no_effective_pending_order" };
  }
  if (!order.stripe_checkout_session_id) {
    return { status: "unavailable", reason: "checkout_cancellation_unavailable" };
  }

  const session = await checkoutClient.expireCheckoutSession(order.stripe_checkout_session_id);
  if (session.status !== "expired") {
    return { status: "unavailable", reason: "checkout_cancellation_unavailable" };
  }

  const now = options.now ?? (await readDatabaseNow(db));
  const result = await db.query<{ id: string }>(
    `
      update trip_pass_orders
      set status = 'expired',
          checkout_session_status = 'expired',
          checkout_cancellation_confirmed_at = $3,
          updated_at = $3
      where id = $1
        and user_id = $2
        and status in ('pending', 'checkout_created')
      returning id
    `,
    [order.id, input.userId, now],
  );

  if (!result.rows[0]) {
    return { status: "already_terminal", orderId: order.id };
  }

  return { status: "cancelled", orderId: order.id };
}

async function ensurePendingCheckoutOrder(
  input: {
    userId: string;
    stripePriceId: string;
    createId: (prefix: string) => string;
  },
  db: DatabaseQueryClient,
): Promise<
  | (TripPassCheckoutOrderSnapshot & { createdForRequest: boolean })
  | { status: "blocked"; reason: string }
> {
  return withDatabaseTransaction(db, async (transaction) => {
    await acquireFamilyReservationLock(
      { productFamily: tripPassProductFamily, userId: input.userId },
      transaction,
    );
    const databaseNow = await readDatabaseNow(transaction);

    if (await hasBlockingTripPass({ userId: input.userId, now: databaseNow }, transaction)) {
      return { status: "blocked", reason: "trip_pass_family_active" };
    }

    const reusableOrder = await loadLatestEffectivePendingOrder(
      { userId: input.userId, productFamily: tripPassProductFamily },
      transaction,
    );
    if (reusableOrder) {
      return orderSnapshotFromRow(reusableOrder, {
        customerEmail: null,
        createdForRequest: false,
      });
    }

    const orderId = input.createId("trip_pass_order");
    const checkoutIdempotencyKey = `trip_pass_checkout:${orderId}`;
    const checkoutSessionExpiresAt = checkoutExpiryFromReservationTime(databaseNow);
    await transaction.query(
      `
        insert into trip_pass_orders (
          id,
          user_id,
          email,
          status,
          product_code,
          product_family,
          product_version,
          stripe_price_id,
          amount_total_minor,
          currency,
          checkout_idempotency_key,
          checkout_session_expires_at,
          terms_policy_version,
          refund_policy_version,
          privacy_policy_version,
          retention_policy_version,
          terms_consent_presented_at,
          metadata_json,
          created_at,
          updated_at
        )
        values (
          $1,
          $2,
          $3,
          'pending',
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17::jsonb,
          $16,
          $16
        )
      `,
      [
        orderId,
        input.userId,
        null,
        tripPassCheckoutProductSnapshot.productCode,
        tripPassCheckoutProductSnapshot.productFamily,
        tripPassCheckoutProductSnapshot.productVersion,
        input.stripePriceId,
        tripPassCheckoutProductSnapshot.amountTotalMinor,
        tripPassCheckoutProductSnapshot.currency,
        checkoutIdempotencyKey,
        checkoutSessionExpiresAt,
        tripPassCheckoutProductSnapshot.policyVersions.terms,
        tripPassCheckoutProductSnapshot.policyVersions.refund,
        tripPassCheckoutProductSnapshot.policyVersions.privacy,
        tripPassCheckoutProductSnapshot.policyVersions.retention,
        databaseNow,
        JSON.stringify({
          durationHours: tripPassCheckoutProductSnapshot.durationHours,
          meterLimits: tripPassCheckoutProductSnapshot.meterLimits,
          policyVersions: tripPassCheckoutProductSnapshot.policyVersions,
        }),
      ],
    );

    return {
      id: orderId,
      userId: input.userId,
      productFamily: tripPassCheckoutProductSnapshot.productFamily,
      customerEmail: null,
      checkoutIdempotencyKey,
      checkoutSessionExpiresAt,
      stripePriceId: input.stripePriceId,
      createdForRequest: true,
    };
  });
}

async function loadLatestEffectivePendingOrder(
  input: { userId: string; productFamily: string },
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
        product_family,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        checkout_session_expires_at,
        checkout_session_status,
        checkout_cancellation_confirmed_at,
        stripe_payment_intent_id,
        stripe_customer_id,
        terms_policy_version,
        refund_policy_version,
        privacy_policy_version,
        retention_policy_version,
        terms_consent_presented_at,
        metadata_json,
        created_at,
        updated_at,
        completed_at
      from trip_pass_orders
      where user_id = $1
        and product_family = $2
        and status in ('pending', 'checkout_created')
      order by created_at desc, id desc
      limit 1
    `,
    [input.userId, input.productFamily],
  );

  return result.rows[0] ?? null;
}

async function hasBlockingTripPass(input: { userId: string; now: Date }, db: DatabaseQueryClient) {
  const result = await db.query<BlockingPassRow>(
    `
      select p.id
      from trip_passes p
      left join trip_usage_meters m
        on m.trip_pass_id = p.id
       and m.meter_type = 'chat_message'
      where p.user_id = $1
        and p.status in ('active', 'suspended')
        and p.starts_at <= $2
        and p.expires_at > $2
        and (p.status = 'suspended' or m.id is null or m.used < m."limit")
      order by p.expires_at desc, p.created_at desc, p.id desc
      limit 1
    `,
    [input.userId, input.now],
  );

  return Boolean(result.rows[0]);
}

async function markOrderCheckoutCreated(
  input: {
    orderId: string;
    session: TripPassCheckoutSessionSummary;
    userId: string;
    now?: Date;
  },
  db: DatabaseQueryClient,
) {
  return withDatabaseTransaction(db, async (transaction) => {
    await acquireFamilyReservationLock(
      { userId: input.userId, productFamily: tripPassProductFamily },
      transaction,
    );
    const now = input.now ?? (await readDatabaseNow(transaction));
    const order = await transaction.query<{
      closure_tombstone_id: string | null;
    }>("select closure_tombstone_id from trip_pass_orders where id = $1 for update", [
      input.orderId,
    ]);
    const closureTombstoneId = order.rows[0]?.closure_tombstone_id;

    if (!closureTombstoneId) {
      await transaction.query(
        `
          update trip_pass_orders
          set status = 'checkout_created',
              stripe_checkout_session_id = $2,
              checkout_session_status = $3,
              amount_total_minor = $4,
              currency = $5,
              updated_at = $6
          where id = $1
            and status in ('pending', 'checkout_created')
        `,
        [
          input.orderId,
          input.session.id,
          input.session.status,
          input.session.amountTotalMinor,
          input.session.currency,
          now,
        ],
      );
      return "created" as const;
    }

    const operation = await transaction.query<{ id: string }>(
      `select id from account_closure_operations
       where tombstone_id = $1 order by created_at asc limit 1 for update`,
      [closureTombstoneId],
    );
    const operationId = operation.rows[0]?.id;
    if (!operationId) {
      throw new Error("closure_operation_missing");
    }
    await transaction.query(
      `update trip_pass_orders
       set status = 'checkout_created', user_id = null, email = null,
         stripe_customer_id = null, metadata_json = '{}'::jsonb,
         stripe_checkout_session_id = $2, checkout_session_status = $3,
         amount_total_minor = $4, currency = $5, updated_at = $6
       where id = $1 and status in ('pending', 'checkout_created')`,
      [
        input.orderId,
        input.session.id,
        input.session.status,
        input.session.amountTotalMinor,
        input.session.currency,
        now,
      ],
    );
    await transaction.query(
      `insert into account_closure_checkout_sessions
         (operation_id, stripe_checkout_session_id, status, created_at, updated_at)
       values ($1, $2, 'pending', $3, $3)
       on conflict (operation_id, stripe_checkout_session_id) do update set
         status = 'pending', completed_at = null, last_error_category = null,
         updated_at = excluded.updated_at`,
      [operationId, input.session.id, now],
    );
    await transaction.query(
      `update account_closure_steps
       set status = 'pending', next_attempt_at = $2, lease_token = null,
         lease_expires_at = null, completed_at = null, updated_at = $2
       where operation_id = $1
         and step_type in ('checkout_expiry', 'commerce_minimization')`,
      [operationId, now],
    );
    await transaction.query(
      `update account_closure_operations
       set status = 'pending', completed_at = null, updated_at = $2
       where id = $1`,
      [operationId, now],
    );
    return "closed" as const;
  });
}

async function markOrderCheckoutCreationFailed(
  input: { orderId: string; now?: Date },
  db: DatabaseQueryClient,
) {
  const now = input.now ?? (await readDatabaseNow(db));
  await db.query(
    `
      update trip_pass_orders
      set status = 'failed',
          updated_at = $2
      where id = $1
        and status = 'pending'
        and stripe_checkout_session_id is null
    `,
    [input.orderId, now],
  );
}

async function acquireFamilyReservationLock(
  input: { userId: string; productFamily: string },
  db: DatabaseQueryClient,
) {
  try {
    await db.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      input.userId,
      input.productFamily,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /pg_advisory|hashtext|function|syntax|unsupported/i.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}

async function readDatabaseNow(db: DatabaseQueryClient) {
  const result = await db.query<DatabaseNowRow>("select now() as database_now");
  const value = result.rows[0]?.database_now;
  return value instanceof Date ? value : new Date(String(value));
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

function orderSnapshotFromRow(
  order: TripPassOrderRow,
  input: { customerEmail: string | null; createdForRequest: boolean },
) {
  return {
    id: order.id,
    userId: order.user_id ?? "",
    productFamily: order.product_family,
    customerEmail: input.customerEmail,
    checkoutIdempotencyKey: order.checkout_idempotency_key,
    checkoutSessionExpiresAt: order.checkout_session_expires_at
      ? dateFromDatabaseValue(order.checkout_session_expires_at)
      : checkoutExpiryFromReservationTime(dateFromDatabaseValue(order.created_at)),
    stripePriceId: order.stripe_price_id ?? "",
    createdForRequest: input.createdForRequest,
  };
}

function checkoutAvailabilityForAccount(
  userId: string,
  checkout: ReturnType<typeof readTripPassEnvironment>["checkout"],
): Extract<TripPassCheckoutResult, { reason: string }> | null {
  if (checkout.mode === "off") {
    return { status: "disabled", reason: "trip_pass_checkout_disabled" };
  }
  if (checkout.status !== "available") {
    return {
      status: "unavailable",
      reason: checkout.unavailableReason ?? "trip_pass_checkout_unavailable",
    };
  }
  if (checkout.mode === "canary" && !checkout.canaryAccountIds.includes(userId)) {
    return { status: "disabled", reason: "trip_pass_checkout_canary_only" };
  }
  return null;
}

function defaultCreateId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function checkoutExpiryFromReservationTime(reservationTime: Date) {
  const reservationEpochSeconds = Math.floor(reservationTime.getTime() / 1_000);
  return new Date((reservationEpochSeconds + 30 * 60) * 1_000);
}

function dateFromDatabaseValue(value: Date | string) {
  return value instanceof Date ? value : new Date(String(value));
}

function legacyStripeCompatibilityAllowed(env?: Record<string, string | undefined>) {
  if (env?.LEGACY_STRIPE_TRIP_PASS_COMPAT === "true") return true;
  const runtimeEnvironment = env?.NODE_ENV ?? process.env.NODE_ENV;
  return runtimeEnvironment !== "production";
}
