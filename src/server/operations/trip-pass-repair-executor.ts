import Stripe from "stripe";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import type {
  AuthoritativeCommerceReader,
  AuthoritativePaymentFact,
} from "@/server/operations/live-reconciliation";
import type {
  PreparedRepairAction,
  RepairActionContext,
  RepairActionDispatcher,
  RepairFinding,
  RepairStateChange,
} from "@/server/operations/repair-actions";
import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";
import { initializeTripPassMeters, tripPassMeterLimits } from "@/server/payments/trip-pass";
import { grantTripPass } from "@/server/trip-pass/entitlement";
import {
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
} from "@/server/trip-pass/payment-lifecycle";

export function createTripPassRepairActionDispatcher(dependencies: {
  commerceReader: AuthoritativeCommerceReader;
}): RepairActionDispatcher<RepairActionType> {
  const actions = createTripPassRepairActions(dependencies);
  const actionTypes = Object.keys(actions) as [RepairActionType, ...RepairActionType[]];

  return {
    actionTypes,
    prepareExecution({ actionType, ...context }) {
      return actions[actionType].prepareExecution(context);
    },
    preview({ actionType, ...context }) {
      return actions[actionType].preview(context);
    },
  };
}

export type RepairActionType = keyof ReturnType<typeof createTripPassRepairActions>;

export const tripPassRepairActionDispatcher = createTripPassRepairActionDispatcher({
  commerceReader: createProductionCommerceReader(),
});

export const repairActionTypes = tripPassRepairActionDispatcher.actionTypes;

function createTripPassRepairActions(dependencies: {
  commerceReader: AuthoritativeCommerceReader;
}) {
  return {
    account_recovery: closureOperationRetryAction(),
    goodwill_grant: goodwillGrantAction(dependencies.commerceReader),
    grant_missing_trip_pass: grantMissingTripPassAction(dependencies.commerceReader),
    initialize_missing_meters: initializeMissingMetersAction(),
    manual_commerce_transition: manualCommerceTransitionAction(dependencies.commerceReader),
    release_stale_reservation: releaseStaleReservationAction(),
    refund_trip_pass: refundTripPassAction(),
  };
}

type TripPassRepairAction = {
  prepareExecution(input: RepairActionContext): Promise<PreparedRepairAction>;
  preview(input: RepairActionContext): Promise<RepairStateChange>;
};

type RepairActionImplementation = {
  apply(input: RepairActionContext): Promise<Record<string, unknown>>;
  preview(input: RepairActionContext): Promise<RepairStateChange>;
  supports(finding: RepairFinding): boolean;
};

function grantMissingTripPassAction(
  commerceReader: AuthoritativeCommerceReader,
): TripPassRepairAction {
  return authoritativeRepairAction(commerceReader, {
    proof: { allowedPaymentStates: ["paid"], requiresPaymentIntent: true },
    supports: (finding) => finding.kind === "paid_without_pass",
    async preview({ db, finding }) {
      const state = await loadOrderGrantState(finding.local_entity_ref, db);
      return {
        before: state,
        after: { grantCount: Math.max(state.grantCount, 1), orderStatus: state.orderStatus },
      };
    },
    async apply({ db, finding }) {
      const order = await db.query<{ user_id: string | null }>(
        "select user_id from trip_pass_orders where id = $1",
        [finding.local_entity_ref],
      );
      const accountId = order.rows[0]?.user_id;
      if (!accountId) throw new Error("repair_order_owner_unavailable");
      const result = await grantTripPass(
        {
          now: await databaseClock(db),
          orderId: finding.local_entity_ref,
          sourceEventId: `repair:${finding.id}`,
          sourceType: "manual_operator",
          userId: accountId,
        },
        db,
      );
      // The state read must follow the grant transaction's commit.
      return {
        ...(await loadOrderGrantState(finding.local_entity_ref, db)),
        result: result.status,
      };
    },
  });
}

