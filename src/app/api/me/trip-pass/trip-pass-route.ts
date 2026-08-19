import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { type EnsureCurrentUserDependencies, ensureCurrentUser } from "@/server/auth/clerk-users";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { trackServerEvent } from "@/server/observability/events";
import {
  applyPendingLemonSqueezyPaymentEvent,
  receiveLemonSqueezyPaymentFact,
} from "@/server/payments/payment-event-receipts";
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
  retrieveLemonSqueezyOrder?: LemonSqueezyCheckoutClient["retrieveOrder"];
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
  const providerOrderId = readCheckoutReturnField(body, "providerOrderId");
  const providerOrderIdentifier = readCheckoutReturnField(body, "providerOrderIdentifier");
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
  if (order.paymentApplied) {
    return Response.json({ status: "applied" }, { headers: responseHeaders });
  }
  if (!order.claimed) {
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
  try {
    const receipt = await dependencies.db.query<{ id: string }>(
      `select id from trip_pass_payment_event_receipts
       where provider = 'lemon_squeezy' and event_name = 'order_created' and order_id = $1
       order by created_at desc, id desc limit 1`,
      [orderId],
    );
    const receiptId = receipt.rows[0]?.id;
    const result = receiptId
      ? await applyPendingLemonSqueezyPaymentEvent(receiptId, {
          db: dependencies.db,
          now: dependencies.now(),
          applyFact: ({ fact: normalizedFact, db, now }) =>
            applyLemonSqueezyPaymentFact(normalizedFact, { db, now, env: dependencies.env }),
        })
      : await recoverCheckoutReturnFromProvider({
          dependencies,
          orderId,
          providerOrderId,
          providerOrderIdentifier,
        });
    const applied = await checkoutReturnPaymentApplied(
      dependencies.db,
      orderId,
      currentUser.userId,
    );
    await completeCheckoutReturnLookup(dependencies.db, {
      orderId,
      userId: currentUser.userId,
      status: applied ? "succeeded" : result?.status === "blocked" ? "exhausted" : "not_found",
      now: dependencies.now(),
    });
    return applied
      ? Response.json({ status: "applied" }, { headers: responseHeaders })
      : Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  } catch {
    await completeCheckoutReturnLookup(dependencies.db, {
      orderId,
      userId: currentUser.userId,
      status: "exhausted",
      now: dependencies.now(),
    }).catch(() => undefined);
    return Response.json({ status: "pending" }, { status: 202, headers: responseHeaders });
  }
}

async function recoverCheckoutReturnFromProvider(input: {
  dependencies: TripPassAccountRouteDependencies;
  orderId: string;
  providerOrderId: string;
  providerOrderIdentifier: string;
}) {
  if (
    !/^\d{1,32}$/.test(input.providerOrderId) ||
    !isProviderOrderIdentifier(input.providerOrderIdentifier)
  ) {
    return null;
  }
  const retrieveOrder =
    input.dependencies.retrieveLemonSqueezyOrder ??
    createLemonSqueezyCheckoutClient().retrieveOrder;
  const providerFact = await retrieveOrder(input.providerOrderId);
  if (
    providerFact.providerOrderId !== input.providerOrderId ||
    providerFact.paymentId !== input.providerOrderIdentifier
  ) {
    return null;
  }
  return receiveLemonSqueezyPaymentFact(
    { ...providerFact, orderId: input.orderId },
    {
      db: input.dependencies.db,
      now: input.dependencies.now(),
      applyFact: ({ fact, db, now }) =>
        applyLemonSqueezyPaymentFact(fact, { db, env: input.dependencies.env, now }),
    },
  );
}

function readCheckoutReturnField(body: unknown, key: string) {
  if (typeof body !== "object" || body === null || !(key in body)) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function isProviderOrderIdentifier(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

async function claimCheckoutReturnLookup(
  db: DatabaseQueryClient,
  input: { orderId: string; userId: string; now: Date },
) {
  const run = async (transaction: DatabaseQueryClient) => {
    const result = await transaction.query<{
      accepted_payment_fact_id: string | null;
      created_at: Date | string;
      checkout_return_lookup_attempts: number | string;
      checkout_return_lookup_claimed_at: Date | string | null;
      checkout_return_lookup_status: string;
    }>(
      `select accepted_payment_fact_id, created_at, checkout_return_lookup_attempts,
          checkout_return_lookup_claimed_at, checkout_return_lookup_status
       from trip_pass_orders
       where id = $1 and user_id = $2 and payment_provider = 'lemon_squeezy' for update`,
      [input.orderId, input.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const paymentApplied = Boolean(row.accepted_payment_fact_id);
    if (paymentApplied) return { paymentApplied: true, claimed: false };
    if (input.now.getTime() < new Date(row.created_at).getTime() + 10_000) {
      return null;
    }
    if (Number(row.checkout_return_lookup_attempts) >= 1) {
      return { paymentApplied: false, claimed: false };
    }
    const claimedAt = row.checkout_return_lookup_claimed_at
      ? new Date(row.checkout_return_lookup_claimed_at).getTime()
      : 0;
    if (claimedAt > input.now.getTime() - 60_000) {
      return { paymentApplied: false, claimed: false };
    }
    const claimed = await transaction.query<{ id: string }>(
      `update trip_pass_orders set checkout_return_lookup_attempts = checkout_return_lookup_attempts + 1,
        checkout_return_lookup_claimed_at = $3, updated_at = $3
       where id = $1 and user_id = $2
       returning id`,
      [input.orderId, input.userId, input.now],
    );
    return { paymentApplied: false, claimed: Boolean(claimed.rows[0]) };
  };
  return db.transaction ? db.transaction(run) : run(db);
}

async function checkoutReturnPaymentApplied(
  db: DatabaseQueryClient,
  orderId: string,
  userId: string,
) {
  const result = await db.query<{ accepted_payment_fact_id: string | null }>(
    "select accepted_payment_fact_id from trip_pass_orders where id = $1 and user_id = $2",
    [orderId, userId],
  );
  const row = result.rows[0];
  return Boolean(row?.accepted_payment_fact_id);
}

async function completeCheckoutReturnLookup(
  db: DatabaseQueryClient,
  input: {
    orderId: string;
    userId: string;
    status: "succeeded" | "not_found" | "exhausted";
    now: Date;
  },
) {
  await db.query(
    `update trip_pass_orders set checkout_return_lookup_status = $3,
      checkout_return_lookup_completed_at = $4, checkout_return_lookup_claimed_at = null,
      updated_at = $4 where id = $1 and user_id = $2`,
    [input.orderId, input.userId, input.status, input.now],
  );
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
