import { randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { LemonSqueezyCheckoutClient } from "@/server/trip-pass/lemon-squeezy-adapter";

type RefundOperationClaim = {
  id: string;
  order_id: string;
  provider_order_id: string;
  amount_minor: number | null;
  captured_total_minor: number | null;
  idempotency_key: string;
  attempts: number;
  lease_token: string;
};

export type LemonSqueezyRefundBatchResult = {
  claimed: number;
  confirmed: number;
  retrying: number;
  stale: number;
};

export async function runLemonSqueezyRefundBatch(input: {
  db: DatabaseQueryClient;
  client: LemonSqueezyCheckoutClient;
  limit?: number;
  leaseMs?: number;
  operationId?: string;
  createLeaseToken?: () => string;
}): Promise<LemonSqueezyRefundBatchResult> {
  const result: LemonSqueezyRefundBatchResult = {
    claimed: 0,
    confirmed: 0,
    retrying: 0,
    stale: 0,
  };
  const limit = input.limit ?? 10;
  const leaseMs = input.leaseMs ?? 60_000;
  const createLeaseToken = input.createLeaseToken ?? randomUUID;
  for (let index = 0; index < limit; index += 1) {
    const claim = await claimRefundOperation(
      input.db,
      leaseMs,
      createLeaseToken(),
      input.operationId,
    );
    if (!claim) break;
    result.claimed += 1;
    try {
      const fact = await input.client.refundOrder(claim.provider_order_id, {
        amountMinor: claim.amount_minor ?? undefined,
        idempotencyKey: claim.idempotency_key,
      });
      if (!isVerifiedRefund(claim, fact)) {
        if (await markRefundRetryable(input.db, claim, "refund_response_unverified")) {
          result.retrying += 1;
        } else {
          result.stale += 1;
        }
        continue;
      }
      if (await markRefundConfirmed(input.db, claim)) result.confirmed += 1;
      else result.stale += 1;
    } catch (error) {
      if (isAmbiguousProviderError(error)) {
        try {
          const authoritative = await input.client.retrieveOrder(claim.provider_order_id);
          if (isVerifiedRefund(claim, authoritative)) {
            if (await markRefundConfirmed(input.db, claim)) result.confirmed += 1;
            else result.stale += 1;
            continue;
          }
        } catch {
          // Preserve the retry path when the authoritative lookup is unavailable.
        }
      }
      if (await markRefundRetryable(input.db, claim, errorCode(error))) result.retrying += 1;
      else result.stale += 1;
    }
  }
  return result;
}

function isVerifiedRefund(
  claim: RefundOperationClaim,
  fact: { providerOrderId: string | null; status: string; refundedAmountMinor: number | null },
) {
  if (fact.providerOrderId !== claim.provider_order_id) return false;
  if (fact.status !== "refunded" && fact.status !== "partial_refund") return false;
  if (fact.status === "refunded") return true;
  if (claim.amount_minor === null || claim.captured_total_minor === null) return false;
  return (fact.refundedAmountMinor ?? 0) >= claim.captured_total_minor;
}

async function claimRefundOperation(
  db: DatabaseQueryClient,
  leaseMs: number,
  leaseToken: string,
  operationId?: string,
) {
  if (!db.transaction) throw new Error("database_transactions_required");
  return db.transaction(async (transaction) => {
    const result = await transaction.query<RefundOperationClaim>(
      `with candidate as (
         select operation.id, order_row.captured_amount_minor as captured_total_minor
         from trip_pass_refund_operations operation
         join trip_pass_orders order_row on order_row.id = operation.order_id
         where ($3::text is null or operation.id = $3)
           and (
             (operation.status = 'pending' and (operation.next_attempt_at is null or operation.next_attempt_at <= clock_timestamp()))
             or (operation.status = 'running' and operation.lease_expires_at <= clock_timestamp())
           )
         order by case when operation.status = 'running' then operation.lease_expires_at
           else coalesce(operation.next_attempt_at, operation.created_at) end, operation.id
         for update of operation skip locked
         limit 1
       )
       update trip_pass_refund_operations operation
       set status = 'running', attempts = operation.attempts + 1, lease_token = $1,
         lease_expires_at = clock_timestamp() + ($2::integer * interval '1 millisecond'),
         updated_at = clock_timestamp()
       from candidate
       where operation.id = candidate.id
       returning operation.id, operation.order_id, operation.provider_order_id,
         operation.amount_minor, candidate.captured_total_minor, operation.idempotency_key, operation.attempts,
         operation.lease_token`,
      [leaseToken, leaseMs, operationId ?? null],
    );
    return result.rows[0] ?? null;
  });
}

async function markRefundConfirmed(db: DatabaseQueryClient, claim: RefundOperationClaim) {
  const result = await db.query(
    `update trip_pass_refund_operations
     set status = 'succeeded', completed_at = clock_timestamp(), next_attempt_at = clock_timestamp(),
       lease_token = null, lease_expires_at = null, last_error_code = null,
       updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [claim.id, claim.lease_token],
  );
  return result.rows.length === 1;
}

async function markRefundRetryable(
  db: DatabaseQueryClient,
  claim: RefundOperationClaim,
  errorCode: string,
) {
  const delaySeconds = Math.min(86_400, 60 * 2 ** Math.max(claim.attempts - 1, 0));
  const result = await db.query(
    `update trip_pass_refund_operations
     set status = 'pending', next_attempt_at = clock_timestamp() + ($3::integer * interval '1 second'),
       lease_token = null, lease_expires_at = null, last_error_code = $4,
       updated_at = clock_timestamp()
     where id = $1 and status = 'running' and lease_token = $2
       and lease_expires_at > clock_timestamp()
     returning id`,
    [claim.id, claim.lease_token, delaySeconds, errorCode],
  );
  return result.rows.length === 1;
}

function errorCode(error: unknown) {
  return error instanceof Error
    ? `lemon_squeezy_refund_${error.name}`
    : "lemon_squeezy_refund_unknown";
}

function isAmbiguousProviderError(error: unknown) {
  return (
    error instanceof TypeError ||
    (typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { retryable?: unknown }).retryable === true)
  );
}
