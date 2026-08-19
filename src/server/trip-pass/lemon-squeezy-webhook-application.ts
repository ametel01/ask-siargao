import { createHash } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  type NormalizedPaymentFact,
  paymentFactFingerprint,
} from "@/server/payments/lemon-squeezy";
import { tripPassProductCatalog } from "@/server/trip-pass/catalog";
import { grantTripPass } from "@/server/trip-pass/entitlement";

export type LemonSqueezyPaymentApplicationResult =
  | { status: "ignored"; reason: "not_trip_pass_event" | "not_paid"; orderId?: string }
  | {
      status: "applied";
      action: "activated" | "refunded" | "refund_review" | "payment_suspended" | "payment_restored";
      orderId: string;
    }
  | { status: "duplicate"; orderId: string }
  | { status: "rejected"; reason: string; orderId?: string };

export async function applyLemonSqueezyPaymentFact(
  fact: NormalizedPaymentFact,
  options: {
    db: DatabaseQueryClient;
    now?: Date;
    env?: Record<string, string | undefined>;
    onPartialRefundReview?: (input: {
      orderId: string;
      remainingAmountMinor: number;
      deadlineAt: Date;
    }) => Promise<void>;
  },
): Promise<LemonSqueezyPaymentApplicationResult> {
  const now = options.now ?? new Date();
  let partialRefundReview:
    | { orderId: string; remainingAmountMinor: number; deadlineAt: Date }
    | undefined;
  const orderId = fact.orderId;
  if (!orderId) return { status: "rejected", reason: "missing_trip_pass_order_id" };
  const allowTestMode = options.env?.LEMON_SQUEEZY_ALLOW_TEST_MODE === "true";
  if (fact.testMode === null || fact.testMode !== allowTestMode) {
    return {
      status: "rejected",
      reason:
        fact.testMode === null ? "test_mode_evidence_missing" : "test_mode_payment_not_allowed",
      orderId,
    };
  }
  if (
    fact.status !== "paid" &&
    fact.status !== "refunded" &&
    fact.status !== "partial_refund" &&
    fact.status !== "fraudulent"
  ) {
    return { status: "ignored", reason: "not_paid", orderId };
  }

  const result = await withTransaction<LemonSqueezyPaymentApplicationResult>(
    options.db,
    async (db) => {
      const orderResult = await db.query<TripPassOrderRow>(
        `select id, user_id, status, product_code, product_version, amount_total_minor, currency,
        payment_provider,
          provider_store_id, provider_product_id, provider_variant_id, provider_order_id, accepted_payment_fact_id,
        provider_updated_at, payment_suspension_state, refund_state, successful_refund_amount_minor,
        checkout_commercial_terms_verified_at,
        refund_review_alerted_at
       from trip_pass_orders where id = $1 for update`,
        [orderId],
      );
      const order = orderResult.rows[0];
      if (!order) return { status: "rejected", reason: "trip_pass_order_not_found", orderId };
      if (order.payment_provider !== "lemon_squeezy") {
        return { status: "rejected", reason: "trip_pass_provider_mismatch", orderId };
      }
      const isAdditionalProviderPayment =
        Boolean(order.provider_order_id) &&
        Boolean(fact.providerOrderId) &&
        order.provider_order_id !== fact.providerOrderId;
      if (order.provider_order_id && !fact.providerOrderId) {
        return { status: "rejected", reason: "trip_pass_provider_order_id_missing", orderId };
      }
      if (isAdditionalProviderPayment) {
        const inserted = await recordPaymentFact(db, {
          order,
          fact,
          receiptId: factFingerprintForFact(fact),
          now,
        });
        if (!inserted) return { status: "duplicate", orderId };
        if (fact.status !== "refunded" && remainingRefundAmount(fact) !== 0) {
          await createRefundOperation(db, {
            order,
            fact,
            reason: "duplicate_payment",
            amountMinor: remainingRefundAmount(fact),
            now,
          });
        }
        return { status: "applied", action: "refunded", orderId };
      }
      if (!order.checkout_commercial_terms_verified_at) {
        return { status: "rejected", reason: "trip_pass_checkout_terms_unverified", orderId };
      }
      if (fact.discountTotalMinor !== 0) {
        return { status: "rejected", reason: "trip_pass_discount_not_allowed", orderId };
      }
      if (
        order.product_code !== tripPassProductCatalog.code ||
        order.product_version !== tripPassProductCatalog.version
      ) {
        return { status: "rejected", reason: "trip_pass_product_version_mismatch", orderId };
      }
      if (fact.amountTotalMinor === null || fact.amountTotalMinor !== order.amount_total_minor) {
        return { status: "rejected", reason: "trip_pass_payment_fact_amount_mismatch", orderId };
      }
      if (!fact.currency || fact.currency.toLowerCase() !== order.currency?.toLowerCase()) {
        return { status: "rejected", reason: "trip_pass_payment_fact_currency_mismatch", orderId };
      }
      if (
        order.provider_product_id &&
        (!fact.productId || fact.productId !== order.provider_product_id)
      ) {
        return { status: "rejected", reason: "trip_pass_product_mismatch", orderId };
      }
      if (
        !fact.variantId ||
        !order.provider_variant_id ||
        fact.variantId !== order.provider_variant_id
      ) {
        return { status: "rejected", reason: "trip_pass_variant_mismatch", orderId };
      }
      if (!fact.storeId || !order.provider_store_id || fact.storeId !== order.provider_store_id) {
        return { status: "rejected", reason: "trip_pass_store_mismatch", orderId };
      }

      const factId = `payment_fact_${factFingerprintForFact(fact).slice(0, 32)}`;
      const inserted = await recordPaymentFact(db, {
        order,
        fact,
        receiptId: factFingerprintForFact(fact),
        now,
        id: factId,
      });
      if (!inserted) return { status: "duplicate", orderId };

      if (isStaleProviderFact(order, fact)) return { status: "duplicate", orderId };
      if (order.status === "refunded" && fact.status === "paid") {
        return { status: "rejected", reason: "paid_after_refund", orderId };
      }
      if (!order.user_id) {
        if (fact.status !== "refunded") {
          await createRefundOperation(db, { order, fact, reason: "paid_after_closure", now });
        }
        return { status: "applied", action: "refunded", orderId };
      }

      if (fact.status === "partial_refund") {
        const remainingAmountMinor = remainingRefundAmount(fact);
        if (remainingAmountMinor === null) {
          return { status: "rejected", reason: "trip_pass_partial_refund_amount_missing", orderId };
        }
        const deadlineAt = new Date(now.getTime() + 24 * 60 * 60_000);
        await db.query(
          `update trip_pass_orders set refund_state = 'review',
          successful_refund_amount_minor = greatest(successful_refund_amount_minor, $2),
          refund_remaining_amount_minor = $3,
          refund_review_deadline_at = coalesce(refund_review_deadline_at, $4),
          refund_review_alerted_at = coalesce(refund_review_alerted_at, $5),
          provider_updated_at = $6, lifecycle_updated_at = $5, updated_at = $5 where id = $1`,
          [
            orderId,
            fact.refundedAmountMinor ?? 0,
            remainingAmountMinor,
            deadlineAt,
            now,
            fact.providerUpdatedAt,
          ],
        );
        await createRefundOperation(db, {
          order,
          fact,
          reason: "partial_refund_deadline",
          amountMinor: remainingAmountMinor,
          nextAttemptAt: deadlineAt,
          now,
        });
        if (!order.refund_review_alerted_at) {
          partialRefundReview = { orderId, remainingAmountMinor, deadlineAt };
        }
        return { status: "applied", action: "refund_review", orderId };
      }
      if (fact.status === "refunded") {
        await db.query(
          "update trip_pass_orders set status = 'refunded', refund_state = 'full', successful_refund_amount_minor = coalesce($2, captured_amount_minor, amount_total_minor), refund_remaining_amount_minor = null, refund_review_deadline_at = null, terminal_revocation_reason = 'full_refund', provider_updated_at = $4, lifecycle_updated_at = $3, updated_at = $3 where id = $1",
          [orderId, fact.refundedAmountMinor, now, fact.providerUpdatedAt],
        );
        await revokePass(db, orderId, now, "full_refund");
        return { status: "applied", action: "refunded", orderId };
      }
      if (fact.status === "fraudulent") {
        await db.query(
          "update trip_pass_orders set payment_suspension_state = 'fraudulent', dispute_state = 'open', provider_updated_at = $3, lifecycle_updated_at = $2, updated_at = $2 where id = $1",
          [orderId, now, fact.providerUpdatedAt],
        );
        await db.query(
          "update trip_passes set status = 'suspended', suspended_at = $2, updated_at = $2 where id in (select trip_pass_id from trip_pass_grants where order_id = $1) and status = 'active'",
          [orderId, now],
        );
        return { status: "applied", action: "payment_suspended", orderId };
      }

      if (order.payment_suspension_state !== "none") {
        await db.query(
          "update trip_pass_orders set payment_suspension_state = 'none', dispute_state = 'won', provider_updated_at = $3, lifecycle_updated_at = $2, updated_at = $2 where id = $1",
          [orderId, now, fact.providerUpdatedAt],
        );
        await db.query(
          "update trip_passes set status = case when expires_at > $2 then 'active' else status end, suspended_at = null, updated_at = $2 where id in (select trip_pass_id from trip_pass_grants where order_id = $1) and status = 'suspended'",
          [orderId, now],
        );
        return { status: "applied", action: "payment_restored", orderId };
      }
      if (order.accepted_payment_fact_id) {
        return { status: "duplicate", orderId };
      }
      if (!order.user_id)
        return { status: "rejected", reason: "trip_pass_order_missing_owner", orderId };
      const grant = await grantTripPass(
        {
          userId: order.user_id,
          orderId,
          sourceType: "lemon_squeezy_checkout",
          sourceEventId: factFingerprintForFact(fact),
          now,
        },
        db,
      );
      await db.query(
        `update trip_pass_orders set status = 'paid', payment_provider = 'lemon_squeezy',
        provider_order_id = coalesce(provider_order_id, $2), provider_payment_id = coalesce(provider_payment_id, $3),
        accepted_payment_fact_id = $4, captured_amount_minor = coalesce(captured_amount_minor, amount_total_minor),
        provider_updated_at = $5, lifecycle_updated_at = $6, completed_at = coalesce(completed_at, $6), updated_at = $6 where id = $1`,
        [orderId, fact.providerOrderId, fact.paymentId, factId, fact.providerUpdatedAt, now],
      );
      return grant.status === "duplicate"
        ? { status: "duplicate", orderId }
        : { status: "applied", action: "activated", orderId };
    },
  );
  if (partialRefundReview) await options.onPartialRefundReview?.(partialRefundReview);
  return result;
}

type TripPassOrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  product_code: string;
  product_version: number;
  amount_total_minor: number | null;
  currency: string | null;
  provider_store_id: string | null;
  provider_product_id: string | null;
  provider_variant_id: string | null;
  provider_order_id: string | null;
  accepted_payment_fact_id: string | null;
  checkout_commercial_terms_verified_at: Date | string | null;
  payment_suspension_state: string;
  refund_state: string;
  refund_review_alerted_at: Date | string | null;
  successful_refund_amount_minor: number | null;
  payment_provider: string;
  provider_updated_at: Date | string | null;
};

async function recordPaymentFact(
  db: DatabaseQueryClient,
  input: {
    order: TripPassOrderRow;
    fact: NormalizedPaymentFact;
    receiptId: string;
    now: Date;
    id?: string;
  },
) {
  const fingerprint = factFingerprintForFact(input.fact);
  const result = await db.query<{ id: string }>(
    `insert into trip_pass_payment_facts (
      id, order_id, receipt_id, provider, provider_order_id, provider_payment_id, fingerprint,
      status, amount_total_minor, refunded_amount_minor, currency, provider_updated_at, created_at, updated_at
    ) values ($1, $2, $3, 'lemon_squeezy', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    on conflict (fingerprint) do nothing returning id`,
    [
      input.id ?? `payment_fact_${fingerprint.slice(0, 32)}`,
      input.order.id,
      input.receiptId.startsWith("payment_receipt_")
        ? input.receiptId
        : `payment_receipt_${input.receiptId.slice(0, 32)}`,
      input.fact.providerOrderId ?? input.fact.objectId,
      input.fact.paymentId,
      fingerprint,
      input.fact.status,
      input.fact.amountTotalMinor,
      input.fact.refundedAmountMinor,
      input.fact.currency,
      input.fact.providerUpdatedAt,
      input.now,
    ],
  );
  return Boolean(result.rows[0]);
}

