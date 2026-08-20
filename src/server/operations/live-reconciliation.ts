import { createHash, randomUUID } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { createOperationTrace, type OperationEventRecorder } from "@/server/operations/contracts";
import type { NormalizedPaymentFact } from "@/server/payments/lemon-squeezy";
import {
  lockTripPassAccountFamily,
  lockTripPassAccountWrites,
} from "@/server/trip-pass/payment-lifecycle";

export type ReconciliationScope = "risk" | "daily" | "all";

export type AuthoritativePaymentFact = {
  paymentState: "pending" | "paid" | "refunded" | "disputed" | "unpaid";
  amountMinor: number | null;
  currency: string | null;
  providerFact?: NormalizedPaymentFact;
};

export type AuthoritativeCommerceReader = {
  readPaymentFact(input: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    providerOrderId?: string | null;
    signal?: AbortSignal;
  }): Promise<AuthoritativePaymentFact>;
};

export const liveCommerceFindingKinds = [
  "paid_without_pass",
  "access_without_payment",
  "payment_state_mismatch",
  "pending_payment_stale",
] as const;

export type LiveCommerceFindingKind = (typeof liveCommerceFindingKinds)[number];

export type OperationalFindingView = {
  findingId: string;
  impact: "warning" | "high";
  incidentKey: string;
  kind: LiveCommerceFindingKind;
  lifecycle: number;
  observationSequence: string;
  status: "open";
  summaryCode: string;
};

export type LiveReconciliationResult = {
  runId: string;
  checkedCount: number;
  findings: OperationalFindingView[];
  trace: ReturnType<typeof createOperationTrace>["events"];
};

type LocalCommerceSnapshot = {
  id: string;
  product_family: string;
  status: string;
  user_id: string | null;
  amount_total_minor: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_provider: string;
  provider_order_id: string | null;
  created_at: Date | string;
  pass_count: string | number;
};

type FindingCandidate = Omit<
  OperationalFindingView,
  "findingId" | "incidentKey" | "lifecycle" | "observationSequence" | "status"
> & {
  localRef: string;
};

type CommerceObservation = {
  local: LocalCommerceSnapshot;
  observedAt: Date;
  provider: AuthoritativePaymentFact;
  sequence: string;
};

