import { randomUUID } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { createStripeRefundClient, type StripeRefundClient } from "@/server/payments/stripe";

type RefundObligationClaim = {
  id: string;
  stripe_payment_intent_id: string;
  stripe_refund_id: string | null;
  expected_amount_minor: number;
  attempts: number;
  lease_token: string;
};

export type PaidAfterClosureRefundBatchResult = {
  claimed: number;
  confirmed: number;
  retrying: number;
  stale: number;
};

export async function runPaidAfterClosureRefundBatch(
  input: {
    db?: DatabaseQueryClient;
    stripe?: StripeRefundClient;
    limit?: number;
    leaseMs?: number;
    alertAfterAttempts?: number;
    jitterUnit?: number;
    createLeaseToken?: () => string;
  } = {},
): Promise<PaidAfterClosureRefundBatchResult> {
  const db = input.db ?? getDefaultDatabaseQueryClient();
  const stripe = input.stripe ?? createStripeRefundClient();
  const result: PaidAfterClosureRefundBatchResult = {
    claimed: 0,
    confirmed: 0,
    retrying: 0,
    stale: 0,
  };

  const limit = input.limit ?? 10;
  const leaseMs = input.leaseMs ?? 60_000;
  const createLeaseToken = input.createLeaseToken ?? randomUUID;
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimRefundObligation(db, leaseMs, createLeaseToken());
    if (!claim) break;
    result.claimed += 1;
    try {
      const refund = claim.stripe_refund_id
        ? await stripe.retrieveRefund(claim.stripe_refund_id)
        : await stripe.createFullRefund({
            paymentIntentId: claim.stripe_payment_intent_id,
            amountMinor: claim.expected_amount_minor,
            idempotencyKey: `paid_after_closure:${claim.id}`,
          });
      const committed =
        refund.status === "succeeded"
          ? await markRefundConfirmed(db, claim, refund.id)
          : await markRefundRetryable(db, claim, {
              stripeRefundId: refund.id,
              providerStatus: normalizeProviderStatus(refund.status),
              alertAfterAttempts: input.alertAfterAttempts ?? 3,
              jitterUnit: input.jitterUnit ?? 0.5,
            });
      if (!committed) result.stale += 1;
      else if (refund.status === "succeeded") result.confirmed += 1;
      else result.retrying += 1;
    } catch (error) {
      const committed = await markRefundRetryable(db, claim, {
        providerStatus: null,
        stripeRefundId: null,
        alertAfterAttempts: input.alertAfterAttempts ?? 3,
        jitterUnit: input.jitterUnit ?? 0.5,
        error,
      });
      if (committed) result.retrying += 1;
      else result.stale += 1;
    }
  }
  return result;
}

async function claimRefundObligation(db: DatabaseQueryClient, leaseMs: number, leaseToken: string) {
  const result = await withTransaction(db, (transaction) =>
    transaction.query<RefundObligationClaim>(
      `
          with candidate as (
            select id from account_closure_refund_obligations
            where stripe_payment_intent_id is not null
              and expected_amount_minor is not null
              and (
                (status = 'pending'
                  and (next_attempt_at is null or next_attempt_at <= clock_timestamp()))
                or (status = 'running' and lease_expires_at <= clock_timestamp())
              )
            order by case when status = 'running' then lease_expires_at
              else coalesce(next_attempt_at, created_at) end, id
            for update skip locked
            limit 1
          )
          update account_closure_refund_obligations r
          set status = 'running', attempts = r.attempts + 1, lease_token = $1,
            lease_expires_at = clock_timestamp() + ($2::integer * interval '1 millisecond'),
            updated_at = clock_timestamp()
          from candidate where r.id = candidate.id
          returning r.id, r.stripe_payment_intent_id, r.stripe_refund_id,
            r.expected_amount_minor, r.attempts, r.lease_token
      `,
      [leaseToken, leaseMs],
    ),
  );
  return result.rows[0] ?? null;
}

async function markRefundConfirmed(
  db: DatabaseQueryClient,
  claim: RefundObligationClaim,
  stripeRefundId: string,
) {
  const result = await db.query(
    `update account_closure_refund_obligations
     set status = 'succeeded', stripe_refund_id = $3, provider_status = 'succeeded',
       completed_at = clock_timestamp(), confirmed_at = clock_timestamp(),
       next_attempt_at = null, lease_token = null, lease_expires_at = null,
       last_error_category = null, updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [claim.id, claim.lease_token, stripeRefundId],
  );
  return result.rows.length === 1;
}

async function markRefundRetryable(
  db: DatabaseQueryClient,
  claim: RefundObligationClaim,
  input: {
    stripeRefundId: string | null;
    providerStatus: string | null;
    alertAfterAttempts: number;
    jitterUnit: number;
    error?: unknown;
  },
) {
  const delayMs = refundRetryDelayMs(claim.attempts, input.jitterUnit);
  const result = await db.query(
    `update account_closure_refund_obligations
     set status = 'pending', stripe_refund_id = coalesce(stripe_refund_id, $3),
       provider_status = coalesce($4, provider_status),
       next_attempt_at = clock_timestamp() + ($5::integer * interval '1 millisecond'),
       lease_token = null, lease_expires_at = null, last_error_category = $6,
       alerted_at = case when attempts >= $7 then coalesce(alerted_at, clock_timestamp())
         else alerted_at end,
       updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [
      claim.id,
      claim.lease_token,
      input.stripeRefundId,
      input.providerStatus,
      delayMs,
      sanitizedErrorCategory(input.error, input.providerStatus),
      input.alertAfterAttempts,
    ],
  );
  return result.rows.length === 1;
}

export function refundRetryDelayMs(attempts: number, jitterUnit: number) {
  const boundedJitter = Math.min(Math.max(jitterUnit, 0), 1);
  const maximumDelayMs = 24 * 60 * 60_000;
  const base = Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), maximumDelayMs);
  return Math.min(Math.round(base * (0.75 + boundedJitter * 0.5)), maximumDelayMs);
}

function normalizeProviderStatus(status: string | null) {
  if (
    status === "pending" ||
    status === "requires_action" ||
    status === "failed" ||
    status === "canceled"
  ) {
    return status;
  }
  return null;
}

function sanitizedErrorCategory(error: unknown, providerStatus: string | null) {
  if (providerStatus) return `stripe_refund_${providerStatus}`;
  return error instanceof Error ? error.name : "stripe_refund_unknown_error";
}

async function withTransaction<T>(
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