async function createRefundOperation(
  db: DatabaseQueryClient,
  input: {
    order: TripPassOrderRow;
    fact: NormalizedPaymentFact;
    reason: "duplicate_payment" | "paid_after_closure" | "partial_refund_deadline";
    amountMinor?: number | null;
    nextAttemptAt?: Date;
    now: Date;
  },
) {
  const providerOrderId = input.fact.providerOrderId ?? input.fact.objectId;
  const idempotencyKey = `lemon_squeezy:${input.order.id}:${input.reason}:${providerOrderId}`;
  const operationId = `refund_operation_${createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 32)}`;
  await db.query(
    `insert into trip_pass_refund_operations (
      id, order_id, provider, provider_order_id, reason, amount_minor, idempotency_key,
      provider_captured_amount_minor, next_attempt_at, created_at, updated_at
    ) values ($1, $2, 'lemon_squeezy', $3, $4, $5, $6, $7, $8, $9, $9)
    on conflict (idempotency_key) do update set
      amount_minor = case when trip_pass_refund_operations.status = 'pending'
        then excluded.amount_minor else trip_pass_refund_operations.amount_minor end,
      next_attempt_at = case when trip_pass_refund_operations.status = 'pending'
        then least(trip_pass_refund_operations.next_attempt_at, excluded.next_attempt_at)
        else trip_pass_refund_operations.next_attempt_at end,
      provider_captured_amount_minor = coalesce(
        trip_pass_refund_operations.provider_captured_amount_minor,
        excluded.provider_captured_amount_minor
      ),
      updated_at = excluded.updated_at`,
    [
      operationId,
      input.order.id,
      providerOrderId,
      input.reason,
      input.amountMinor ?? input.fact.amountTotalMinor,
      idempotencyKey,
      input.fact.amountTotalMinor,
      input.nextAttemptAt ?? input.now,
      input.now,
    ],
  );
}

