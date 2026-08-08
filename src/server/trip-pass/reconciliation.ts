import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { trackServerEvent } from "@/server/observability/events";
import { tripPassMeterTypes } from "@/server/payments/trip-pass";
import {
  readTripPassEnvironment,
  type TripPassMeterType,
  tripPassProductCode,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";

const defaultStaleOrderMs = 30 * 60 * 1000;
const defaultStaleReservationMs = 10 * 60 * 1000;
const reconciliationPageSize = 500;

export type TripPassReconciliationMode = "dry_run" | "repair";

export type TripPassReconciliationScope = {
  orderId?: string;
  passId?: string;
  userId?: string;
};

export type TripPassIssueSeverity = "info" | "warning" | "repairable" | "blocked";

export type TripPassDiagnosticIssue = {
  code:
    | "stuck_pending_order"
    | "paid_without_pass"
    | "duplicate_order_grants"
    | "revoked_or_suspended_pass"
    | "missing_usage_meters"
    | "usage_meter_aggregate_mismatch"
    | "stale_usage_reservation"
    | "paid_answer_usage_event_missing"
    | "provider_usage_missing_request_id"
    | "provider_usage_duplicate_request_id"
    | "price_catalog_mismatch"
    | "store_unavailable"
    | "analytics_sink_unavailable"
    | "cost_circuit_unconfigured";
  severity: TripPassIssueSeverity;
  localRef: string;
  reason: string;
  repairable: boolean;
  details?: Record<string, string | number | boolean | null>;
};

export type TripPassRepairAction = {
  action: "grant_missing_trip_pass" | "initialize_missing_meters" | "release_stale_reservation";
  localRef: string;
  status: "planned" | "applied" | "skipped" | "failed";
  reason: string;
};

export type TripPassReconciliationSnapshot = {
  generatedAt: string;
  mode: TripPassReconciliationMode;
  scope: TripPassReconciliationScope;
  thresholds: {
    staleOrderMinutes: number;
    staleReservationMinutes: number;
  };
  infrastructure: {
    analyticsSink: "available" | "unavailable";
    sharedQuotaStore: "available" | "unavailable";
    costCircuits: {
      deepseek: "configured" | "unconfigured";
      openai: "configured" | "unconfigured";
      global: "configured" | "unconfigured";
    };
    priceCatalog: {
      productCode: string;
      productVersion: number;
      stripePriceConfigured: boolean;
    };
  };
  issues: TripPassDiagnosticIssue[];
  actions: TripPassRepairAction[];
};

export type TripPassSupportLookupResult =
  | {
      status: "found";
      referenceType: "order" | "pass" | "user";
      summary: {
        orderRefs: string[];
        passRefs: string[];
        userRef: string | null;
        statuses: string[];
        meterSummary: Array<{
          meterType: TripPassMeterType;
          used: number;
          limit: number;
          reserved: number;
        }>;
      };
    }
  | { status: "not_found"; reason: "reference_not_found" }
  | { status: "forbidden"; reason: "cross_user_reference" }
  | { status: "ambiguous"; reason: "references_do_not_match_same_trip_pass_account" }
  | { status: "invalid"; reason: "lookup_reference_required" };

type ReconciliationOptions = {
  db?: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now?: Date;
  scope?: TripPassReconciliationScope;
  staleOrderMs?: number;
  staleReservationMs?: number;
};

type ReconcileOptions = ReconciliationOptions & {
  confirmMutation?: boolean;
  mode?: TripPassReconciliationMode;
};

type TripPassOrderRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  status: string;
  product_code: string;
  product_version: number;
  stripe_price_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

type PaidWithoutPassRow = TripPassOrderRow & {
  grant_count: string | number;
  pass_count: string | number;
};

type DuplicateGrantRow = {
  order_id: string;
  grant_count: string | number;
  user_count: string | number;
};

type PassRow = {
  id: string;
  user_id: string | null;
  status: string;
  starts_at: Date | string;
  expires_at: Date | string;
};

type MissingMeterRow = PassRow & {
  meter_count: string | number;
  expected_meter_count: string | number;
};

type MeterAggregateRow = {
  trip_pass_id: string;
  meter_type: string;
  used: number;
  settled_quantity: string | number | null;
};

type UsageEventRow = {
  id: string;
  trip_pass_id: string;
  usage_meter_id: string | null;
  user_id: string | null;
  event_type: string;
  meter_type: string;
  quantity: number;
  idempotency_key: string;
  request_id: string | null;
  request_hash: string | null;
  provider_request_ids_json: string[] | string;
  occurred_at: Date | string;
  paid_answer_reservation_id: string | null;
  paid_answer_reservation_status: string | null;
  paid_answer_details_purged_at: Date | string | null;
};

type SettledPaidAnswerIntegrityRow = {
  id: string;
  trip_pass_id: string;
  usage_meter_id: string;
  exact_event_id: string | null;
  candidate_event_ids_json: string[] | string;
};

type MeterSummaryRow = {
  meter_type: string;
  used: number;
  limit: number;
  reserved: string | number | null;
};

export async function buildTripPassReconciliationSnapshot(
  options: ReconciliationOptions = {},
): Promise<TripPassReconciliationSnapshot> {
  return reconcileTripPassState({ ...options, mode: "dry_run", confirmMutation: false });
}

export async function reconcileTripPassState(
  options: ReconcileOptions = {},
): Promise<TripPassReconciliationSnapshot> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = options.now ?? new Date();
  const staleOrderMs = options.staleOrderMs ?? defaultStaleOrderMs;
  const staleReservationMs = options.staleReservationMs ?? defaultStaleReservationMs;
  const scope = options.scope ?? {};
  const issues = await collectTripPassIssues({
    db,
    env: options.env,
    now,
    scope,
    staleOrderMs,
    staleReservationMs,
  });
  // Reconciliation is permanently detect-only. Historical `mode` and
  // `confirmMutation` inputs remain accepted during rolling deployment but are
  // intentionally ignored. Mutations belong to an audited Repair Action.
  const actions = await buildRepairActions({ db, issues, now });

  const snapshot = createSnapshot({
    actions,
    env: options.env,
    issues,
    mode: "dry_run",
    now,
    scope,
    staleOrderMs,
    staleReservationMs,
  });

  if (snapshot.issues.some((issue) => issue.severity === "blocked")) {
    trackServerEvent({
      name: "trip_pass_reconciliation_failed",
      payload: { reason: "blocked_reconciliation_issue", status: "blocked" },
    });
  }

  return snapshot;
}

