import type { DatabaseQueryClient } from "@/server/db/query-client";

export type RefundProviderStatus =
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled";

export type AuthoritativeRefundFact = {
  stripeRefundId: string;
  stripeChargeId: string;
  stripeEventId: string;
  paymentIntentId: string;
  providerStatus: RefundProviderStatus;
  amountMinor: number;
  successfulAmountMinor: number;
  providerCreatedAt: Date | null;
};

export type AuthoritativeDisputeFact = {
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripeEventId: string;
  paymentIntentId: string;
  providerStatus: string;
  applicationStatus: "open" | "won" | "lost";
  amountMinor: number | null;
  providerCreatedAt: Date | null;
};

export type PaymentLifecycleApplication =
  | {
      status: "applied";
      action: "refund_review" | "refunded" | "dispute_suspended" | "dispute_won" | "disputed";
      orderId: string;
      invalidatedReservations: number;
    }
  | { status: "duplicate"; orderId: string }
  | { status: "rejected"; reason: string; orderId?: string };

type LifecycleOrderRow = {
  id: string;
  user_id: string | null;
  product_family: string;
  status: string;
  amount_total_minor: number | null;
  captured_amount_minor: number | null;
  successful_refund_amount_minor: number;
  refund_state: string;
  dispute_state: string;
  terminal_revocation_reason: string | null;
};

type LifecyclePassRow = {
  id: string;
  status: string;
  expires_at: Date | string;
};

export async function applyAuthoritativeRefundFact(
  fact: AuthoritativeRefundFact,
  db: DatabaseQueryClient,
): Promise<PaymentLifecycleApplication> {
  return withLifecycleTransaction(db, async (transaction) => {
    const locked = await lockLifecycleTarget(fact.paymentIntentId, transaction);
    if (!locked) {
      return { status: "rejected", reason: "trip_pass_payment_intent_not_found" };
    }

    const existing = await transaction.query<{
      provider_status: string;
      amount_minor: number;
    }>(
      `select provider_status, amount_minor from trip_pass_refund_facts
       where stripe_refund_id = $1 limit 1`,
      [fact.stripeRefundId],
    );

    await transaction.query(
      `
        insert into trip_pass_refund_facts (
          id, order_id, stripe_refund_id, stripe_charge_id, stripe_event_id,
          provider_status, amount_minor, provider_created_at, first_seen_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, transaction_timestamp(), transaction_timestamp())
        on conflict (stripe_refund_id) do update set
          stripe_event_id = excluded.stripe_event_id,
          stripe_charge_id = excluded.stripe_charge_id,
          provider_status = excluded.provider_status,
          amount_minor = excluded.amount_minor,
          provider_created_at = coalesce(excluded.provider_created_at,
            trip_pass_refund_facts.provider_created_at),
          updated_at = transaction_timestamp()
      `,
      [
        `refund_fact_${fact.stripeRefundId}`,
        locked.order.id,
        fact.stripeRefundId,
        fact.stripeChargeId,
        fact.stripeEventId,
        fact.providerStatus,
        fact.amountMinor,
        fact.providerCreatedAt,
      ],
    );

    const successfulRefundAmountMinor = Math.min(
      Math.max(locked.order.successful_refund_amount_minor, fact.successfulAmountMinor),
      capturedAmount(locked.order),
    );
    if (
      successfulRefundAmountMinor === locked.order.successful_refund_amount_minor &&
      (locked.order.refund_state === "full" ||
        (existing.rows[0]?.provider_status === fact.providerStatus &&
          existing.rows[0]?.amount_minor === fact.amountMinor))
    ) {
      return { status: "duplicate", orderId: locked.order.id };
    }
    return projectLifecycle(
      {
        ...locked,
        successfulRefundAmountMinor,
      },
      transaction,
    );
  });
}

