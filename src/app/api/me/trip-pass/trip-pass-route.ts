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
  const order = await dependencies.db.query<{
    id: string;
    provider_order_id: string | null;
    payment_provider: string;
  }>(
    `select id, provider_order_id, payment_provider from trip_pass_orders
     where id = $1 and user_id = $2 limit 1`,
    [orderId, currentUser.userId],
  );
  if (!order.rows[0])
    return Response.json(
      { error: "checkout_return_not_found" },
      { status: 404, headers: responseHeaders },
    );
  if (order.rows[0].payment_provider !== "lemon_squeezy" || !order.rows[0].provider_order_id) {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
  try {
    const client = dependencies.lemonCheckoutClient ?? createLemonSqueezyCheckoutClient();
    const fact = await client.retrieveOrder(order.rows[0].provider_order_id);
    const result = await receiveLemonSqueezyPaymentEvent(toLemonPaymentPayload(fact), {
      db: dependencies.db,
      now: dependencies.now(),
      applyFact: ({ fact: normalizedFact, db, now }) =>
        applyLemonSqueezyPaymentFact(normalizedFact, { db, now, env: dependencies.env }),
    });
    return Response.json(
      { status: result.status === "applied" ? "applied" : result.status },
      { headers: responseHeaders },
    );
  } catch {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
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
        first_order_item: fact.productId ? { product_id: fact.productId } : undefined,
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