export async function lookupTripPassSupportReference(
  input: TripPassReconciliationScope,
  options: { db?: DatabaseQueryClient } = {},
): Promise<TripPassSupportLookupResult> {
  if (!input.orderId && !input.passId && !input.userId) {
    return { status: "invalid", reason: "lookup_reference_required" };
  }

  const db = options.db ?? getDefaultDatabaseQueryClient();
  const [orders, passes] = await Promise.all([
    loadSupportOrders(input, db),
    loadSupportPasses(input, db),
  ]);
  const userRefs = new Set<string>();
  for (const order of orders) {
    if (order.user_id) {
      userRefs.add(order.user_id);
    }
  }
  for (const pass of passes) {
    if (pass.user_id) {
      userRefs.add(pass.user_id);
    }
  }

  if (input.userId && userRefs.size > 0 && !userRefs.has(input.userId)) {
    return { status: "forbidden", reason: "cross_user_reference" };
  }
  if (!input.userId && input.orderId && input.passId && userRefs.size > 1) {
    return { status: "ambiguous", reason: "references_do_not_match_same_trip_pass_account" };
  }
  if (orders.length === 0 && passes.length === 0) {
    return { status: "not_found", reason: "reference_not_found" };
  }

  const passRefs = [...new Set(passes.map((pass) => pass.id))];
  const meterSummary = passRefs.length > 0 ? await loadMeterSummary(passRefs, db) : [];
  const referenceType = input.orderId ? "order" : input.passId ? "pass" : "user";

  return {
    status: "found",
    referenceType,
    summary: {
      orderRefs: [...new Set(orders.map((order) => order.id))],
      passRefs,
      userRef: input.userId ?? [...userRefs][0] ?? null,
      statuses: [
        ...orders.map((order) => `order:${order.status}`),
        ...passes.map((pass) => `pass:${pass.status}`),
      ],
      meterSummary,
    },
  };
}