export async function applyAuthoritativeDisputeFact(
  fact: AuthoritativeDisputeFact,
  db: DatabaseQueryClient,
): Promise<PaymentLifecycleApplication> {
  return withLifecycleTransaction(db, async (transaction) => {
    const locked = await lockLifecycleTarget(fact.paymentIntentId, transaction);
    if (!locked) {
      return { status: "rejected", reason: "trip_pass_payment_intent_not_found" };
    }

    const existing = await transaction.query<{
      application_status: string;
      provider_status: string;
    }>(
      `select application_status, provider_status from trip_pass_dispute_facts
       where stripe_dispute_id = $1 limit 1`,
      [fact.stripeDisputeId],
    );

    await transaction.query(
      `
        insert into trip_pass_dispute_facts (
          id, order_id, stripe_dispute_id, stripe_charge_id, stripe_event_id,
          provider_status, application_status, amount_minor, provider_created_at,
          first_seen_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
          transaction_timestamp(), transaction_timestamp())
        on conflict (stripe_dispute_id) do update set
          stripe_event_id = excluded.stripe_event_id,
          stripe_charge_id = excluded.stripe_charge_id,
          provider_status = excluded.provider_status,
          application_status = case
            when trip_pass_dispute_facts.application_status = 'lost' then 'lost'
            else excluded.application_status
          end,
          amount_minor = excluded.amount_minor,
          provider_created_at = coalesce(excluded.provider_created_at,
            trip_pass_dispute_facts.provider_created_at),
          updated_at = transaction_timestamp()
      `,
      [
        `dispute_fact_${fact.stripeDisputeId}`,
        locked.order.id,
        fact.stripeDisputeId,
        fact.stripeChargeId,
        fact.stripeEventId,
        fact.providerStatus,
        fact.applicationStatus,
        fact.amountMinor,
        fact.providerCreatedAt,
      ],
    );

    if (
      existing.rows[0]?.application_status === fact.applicationStatus &&
      existing.rows[0]?.provider_status === fact.providerStatus
    ) {
      return { status: "duplicate", orderId: locked.order.id };
    }

    return projectLifecycle(
      {
        ...locked,
        successfulRefundAmountMinor: locked.order.successful_refund_amount_minor,
      },
      transaction,
    );
  });
}

export async function lockTripPassAccountFamily(
  accountId: string,
  productFamily: string,
  db: DatabaseQueryClient,
) {
  try {
    await db.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      accountId,
      productFamily,
    ]);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/pg_advisory|hashtext|function|syntax|unsupported/i.test(error.message)
    ) {
      throw error;
    }
  }
}

export async function invalidateOpenPaidAnswerReservations(
  input: { tripPassId: string; reason: "full_refund" | "dispute_lost" },
  db: DatabaseQueryClient,
) {
  const result = await db.query<{ invalidated: number | string }>(
    "select invalidate_open_paid_answer_reservations($1, $2)::integer as invalidated",
    [input.tripPassId, input.reason],
  );
  return Number(result.rows[0]?.invalidated ?? 0);
}

async function lockLifecycleTarget(paymentIntentId: string, db: DatabaseQueryClient) {
  const candidate = await db.query<{ user_id: string | null; product_family: string }>(
    `select user_id, product_family from trip_pass_orders
     where stripe_payment_intent_id = $1 limit 1`,
    [paymentIntentId],
  );
  const owner = candidate.rows[0];
  if (!owner?.user_id) return null;

  await lockTripPassAccountFamily(owner.user_id, owner.product_family, db);

  const orderResult = await db.query<LifecycleOrderRow>(
    `
      select id, user_id, product_family, status, amount_total_minor, captured_amount_minor,
        successful_refund_amount_minor, refund_state, dispute_state,
        terminal_revocation_reason
      from trip_pass_orders
      where stripe_payment_intent_id = $1
      limit 1
      for update
    `,
    [paymentIntentId],
  );
  const order = orderResult.rows[0];
  if (!order?.user_id) return null;

  const passResult = await db.query<LifecyclePassRow>(
    `select id, status, expires_at from trip_passes
     where stripe_payment_intent_id = $1 limit 1 for update`,
    [paymentIntentId],
  );
  const pass = passResult.rows[0];
  if (!pass) return null;
  return { order, pass };
}