function initializeMissingMetersAction(): TripPassRepairAction {
  return localRepairAction({
    supports: (finding) => finding.kind === "missing_usage_meters",
    async lock({ db, finding }) {
      await lockEntity("trip_passes", finding.local_entity_ref, db);
    },
    async preview({ db, finding }) {
      const state = await loadPassMeterState(finding.local_entity_ref, db);
      return {
        before: state,
        after: {
          meterCount: Object.keys(tripPassMeterLimits).length,
          passStatus: state.passStatus,
        },
      };
    },
    async apply({ db, finding }) {
      const pass = await db.query<{ expires_at: Date | string }>(
        "select expires_at from trip_passes where id = $1",
        [finding.local_entity_ref],
      );
      if (!pass.rows[0]) throw new Error("repair_trip_pass_unavailable");
      await initializeTripPassMeters(
        {
          meterLimits: tripPassMeterLimits,
          now: await databaseClock(db),
          resetAt: new Date(pass.rows[0].expires_at),
          tripPassId: finding.local_entity_ref,
        },
        db,
      );
      return loadPassMeterState(finding.local_entity_ref, db);
    },
  });
}

function releaseStaleReservationAction(): TripPassRepairAction {
  return localRepairAction({
    supports: (finding) => finding.kind === "stale_usage_reservation",
    async lock({ db, finding }) {
      await lockEntity("trip_usage_events", finding.local_entity_ref, db);
    },
    async preview({ db, finding }) {
      const state = await loadUsageEventState(finding.local_entity_ref, db);
      return { before: state, after: { eventType: "released" } };
    },
    async apply({ db, finding }) {
      await db.query(
        `update trip_usage_events set event_type = 'released', occurred_at = clock_timestamp()
         where id = $1 and event_type = 'reserved'`,
        [finding.local_entity_ref],
      );
      return loadUsageEventState(finding.local_entity_ref, db);
    },
  });
}

function refundTripPassAction(): TripPassRepairAction {
  return localRepairAction({
    supports: (finding) =>
      finding.kind === "refund_required" &&
      finding.summary_code === "manual_refund_required" &&
      finding.local_entity_type === "trip_pass_order",
    async lock({ db, finding }) {
      await lockOrderAccount(finding.local_entity_ref, db);
    },
    async preview({ db, finding }) {
      const state = await loadRefundState(finding.local_entity_ref, db);
      if (
        state.paymentProvider !== "lemon_squeezy" ||
        !state.providerOrderId ||
        state.capturedAmountMinor === null
      ) {
        throw new Error("refund_provider_terms_unavailable");
      }
      return {
        before: state,
        after: { ...state, operation: "queued", amountMinor: state.capturedAmountMinor },
      };
    },
    async apply({ db, finding }) {
      const state = await loadRefundState(finding.local_entity_ref, db);
      if (
        state.paymentProvider !== "lemon_squeezy" ||
        !state.providerOrderId ||
        state.capturedAmountMinor === null
      ) {
        throw new Error("refund_provider_terms_unavailable");
      }
      const idempotencyKey = `operator_refund:${finding.id}`;
      await db.query(
        `insert into trip_pass_refund_operations (
          id, order_id, provider, provider_order_id, reason, amount_minor,
          provider_captured_amount_minor, idempotency_key, created_at, updated_at
        ) values ($1, $2, 'lemon_squeezy', $3, 'operator_refund', $4, $4, $5, clock_timestamp(), clock_timestamp())
        on conflict (idempotency_key) do nothing`,
        [
          `refund_operation_${finding.id}`,
          finding.local_entity_ref,
          state.providerOrderId,
          state.capturedAmountMinor,
          idempotencyKey,
        ],
      );
      return { ...state, operation: "queued", amountMinor: state.capturedAmountMinor };
    },
  });
}

