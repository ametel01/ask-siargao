import { createHash, randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { authorizeOperator, type OperatorAuthSnapshot } from "@/server/operations/operator-auth";
import {
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
} from "@/server/trip-pass/payment-lifecycle";

export const operatorRefundDecisions = ["full_refund", "accept_partial_refund"] as const;
export type OperatorRefundDecision = (typeof operatorRefundDecisions)[number];

type RefundState = {
  activeRefundOperationReason: string | null;
  activeRefundOperationStatus: string | null;
  capturedAmountMinor: number | null;
  meterUsed: number;
  orderStatus: string;
  passCount: number;
  paymentProvider: string;
  providerRefundReady: boolean;
  refundRemainingAmountMinor: number | null;
  reviewOperationStatus: string | null;
  refundState: string;
  successfulRefundAmountMinor: number;
};

type RefundOrderRow = {
  active_refund_operation_reason: string | null;
  active_refund_operation_status: string | null;
  captured_amount_minor: number | null;
  payment_provider: string;
  product_family: string;
  provider_order_id: string | null;
  refund_remaining_amount_minor: number | null;
  review_operation_status: string | null;
  refund_state: string;
  status: string;
  successful_refund_amount_minor: number | string;
  user_id: string | null;
};

export async function previewOperatorRefund(
  input: { decision: OperatorRefundDecision; orderId: string },
  db: DatabaseQueryClient,
) {
  const before = await loadRefundState(input.orderId, db);
  const after = projectRefundOutcome(input.decision, before);
  return {
    before,
    after,
    decision: input.decision,
    digest: refundPreviewDigest(input, { before, after }),
    orderId: input.orderId,
  };
}

export async function executeOperatorRefund(
  input: {
    auth: OperatorAuthSnapshot;
    confirmation: string;
    decision: OperatorRefundDecision;
    idempotencyKey: string;
    orderId: string;
    previewDigest: string;
    reasonCode: string;
  },
  dependencies: {
    allowlist: ReadonlySet<string>;
    createId?: (prefix: string) => string;
    db: DatabaseQueryClient;
  },
) {
  const authorization = authorizeOperator({
    allowlist: dependencies.allowlist,
    auth: input.auth,
    mutation: true,
  });
  if (!authorization.allowed) return { status: "denied" as const, reason: authorization.reason };
  if (input.confirmation !== "APPLY REFUND") {
    return { status: "denied" as const, reason: "explicit_confirmation_required" as const };
  }
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.reasonCode)) {
    return { status: "denied" as const, reason: "invalid_reason_code" as const };
  }
  if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
    return { status: "denied" as const, reason: "invalid_idempotency_key" as const };
  }
  if (!dependencies.db.transaction) throw new Error("database_transactions_required");

  const idempotencyHash = sha256(input.idempotencyKey);
  const commandHash = sha256(
    JSON.stringify({
      decision: input.decision,
      orderId: input.orderId,
      previewDigest: input.previewDigest,
      reasonCode: input.reasonCode,
    }),
  );
  const replay = await loadReplay(
    authorization.accountId,
    idempotencyHash,
    commandHash,
    dependencies.db,
  );
  if (replay) return replay;
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);

  return dependencies.db.transaction(async (db) => {
    const order = await loadRefundOrder(input.orderId, db);
    if (!order) throw new Error("operator_refund_order_unavailable");
    if (order.user_id) {
      await lockTripPassAccountFamily(order.user_id, order.product_family, db);
      await lockTripPassAccountWrites(order.user_id, db);
    }
    await db.query("select id from trip_pass_orders where id = $1 for update", [input.orderId]);
    const lockedOrder = await loadRefundOrder(input.orderId, db);
    if (!lockedOrder) throw new Error("operator_refund_order_unavailable");
    const replayAfterLock = await loadReplay(
      authorization.accountId,
      idempotencyHash,
      commandHash,
      db,
    );
    if (replayAfterLock) return replayAfterLock;
    await db.query(
      `select id from trip_pass_refund_operations
       where order_id = $1 and provider = 'lemon_squeezy' and provider_order_id = $2
         and status in ('pending', 'running')
       order by created_at, id for update`,
      [input.orderId, lockedOrder.provider_order_id],
    );

    const before = await loadRefundState(input.orderId, db);
    const after = projectRefundOutcome(input.decision, before);
    if (refundPreviewDigest(input, { before, after }) !== input.previewDigest) {
      throw new Error("operator_refund_preview_changed");
    }
    const actionId = createId("operator_refund_action");
    const reserved = await db.query<{ id: string }>(
      `insert into operator_refund_actions (
         id, order_id, operator_account_id, idempotency_key_hash, command_hash,
         decision, reason_code, before_state, after_state, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, clock_timestamp())
       on conflict (operator_account_id, idempotency_key_hash) do nothing returning id`,
      [
        actionId,
        input.orderId,
        authorization.accountId,
        idempotencyHash,
        commandHash,
        input.decision,
        input.reasonCode,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
    if (!reserved.rows[0]) {
      const conflict = await loadReplay(authorization.accountId, idempotencyHash, commandHash, db);
      if (!conflict) throw new Error("operator_refund_idempotency_mismatch");
      return conflict;
    }

    if (input.decision === "full_refund") {
      const amountMinor = refundAmount(before);
      if (
        before.activeRefundOperationReason === "partial_refund_deadline" &&
        before.activeRefundOperationStatus === "pending"
      ) {
        await db.query(
          `update trip_pass_refund_operations set reason = 'operator_refund', amount_minor = $3,
             provider_captured_amount_minor = $4,
             next_attempt_at = clock_timestamp(), last_error_code = null,
             updated_at = clock_timestamp()
           where order_id = $1 and provider_order_id = $2
             and reason = 'partial_refund_deadline' and status = 'pending'`,
          [input.orderId, lockedOrder.provider_order_id, amountMinor, before.capturedAmountMinor],
        );
      } else {
        await db.query(
          `insert into trip_pass_refund_operations (
             id, order_id, provider, provider_order_id, reason, amount_minor,
             provider_captured_amount_minor, idempotency_key, created_at, updated_at
           ) values ($1, $2, 'lemon_squeezy', $3, 'operator_refund', $4, $5, $6,
             clock_timestamp(), clock_timestamp())`,
          [
            `refund_operation_${actionId}`,
            input.orderId,
            lockedOrder.provider_order_id,
            amountMinor,
            before.capturedAmountMinor,
            `operator_refund:${actionId}`,
          ],
        );
      }
    } else {
      await db.query(
        `update trip_pass_refund_operations set status = 'cancelled', next_attempt_at = clock_timestamp(),
           last_error_code = 'operator_accepted_partial_refund', lease_token = null,
           lease_expires_at = null, updated_at = clock_timestamp()
         where order_id = $1 and reason = 'partial_refund_deadline' and status = 'pending'`,
        [input.orderId],
      );
      await db.query(
        `update trip_pass_orders set refund_state = 'partial_final',
           refund_remaining_amount_minor = null, refund_review_deadline_at = null,
           refund_review_alerted_at = null,
           lifecycle_updated_at = clock_timestamp(), updated_at = clock_timestamp()
         where id = $1 and refund_state = 'review'`,
        [input.orderId],
      );
    }
    return { actionId, after, status: "applied" as const };
  });
}

function projectRefundOutcome(decision: OperatorRefundDecision, before: RefundState) {
  if (decision === "full_refund") {
    if (
      before.activeRefundOperationStatus &&
      before.activeRefundOperationReason !== "partial_refund_deadline"
    ) {
      throw new Error("refund_operation_already_active");
    }
    if (before.activeRefundOperationStatus === "running") {
      throw new Error("partial_refund_operation_in_flight");
    }
    return {
      ...before,
      amountMinor: refundAmount(before),
      operation: "queued",
      accessChangesOnlyAfterVerifiedRefund: true,
    };
  }
  if (before.refundState !== "review" || before.reviewOperationStatus !== "pending") {
    throw new Error(
      before.reviewOperationStatus === "running"
        ? "partial_refund_operation_in_flight"
        : "partial_refund_review_unavailable",
    );
  }
  return {
    ...before,
    refundRemainingAmountMinor: null,
    refundState: "partial_final",
    reviewOperationStatus: "cancelled",
  };
}

function refundAmount(state: RefundState) {
  if (
    state.paymentProvider !== "lemon_squeezy" ||
    !state.providerRefundReady ||
    state.capturedAmountMinor === null
  ) {
    throw new Error("refund_provider_terms_unavailable");
  }
  const amount = state.capturedAmountMinor - state.successfulRefundAmountMinor;
  if (amount <= 0) throw new Error("refund_amount_unavailable");
  return amount;
}

async function loadRefundOrder(orderId: string, db: DatabaseQueryClient) {
  return (
    await db.query<RefundOrderRow>(
      `select user_id, product_family, status, payment_provider, provider_order_id,
         captured_amount_minor, successful_refund_amount_minor, refund_state,
         refund_remaining_amount_minor,
         (select operation.reason from trip_pass_refund_operations operation
          where operation.order_id = trip_pass_orders.id
            and operation.provider_order_id = trip_pass_orders.provider_order_id
            and operation.status in ('pending', 'running')
          order by operation.created_at, operation.id limit 1) as active_refund_operation_reason,
         (select operation.status from trip_pass_refund_operations operation
          where operation.order_id = trip_pass_orders.id
            and operation.provider_order_id = trip_pass_orders.provider_order_id
            and operation.status in ('pending', 'running')
          order by operation.created_at, operation.id limit 1) as active_refund_operation_status,
         (select operation.status from trip_pass_refund_operations operation
          where operation.order_id = trip_pass_orders.id
            and operation.reason = 'partial_refund_deadline'
          order by operation.created_at desc, operation.id desc limit 1) as review_operation_status
       from trip_pass_orders where id = $1`,
      [orderId],
    )
  ).rows[0];
}

async function loadRefundState(orderId: string, db: DatabaseQueryClient): Promise<RefundState> {
  const order = await loadRefundOrder(orderId, db);
  if (!order) throw new Error("operator_refund_order_unavailable");
  const access = await db.query<{ meter_used: number | string; pass_count: number | string }>(
    `select count(distinct p.id)::int as pass_count, coalesce(sum(m.used), 0)::int as meter_used
     from trip_pass_orders o
     left join trip_pass_grants g on g.order_id = o.id
     left join trip_passes p on p.id = g.trip_pass_id
     left join trip_usage_meters m on m.trip_pass_id = p.id
     where o.id = $1`,
    [orderId],
  );
  return {
    activeRefundOperationReason: order.active_refund_operation_reason,
    activeRefundOperationStatus: order.active_refund_operation_status,
    capturedAmountMinor: order.captured_amount_minor,
    meterUsed: Number(access.rows[0]?.meter_used ?? 0),
    orderStatus: order.status,
    passCount: Number(access.rows[0]?.pass_count ?? 0),
    paymentProvider: order.payment_provider,
    providerRefundReady:
      order.payment_provider === "lemon_squeezy" && Boolean(order.provider_order_id),
    refundRemainingAmountMinor: order.refund_remaining_amount_minor,
    reviewOperationStatus: order.review_operation_status,
    refundState: order.refund_state,
    successfulRefundAmountMinor: Number(order.successful_refund_amount_minor),
  };
}

function refundPreviewDigest(
  input: { decision: OperatorRefundDecision; orderId: string },
  state: { before: RefundState; after: Record<string, unknown> },
) {
  return sha256(
    JSON.stringify({
      decision: input.decision,
      orderId: input.orderId,
      ...state,
    }),
  );
}

async function loadReplay(
  accountId: string,
  idempotencyHash: string,
  commandHash: string,
  db: DatabaseQueryClient,
) {
  const result = await db.query<{
    after_state: Record<string, unknown>;
    command_hash: string;
    id: string;
  }>(
    `select id, command_hash, after_state from operator_refund_actions
     where operator_account_id = $1 and idempotency_key_hash = $2`,
    [accountId, idempotencyHash],
  );
  if (!result.rows[0]) return null;
  if (result.rows[0].command_hash !== commandHash) {
    throw new Error("operator_refund_idempotency_mismatch");
  }
  return {
    actionId: result.rows[0].id,
    after: result.rows[0].after_state,
    status: "replayed" as const,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