function remainingRefundAmount(fact: NormalizedPaymentFact) {
  if (fact.amountTotalMinor === null) return null;
  return Math.max(fact.amountTotalMinor - (fact.refundedAmountMinor ?? 0), 0);
}

function isStaleProviderFact(order: TripPassOrderRow, fact: NormalizedPaymentFact) {
  if (!order.provider_updated_at) return false;
  const current = new Date(order.provider_updated_at).getTime();
  const incoming = new Date(fact.providerUpdatedAt).getTime();
  if (!Number.isFinite(current) || !Number.isFinite(incoming)) return false;
  if (incoming < current) return true;
  if (incoming > current) return false;
  const currentRank = paymentStateRank(
    order.status,
    order.refund_state,
    order.payment_suspension_state,
  );
  const incomingRank = paymentStateRank(
    fact.status,
    fact.status === "partial_refund" ? "review" : "none",
    fact.status === "fraudulent" ? "fraudulent" : "none",
  );
  if (incomingRank !== currentRank) return incomingRank < currentRank;
  return (
    fact.status === "partial_refund" &&
    (fact.refundedAmountMinor ?? 0) <= (order.successful_refund_amount_minor ?? 0)
  );
}

function paymentStateRank(status: string, refundState: string, suspensionState = "none") {
  if (status === "refunded" || refundState === "full") return 4;
  if (status === "fraudulent" || suspensionState === "fraudulent") return 3;
  if (status === "partial_refund" || refundState === "review") return 2;
  if (status === "paid") return 1;
  return 0;
}

async function revokePass(
  db: DatabaseQueryClient,
  orderId: string,
  now: Date,
  reason: "full_refund",
) {
  await db.query(
    "update trip_passes set status = 'refunded', terminal_revocation_reason = $2, updated_at = $3 where id in (select trip_pass_id from trip_pass_grants where order_id = $1) and status in ('active', 'suspended')",
    [orderId, reason, now],
  );
}

function factFingerprintForFact(fact: NormalizedPaymentFact) {
  return paymentFactFingerprint(fact);
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.inTransaction || !db.transaction) return callback(db);
  return db.transaction(callback);
}