function manualCommerceTransitionAction(
  commerceReader: AuthoritativeCommerceReader,
): TripPassRepairAction {
  return authoritativeRepairAction(commerceReader, {
    proof: {
      allowedPaymentStates: ["pending", "unpaid"],
      requiresPaymentIntent: false,
    },
    supports: (finding) =>
      finding.kind === "payment_state_mismatch" &&
      finding.summary_code === "authoritative_payment_terms_mismatch" &&
      finding.local_entity_type === "trip_pass_order",
    async preview({ db, finding }) {
      const state = await loadManualTransitionState(finding.local_entity_ref, db);
      assertManualTransitionAllowed(state);
      return {
        before: publicOrderRepairState(state),
        after: { ...publicOrderRepairState(state), status: "failed" },
      };
    },
    async apply({ db, finding }) {
      const state = await lockOrderAccount(finding.local_entity_ref, db);
      assertManualTransitionAllowed(state);
      const updated = await db.query<{ id: string }>(
        `update trip_pass_orders set status = 'failed', completed_at = clock_timestamp(),
           lifecycle_updated_at = clock_timestamp(), updated_at = clock_timestamp()
         where id = $1 and status in ('pending', 'checkout_created')
         returning id`,
        [finding.local_entity_ref],
      );
      if (!updated.rows[0]) throw new Error("manual_transition_state_changed");
      return publicOrderRepairState(await loadManualTransitionState(finding.local_entity_ref, db));
    },
  });
}

function goodwillGrantAction(commerceReader: AuthoritativeCommerceReader): TripPassRepairAction {
  return authoritativeRepairAction(commerceReader, {
    proof: { allowedPaymentStates: ["paid"], requiresPaymentIntent: true },
    supports: (finding) =>
      finding.kind === "provider_application_failed" &&
      finding.local_entity_type === "trip_pass_order",
    async preview({ db, finding }) {
      const state = await loadManualTransitionState(finding.local_entity_ref, db);
      assertGoodwillGrantAllowed(state);
      return {
        before: publicOrderRepairState(state),
        after: { ...publicOrderRepairState(state), grantCount: 1, passStatus: "active" },
      };
    },
    async apply({ db, finding }) {
      const state = await lockOrderAccount(finding.local_entity_ref, db);
      assertGoodwillGrantAllowed(state);
      const result = await grantTripPass(
        {
          now: await databaseClock(db),
          orderId: finding.local_entity_ref,
          sourceEventId: `goodwill:${finding.id}`,
          sourceType: "manual_operator",
          userId: state.accountId,
        },
        db,
      );
      return {
        ...publicOrderRepairState(await loadManualTransitionState(finding.local_entity_ref, db)),
        passStatus: result.pass.status,
        result: result.status,
      };
    },
  });
}

function closureOperationRetryAction(): TripPassRepairAction {
  return localRepairAction({
    supports: (finding) =>
      finding.kind === "privacy_cleanup_failed" &&
      finding.local_entity_type === "closure_operation",
    async lock({ db, finding }) {
      await lockEntity("account_closure_operations", finding.local_entity_ref, db);
    },
    async preview({ db, finding }) {
      const state = await loadClosureOperationState(finding.local_entity_ref, db);
      if (state.status !== "failed") throw new Error("closure_operation_retry_not_allowed");
      return { before: state, after: { ...state, lastErrorCode: null, status: "pending" } };
    },
    async apply({ db, finding }) {
      const state = await loadClosureOperationState(finding.local_entity_ref, db);
      if (state.status !== "failed") throw new Error("closure_operation_retry_not_allowed");
      const tombstone = await db.query<{ subject_hash: string }>(
        `select t.subject_hash from account_closure_operations o
         join account_closure_tombstones t on t.id = o.tombstone_id
         where o.id = $1 for update of o`,
        [finding.local_entity_ref],
      );
      if (!tombstone.rows[0]) throw new Error("closure_operation_retry_unavailable");
      const updated = await db.query<{ id: string }>(
        `update account_closure_operations set status = 'pending', next_attempt_at = clock_timestamp(),
           last_error_code = null, completed_at = null, updated_at = clock_timestamp()
         where id = $1 and status = 'failed' returning id`,
        [finding.local_entity_ref],
      );
      if (!updated.rows[0]) throw new Error("closure_operation_retry_state_changed");
      return loadClosureOperationState(finding.local_entity_ref, db);
    },
  });
}

