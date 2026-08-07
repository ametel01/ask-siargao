import type Stripe from "stripe";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  getTripPassProductContract,
  readTripPassEnvironment,
  tripPassProductCode,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";
import { grantTripPass } from "@/server/trip-pass/entitlement";

export type TripPassStripeApplicationResult =
  | { status: "ignored"; reason: "not_trip_pass_event" | "not_relevant_event" }
  | { status: "noop"; reason: string; orderId?: string; stripeEventId: string }
  | { status: "duplicate"; orderId: string; stripeEventId: string }
  | {
      status: "applied";
      action: "activated" | "failed" | "expired" | "refunded" | "disputed";
      orderId: string;
      stripeEventId: string;
    }
  | { status: "rejected"; reason: string; orderId?: string; stripeEventId: string };

type TripPassOrderRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  status: string;
  product_code: string;
  product_version: number;
  stripe_price_id: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

export async function applyTripPassStripeEvent(
  event: Stripe.Event,
  options: {
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
): Promise<TripPassStripeApplicationResult> {
  const now = options.now ?? new Date();

  if (isCheckoutSessionEvent(event)) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!isTripPassCheckoutSession(session)) {
      return { status: "ignored", reason: "not_trip_pass_event" };
    }

    const db = options.db ?? getDefaultDatabaseQueryClient();
    return applyCheckoutSessionEvent(event, db, options.env, now);
  }
  if (isRefundEvent(event)) {
    const db = options.db ?? getDefaultDatabaseQueryClient();
    return applyPaymentIntentLifecycleEvent({
      event,
      paymentIntentId: paymentIntentIdFromRefund(event.data.object as Stripe.Refund),
      action: "refunded",
      orderStatus: "refunded",
      passStatus: "refunded",
      db,
      now,
    });
  }
  if (isDisputeEvent(event)) {
    const db = options.db ?? getDefaultDatabaseQueryClient();
    return applyPaymentIntentLifecycleEvent({
      event,
      paymentIntentId: paymentIntentIdFromDispute(event.data.object as Stripe.Dispute),
      action: "disputed",
      orderStatus: "disputed",
      passStatus: "cancelled",
      db,
      now,
    });
  }

  return { status: "ignored", reason: "not_relevant_event" };
}

async function applyCheckoutSessionEvent(
  event: Stripe.Event,
  db: DatabaseQueryClient,
  env: Record<string, string | undefined> | undefined,
  now: Date,
): Promise<TripPassStripeApplicationResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  const metadataVersion = Number(session.metadata?.productVersion);
  if (!getTripPassProductContract(session.metadata?.productCode ?? "", metadataVersion)) {
    return { status: "ignored", reason: "not_trip_pass_event" };
  }

  const orderId = session.metadata?.tripPassOrderId ?? session.client_reference_id ?? undefined;
  if (!orderId) {
    return { status: "rejected", reason: "missing_trip_pass_order_id", stripeEventId: event.id };
  }

  const order = await loadOrderById(orderId, db);
  const orderValidation = validateCheckoutSessionOrder({ event, session, order, env });
  if (orderValidation) {
    return orderValidation;
  }
  if (!order) {
    return {
      status: "rejected",
      reason: "trip_pass_order_not_found",
      orderId,
      stripeEventId: event.id,
    };
  }

  if (event.type === "checkout.session.expired") {
    if (order.status === "expired") {
      return { status: "duplicate", orderId: order.id, stripeEventId: event.id };
    }
    await updateOrderStatus({ orderId: order.id, status: "expired", now }, db);
    return { status: "applied", action: "expired", orderId: order.id, stripeEventId: event.id };
  }

  if (event.type === "checkout.session.async_payment_failed") {
    if (order.status === "failed") {
      return { status: "duplicate", orderId: order.id, stripeEventId: event.id };
    }
    await updateOrderStatus({ orderId: order.id, status: "failed", now }, db);
    return { status: "applied", action: "failed", orderId: order.id, stripeEventId: event.id };
  }

  if (!isPaidCheckoutSession(session)) {
    return {
      status: "noop",
      reason: "checkout_session_not_paid",
      orderId,
      stripeEventId: event.id,
    };
  }
  if (order.status === "paid") {
    return { status: "duplicate", orderId: order.id, stripeEventId: event.id };
  }
  if (order.status !== "checkout_created" && order.status !== "pending") {
    return {
      status: "rejected",
      reason: "trip_pass_order_not_payable",
      orderId: order.id,
      stripeEventId: event.id,
    };
  }
  if (!order.user_id) {
    return {
      status: "rejected",
      reason: "trip_pass_order_missing_owner",
      orderId: order.id,
      stripeEventId: event.id,
    };
  }

  const paymentIntentId = paymentIntentIdFromCheckoutSession(session);
  await rememberOrderPaymentIntent(
    { orderId: order.id, sessionId: session.id, paymentIntentId, now },
    db,
  );
  const grant = await grantTripPass(
    {
      userId: order.user_id,
      email: order.email,
      orderId: order.id,
      sourceType: "stripe_checkout",
      sourceEventId: event.id,
      now,
    },
    db,
  );
  await markOrderPaid(
    {
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId,
      now,
    },
    db,
  );

  if (grant.status === "duplicate") {
    return { status: "duplicate", orderId: order.id, stripeEventId: event.id };
  }

  return {
    status: "applied",
    action: "activated",
    orderId: order.id,
    stripeEventId: event.id,
  };
}