async function collectTripPassIssues(input: {
  db: DatabaseQueryClient;
  env: Record<string, string | undefined> | undefined;
  now: Date;
  scope: TripPassReconciliationScope;
  staleOrderMs: number;
  staleReservationMs: number;
}) {
  const staleOrderCutoff = new Date(input.now.getTime() - input.staleOrderMs);
  const staleReservationCutoff = new Date(input.now.getTime() - input.staleReservationMs);
  const issues: TripPassDiagnosticIssue[] = [];

  const [
    stuckOrders,
    paidWithoutPass,
    duplicateGrants,
    revokedPasses,
    missingMeters,
    aggregateMismatches,
    usageEvents,
    settledPaidAnswers,
    priceMismatches,
  ] = await Promise.all([
    loadStuckPendingOrders(input.db, input.scope, staleOrderCutoff),
    loadPaidOrdersWithoutPass(input.db, input.scope),
    loadDuplicateOrderGrants(input.db, input.scope),
    loadRevokedPasses(input.db, input.scope, input.now),
    loadPassesMissingMeters(input.db, input.scope),
    loadMeterAggregateMismatches(input.db, input.scope),
    loadUsageEvents(input.db, input.scope),
    loadSettledPaidAnswerIntegrity(input.db, input.scope),
    loadPriceCatalogMismatches(input.db, input.scope, input.env),
  ]);

  for (const order of stuckOrders) {
    issues.push({
      code: "stuck_pending_order",
      severity: "warning",
      localRef: order.id,
      reason: "checkout order is still pending after the local recovery window",
      repairable: false,
      details: {
        status: order.status,
        ageMinutes: ageMinutes(order.created_at, input.now),
      },
    });
  }

  for (const order of paidWithoutPass) {
    issues.push({
      code: "paid_without_pass",
      severity: order.user_id ? "repairable" : "blocked",
      localRef: order.id,
      reason: order.user_id
        ? "paid order has no linked Trip Pass grant"
        : "paid order has no authenticated owner for a safe grant",
      repairable: Boolean(order.user_id),
      details: {
        grants: toNumber(order.grant_count),
        passes: toNumber(order.pass_count),
      },
    });
  }

  for (const duplicate of duplicateGrants) {
    issues.push({
      code: "duplicate_order_grants",
      severity: "blocked",
      localRef: duplicate.order_id,
      reason: "one order has multiple grants and needs operator review",
      repairable: false,
      details: {
        grants: toNumber(duplicate.grant_count),
        distinctOwners: toNumber(duplicate.user_count),
      },
    });
  }

  for (const pass of revokedPasses) {
    issues.push({
      code: "revoked_or_suspended_pass",
      severity: "info",
      localRef: pass.id,
      reason: "pass is no longer active because it was refunded, cancelled, or expired",
      repairable: false,
      details: { status: pass.status },
    });
  }

  for (const pass of missingMeters) {
    issues.push({
      code: "missing_usage_meters",
      severity: "repairable",
      localRef: pass.id,
      reason: "pass is missing one or more usage meter rows",
      repairable: true,
      details: {
        meterCount: toNumber(pass.meter_count),
        expectedMeters: toNumber(pass.expected_meter_count),
      },
    });
  }

  for (const meter of aggregateMismatches) {
    issues.push({
      code: "usage_meter_aggregate_mismatch",
      severity: "blocked",
      localRef: `${meter.trip_pass_id}:${meter.meter_type}`,
      reason: "meter used count does not match settled usage-event quantity",
      repairable: false,
      details: {
        used: meter.used,
        settledQuantity: toNumber(meter.settled_quantity),
      },
    });
  }

  const paidAnswerIntegrity = paidAnswerUsageEventIssues(settledPaidAnswers);
  issues.push(...paidAnswerIntegrity.issues);
  issues.push(
    ...usageEventIssues(usageEvents, staleReservationCutoff, paidAnswerIntegrity.coveredEventRefs),
  );
  issues.push(...priceMismatches);
  issues.push(...infrastructureIssues(input.env));

  return issues;
}

async function buildRepairActions(input: {
  db: DatabaseQueryClient;
  issues: TripPassDiagnosticIssue[];
  now: Date;
}): Promise<TripPassRepairAction[]> {
  return Promise.all(
    input.issues.flatMap((issue) => {
      if (!issue.repairable) {
        return [];
      }
      if (issue.code === "paid_without_pass") {
        return [grantMissingTripPass(input.db, issue.localRef)];
      }
      if (issue.code === "missing_usage_meters") {
        return [initializeMissingMeters(issue.localRef)];
      }
      if (issue.code === "stale_usage_reservation") {
        return [releaseStaleReservation(issue.localRef)];
      }
      return [];
    }),
  );
}