function authoritativeRepairAction(
  commerceReader: AuthoritativeCommerceReader,
  implementation: RepairActionImplementation & {
    proof: {
      allowedPaymentStates: readonly AuthoritativePaymentFact["paymentState"][];
      requiresPaymentIntent: boolean;
    };
  },
): TripPassRepairAction {
  return {
    async preview(input) {
      assertSupportedRepair(implementation, input.finding);
      return implementation.preview(input);
    },
    async prepareExecution(input) {
      assertSupportedRepair(implementation, input.finding);
      const proof = await prepareAuthoritativeProof(input, commerceReader);
      return preparedRepairAction(
        input,
        {
          ...implementation,
          async lock({ db, finding }) {
            await lockOrderAccount(finding.local_entity_ref, db);
          },
        },
        async (context) => {
          await assertAuthoritativeProof(implementation.proof, context.finding, proof, context.db);
        },
      );
    },
  };
}

function localRepairAction(
  implementation: RepairActionImplementation & {
    lock(input: RepairActionContext): Promise<void>;
  },
): TripPassRepairAction {
  return {
    async preview(input) {
      assertSupportedRepair(implementation, input.finding);
      return implementation.preview(input);
    },
    async prepareExecution(input) {
      assertSupportedRepair(implementation, input.finding);
      return preparedRepairAction(input, implementation);
    },
  };
}

function preparedRepairAction(
  preparedContext: RepairActionContext,
  implementation: RepairActionImplementation & {
    lock(input: RepairActionContext): Promise<void>;
  },
  validate?: (input: RepairActionContext) => Promise<void>,
): PreparedRepairAction {
  return {
    async executeInTransaction({ db, finding, lockFindingOrReplay, reserveRepairAction }) {
      assertSameFinding(preparedContext.finding, finding);
      assertSupportedRepair(implementation, finding);
      await implementation.lock({ db, finding });
      const locked = await lockFindingOrReplay();
      if (locked.status === "replayed") return locked;
      const context = { db, finding: locked.finding };
      assertSameFinding(finding, context.finding);
      assertSupportedRepair(implementation, context.finding);
      await validate?.(context);
      const preview = await implementation.preview(context);
      const decision = await reserveRepairAction(context.finding, preview);
      if (decision.status === "replayed") return decision;
      await validate?.(context);
      const after = await implementation.apply(context);
      return { actionId: decision.actionId, after, status: "applied" };
    },
  };
}

function assertSupportedRepair(implementation: RepairActionImplementation, finding: RepairFinding) {
  if (!implementation.supports(finding)) {
    throw new Error("unsupported_repair_action_for_finding");
  }
}

function assertSameFinding(expected: RepairFinding, actual: RepairFinding) {
  if (expected.id !== actual.id || expected.local_entity_ref !== actual.local_entity_ref) {
    throw new Error("repair_finding_changed");
  }
}

async function prepareAuthoritativeProof(
  { db, finding }: RepairActionContext,
  commerceReader: AuthoritativeCommerceReader,
): Promise<PreparedAuthoritativeRepairProof> {
  if (finding.local_entity_type !== "trip_pass_order") {
    throw new Error("repair_authoritative_proof_unavailable");
  }
  const order = await loadAuthoritativeOrderState(finding.local_entity_ref, db);
  const fact = await commerceReader.readPaymentFact({
    checkoutSessionId: order.checkoutSessionId,
    paymentIntentId: order.paymentIntentId,
  });
  return {
    checkoutSessionId: order.checkoutSessionId,
    fact,
    findingId: finding.id,
    orderId: finding.local_entity_ref,
    paymentIntentId: order.paymentIntentId,
    version: "stripe-payment-proof-v1",
  };
}