async function applyPaymentIntentLifecycleEvent(input: {
  event: Stripe.Event;
  paymentIntentId: string | null;
  action: "refunded" | "disputed";
  orderStatus: "refunded" | "disputed";
  passStatus: "refunded" | "cancelled";
  db: DatabaseQueryClient;
  now: Date;
}): Promise<TripPassStripeApplicationResult> {
  if (!input.paymentIntentId) {
    return {
      status: "ignored",
      reason: "not_trip_pass_event",
    };
  }

  const order = await loadOrderByPaymentIntent(input.paymentIntentId, input.db);
  if (!order) {
    return { status: "ignored", reason: "not_trip_pass_event" };
  }
  if (order.status === input.orderStatus) {
    return { status: "duplicate", orderId: order.id, stripeEventId: input.event.id };
  }

  await input.db.query(
    `
      update trip_pass_orders
      set status = $2,
          updated_at = $3
      where id = $1
    `,
    [order.id, input.orderStatus, input.now],
  );
  await input.db.query(
    `
      update trip_passes
      set status = $2,
          updated_at = $3
      where stripe_payment_intent_id = $1
    `,
    [input.paymentIntentId, input.passStatus, input.now],
  );

  return {
    status: "applied",
    action: input.action,
    orderId: order.id,
    stripeEventId: input.event.id,
  };
}

async function rememberOrderPaymentIntent(
  input: { orderId: string; sessionId: string; paymentIntentId: string | null; now: Date },
  db: DatabaseQueryClient,
) {
  await db.query(
    `
      update trip_pass_orders
      set stripe_checkout_session_id = $2,
          stripe_payment_intent_id = $3,
          updated_at = $4
      where id = $1
        and status in ('pending', 'checkout_created')
    `,
    [input.orderId, input.sessionId, input.paymentIntentId, input.now],
  );
}

function validateCheckoutSessionOrder(input: {
  event: Stripe.Event;
  session: Stripe.Checkout.Session;
  order: TripPassOrderRow | null;
  env: Record<string, string | undefined> | undefined;
}): TripPassStripeApplicationResult | null {
  const orderId =
    input.session.metadata?.tripPassOrderId ?? input.session.client_reference_id ?? undefined;
  if (!input.order) {
    return {
      status: "rejected",
      reason: "trip_pass_order_not_found",
      orderId,
      stripeEventId: input.event.id,
    };
  }
  if (input.session.mode !== "payment") {
    return {
      status: "rejected",
      reason: "trip_pass_checkout_mode_mismatch",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  if (input.session.id !== input.order.stripe_checkout_session_id) {
    return {
      status: "rejected",
      reason: "trip_pass_checkout_session_mismatch",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  if (input.session.client_reference_id !== input.order.id) {
    return {
      status: "rejected",
      reason: "trip_pass_client_reference_mismatch",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  if (
    input.session.metadata?.productCode !== input.order.product_code ||
    input.session.metadata?.productVersion !== String(input.order.product_version)
  ) {
    return {
      status: "rejected",
      reason: "trip_pass_product_version_mismatch",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }

  const environment = readTripPassEnvironment(input.env);
  if (
    input.order.product_code === tripPassProductCode &&
    input.order.product_version === tripPassProductVersion &&
    environment.checkout.priceId &&
    environment.checkout.priceId !== input.order.stripe_price_id
  ) {
    return {
      status: "rejected",
      reason: "trip_pass_price_mismatch",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }

  return null;
}

async function loadOrderById(orderId: string, db: DatabaseQueryClient) {
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

async function loadOrderByPaymentIntent(paymentIntentId: string, db: DatabaseQueryClient) {
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
        stripe_checkout_session_id,
        stripe_payment_intent_id
      from trip_pass_orders
      where stripe_payment_intent_id = $1
      limit 1
    `,
    [paymentIntentId],
  );

  return result.rows[0] ?? null;
}

async function updateOrderStatus(
  input: { orderId: string; status: "expired" | "failed"; now: Date },
  db: DatabaseQueryClient,
) {
  await db.query(
    `
      update trip_pass_orders
      set status = $2,
          updated_at = $3
      where id = $1
    `,
    [input.orderId, input.status, input.now],
  );
}

async function markOrderPaid(
  input: { orderId: string; sessionId: string; paymentIntentId: string | null; now: Date },
  db: DatabaseQueryClient,
) {
  await db.query(
    `
      update trip_pass_orders
      set status = 'paid',
          stripe_checkout_session_id = $2,
          stripe_payment_intent_id = $3,
          completed_at = $4,
          updated_at = $4
      where id = $1
    `,
    [input.orderId, input.sessionId, input.paymentIntentId, input.now],
  );
}

function isCheckoutSessionEvent(event: Stripe.Event) {
  return (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  );
}

function isTripPassCheckoutSession(session: Stripe.Checkout.Session) {
  const metadataVersion = Number(session.metadata?.productVersion);
  return Boolean(getTripPassProductContract(session.metadata?.productCode ?? "", metadataVersion));
}

function isRefundEvent(event: Stripe.Event) {
  return event.type === "charge.refunded" || event.type === "refund.created";
}

function isDisputeEvent(event: Stripe.Event) {
  return event.type === "charge.dispute.created" || event.type === "charge.dispute.closed";
}

function isPaidCheckoutSession(session: Stripe.Checkout.Session) {
  return session.payment_status === "paid";
}

function paymentIntentIdFromCheckoutSession(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);
}

function paymentIntentIdFromRefund(refund: Stripe.Refund) {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : (refund.payment_intent?.id ?? null);
}

function paymentIntentIdFromDispute(dispute: Stripe.Dispute) {
  return typeof dispute.payment_intent === "string"
    ? dispute.payment_intent
    : (dispute.payment_intent?.id ?? null);
}