async function grantMissingTripPass(
  db: DatabaseQueryClient,
  orderId: string,
): Promise<TripPassRepairAction> {
  const order = await loadOrderById(orderId, db);
  if (!order?.user_id) {
    return {
      action: "grant_missing_trip_pass",
      localRef: orderId,
      status: "skipped",
      reason: "order_missing_authenticated_owner",
    };
  }
  return {
    action: "grant_missing_trip_pass",
    localRef: orderId,
    status: "planned",
    reason: "repair_action_required_for_manual_grant",
  };
}

async function initializeMissingMeters(passId: string): Promise<TripPassRepairAction> {
  return {
    action: "initialize_missing_meters",
    localRef: passId,
    status: "planned",
    reason: "repair_action_required_for_missing_meters",
  };
}

async function releaseStaleReservation(eventId: string): Promise<TripPassRepairAction> {
  return {
    action: "release_stale_reservation",
    localRef: eventId,
    status: "planned",
    reason: "repair_action_required_for_stale_reservation",
  };
}

function createSnapshot(input: {
  actions: TripPassRepairAction[];
  env: Record<string, string | undefined> | undefined;
  issues: TripPassDiagnosticIssue[];
  mode: TripPassReconciliationMode;
  now: Date;
  scope: TripPassReconciliationScope;
  staleOrderMs: number;
  staleReservationMs: number;
}): TripPassReconciliationSnapshot {
  const environment = readTripPassEnvironment(input.env);
  return {
    generatedAt: input.now.toISOString(),
    mode: input.mode,
    scope: input.scope,
    thresholds: {
      staleOrderMinutes: Math.round(input.staleOrderMs / 60_000),
      staleReservationMinutes: Math.round(input.staleReservationMs / 60_000),
    },
    infrastructure: {
      analyticsSink: environment.analytics.status,
      sharedQuotaStore: environment.redis.status,
      costCircuits: {
        deepseek: environment.costBudgets.deepSeekDailyUsd === null ? "unconfigured" : "configured",
        openai: environment.costBudgets.openAiDailyUsd === null ? "unconfigured" : "configured",
        global: environment.costBudgets.globalDailyUsd === null ? "unconfigured" : "configured",
      },
      priceCatalog: {
        productCode: tripPassProductCode,
        productVersion: tripPassProductVersion,
        stripePriceConfigured: Boolean(environment.checkout.priceId),
      },
    },
    issues: input.issues,
    actions: input.actions,
  };
}

function usageEventIssues(
  events: UsageEventRow[],
  staleReservationCutoff: Date,
  paidAnswerIntegrityCoveredEventRefs: ReadonlySet<string> = new Set(),
): TripPassDiagnosticIssue[] {
  const issues: TripPassDiagnosticIssue[] = [];
  const providerEventRefs = new Map<string, string[]>();

  for (const event of events) {
    const providerRequestIds = parseProviderRequestIds(event.provider_request_ids_json);
    if (
      event.event_type === "reserved" &&
      new Date(event.occurred_at).getTime() < staleReservationCutoff.getTime()
    ) {
      issues.push({
        code: "stale_usage_reservation",
        severity: "repairable",
        localRef: event.id,
        reason: "reserved usage event exceeded the release window",
        repairable: true,
        details: {
          passRef: event.trip_pass_id,
          meterType: event.meter_type,
        },
      });
    }
    if (
      event.event_type === "settled" &&
      providerRequestIds.length === 0 &&
      !paidAnswerIntegrityCoveredEventRefs.has(event.id) &&
      !isPurgedPaidAnswerAggregate(event)
    ) {
      issues.push({
        code: "provider_usage_missing_request_id",
        severity: "warning",
        localRef: event.id,
        reason: "settled usage event has no provider request reference",
        repairable: false,
        details: {
          passRef: event.trip_pass_id,
          meterType: event.meter_type,
        },
      });
    }
    for (const providerRequestId of providerRequestIds) {
      const refs = providerEventRefs.get(providerRequestId) ?? [];
      refs.push(event.id);
      providerEventRefs.set(providerRequestId, refs);
    }
  }

  for (const [providerRequestId, eventRefs] of providerEventRefs) {
    if (eventRefs.length > 1) {
      issues.push({
        code: "provider_usage_duplicate_request_id",
        severity: "blocked",
        localRef: eventRefs.join(","),
        reason: "one provider request is linked to multiple settled usage events",
        repairable: false,
        details: {
          providerRequestHash: hashLocalReference(providerRequestId),
          eventCount: eventRefs.length,
        },
      });
    }
  }

  return issues;
}

