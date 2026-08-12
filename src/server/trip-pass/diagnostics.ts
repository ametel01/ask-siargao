import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { tripPassMeterTypes } from "@/server/payments/trip-pass";
import type { TripPassMeterType } from "@/server/trip-pass/catalog";

const defaultStaleReservationMs = 10 * 60 * 1000;
const diagnosticPageSize = 500;

export type TripPassDiagnosticScope = {
  orderId?: string;
  passId?: string;
  userId?: string;
};

export type TripPassDiagnosticSeverity = "warning" | "repairable" | "blocked";

export type TripPassDiagnosticIssue = {
  code:
    | "missing_usage_meters"
    | "usage_meter_aggregate_mismatch"
    | "stale_usage_reservation"
    | "paid_answer_usage_event_missing"
    | "provider_usage_missing_request_id"
    | "provider_usage_duplicate_request_id";
  severity: TripPassDiagnosticSeverity;
  localRef: string;
  reason: string;
  details?: Record<string, string | number | boolean | null>;
};

export type TripPassDiagnosticsSnapshot = {
  generatedAt: string;
  scope: TripPassDiagnosticScope;
  thresholds: {
    staleReservationMinutes: number;
  };
  issues: TripPassDiagnosticIssue[];
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

type TripPassDiagnosticsOptions = {
  db?: DatabaseQueryClient;
  now?: Date;
  scope?: TripPassDiagnosticScope;
  staleReservationMs?: number;
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

export async function buildTripPassDiagnostics(
  options: TripPassDiagnosticsOptions = {},
): Promise<TripPassDiagnosticsSnapshot> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = options.now ?? new Date();
  const staleReservationMs = options.staleReservationMs ?? defaultStaleReservationMs;
  const scope = options.scope ?? {};
  const issues = await collectTripPassDiagnosticIssues({
    db,
    now,
    scope,
    staleReservationMs,
  });
  return {
    generatedAt: now.toISOString(),
    issues,
    scope,
    thresholds: {
      staleReservationMinutes: Math.round(staleReservationMs / 60_000),
    },
  };
}

export async function lookupTripPassSupportReference(
  input: TripPassDiagnosticScope,
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

async function collectTripPassDiagnosticIssues(input: {
  db: DatabaseQueryClient;
  now: Date;
  scope: TripPassDiagnosticScope;
  staleReservationMs: number;
}) {
  const staleReservationCutoff = new Date(input.now.getTime() - input.staleReservationMs);
  const issues: TripPassDiagnosticIssue[] = [];

  const [missingMeters, aggregateMismatches, usageEvents, settledPaidAnswers] = await Promise.all([
    loadPassesMissingMeters(input.db, input.scope),
    loadMeterAggregateMismatches(input.db, input.scope),
    loadUsageEvents(input.db, input.scope),
    loadSettledPaidAnswerIntegrity(input.db, input.scope),
  ]);

  for (const pass of missingMeters) {
    issues.push({
      code: "missing_usage_meters",
      severity: "repairable",
      localRef: pass.id,
      reason: "pass is missing one or more usage meter rows",
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

  return issues;
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

async function loadPassesMissingMeters(db: DatabaseQueryClient, scope: TripPassDiagnosticScope) {
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
  scope: TripPassDiagnosticScope,
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

async function loadUsageEvents(db: DatabaseQueryClient, scope: TripPassDiagnosticScope) {
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
    queryParams.push(diagnosticPageSize);
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
    if (result.rows.length < diagnosticPageSize) break;
  } while (cursor !== null);
  return rows;
}

async function loadSettledPaidAnswerIntegrity(
  db: DatabaseQueryClient,
  scope: TripPassDiagnosticScope,
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
    queryParams.push(diagnosticPageSize);
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
    if (result.rows.length < diagnosticPageSize) break;
  } while (cursor !== null);
  return rows;
}

async function loadSupportOrders(input: TripPassDiagnosticScope, db: DatabaseQueryClient) {
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

async function loadSupportPasses(input: TripPassDiagnosticScope, db: DatabaseQueryClient) {
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

function scopeWhere(scope: TripPassDiagnosticScope, alias: string, startIndex: number) {
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