export async function reconcileLiveCommerce(
  input: {
    source: "cli" | "authenticated_adapter" | "worker";
    orderId?: string;
    scope?: ReconciliationScope;
  },
  dependencies: {
    commerceReader: AuthoritativeCommerceReader;
    commerceReaders?: Partial<Record<"stripe" | "lemon_squeezy", AuthoritativeCommerceReader>>;
    createId?: (prefix: string) => string;
    db?: DatabaseQueryClient;
    now?: () => Date;
    recordEvent?: OperationEventRecorder;
    signal?: AbortSignal;
    alertFinding?: (finding: OperationalFindingView) => Promise<void>;
    applyVerifiedPaymentFact?: (input: {
      local: { id: string; paymentProvider: string };
      fact: NormalizedPaymentFact;
    }) => Promise<void>;
  },
): Promise<LiveReconciliationResult> {
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const trace = createOperationTrace(dependencies.recordEvent);
  const runId = createId("reconciliation_run");
  const scope = input.scope ?? "all";
  await trace.record({ index: 0, operation: "load_local_commerce", result: "started" });
  const localRows = await loadLocalCommerce(db, input.orderId, scope);
  await trace.record({ index: 0, operation: "load_local_commerce", result: "succeeded" });

  const observations: CommerceObservation[] = [];
  for (const local of localRows) {
    await trace.record({ index: 0, operation: "authoritative_payment_lookup", result: "started" });
    const commerceReader =
      dependencies.commerceReaders?.[local.payment_provider as "stripe" | "lemon_squeezy"] ??
      dependencies.commerceReader;
    const provider = await commerceReader.readPaymentFact({
      checkoutSessionId: local.stripe_checkout_session_id,
      paymentIntentId: local.stripe_payment_intent_id,
      providerOrderId: local.provider_order_id,
      signal: dependencies.signal,
    });
    await trace.record({
      index: 0,
      operation: "authoritative_payment_lookup",
      result: "succeeded",
    });
    await trace.record({
      index: 0,
      operation: "allocate_reconciliation_observation",
      result: "started",
    });
    const sequence = await allocateObservationSequence(db);
    await trace.record({
      index: 0,
      operation: "allocate_reconciliation_observation",
      result: "succeeded",
    });
    observations.push({ local, observedAt: now(), provider, sequence });
  }

  await trace.record({ index: 0, operation: "record_reconciliation_findings", result: "started" });
  const findings = await withTransaction(db, async (transaction) => {
    const at = await databaseClock(transaction);
    await transaction.query(
      `insert into operational_reconciliation_runs (
         id, source, status, checked_count, finding_count, started_at, completed_at
       ) values ($1, $2, 'succeeded', $3, 0, $4, $4)`,
      [runId, input.source, localRows.length, at],
    );
    const recorded: OperationalFindingView[] = [];
    for (const observation of observations) {
      const local = observation.local;
      const userId = local.user_id;
      const localId = local.id;
      if (userId) {
        await lockTripPassAccountFamily(userId, local.product_family, transaction);
        await lockTripPassAccountWrites(userId, transaction);
      }
      await transaction.query("select id from trip_pass_orders where id = $1 for update", [
        localId,
      ]);
      const freshness = await transaction.query<{ last_applied_sequence: string }>(
        `insert into operational_reconciliation_observations (
           local_entity_type, local_entity_ref, last_applied_sequence, observed_at
         ) values ('trip_pass_order', $1, $2, $3)
         on conflict (local_entity_type, local_entity_ref) do update set
           last_applied_sequence = excluded.last_applied_sequence,
           observed_at = excluded.observed_at
         where operational_reconciliation_observations.last_applied_sequence
           < excluded.last_applied_sequence
         returning last_applied_sequence::text`,
        [localId, observation.sequence, at],
      );
      if (!freshness.rows[0]) continue;

      const currentLocal = (await loadLocalCommerce(transaction, localId, "all"))[0];
      if (!currentLocal) continue;
      const observationFindings: OperationalFindingView[] = [];
      for (const candidate of compareCommerce(
        currentLocal,
        observation.provider,
        observation.observedAt,
      )) {
        const findingId = createId("finding");
        const incidentKey = createIncidentKey(candidate);
        const result = await transaction.query<{
          id: string;
          incident_key: string;
          lifecycle: number;
        }>(
          `insert into operational_findings (
             id, run_id, kind, impact, status, local_entity_type, local_entity_ref,
             summary_code, incident_key, lifecycle, last_observation_sequence,
             detected_at, last_detected_at
           ) values (
             $1, $2, $3, $4, 'open', 'trip_pass_order', $5, $6, $7, 1, $8, $9, $9
           )
           on conflict (incident_key) do update set
             run_id = excluded.run_id,
             impact = excluded.impact,
             status = 'open',
             lifecycle = case
               when operational_findings.status = 'resolved'
               then operational_findings.lifecycle + 1
               else operational_findings.lifecycle
             end,
             detected_at = case
               when operational_findings.status = 'resolved' then excluded.detected_at
               else operational_findings.detected_at
             end,
             last_detected_at = excluded.last_detected_at,
             last_observation_sequence = excluded.last_observation_sequence,
             resolved_at = null
           returning id, incident_key, lifecycle`,
          [
            findingId,
            runId,
            candidate.kind,
            candidate.impact,
            candidate.localRef,
            candidate.summaryCode,
            incidentKey,
            observation.sequence,
            at,
          ],
        );
        const current = result.rows[0];
        if (!current) throw new Error("reconciliation_finding_upsert_failed");
        observationFindings.push({
          findingId: current.id,
          impact: candidate.impact,
          incidentKey: current.incident_key,
          kind: candidate.kind,
          lifecycle: current.lifecycle,
          observationSequence: observation.sequence,
          status: "open",
          summaryCode: candidate.summaryCode,
        });
      }
      recorded.push(...observationFindings);
      await transaction.query(
        `update operational_findings set status = 'resolved', resolved_at = $3
         where status = 'open'
           and local_entity_type = 'trip_pass_order'
           and local_entity_ref = $1
           and kind = any($2::text[])
           and not (incident_key = any($4::text[]))`,
        [
          localId,
          liveCommerceFindingKinds,
          at,
          observationFindings.map((finding) => finding.incidentKey),
        ],
      );
    }
    await transaction.query(
      "update operational_reconciliation_runs set finding_count = $2 where id = $1",
      [runId, recorded.length],
    );
    return recorded;
  });
  await trace.record({
    index: 0,
    operation: "record_reconciliation_findings",
    result: "succeeded",
  });
  if (dependencies.applyVerifiedPaymentFact) {
    for (const observation of observations) {
      if (observation.provider.providerFact) {
        await dependencies.applyVerifiedPaymentFact({
          local: { id: observation.local.id, paymentProvider: observation.local.payment_provider },
          fact: observation.provider.providerFact,
        });
      }
    }
  }
  await Promise.all(findings.map((finding) => dependencies.alertFinding?.(finding)));
  return { checkedCount: localRows.length, findings, runId, trace: trace.events };
}