async function projectLifecycle(
  input: {
    order: LifecycleOrderRow;
    pass: LifecyclePassRow;
    successfulRefundAmountMinor: number;
  },
  db: DatabaseQueryClient,
): Promise<PaymentLifecycleApplication> {
  const captured = capturedAmount(input.order);
  const pendingRefunds = await db.query<{ count: number | string }>(
    `select count(*)::integer as count from trip_pass_refund_facts
     where order_id = $1 and provider_status in ('pending', 'requires_action')`,
    [input.order.id],
  );
  const disputes = await db.query<{ application_status: string; count: number | string }>(
    `select application_status, count(*)::integer as count
     from trip_pass_dispute_facts where order_id = $1 group by application_status`,
    [input.order.id],
  );
  const disputeCounts = new Map(
    disputes.rows.map((row) => [row.application_status, Number(row.count)]),
  );
  const fullRefund = input.successfulRefundAmountMinor >= captured;
  const refundReview =
    !fullRefund &&
    (input.successfulRefundAmountMinor > 0 || Number(pendingRefunds.rows[0]?.count ?? 0) > 0);
  const disputeLost = (disputeCounts.get("lost") ?? 0) > 0;
  const disputeOpen = (disputeCounts.get("open") ?? 0) > 0;
  const disputeWon = (disputeCounts.get("won") ?? 0) > 0;
  const terminalReason = fullRefund ? "full_refund" : disputeLost ? "dispute_lost" : null;
  const now = await readTransactionTime(db);

  let invalidatedReservations = 0;
  if (terminalReason) {
    invalidatedReservations = await invalidateOpenPaidAnswerReservations(
      { tripPassId: input.pass.id, reason: terminalReason },
      db,
    );
  }

  const passStatus = terminalReason
    ? terminalReason === "full_refund"
      ? "refunded"
      : "cancelled"
    : disputeOpen
      ? "suspended"
      : new Date(input.pass.expires_at).getTime() > now.getTime()
        ? "active"
        : "expired";
  const orderStatus = terminalReason
    ? terminalReason === "full_refund"
      ? "refunded"
      : "disputed"
    : disputeOpen
      ? "disputed"
      : "paid";
  const refundState = fullRefund ? "full" : refundReview ? "review" : "none";
  const disputeState = disputeLost ? "lost" : disputeOpen ? "open" : disputeWon ? "won" : "none";

  await db.query(
    `update trip_pass_orders set status = $2, captured_amount_minor = $3,
       successful_refund_amount_minor = $4, refund_state = $5, dispute_state = $6,
       terminal_revocation_reason = $7, lifecycle_updated_at = $8, updated_at = $8
     where id = $1`,
    [
      input.order.id,
      orderStatus,
      captured,
      input.successfulRefundAmountMinor,
      refundState,
      disputeState,
      terminalReason,
      now,
    ],
  );
  await db.query(
    `update trip_passes set status = $2, terminal_revocation_reason = $3,
       suspended_at = case when $2 = 'suspended' then coalesce(suspended_at, $4) else null end,
       updated_at = $4 where id = $1`,
    [input.pass.id, passStatus, terminalReason, now],
  );

  const action = terminalReason
    ? terminalReason === "full_refund"
      ? "refunded"
      : "disputed"
    : disputeOpen
      ? "dispute_suspended"
      : disputeWon
        ? "dispute_won"
        : "refund_review";
  return { status: "applied", action, orderId: input.order.id, invalidatedReservations };
}

function capturedAmount(order: LifecycleOrderRow) {
  const captured = order.captured_amount_minor ?? order.amount_total_minor;
  if (!captured || captured <= 0) {
    throw new Error("Trip Pass Order is missing a positive captured payment amount.");
  }
  return captured;
}

async function readTransactionTime(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select transaction_timestamp() as now");
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL transaction time was unavailable.");
  return new Date(value);
}

async function withLifecycleTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction) return callback(db);
  if (db.transaction) return db.transaction(callback);
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