function paidAnswerUsageEventIssues(reservations: SettledPaidAnswerIntegrityRow[]): {
  issues: TripPassDiagnosticIssue[];
  coveredEventRefs: Set<string>;
} {
  const issues: TripPassDiagnosticIssue[] = [];
  const coveredEventRefs = new Set<string>();

  for (const reservation of reservations) {
    if (reservation.exact_event_id !== null) continue;

    for (const eventId of parseProviderRequestIds(reservation.candidate_event_ids_json)) {
      coveredEventRefs.add(eventId);
    }
    issues.push({
      code: "paid_answer_usage_event_missing",
      severity: "warning",
      localRef: reservation.id,
      reason: "settled paid answer has no exactly linked settled chat-message usage event",
      repairable: false,
      details: {
        passRef: reservation.trip_pass_id,
        meterRef: reservation.usage_meter_id,
      },
    });
  }

  return { coveredEventRefs, issues };
}

function isPurgedPaidAnswerAggregate(event: UsageEventRow) {
  return (
    event.meter_type === "chat_message" &&
    event.request_id === null &&
    event.request_hash === null &&
    event.paid_answer_reservation_id !== null &&
    event.paid_answer_reservation_status === "settled" &&
    event.paid_answer_details_purged_at !== null
  );
}

function infrastructureIssues(
  env: Record<string, string | undefined> | undefined,
): TripPassDiagnosticIssue[] {
  const environment = readTripPassEnvironment(env);
  const issues: TripPassDiagnosticIssue[] = [];
  if (environment.analytics.status !== "available") {
    issues.push({
      code: "analytics_sink_unavailable",
      severity: "warning",
      localRef: "analytics",
      reason: "analytics sink is not configured",
      repairable: false,
    });
  }
  if (environment.redis.status !== "available") {
    issues.push({
      code: "store_unavailable",
      severity: "warning",
      localRef: "quota_store",
      reason: "shared quota store is not configured",
      repairable: false,
    });
  }
  if (
    environment.costBudgets.deepSeekDailyUsd === null &&
    environment.costBudgets.openAiDailyUsd === null &&
    environment.costBudgets.globalDailyUsd === null
  ) {
    issues.push({
      code: "cost_circuit_unconfigured",
      severity: "warning",
      localRef: "model_cost_circuits",
      reason: "provider and global model-cost circuits are not configured",
      repairable: false,
    });
  }
  return issues;
}

async function loadStuckPendingOrders(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
  staleCutoff: Date,
) {
  const { clause, params } = scopeWhere(scope, "o", 2);
  const result = await db.query<TripPassOrderRow>(
    `
      select id, user_id, email, status, product_code, product_version, stripe_price_id,
        created_at, updated_at, completed_at
      from trip_pass_orders o
      where status in ('pending', 'checkout_created')
        and created_at < $1
        ${clause}
      order by created_at asc
    `,
    [staleCutoff, ...params],
  );
  return result.rows;
}

async function loadPaidOrdersWithoutPass(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
) {
  const { clause, params } = scopeWhere(scope, "o", 1);
  const result = await db.query<PaidWithoutPassRow>(
    `
      select
        o.id, o.user_id, o.email, o.status, o.product_code, o.product_version,
        o.stripe_price_id, o.created_at, o.updated_at, o.completed_at,
        count(g.id)::text as grant_count,
        count(p.id)::text as pass_count
      from trip_pass_orders o
      left join trip_pass_grants g on g.order_id = o.id
      left join trip_passes p on p.id = g.trip_pass_id
      where o.status = 'paid'
        ${clause}
      group by o.id, o.user_id, o.email, o.status, o.product_code, o.product_version,
        o.stripe_price_id, o.created_at, o.updated_at, o.completed_at
      having count(g.id) = 0 or count(p.id) = 0
      order by o.completed_at desc nulls last, o.created_at desc
    `,
    params,
  );
  return result.rows;
}