async function allocateObservationSequence(db: DatabaseQueryClient) {
  const allocated = await db.query<{ sequence: string }>(
    "select nextval('operational_reconciliation_observation_sequence')::text as sequence",
  );
  const sequence = allocated.rows[0]?.sequence;
  if (!sequence) throw new Error("reconciliation_observation_allocation_failed");
  return sequence;
}

export function reconciliationAlertKey(finding: OperationalFindingView) {
  return `reconciliation:${finding.incidentKey}:lifecycle:${finding.lifecycle}`;
}

function createIncidentKey(candidate: FindingCandidate) {
  return `incident_${createHash("md5")
    .update(
      [candidate.kind, "trip_pass_order", candidate.localRef, candidate.summaryCode].join("\u001f"),
    )
    .digest("hex")}`;
}

async function loadLocalCommerce(
  db: DatabaseQueryClient,
  orderId?: string,
  scope: ReconciliationScope = "all",
) {
  const params = orderId ? [orderId] : [];
  const filter = orderId
    ? "where o.id = $1"
    : scope === "risk"
      ? "where o.status in ('pending', 'checkout_created', 'paid', 'disputed')"
      : scope === "daily"
        ? "where o.status not in ('pending', 'checkout_created', 'paid', 'disputed')"
        : "where true";
  const result = await db.query<LocalCommerceSnapshot>(
    `select o.id, o.user_id, o.product_family, o.status, o.amount_total_minor, o.currency,
       o.stripe_checkout_session_id, o.stripe_payment_intent_id, o.payment_provider,
       o.provider_order_id, o.created_at,
       count(distinct p.id)::text as pass_count
     from trip_pass_orders o
     left join trip_pass_grants g on g.order_id = o.id
     left join trip_passes p on p.id = g.trip_pass_id
     ${filter}${orderId ? "" : " and o.updated_at <= statement_timestamp()"}
     group by o.id
     order by case when o.status in ('paid', 'checkout_created') then 0 else 1 end,
       o.updated_at desc, o.created_at, o.id
     `,
    params,
  );
  return result.rows;
}

function compareCommerce(
  local: LocalCommerceSnapshot,
  provider: AuthoritativePaymentFact,
  now: Date,
): FindingCandidate[] {
  const findings: FindingCandidate[] = [];
  const passCount = Number(local.pass_count);
  if (provider.paymentState === "paid" && passCount === 0) {
    findings.push({
      impact: "high",
      kind: "paid_without_pass",
      localRef: local.id,
      summaryCode: "authoritative_payment_has_no_local_access",
    });
  }
  if (
    (provider.paymentState === "unpaid" || provider.paymentState === "pending") &&
    passCount > 0
  ) {
    findings.push({
      impact: "high",
      kind: "access_without_payment",
      localRef: local.id,
      summaryCode: "local_access_has_no_authoritative_payment",
    });
  }
  const amountMismatch =
    provider.amountMinor !== null && provider.amountMinor !== local.amount_total_minor;
  const currencyMismatch = provider.currency !== null && provider.currency !== local.currency;
  if (amountMismatch || currencyMismatch) {
    findings.push({
      impact: "high",
      kind: "payment_state_mismatch",
      localRef: local.id,
      summaryCode: "authoritative_payment_terms_mismatch",
    });
  }
  if (
    provider.paymentState === "pending" &&
    now.getTime() - new Date(local.created_at).getTime() >= 30 * 60 * 1000
  ) {
    findings.push({
      impact: "warning",
      kind: "pending_payment_stale",
      localRef: local.id,
      summaryCode: "authoritative_payment_remains_pending",
    });
  }
  return findings;
}

async function databaseClock(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  return new Date(result.rows[0]?.now ?? Date.now());
}

async function withTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (!db.transaction) throw new Error("database_transactions_required");
  return db.transaction(callback);
}
