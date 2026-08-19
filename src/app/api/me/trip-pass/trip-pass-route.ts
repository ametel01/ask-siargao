import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { trackServerEvent } from "@/server/observability/events";
import { receiveLemonSqueezyPaymentEvent } from "@/server/payments/payment-event-receipts";
import { isAllowedMutationOrigin } from "@/server/security/request-origin";
import {
  readLemonSqueezyEnvironment,
  tripPassProductCode,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";
import {
  cancelTripPassCheckout,
  startTripPassCheckout,
  type TripPassCheckoutResult,
} from "@/server/trip-pass/commerce";
import {
  createLemonSqueezyCheckoutClient,
  type LemonSqueezyCheckoutClient,
} from "@/server/trip-pass/lemon-squeezy-adapter";
import { applyLemonSqueezyPaymentFact } from "@/server/trip-pass/lemon-squeezy-webhook-application";
import { buildTripPassAccountPresentation } from "@/server/trip-pass/presentation";

export type TripPassAccountRouteDependencies = {
  auth?: EnsureCurrentUserDependencies["auth"];
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now: () => Date;
  cancelTripPassCheckout: typeof cancelTripPassCheckout;
  startTripPassCheckout: typeof startTripPassCheckout;
  trackServerEvent: typeof trackServerEvent;
  lemonCheckoutClient?: LemonSqueezyCheckoutClient;
};

function createDefaultTripPassAccountRouteDependencies(): TripPassAccountRouteDependencies {
  return {
    db: getDefaultDatabaseQueryClient(),
    env: process.env,
    now: () => new Date(),
    cancelTripPassCheckout,
    startTripPassCheckout,
    trackServerEvent,
  };
}

const privateNoStoreHeaders = {
  "cache-control": "private, no-store",
};

export async function getTripPassAccountResponse(
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
) {
  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser) {
    return Response.json(
      { error: "unauthenticated" },
      { status: 401, headers: privateNoStoreHeaders },
    );
  }

  try {
    const presentation = await buildTripPassAccountPresentation(
      { userId: currentUser.userId, now: dependencies.now() },
      { db: dependencies.db, env: dependencies.env },
    );
    return Response.json(presentation, { headers: privateNoStoreHeaders });
  } catch {
    return Response.json(
      { error: "trip_pass_status_unavailable" },
      { status: 503, headers: privateNoStoreHeaders },
    );
  }
}

export async function postTripPassCheckoutResponse(
  request: Request,
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
  headers?: HeadersInit,
) {
  const responseHeaders = { ...privateNoStoreHeaders, ...headers };
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: responseHeaders },
    );
  }

  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: responseHeaders });
  }

  try {
    const email = readLemonSqueezyEnvironment(dependencies.env).configured
      ? (
          await dependencies.db.query<{ email: string | null }>(
            "select email from users where id = $1 and deleted_at is null",
            [currentUser.userId],
          )
        ).rows[0]?.email
      : undefined;
    const result = await dependencies.startTripPassCheckout(
      {
        userId: currentUser.userId,
        email,
        appUrl: dependencies.env?.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
      },
      {
        db: dependencies.db,
        env: dependencies.env,
        now: dependencies.now(),
      },
    );
    dependencies.trackServerEvent({
      name: "trip_pass_checkout_started",
      now: dependencies.now(),
      payload: {
        checkoutAvailable: result.status === "started" || result.status === "reused",
        productCode: tripPassProductCode,
        productVersion: tripPassProductVersion,
        reason: checkoutTelemetryReason(result),
        status: result.status,
        surface: "settings",
      },
    });

    if (
      result.status === "blocked" ||
      result.status === "disabled" ||
      result.status === "unavailable"
    ) {
      dependencies.trackServerEvent({
        name: "trip_pass_checkout_failed",
        now: dependencies.now(),
        payload: {
          applicationStatus: result.status,
          reason: checkoutFailureTelemetryReason(result),
          status: "failed",
        },
      });
      return Response.json(sanitizedUnavailableCheckout(result), {
        status: 409,
        headers: responseHeaders,
      });
    }

    if (result.status === "started" || result.status === "reused") {
      return Response.json(
        {
          status: result.status,
          checkoutUrl: result.checkoutUrl,
        },
        { headers: responseHeaders },
      );
    }

    dependencies.trackServerEvent({
      name: "trip_pass_checkout_failed",
      now: dependencies.now(),
      payload: {
        applicationStatus: result.status,
        reason: "unexpected_checkout_result",
        status: "failed",
      },
    });
    return Response.json(
      { error: "trip_pass_checkout_unavailable" },
      { status: 409, headers: responseHeaders },
    );
  } catch {
    dependencies.trackServerEvent({
      name: "trip_pass_checkout_failed",
      now: dependencies.now(),
      payload: {
        applicationStatus: "thrown",
        reason: "checkout_exception",
        status: "failed",
      },
    });
    return Response.json(
      {
        error: "trip_pass_checkout_unavailable",
        message: "Trip Pass checkout could not be started.",
      },
      { status: 409, headers: responseHeaders },
    );
  }
}