async function loadDuplicateOrderGrants(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
) {
  const { clause, params } = scopeWhere(scope, "o", 1);
  const result = await db.query<DuplicateGrantRow>(
    `
      select
        o.id as order_id,
        count(g.id)::text as grant_count,
        count(distinct g.user_id)::text as user_count
      from trip_pass_orders o
      join trip_pass_grants g on g.order_id = o.id
      where true
        ${clause}
      group by o.id
      having count(g.id) > 1
      order by o.id
    `,
    params,
  );
  return result.rows;
}

async function loadRevokedPasses(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
  now: Date,
) {
  const { clause, params } = scopeWhere(scope, "p", 2);
  const result = await db.query<PassRow>(
    `
      select id, user_id, status, starts_at, expires_at
      from trip_passes p
      where (status in ('cancelled', 'refunded') or expires_at < $1)
        ${clause}
      order by updated_at desc
    `,
    [now, ...params],
  );
  return result.rows;
}

async function loadPassesMissingMeters(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
) {
  const { clause, params } = scopeWhere(scope, "p", 1);
  const expectedCurrentMetersParameter = params.length + 1;
  const result = await db.query<MissingMeterRow>(
    `
      with pass_meter_counts as (
        select
          p.id,
          p.user_id,
          p.status,
          p.starts_at,
          p.expires_at,
          p.created_at,
          count(m.id) as meter_count,
          coalesce(
            nullif((
              select count(distinct meter_keys.meter_type)
              from trip_pass_grants g
              cross join lateral jsonb_object_keys(g.meter_limits_json)
                as meter_keys(meter_type)
              where g.trip_pass_id = p.id
            ), 0),
            $${expectedCurrentMetersParameter}::bigint
          ) as expected_meter_count
        from trip_passes p
        left join trip_usage_meters m on m.trip_pass_id = p.id
        where p.status = 'active'
          ${clause}
        group by p.id, p.user_id, p.status, p.starts_at, p.expires_at, p.created_at
      )
      select
        id,
        user_id,
        status,
        starts_at,
        expires_at,
        meter_count::text,
        expected_meter_count::text
      from pass_meter_counts
      where meter_count <> expected_meter_count
      order by created_at desc
    `,
    [...params, tripPassMeterTypes.length],
  );
  return result.rows;
}

async function loadMeterAggregateMismatches(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
) {
  const { clause, params } = scopeWhere(scope, "p", 1);
  const result = await db.query<MeterAggregateRow>(
    `
      select
        m.trip_pass_id,
        m.meter_type,
        m.used,
        coalesce(sum(case when e.event_type = 'settled' then e.quantity else 0 end), 0)::text
          as settled_quantity
      from trip_usage_meters m
      join trip_passes p on p.id = m.trip_pass_id
      left join trip_usage_events e on e.usage_meter_id = m.id
      where true
        ${clause}
      group by m.trip_pass_id, m.meter_type, m.used
      having m.used <> coalesce(sum(case when e.event_type = 'settled' then e.quantity else 0 end), 0)
      order by m.trip_pass_id, m.meter_type
    `,
    params,
  );
  return result.rows;
}

async function loadUsageEvents(db: DatabaseQueryClient, scope: TripPassReconciliationScope) {
  const rows: UsageEventRow[] = [];
  let cursor: string | null = null;
  do {
    const { clause, params } = scopeWhere(scope, "p", 1);
    const queryParams = [...params];
    let cursorClause = "";
    if (cursor !== null) {
      queryParams.push(cursor);
      cursorClause = `and e.id > $${queryParams.length}`;
    }
    queryParams.push(reconciliationPageSize);
    const result = await db.query<UsageEventRow>(
      `
      select
        e.id, e.trip_pass_id, e.usage_meter_id, e.user_id, e.event_type, e.meter_type,
        e.quantity, e.idempotency_key, e.request_id, e.request_hash,
        e.provider_request_ids_json, e.occurred_at,
        r.id as paid_answer_reservation_id,
        r.status as paid_answer_reservation_status,
        r.details_purged_at as paid_answer_details_purged_at
      from trip_usage_events e
      join trip_passes p on p.id = e.trip_pass_id
      left join paid_answer_reservations r
        on e.id = 'trip_usage_event_' || r.id
        and e.idempotency_key = 'paid-answer:' || r.id
        and e.trip_pass_id = r.trip_pass_id
        and e.usage_meter_id = r.usage_meter_id
        and e.user_id = r.account_id
        and e.event_type = 'settled'
        and e.meter_type = 'chat_message'
      where true
        ${clause}
        ${cursorClause}
      order by e.id
      limit $${queryParams.length}
    `,
      queryParams,
    );
    rows.push(...result.rows);
    cursor = result.rows.at(-1)?.id ?? null;
    if (result.rows.length < reconciliationPageSize) break;
  } while (cursor !== null);
  return rows;
}

