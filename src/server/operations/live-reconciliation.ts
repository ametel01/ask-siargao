import { randomUUID } from "node:crypto";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { createOperationTrace, type OperationEventRecorder } from "@/server/operations/contracts";

export type AuthoritativePaymentFact = {
  paymentState: "pending" | "paid" | "refunded" | "disputed" | "unpaid";
  amountMinor: number | null;
  currency: string | null;
};

export type AuthoritativeCommerceReader = {
  readPaymentFact(input: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
  }): Promise<AuthoritativePaymentFact>;
};

export type OperationalFindingView = {
  findingId: string;
  impact: "warning" | "high";
  kind:
    | "paid_without_pass"
    | "access_without_payment"
    | "payment_state_mismatch"
    | "pending_payment_stale";
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
  status: string;
  amount_total_minor: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: Date | string;
  pass_count: string | number;
};

type FindingCandidate = Omit<OperationalFindingView, "findingId" | "status"> & {
  localRef: string;
};

export async function reconcileLiveCommerce(
  input: {
    source: "cli" | "authenticated_adapter" | "worker";
    orderId?: string;
  },
  dependencies: {
    commerceReader: AuthoritativeCommerceReader;
    createId?: (prefix: string) => string;
    db?: DatabaseQueryClient;
    now?: () => Date;
    recordEvent?: OperationEventRecorder;
    alertFinding?: (finding: OperationalFindingView) => Promise<void>;
  },
): Promise<LiveReconciliationResult> {
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const trace = createOperationTrace(dependencies.recordEvent);
  const runId = createId("reconciliation_run");
  await trace.record({ index: 0, operation: "load_local_commerce", result: "started" });
  const localRows = await loadLocalCommerce(db, input.orderId);
  await trace.record({ index: 0, operation: "load_local_commerce", result: "succeeded" });

  const candidates: FindingCandidate[] = [];
  for (const local of localRows) {
    await trace.record({ index: 0, operation: "authoritative_payment_lookup", result: "started" });
    const provider = await dependencies.commerceReader.readPaymentFact({
      checkoutSessionId: local.stripe_checkout_session_id,
      paymentIntentId: local.stripe_payment_intent_id,
    });
    await trace.record({
      index: 0,
      operation: "authoritative_payment_lookup",
      result: "succeeded",
    });
    candidates.push(...compareCommerce(local, provider, now()));
  }

  await trace.record({ index: 0, operation: "record_reconciliation_findings", result: "started" });
  const findings = await withTransaction(db, async (transaction) => {
    const at = await databaseClock(transaction);
    await transaction.query(
      `insert into operational_reconciliation_runs (
         id, source, status, checked_count, finding_count, started_at, completed_at
       ) values ($1, $2, 'succeeded', $3, $4, $5, $5)`,
      [runId, input.source, localRows.length, candidates.length, at],
    );
    const recorded: OperationalFindingView[] = [];
    for (const candidate of candidates) {
      const findingId = createId("finding");
      await transaction.query(
        `insert into operational_findings (
           id, run_id, kind, impact, status, local_entity_type, local_entity_ref,
           summary_code, detected_at
         ) values ($1, $2, $3, $4, 'open', 'trip_pass_order', $5, $6, $7)`,
        [
          findingId,
          runId,
          candidate.kind,
          candidate.impact,
          candidate.localRef,
          candidate.summaryCode,
          at,
        ],
      );
      recorded.push({
        findingId,
        impact: candidate.impact,
        kind: candidate.kind,
        status: "open",
        summaryCode: candidate.summaryCode,
      });
    }
    return recorded;
  });
  await trace.record({
    index: 0,
    operation: "record_reconciliation_findings",
    result: "succeeded",
  });
  for (const finding of findings) {
    if (finding.impact === "high") await dependencies.alertFinding?.(finding);
  }
  return { checkedCount: localRows.length, findings, runId, trace: trace.events };
}

async function loadLocalCommerce(db: DatabaseQueryClient, orderId?: string) {
  const params = orderId ? [orderId] : [];
  const filter = orderId ? "where o.id = $1" : "";
  const result = await db.query<LocalCommerceSnapshot>(
    `select o.id, o.status, o.amount_total_minor, o.currency,
       o.stripe_checkout_session_id, o.stripe_payment_intent_id, o.created_at,
       count(distinct p.id)::text as pass_count
     from trip_pass_orders o
     left join trip_pass_grants g on g.order_id = o.id
     left join trip_passes p on p.id = g.trip_pass_id
     ${filter}
     group by o.id
     order by o.id`,
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
