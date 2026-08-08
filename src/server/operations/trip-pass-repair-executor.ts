import type { LocalRepairExecutor } from "@/server/operations/repair-actions";
import { initializeTripPassMeters, tripPassMeterLimits } from "@/server/payments/trip-pass";
import { grantTripPass } from "@/server/trip-pass/entitlement";
import {
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
} from "@/server/trip-pass/payment-lifecycle";

export const tripPassLocalRepairExecutor: LocalRepairExecutor = {
  async preview({ actionType, db, finding }) {
    if (actionType === "grant_missing_trip_pass" && finding.kind === "paid_without_pass") {
      const state = await loadOrderGrantState(finding.local_entity_ref, db);
      return {
        before: state,
        after: { grantCount: Math.max(state.grantCount, 1), orderStatus: state.orderStatus },
      };
    }
    if (actionType === "initialize_missing_meters" && finding.kind === "missing_usage_meters") {
      const state = await loadPassMeterState(finding.local_entity_ref, db);
      return {
        before: state,
        after: {
          meterCount: Object.keys(tripPassMeterLimits).length,
          passStatus: state.passStatus,
        },
      };
    }
    if (actionType === "release_stale_reservation" && finding.kind === "stale_usage_reservation") {
      const state = await loadUsageEventState(finding.local_entity_ref, db);
      return { before: state, after: { eventType: "released" } };
    }
    if (
      actionType === "manual_commerce_transition" &&
      finding.kind === "payment_state_mismatch" &&
      finding.summary_code === "authoritative_payment_terms_mismatch" &&
      finding.local_entity_type === "trip_pass_order"
    ) {
      const state = await loadManualTransitionState(finding.local_entity_ref, db);
      assertManualTransitionAllowed(state);
      return {
        before: publicOrderRepairState(state),
        after: { ...publicOrderRepairState(state), status: "failed" },
      };
    }
    if (
      actionType === "goodwill_grant" &&
      finding.kind === "provider_application_failed" &&
      finding.local_entity_type === "trip_pass_order"
    ) {
      const state = await loadManualTransitionState(finding.local_entity_ref, db);
      assertGoodwillGrantAllowed(state);
      return {
        before: publicOrderRepairState(state),
        after: { ...publicOrderRepairState(state), grantCount: 1, passStatus: "active" },
      };
    }
    if (
      actionType === "account_recovery" &&
      finding.kind === "privacy_cleanup_failed" &&
      finding.local_entity_type === "closure_operation"
    ) {
      const state = await loadClosureOperationState(finding.local_entity_ref, db);
      if (state.status !== "failed") throw new Error("account_recovery_not_retryable");
      return { before: state, after: { ...state, lastErrorCode: null, status: "pending" } };
    }
    throw new Error("unsupported_repair_action_for_finding");
  },
  async apply({ actionType, db, finding }) {
    if (actionType === "grant_missing_trip_pass" && finding.kind === "paid_without_pass") {
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
      const after = await loadOrderGrantState(finding.local_entity_ref, db);
      return { ...after, result: result.status };
    }
    if (actionType === "initialize_missing_meters" && finding.kind === "missing_usage_meters") {
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
    }
    if (actionType === "release_stale_reservation" && finding.kind === "stale_usage_reservation") {
      await db.query(
        `update trip_usage_events set event_type = 'released', occurred_at = clock_timestamp()
         where id = $1 and event_type = 'reserved'`,
        [finding.local_entity_ref],
      );
      return loadUsageEventState(finding.local_entity_ref, db);
    }
    if (
      actionType === "manual_commerce_transition" &&
      finding.kind === "payment_state_mismatch" &&
      finding.summary_code === "authoritative_payment_terms_mismatch" &&
      finding.local_entity_type === "trip_pass_order"
    ) {
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
    }
    if (
      actionType === "goodwill_grant" &&
      finding.kind === "provider_application_failed" &&
      finding.local_entity_type === "trip_pass_order"
    ) {
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
    }
    if (
      actionType === "account_recovery" &&
      finding.kind === "privacy_cleanup_failed" &&
      finding.local_entity_type === "closure_operation"
    ) {
      const state = await loadClosureOperationState(finding.local_entity_ref, db);
      if (state.status !== "failed") throw new Error("account_recovery_not_retryable");
      const tombstone = await db.query<{ subject_hash: string }>(
        `select t.subject_hash from account_closure_operations o
         join account_closure_tombstones t on t.id = o.tombstone_id
         where o.id = $1 for update of o`,
        [finding.local_entity_ref],
      );
      if (!tombstone.rows[0]) throw new Error("account_recovery_operation_unavailable");
      const updated = await db.query<{ id: string }>(
        `update account_closure_operations set status = 'pending', next_attempt_at = clock_timestamp(),
           last_error_code = null, completed_at = null, updated_at = clock_timestamp()
         where id = $1 and status = 'failed' returning id`,
        [finding.local_entity_ref],
      );
      if (!updated.rows[0]) throw new Error("account_recovery_state_changed");
      return loadClosureOperationState(finding.local_entity_ref, db);
    }
    throw new Error("unsupported_repair_action_for_finding");
  },
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
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
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

async function lockOrderAccount(
  orderId: string,
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
) {
  const candidate = await loadManualTransitionState(orderId, db);
  await lockTripPassAccountFamily(candidate.accountId, candidate.productFamily, db);
  await lockTripPassAccountWrites(candidate.accountId, db);
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

async function loadClosureOperationState(
  operationId: string,
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
) {
  const result = await db.query<{ last_error_code: string | null; status: string }>(
    "select status, last_error_code from account_closure_operations where id = $1",
    [operationId],
  );
  if (!result.rows[0]) throw new Error("account_recovery_operation_unavailable");
  return {
    lastErrorCode: result.rows[0].last_error_code,
    status: result.rows[0].status,
  };
}

async function loadOrderGrantState(
  orderId: string,
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
) {
  const result = await db.query<{ grant_count: string | number; status: string }>(
    `select o.status, count(g.id)::text as grant_count from trip_pass_orders o
     left join trip_pass_grants g on g.order_id = o.id
     where o.id = $1 group by o.id`,
    [orderId],
  );
  if (!result.rows[0]) throw new Error("repair_order_unavailable");
  return { grantCount: Number(result.rows[0].grant_count), orderStatus: result.rows[0].status };
}

async function loadPassMeterState(
  passId: string,
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
) {
  const result = await db.query<{ meter_count: string | number; status: string }>(
    `select p.status, count(m.id)::text as meter_count from trip_passes p
     left join trip_usage_meters m on m.trip_pass_id = p.id
     where p.id = $1 group by p.id`,
    [passId],
  );
  if (!result.rows[0]) throw new Error("repair_trip_pass_unavailable");
  return { meterCount: Number(result.rows[0].meter_count), passStatus: result.rows[0].status };
}

async function loadUsageEventState(
  eventId: string,
  db: Parameters<LocalRepairExecutor["preview"]>[0]["db"],
) {
  const result = await db.query<{ event_type: string }>(
    "select event_type from trip_usage_events where id = $1",
    [eventId],
  );
  if (!result.rows[0]) throw new Error("repair_usage_event_unavailable");
  return { eventType: result.rows[0].event_type };
}

async function databaseClock(db: Parameters<LocalRepairExecutor["preview"]>[0]["db"]) {
  const result = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  return new Date(result.rows[0]?.now ?? Date.now());
}