async function loadSettledPaidAnswerIntegrity(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
) {
  const rows: SettledPaidAnswerIntegrityRow[] = [];
  let cursor: string | null = null;
  do {
    const { clause, params } = scopeWhere(scope, "p", 1);
    const queryParams = [...params];
    let cursorClause = "";
    if (cursor !== null) {
      queryParams.push(cursor);
      cursorClause = `and r.id > $${queryParams.length}`;
    }
    queryParams.push(reconciliationPageSize);
    const result = await db.query<SettledPaidAnswerIntegrityRow>(
      `
      select
        r.id,
        r.trip_pass_id,
        r.usage_meter_id,
        e.id as exact_event_id,
        coalesce((
          select jsonb_agg(candidate.id order by candidate.id)
          from trip_usage_events candidate
          where candidate.id = 'trip_usage_event_' || r.id
            or candidate.idempotency_key = 'paid-answer:' || r.id
        ), '[]'::jsonb) as candidate_event_ids_json
      from paid_answer_reservations r
      join trip_passes p on p.id = r.trip_pass_id
      left join trip_usage_events e
        on e.id = 'trip_usage_event_' || r.id
        and e.idempotency_key = 'paid-answer:' || r.id
        and e.trip_pass_id = r.trip_pass_id
        and e.usage_meter_id = r.usage_meter_id
        and e.user_id = r.account_id
        and e.event_type = 'settled'
        and e.meter_type = 'chat_message'
      where r.status = 'settled'
        ${clause}
        ${cursorClause}
      order by r.id
      limit $${queryParams.length}
    `,
      queryParams,
    );
    rows.push(...result.rows);
    cursor = result.rows.at(-1)?.id ?? null;
    if (result.rows.length < reconciliationPageSize) break;
  } while (cursor !== null);
  return rows;
}

async function loadPriceCatalogMismatches(
  db: DatabaseQueryClient,
  scope: TripPassReconciliationScope,
  env: Record<string, string | undefined> | undefined,
) {
  const environment = readTripPassEnvironment(env);
  const { clause, params } = scopeWhere(scope, "o", 1);
  const queryParams = [...params];
  let priceClause = "";
  if (environment.checkout.priceId) {
    queryParams.push(environment.checkout.priceId);
    priceClause = `or o.stripe_price_id <> $${queryParams.length}`;
  }
  queryParams.push(tripPassProductCode);
  const productCodeParam = queryParams.length;
  queryParams.push(tripPassProductVersion);
  const productVersionParam = queryParams.length;
  const result = await db.query<TripPassOrderRow>(
    `
      select id, user_id, email, status, product_code, product_version, stripe_price_id,
        created_at, updated_at, completed_at
      from trip_pass_orders o
      where (
          o.product_code <> $${productCodeParam}
          or o.product_version <> $${productVersionParam}
          ${priceClause}
        )
        ${clause}
      order by created_at desc
    `,
    queryParams,
  );
  return result.rows.map(
    (order): TripPassDiagnosticIssue => ({
      code: "price_catalog_mismatch",
      severity: "blocked",
      localRef: order.id,
      reason: "order catalog snapshot differs from the active Trip Pass catalog",
      repairable: false,
      details: {
        productVersion: order.product_version,
        currentProductVersion: tripPassProductVersion,
      },
    }),
  );
}