export async function postTripPassCheckoutReturnResponse(
  request: Request,
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
  headers?: HeadersInit,
) {
  const responseHeaders = { ...privateNoStoreHeaders, ...headers };
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: responseHeaders },
    );
  }
  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser)
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: responseHeaders });
  const body = await request.json().catch(() => null);
  const orderId =
    typeof body === "object" &&
    body !== null &&
    "orderId" in body &&
    typeof body.orderId === "string"
      ? body.orderId.trim()
      : "";
  if (!orderId || orderId.length > 200) {
    return Response.json(
      { error: "invalid_checkout_return" },
      { status: 400, headers: responseHeaders },
    );
  }
  const order = await claimCheckoutReturnLookup(dependencies.db, {
    orderId,
    userId: currentUser.userId,
    now: dependencies.now(),
  });
  if (!order) {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
  if (order.lookupStatus === "not_found" || order.lookupStatus === "exhausted") {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
  if (order.lookupStatus === "succeeded" && order.providerOrderId) {
    return Response.json({ status: "applied" }, { headers: responseHeaders });
  }
  if (order.providerOrderId === null && !order.providerCheckoutId) {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
  try {
    const client = dependencies.lemonCheckoutClient ?? createLemonSqueezyCheckoutClient();
    let providerOrderId = order.providerOrderId;
    if (!providerOrderId) {
      if (!client.lookupOrderByCheckoutId || !order.providerCheckoutId) {
        return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
      }
      const lookedUp = await client.lookupOrderByCheckoutId({
        checkoutId: order.providerCheckoutId,
        storeId: order.providerStoreId,
        customerEmail: order.customerEmail,
      });
      if (!lookedUp) {
        await dependencies.db.query(
          `update trip_pass_orders set checkout_return_lookup_status = 'not_found',
            checkout_return_lookup_completed_at = $2, checkout_return_lookup_claimed_at = null,
            updated_at = $2 where id = $1 and user_id = $3 and provider_order_id is null`,
          [orderId, dependencies.now(), currentUser.userId],
        );
        return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
      }
      if (
        lookedUp.checkoutId !== order.providerCheckoutId ||
        lookedUp.storeId !== order.providerStoreId
      ) {
        await dependencies.db.query(
          `update trip_pass_orders set checkout_return_lookup_status = 'exhausted',
            checkout_return_lookup_completed_at = $2, checkout_return_lookup_claimed_at = null,
            updated_at = $2 where id = $1 and user_id = $3 and provider_order_id is null`,
          [orderId, dependencies.now(), currentUser.userId],
        );
        throw new Error("checkout_return_provider_correlation_failed");
      }
      providerOrderId = lookedUp.providerOrderId;
      await dependencies.db.query(
        `update trip_pass_orders set provider_order_id = $2,
          checkout_return_lookup_status = 'succeeded', checkout_return_lookup_completed_at = $3,
          checkout_return_lookup_claimed_at = null, updated_at = $3
         where id = $1 and user_id = $4 and provider_order_id is null`,
        [orderId, providerOrderId, dependencies.now(), currentUser.userId],
      );
    }
    const fact = await client.retrieveOrder(providerOrderId);
    const result = await receiveLemonSqueezyPaymentEvent(toLemonPaymentPayload(fact), {
      db: dependencies.db,
      now: dependencies.now(),
      applyFact: ({ fact: normalizedFact, db, now }) =>
        applyLemonSqueezyPaymentFact(normalizedFact, { db, now, env: dependencies.env }),
    });
    if (result.status === "applied" || result.status === "duplicate") {
      await dependencies.db.query(
        `update trip_pass_orders set checkout_return_lookup_status = 'succeeded',
        checkout_return_lookup_completed_at = coalesce(checkout_return_lookup_completed_at, $2),
        checkout_return_lookup_claimed_at = null, updated_at = $2
       where id = $1 and user_id = $3`,
        [orderId, dependencies.now(), currentUser.userId],
      );
    }
    return Response.json(
      { status: result.status === "applied" ? "applied" : result.status },
      { headers: responseHeaders },
    );
  } catch {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
}

async function claimCheckoutReturnLookup(
  db: DatabaseQueryClient,
  input: { orderId: string; userId: string; now: Date },
) {
  const run = async (transaction: DatabaseQueryClient) => {
    const result = await transaction.query<{
      provider_order_id: string | null;
      provider_checkout_id: string | null;
      provider_store_id: string | null;
      customer_email: string | null;
      checkout_return_lookup_attempts: number | string;
      checkout_return_lookup_claimed_at: Date | string | null;
      checkout_return_lookup_status: string;
    }>(
      `select o.provider_order_id, o.provider_checkout_id, o.provider_store_id,
          u.email as customer_email, o.checkout_return_lookup_attempts,
          o.checkout_return_lookup_claimed_at, o.checkout_return_lookup_status
       from trip_pass_orders o left join users u on u.id = o.user_id
       where o.id = $1 and o.user_id = $2 and o.payment_provider = 'lemon_squeezy' for update of o`,
      [input.orderId, input.userId],
    );
    const row = result.rows[0];
    if (!row || row.provider_order_id || row.checkout_return_lookup_status !== "pending") {
      return row
        ? {
            providerOrderId: row.provider_order_id,
            providerCheckoutId: row.provider_checkout_id,
            providerStoreId: row.provider_store_id,
            customerEmail: row.customer_email,
            lookupStatus: row.checkout_return_lookup_status,
          }
        : null;
    }
    const created = await transaction.query<{ created_at: Date | string }>(
      "select created_at from trip_pass_orders where id = $1",
      [input.orderId],
    );
    if (
      created.rows[0] &&
      input.now.getTime() < new Date(created.rows[0].created_at).getTime() + 10_000
    ) {
      return null;
    }
    if (Number(row.checkout_return_lookup_attempts) >= 1) return null;
    const claimedAt = row.checkout_return_lookup_claimed_at
      ? new Date(row.checkout_return_lookup_claimed_at).getTime()
      : 0;
    if (claimedAt > input.now.getTime() - 60_000) return null;
    const claimed = await transaction.query<{ provider_checkout_id: string | null }>(
      `update trip_pass_orders set checkout_return_lookup_attempts = checkout_return_lookup_attempts + 1,
        checkout_return_lookup_claimed_at = $3, updated_at = $3
       where id = $1 and user_id = $2 and provider_order_id is null
       returning provider_checkout_id`,
      [input.orderId, input.userId, input.now],
    );
    return {
      providerOrderId: null,
      providerCheckoutId: claimed.rows[0]?.provider_checkout_id ?? null,
      providerStoreId: row.provider_store_id,
      customerEmail: row.customer_email,
      lookupStatus: "pending",
    };
  };
  return db.transaction ? db.transaction(run) : run(db);
}

function toLemonPaymentPayload(
  fact: Awaited<ReturnType<LemonSqueezyCheckoutClient["retrieveOrder"]>>,
) {
  return {
    meta: { event_name: fact.eventName, custom_data: { order_id: fact.orderId } },
    data: {
      id: fact.providerOrderId,
      attributes: {
        status: fact.status,
        total: fact.amountTotalMinor,
        refunded_amount: fact.refundedAmountMinor,
        currency: fact.currency,
        store_id: fact.storeId,
        variant_id: fact.variantId,
        updated_at: fact.providerUpdatedAt,
        test_mode: fact.testMode,
        first_order_item:
          fact.productId || fact.variantId
            ? {
                product_id: fact.productId,
                variant_id: fact.variantId,
                quantity: fact.quantity,
                test_mode: fact.testMode,
              }
            : undefined,
        quantity: fact.quantity,
        discount_enabled: fact.discountEnabled,
        discount_total: fact.discountTotalMinor,
        ...(fact.customPriceMinor === undefined ? {} : { custom_price: fact.customPriceMinor }),
        ...(fact.licenseKey === undefined ? {} : { license_key: fact.licenseKey }),
      },
    },
  };
}

export async function deleteTripPassCheckoutResponse(
  request: Request,
  dependencies: TripPassAccountRouteDependencies = createDefaultTripPassAccountRouteDependencies(),
  headers?: HeadersInit,
) {
  const responseHeaders = { ...privateNoStoreHeaders, ...headers };
  if (!isAllowedMutationOrigin(request)) {
    return Response.json(
      { error: "invalid_request_origin" },
      { status: 403, headers: responseHeaders },
    );
  }

  const currentUser = await ensureTripPassUser(dependencies);
  if (!currentUser) {
    return Response.json({ error: "unauthenticated" }, { status: 401, headers: responseHeaders });
  }

  try {
    const result = await dependencies.cancelTripPassCheckout(
      { userId: currentUser.userId },
      {
        db: dependencies.db,
        env: dependencies.env,
        now: dependencies.now(),
      },
    );
    dependencies.trackServerEvent({
      name: "trip_pass_checkout_cancelled",
      now: dependencies.now(),
      payload: {
        status: result.status,
        surface: "settings",
      },
    });

    if (result.status === "cancelled" || result.status === "already_terminal") {
      return Response.json({ status: result.status }, { headers: responseHeaders });
    }
    if (result.status === "not_found") {
      return Response.json(
        { error: "trip_pass_checkout_not_found" },
        { status: 404, headers: responseHeaders },
      );
    }
    return Response.json(
      { error: "trip_pass_checkout_cancellation_unavailable" },
      { status: 409, headers: responseHeaders },
    );
  } catch {
    dependencies.trackServerEvent({
      name: "trip_pass_checkout_cancel_failed",
      now: dependencies.now(),
      payload: {
        reason: "checkout_cancel_exception",
        status: "failed",
      },
    });
    return Response.json(
      { error: "trip_pass_checkout_cancellation_unavailable" },
      { status: 409, headers: responseHeaders },
    );
  }
}

async function ensureTripPassUser(dependencies: TripPassAccountRouteDependencies) {
  if (!dependencies.auth && !isClerkServerConfigured) {
    return null;
  }

  return ensureCurrentUser({
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    db: dependencies.db,
    now: dependencies.now,
  });
}

function sanitizedUnavailableCheckout(result: Extract<TripPassCheckoutResult, { reason: string }>) {
  return {
    error: "trip_pass_checkout_unavailable",
    status: result.status,
    reason: checkoutFailureTelemetryReason(result),
  };
}

function checkoutTelemetryReason(result: TripPassCheckoutResult) {
  if (result.status === "disabled") {
    return "checkout_disabled";
  }
  if (result.status === "unavailable") {
    return "checkout_unavailable";
  }
  return undefined;
}

function checkoutFailureTelemetryReason(
  result: Extract<TripPassCheckoutResult, { reason: string }>,
) {
  if (result.status === "blocked") {
    return "checkout_blocked";
  }
  if (result.status === "disabled") {
    return "checkout_disabled";
  }
  return "checkout_unavailable";
}
