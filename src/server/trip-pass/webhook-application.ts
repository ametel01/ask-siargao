import type Stripe from "stripe";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  createStripeLifecycleObjectRetriever,
  type StripeLifecycleObjectRetriever,
} from "@/server/payments/stripe";
import {
  getTripPassProductContract,
  readTripPassEnvironment,
  tripPassProductCode,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";
import { grantTripPass } from "@/server/trip-pass/entitlement";
import {
  type AuthoritativeDisputeFact,
  type AuthoritativeRefundFact,
  applyAuthoritativeDisputeFact,
  applyAuthoritativeRefundFact,
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
  type RefundProviderStatus,
} from "@/server/trip-pass/payment-lifecycle";

export type PreparedTripPassStripeEvent =
  | { event: Stripe.Event; kind: "direct" }
  | { event: Stripe.Event; fact: AuthoritativeRefundFact | null; kind: "refund" }
  | { event: Stripe.Event; fact: AuthoritativeDisputeFact | null; kind: "dispute" };

export type TripPassStripeApplicationResult =
  | { status: "ignored"; reason: "not_trip_pass_event" | "not_relevant_event" }
  | { status: "noop"; reason: string; orderId?: string; stripeEventId: string }
  | { status: "duplicate"; orderId: string; stripeEventId: string }
  | {
      status: "applied";
      action:
        | "activated"
        | "failed"
        | "expired"
        | "refund_review"
        | "refunded"
        | "dispute_suspended"
        | "dispute_won"
        | "disputed"
        | "paid_after_closure";
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
  product_family: string;
  product_version: number;
  stripe_price_id: string;
  amount_total_minor: number | null;
  currency: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  closure_tombstone_id: string | null;
  closure_outcome: string | null;
};

export async function applyTripPassStripeEvent(
  event: Stripe.Event,
  options: {
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
    now?: Date;
    preparedEvent?: PreparedTripPassStripeEvent;
    stripeObjects?: StripeLifecycleObjectRetriever;
  } = {},
): Promise<TripPassStripeApplicationResult> {
  const prepared =
    options.preparedEvent ?? (await prepareTripPassStripeEvent(event, options.stripeObjects));
  return applyPreparedTripPassStripeEvent(prepared, options);
}

export async function prepareTripPassStripeEvent(
  event: Stripe.Event,
  retriever?: StripeLifecycleObjectRetriever,
): Promise<PreparedTripPassStripeEvent> {
  if (isRefundEvent(event)) {
    return {
      event,
      fact: await retrieveAuthoritativeRefundFact(
        event,
        retriever ?? createStripeLifecycleObjectRetriever(),
      ),
      kind: "refund",
    };
  }
  if (isDisputeEvent(event)) {
    return {
      event,
      fact: await retrieveAuthoritativeDisputeFact(
        event,
        retriever ?? createStripeLifecycleObjectRetriever(),
      ),
      kind: "dispute",
    };
  }
  return { event, kind: "direct" };
}

async function applyPreparedTripPassStripeEvent(
  prepared: PreparedTripPassStripeEvent,
  options: {
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
    now?: Date;
  },
): Promise<TripPassStripeApplicationResult> {
  const { event } = prepared;
  const now = options.now ?? new Date();

  if (isCheckoutSessionEvent(event)) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!isTripPassCheckoutSession(session)) {
      return { status: "ignored", reason: "not_trip_pass_event" };
    }

    const db = options.db ?? getDefaultDatabaseQueryClient();
    return withApplicationTransaction(db, (transaction) =>
      applyCheckoutSessionEvent(event, transaction, options.env, now),
    );
  }
  if (isRefundEvent(event)) {
    const fact = prepared.kind === "refund" ? prepared.fact : null;
    if (!fact) {
      return {
        status: "rejected",
        reason: "trip_pass_payment_intent_not_found",
        stripeEventId: event.id,
      };
    }
    const result = await applyAuthoritativeRefundFact(
      fact,
      options.db ?? getDefaultDatabaseQueryClient(),
    );
    return result.status === "applied"
      ? {
          status: result.status,
          action: result.action,
          orderId: result.orderId,
          stripeEventId: event.id,
        }
      : { ...result, stripeEventId: event.id };
  }
  if (isDisputeEvent(event)) {
    const fact = prepared.kind === "dispute" ? prepared.fact : null;
    if (!fact) {
      return {
        status: "rejected",
        reason: "trip_pass_payment_intent_not_found",
        stripeEventId: event.id,
      };
    }
    const result = await applyAuthoritativeDisputeFact(
      fact,
      options.db ?? getDefaultDatabaseQueryClient(),
    );
    return result.status === "applied"
      ? {
          status: result.status,
          action: result.action,
          orderId: result.orderId,
          stripeEventId: event.id,
        }
      : { ...result, stripeEventId: event.id };
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

  const candidate = await loadOrderOwnerCandidate(orderId, db);
  if (candidate?.user_id) {
    await lockTripPassAccountFamily(candidate.user_id, candidate.product_family, db);
    await lockTripPassAccountWrites(candidate.user_id, db);
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
  if (order.closure_tombstone_id) {
    return applyClosedAccountPayment({ db, event, now, order, session });
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
  if (!paymentIntentId) {
    return {
      status: "rejected",
      reason: "trip_pass_payment_intent_not_found",
      orderId: order.id,
      stripeEventId: event.id,
    };
  }
  const activationTime = await readTransactionTime(db);
  await rememberOrderPaymentIntent(
    { orderId: order.id, sessionId: session.id, paymentIntentId, now: activationTime },
    db,
  );
  const grant = await grantTripPass(
    {
      userId: order.user_id,
      orderId: order.id,
      sourceType: "stripe_checkout",
      sourceEventId: event.id,
      now: activationTime,
    },
    db,
  );
  await markOrderPaid(
    {
      orderId: order.id,
      sessionId: session.id,
      paymentIntentId,
      capturedAmountMinor: session.amount_total ?? 0,
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

async function applyClosedAccountPayment(input: {
  db: DatabaseQueryClient;
  event: Stripe.Event;
  now: Date;
  order: TripPassOrderRow;
  session: Stripe.Checkout.Session;
}): Promise<TripPassStripeApplicationResult> {
  if (input.order.closure_outcome === "paid_after_closure") {
    return {
      status: "duplicate",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  if (!Number.isFinite(input.event.created)) {
    return {
      status: "rejected",
      reason: "missing_authoritative_completion_time",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  const tombstone = await input.db.query<{
    closed_at: Date | string;
    commerce_policy_version: string | null;
  }>(
    `
      select t.closed_at, o.commerce_policy_version
      from account_closure_tombstones t
      join account_closure_operations o on o.tombstone_id = t.id
      where t.id = $1
      order by o.created_at asc
      limit 1
    `,
    [input.order.closure_tombstone_id],
  );
  const closure = tombstone.rows[0];
  if (!closure) {
    return {
      status: "rejected",
      reason: "closure_state_missing",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  const completedAt = new Date(input.event.created * 1_000);
  const closedAt = new Date(closure.closed_at);
  // Stripe signs event.created at whole-second precision while PostgreSQL records
  // closure with sub-second precision. The ambiguous closure second is treated
  // conservatively as Paid After Closure: no access is granted and refund work
  // is durable. Only an event from an earlier whole second is pre-closure.
  const closureSecond = Math.floor(closedAt.getTime() / 1_000) * 1_000;
  const isPaidAfterClosure = completedAt.getTime() >= closureSecond;
  const paymentIntentId = paymentIntentIdFromCheckoutSession(input.session);
  if (!paymentIntentId || !input.session.amount_total) {
    return {
      status: "rejected",
      reason: "trip_pass_payment_intent_not_found",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }
  if (!isPaidAfterClosure) {
    await input.db.query(
      `update trip_pass_orders set status = 'paid', user_id = null, email = null,
        stripe_customer_id = null, metadata_json = '{}'::jsonb,
        stripe_checkout_session_id = $2, stripe_payment_intent_id = $3,
        completed_at = $4, updated_at = $5
       where id = $1`,
      [input.order.id, input.session.id, paymentIntentId, completedAt, input.now],
    );
    return {
      status: "noop",
      reason: "activation_blocked_by_account_closure",
      orderId: input.order.id,
      stripeEventId: input.event.id,
    };
  }

  const obligationId = `closure_refund_${input.order.id}`;
  await withDatabaseTransaction(input.db, async (transaction) => {
    await transaction.query(
      `
        insert into account_closure_refund_obligations (
          id, tombstone_id, order_id, stripe_event_id, reason, status,
          attempts, policy_version, stripe_payment_intent_id, expected_amount_minor,
          created_at, updated_at
        ) values ($1, $2, $3, $4, 'paid_after_closure', 'pending', 0, $5, $6, $7, $8, $8)
        on conflict (order_id) do update set
          stripe_event_id = coalesce(account_closure_refund_obligations.stripe_event_id,
            excluded.stripe_event_id),
          stripe_payment_intent_id = coalesce(
            account_closure_refund_obligations.stripe_payment_intent_id,
            excluded.stripe_payment_intent_id),
          expected_amount_minor = coalesce(
            account_closure_refund_obligations.expected_amount_minor,
            excluded.expected_amount_minor),
          updated_at = excluded.updated_at
      `,
      [
        obligationId,
        input.order.closure_tombstone_id,
        input.order.id,
        input.event.id,
        closure.commerce_policy_version ?? "closure-commerce-policy-unset",
        paymentIntentId,
        input.session.amount_total,
        input.now,
      ],
    );
    await transaction.query(
      `
        update trip_pass_orders
        set status = 'paid', user_id = null, email = null, stripe_customer_id = null,
          metadata_json = '{}'::jsonb, stripe_checkout_session_id = $2,
          stripe_payment_intent_id = $3, closure_outcome = 'paid_after_closure',
          closure_refund_obligation_id = $4, completed_at = $5, updated_at = $6
        where id = $1
      `,
      [input.order.id, input.session.id, paymentIntentId, obligationId, completedAt, input.now],
    );
    const closureOperation = await transaction.query<{ id: string }>(
      `select id from account_closure_operations
       where tombstone_id = $1 order by created_at asc limit 1 for update`,
      [input.order.closure_tombstone_id],
    );
    const operationId = closureOperation.rows[0]?.id;
    if (operationId) {
      await transaction.query(
        `update account_closure_steps
         set status = 'pending', next_attempt_at = $2, lease_token = null,
           lease_expires_at = null, completed_at = null, updated_at = $2
         where operation_id = $1 and step_type = 'commerce_minimization'`,
        [operationId, input.now],
      );
      await transaction.query(
        `update account_closure_operations
         set status = 'pending', completed_at = null, updated_at = $2
         where id = $1`,
        [operationId, input.now],
      );
    }
  });
  return {
    status: "applied",
    action: "paid_after_closure",
    orderId: input.order.id,
    stripeEventId: input.event.id,
  };
}

async function withApplicationTransaction<T>(
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
    const result = await callback({ ...db, inTransaction: true });
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
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
  if (
    isPaidCheckoutSession(input.session) &&
    (input.session.amount_total !== input.order.amount_total_minor ||
      input.session.currency !== input.order.currency)
  ) {
    return {
      status: "rejected",
      reason: "trip_pass_payment_fact_mismatch",
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
        product_family,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        closure_tombstone_id,
        closure_outcome
      from trip_pass_orders
      where id = $1
      limit 1
      for update
    `,
    [orderId],
  );

  return result.rows[0] ?? null;
}

async function loadOrderOwnerCandidate(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ user_id: string | null; product_family: string }>(
    "select user_id, product_family from trip_pass_orders where id = $1 limit 1",
    [orderId],
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
  input: {
    orderId: string;
    sessionId: string;
    paymentIntentId: string;
    capturedAmountMinor: number;
  },
  db: DatabaseQueryClient,
) {
  await db.query(
    `
      update trip_pass_orders
      set status = 'paid',
          stripe_checkout_session_id = $2,
          stripe_payment_intent_id = $3,
          captured_amount_minor = $4,
          completed_at = transaction_timestamp(),
          updated_at = transaction_timestamp()
      where id = $1
    `,
    [input.orderId, input.sessionId, input.paymentIntentId, input.capturedAmountMinor],
  );
}

async function withDatabaseTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction) return callback(db);
  if (db.transaction) return db.transaction(callback);
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
  return (
    event.type === "charge.refunded" ||
    event.type === "refund.created" ||
    event.type === "refund.updated" ||
    event.type === "refund.failed"
  );
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

function paymentIntentIdFromDispute(dispute: Stripe.Dispute) {
  return typeof dispute.payment_intent === "string"
    ? dispute.payment_intent
    : (dispute.payment_intent?.id ?? null);
}

async function retrieveAuthoritativeRefundFact(
  event: Stripe.Event,
  retriever: StripeLifecycleObjectRetriever,
) {
  const object = event.data.object as Stripe.Charge | Stripe.Refund;
  if (
    event.type === "refund.created" ||
    event.type === "refund.updated" ||
    event.type === "refund.failed"
  ) {
    const refund = await retriever.retrieveRefund(object.id);
    const chargeId = stripeObjectId(refund.charge);
    if (!chargeId) return null;
    const charge = await retriever.retrieveCharge(chargeId);
    const paymentIntentId = paymentIntentIdFromCharge(charge);
    if (!paymentIntentId) return null;
    return {
      stripeRefundId: refund.id,
      stripeChargeId: charge.id,
      stripeEventId: event.id,
      paymentIntentId,
      providerStatus: normalizeRefundStatus(refund.status),
      amountMinor: refund.amount,
      successfulAmountMinor: charge.amount_refunded,
      providerCreatedAt: stripeCreatedAt(refund.created),
    };
  }

  const charge = await retriever.retrieveCharge(object.id);
  const paymentIntentId = paymentIntentIdFromCharge(charge);
  if (!paymentIntentId) return null;
  return {
    stripeRefundId: `charge_aggregate_${charge.id}`,
    stripeChargeId: charge.id,
    stripeEventId: event.id,
    paymentIntentId,
    providerStatus: "succeeded" as const,
    amountMinor: charge.amount_refunded,
    successfulAmountMinor: charge.amount_refunded,
    providerCreatedAt: stripeCreatedAt(charge.created),
  };
}

async function retrieveAuthoritativeDisputeFact(
  event: Stripe.Event,
  retriever: StripeLifecycleObjectRetriever,
) {
  const dispute = await retriever.retrieveDispute((event.data.object as Stripe.Dispute).id);
  const paymentIntentId = paymentIntentIdFromDispute(dispute);
  if (!paymentIntentId) return null;
  return {
    stripeDisputeId: dispute.id,
    stripeChargeId: stripeObjectId(dispute.charge),
    stripeEventId: event.id,
    paymentIntentId,
    providerStatus: dispute.status,
    applicationStatus: normalizeDisputeStatus(dispute.status),
    amountMinor: Number.isInteger(dispute.amount) ? dispute.amount : null,
    providerCreatedAt: stripeCreatedAt(dispute.created),
  };
}

function paymentIntentIdFromCharge(charge: Stripe.Charge) {
  return typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent?.id ?? null);
}

function stripeObjectId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function normalizeRefundStatus(status: Stripe.Refund["status"]): RefundProviderStatus {
  if (
    status === "pending" ||
    status === "requires_action" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "canceled"
  ) {
    return status;
  }
  throw new Error("Stripe refund has an unsupported authoritative status.");
}

function normalizeDisputeStatus(status: Stripe.Dispute.Status): "open" | "won" | "lost" {
  if (status === "won" || status === "warning_closed") return "won";
  if (status === "lost") return "lost";
  return "open";
}

function stripeCreatedAt(created: number | undefined) {
  return Number.isFinite(created) ? new Date((created ?? 0) * 1_000) : null;
}

async function readTransactionTime(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select transaction_timestamp() as now");
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL transaction time was unavailable.");
  return new Date(value);
}