async function loadOrderById(orderId: string, db: DatabaseQueryClient) {
  const result = await db.query<TripPassOrderRow>(
    `
      select id, user_id, email, status, product_code, product_version, stripe_price_id,
        created_at, updated_at, completed_at
      from trip_pass_orders
      where id = $1
      limit 1
    `,
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function loadSupportOrders(input: TripPassReconciliationScope, db: DatabaseQueryClient) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.orderId) {
    params.push(input.orderId);
    clauses.push(`o.id = $${params.length}`);
  }
  if (input.passId) {
    params.push(input.passId);
    clauses.push(`g.trip_pass_id = $${params.length}`);
  }
  if (clauses.length === 0 && input.userId) {
    params.push(input.userId);
    clauses.push(`o.user_id = $${params.length}`);
  }
  const result = await db.query<TripPassOrderRow>(
    `
      select distinct o.id, o.user_id, o.email, o.status, o.product_code, o.product_version,
        o.stripe_price_id, o.created_at, o.updated_at, o.completed_at
      from trip_pass_orders o
      left join trip_pass_grants g on g.order_id = o.id
      where ${clauses.join(" or ")}
      order by o.created_at desc
      limit 10
    `,
    params,
  );
  return result.rows;
}

async function loadSupportPasses(input: TripPassReconciliationScope, db: DatabaseQueryClient) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.passId) {
    params.push(input.passId);
    clauses.push(`p.id = $${params.length}`);
  }
  if (input.orderId) {
    params.push(input.orderId);
    clauses.push(`g.order_id = $${params.length}`);
  }
  if (clauses.length === 0 && input.userId) {
    params.push(input.userId);
    clauses.push(`p.user_id = $${params.length}`);
  }
  const result = await db.query<PassRow>(
    `
      select distinct p.id, p.user_id, p.status, p.starts_at, p.expires_at
      from trip_passes p
      left join trip_pass_grants g on g.trip_pass_id = p.id
      where ${clauses.join(" or ")}
      order by p.starts_at desc
      limit 10
    `,
    params,
  );
  return result.rows;
}

async function loadMeterSummary(passRefs: readonly string[], db: DatabaseQueryClient) {
  const placeholders = passRefs.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<MeterSummaryRow>(
    `
      select
        m.meter_type,
        sum(m.used)::integer as used,
        sum(m."limit")::integer as "limit",
        coalesce(sum(case when e.event_type = 'reserved' then e.quantity else 0 end), 0)::text
          as reserved
      from trip_usage_meters m
      left join trip_usage_events e on e.usage_meter_id = m.id
      where m.trip_pass_id in (${placeholders})
      group by m.meter_type
      order by m.meter_type
    `,
    [...passRefs],
  );
  return result.rows.map((row) => ({
    meterType: row.meter_type as TripPassMeterType,
    used: row.used,
    limit: row.limit,
    reserved: toNumber(row.reserved),
  }));
}

function scopeWhere(scope: TripPassReconciliationScope, alias: string, startIndex: number) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.orderId) {
    if (alias === "o") {
      params.push(scope.orderId);
      clauses.push(`${alias}.id = $${startIndex + params.length - 1}`);
    } else {
      params.push(scope.orderId);
      clauses.push(`exists (
        select 1 from trip_pass_grants scoped_grant
        where scoped_grant.trip_pass_id = ${alias}.id
          and scoped_grant.order_id = $${startIndex + params.length - 1}
      )`);
    }
  }
  if (scope.passId) {
    if (alias === "p") {
      params.push(scope.passId);
      clauses.push(`${alias}.id = $${startIndex + params.length - 1}`);
    } else {
      params.push(scope.passId);
      clauses.push(`exists (
        select 1 from trip_pass_grants scoped_grant
        where scoped_grant.order_id = ${alias}.id
          and scoped_grant.trip_pass_id = $${startIndex + params.length - 1}
      )`);
    }
  }
  if (scope.userId) {
    params.push(scope.userId);
    clauses.push(`${alias}.user_id = $${startIndex + params.length - 1}`);
  }

  return {
    clause: clauses.length > 0 ? `and ${clauses.join(" and ")}` : "",
    params,
  };
}

function parseProviderRequestIds(value: string[] | string) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  } catch {
    return [];
  }
}

function ageMinutes(value: Date | string, now: Date) {
  return Math.max(Math.floor((now.getTime() - new Date(value).getTime()) / 60_000), 0);
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return 0;
  }
  return Number.parseInt(value, 10);
}

function hashLocalReference(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `provider_request_${hash.toString(16)}`;
}