async function lockEntity(
  table: "account_closure_operations" | "trip_passes" | "trip_usage_events",
  entityId: string,
  db: DatabaseQueryClient,
) {
  const locked = await db.query<{ id: string }>(
    `select id from ${table} where id = $1 for update`,
    [entityId],
  );
  if (!locked.rows[0]) throw new Error("repair_lock_scope_changed");
}

type PreparedAuthoritativeRepairProof = {
  checkoutSessionId: string | null;
  fact: AuthoritativePaymentFact;
  findingId: string;
  orderId: string;
  paymentIntentId: string | null;
  version: "stripe-payment-proof-v1";
};

type ManualOrderRepairState = {
  accountId: string;
  eligiblePassCount: number;
  grantCount: number;
  productFamily: string;
  status: string;
};

async function loadManualTransitionState(
  orderId: string,
  db: DatabaseQueryClient,
): Promise<ManualOrderRepairState> {
  const result = await db.query<{
    grant_count: string | number;
    eligible_pass_count: string | number;
    product_family: string;
    status: string;
    user_id: string | null;
  }>(
    `select o.user_id, o.product_family, o.status, count(g.id)::text as grant_count,
       (select count(distinct active.id)::text
        from trip_passes active
        left join trip_pass_grants active_grant on active_grant.trip_pass_id = active.id
        left join trip_pass_orders active_order on active_order.id = active_grant.order_id
        where active.user_id = o.user_id
          and active.status in ('active', 'suspended')
          and active.expires_at > clock_timestamp()
          and coalesce(active_order.product_family, 'siargao_trip_pass') = o.product_family
       ) as eligible_pass_count
     from trip_pass_orders o left join trip_pass_grants g on g.order_id = o.id
     where o.id = $1 group by o.id`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row?.user_id) throw new Error("repair_order_owner_unavailable");
  return {
    accountId: row.user_id,
    eligiblePassCount: Number(row.eligible_pass_count),
    grantCount: Number(row.grant_count),
    productFamily: row.product_family,
    status: row.status,
  };
}

async function lockOrderAccount(orderId: string, db: DatabaseQueryClient) {
  const candidate = await loadManualTransitionState(orderId, db);
  await lockTripPassAccountFamily(candidate.accountId, candidate.productFamily, db);
  await lockTripPassAccountWrites(candidate.accountId, db);
  const locked = await db.query<{ product_family: string; user_id: string | null }>(
    "select user_id, product_family from trip_pass_orders where id = $1 for update",
    [orderId],
  );
  const row = locked.rows[0];
  if (row?.user_id !== candidate.accountId || row.product_family !== candidate.productFamily) {
    throw new Error("repair_lock_scope_changed");
  }
  return loadManualTransitionState(orderId, db);
}

function assertManualTransitionAllowed(state: ManualOrderRepairState) {
  if (!new Set(["pending", "checkout_created"]).has(state.status) || state.grantCount !== 0) {
    throw new Error("manual_transition_not_allowed");
  }
}

function assertGoodwillGrantAllowed(state: ManualOrderRepairState) {
  if (state.status !== "paid" || state.grantCount !== 0 || state.eligiblePassCount !== 0) {
    throw new Error("goodwill_grant_not_allowed");
  }
}

function publicOrderRepairState(state: ManualOrderRepairState) {
  return { grantCount: state.grantCount, status: state.status };
}

async function loadClosureOperationState(operationId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ last_error_code: string | null; status: string }>(
    "select status, last_error_code from account_closure_operations where id = $1",
    [operationId],
  );
  if (!result.rows[0]) throw new Error("closure_operation_retry_unavailable");
  return {
    lastErrorCode: result.rows[0].last_error_code,
    status: result.rows[0].status,
  };
}

