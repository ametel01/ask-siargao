import type { LocalRepairExecutor } from "@/server/operations/repair-actions";
import { initializeTripPassMeters, tripPassMeterLimits } from "@/server/payments/trip-pass";
import { grantTripPass } from "@/server/trip-pass/entitlement";

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
    throw new Error("unsupported_repair_action_for_finding");
  },
};

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