async function loadOrderGrantState(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ grant_count: string | number; status: string }>(
    `select o.status, count(g.id)::text as grant_count from trip_pass_orders o
     left join trip_pass_grants g on g.order_id = o.id
     where o.id = $1 group by o.id`,
    [orderId],
  );
  if (!result.rows[0]) throw new Error("repair_order_unavailable");
  return { grantCount: Number(result.rows[0].grant_count), orderStatus: result.rows[0].status };
}

async function loadPassMeterState(passId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ meter_count: string | number; status: string }>(
    `select p.status, count(m.id)::text as meter_count from trip_passes p
     left join trip_usage_meters m on m.trip_pass_id = p.id
     where p.id = $1 group by p.id`,
    [passId],
  );
  if (!result.rows[0]) throw new Error("repair_trip_pass_unavailable");
  return { meterCount: Number(result.rows[0].meter_count), passStatus: result.rows[0].status };
}

async function loadUsageEventState(eventId: string, db: DatabaseQueryClient) {
  const result = await db.query<{ event_type: string }>(
    "select event_type from trip_usage_events where id = $1",
    [eventId],
  );
  if (!result.rows[0]) throw new Error("repair_usage_event_unavailable");
  return { eventType: result.rows[0].event_type };
}

async function loadRefundState(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<{
    status: string;
    payment_provider: string;
    provider_order_id: string | null;
    captured_amount_minor: number | null;
    currency: string | null;
  }>(
    `select status, payment_provider, provider_order_id, captured_amount_minor, currency
     from trip_pass_orders where id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("refund_order_unavailable");
  return {
    status: row.status,
    paymentProvider: row.payment_provider,
    providerOrderId: row.provider_order_id,
    capturedAmountMinor: row.captured_amount_minor,
    currency: row.currency,
  };
}

async function databaseClock(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  return new Date(result.rows[0]?.now ?? Date.now());
}

async function assertAuthoritativeProof(
  policy: {
    allowedPaymentStates: readonly AuthoritativePaymentFact["paymentState"][];
    requiresPaymentIntent: boolean;
  },
  finding: RepairFinding,
  value: PreparedAuthoritativeRepairProof,
  db: DatabaseQueryClient,
) {
  const local = await loadAuthoritativeOrderState(finding.local_entity_ref, db);
  if (
    value.findingId !== finding.id ||
    value.orderId !== finding.local_entity_ref ||
    value.checkoutSessionId !== local.checkoutSessionId ||
    value.paymentIntentId !== local.paymentIntentId
  ) {
    throw new Error("repair_authoritative_identity_changed");
  }
  if (policy.requiresPaymentIntent && value.paymentIntentId === null) {
    throw new Error("repair_authoritative_proof_unavailable");
  }
  if (
    value.fact.amountMinor !== local.amountMinor ||
    value.fact.currency?.toLowerCase() !== local.currency.toLowerCase()
  ) {
    throw new Error("repair_authoritative_terms_changed");
  }
  if (!policy.allowedPaymentStates.includes(value.fact.paymentState)) {
    throw new Error("repair_authoritative_state_changed");
  }
}

async function loadAuthoritativeOrderState(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<{
    amount_total_minor: number;
    currency: string;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
  }>(
    `select amount_total_minor, currency, stripe_checkout_session_id, stripe_payment_intent_id
     from trip_pass_orders where id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("repair_order_unavailable");
  return {
    amountMinor: row.amount_total_minor,
    checkoutSessionId: row.stripe_checkout_session_id,
    currency: row.currency,
    paymentIntentId: row.stripe_payment_intent_id,
  };
}

function createProductionCommerceReader(): AuthoritativeCommerceReader {
  return {
    async readPaymentFact(input) {
      const apiKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;
      if (!apiKey) throw new Error("stripe_configuration_unavailable");
      return createStripeCommerceReader(new Stripe(apiKey)).readPaymentFact(input);
    },
  };
}
