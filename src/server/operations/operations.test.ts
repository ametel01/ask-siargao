import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { reconcileLiveCommerce } from "@/server/operations/live-reconciliation";
import {
  authorizeOperator,
  operatorMutationVerificationConfig,
  readOperatorAccountAllowlist,
} from "@/server/operations/operator-auth";
import {
  executeRepairAction,
  type LocalRepairExecutor,
  previewRepairAction,
} from "@/server/operations/repair-actions";
import { parseOperationalWorkerArguments } from "@/server/operations/run-operational-worker";
import {
  classifyOperationalCondition,
  createSentryHttpSink,
  deliverOperationalAlertOnce,
} from "@/server/operations/sentry-alerts";
import { tripPassLocalRepairExecutor } from "@/server/operations/trip-pass-repair-executor";
import { enqueueOperationalTask, runOperationalWorker } from "@/server/operations/worker-runner";

describe("Operator authorization", () => {
  test("requires an immutable Account allowlist and inclusive five-minute Clerk MFA", () => {
    const allowlist = readOperatorAccountAllowlist({
      ADMIN_ACCESS_TOKEN: "shared-does-not-authorize",
      OPERATOR_ACCOUNT_IDS: "account_operator, account_backup",
    });
    expect(operatorMutationVerificationConfig).toEqual({ level: "second_factor", afterMinutes: 6 });
    expect(
      authorizeOperator({
        allowlist,
        auth: { accountId: "account_operator", mfaFresh: true },
        mutation: true,
      }),
    ).toEqual({ accountId: "account_operator", allowed: true });
    expect(
      authorizeOperator({
        allowlist,
        auth: { accountId: "account_operator", mfaFresh: false },
        mutation: true,
      }),
    ).toEqual({ allowed: false, reason: "fresh_mfa_required" });
    expect(
      authorizeOperator({
        allowlist,
        auth: { accountId: null, mfaFresh: true },
        mutation: true,
      }),
    ).toEqual({ allowed: false, reason: "unauthenticated" });
  });
});

describe("live Stripe reconciliation", () => {
  test("finishes provider lookup before recording opaque findings and never mutates commerce", async () => {
    await withTestDb(async (db, state) => {
      await seedOrder(db, "order_live_reconciliation");
      const providerCalls: string[] = [];
      const alerted: string[] = [];
      const result = await reconcileLiveCommerce(
        { orderId: "order_live_reconciliation", source: "cli" },
        {
          commerceReader: {
            async readPaymentFact(input) {
              expect(state.inTransaction).toBe(false);
              providerCalls.push(JSON.stringify(input));
              return { amountMinor: 999, currency: "usd", paymentState: "paid" };
            },
          },
          createId: sequenceIds(),
          db,
          alertFinding: async (finding) => {
            expect(state.inTransaction).toBe(false);
            alerted.push(finding.findingId);
          },
          now: () => new Date("2026-08-08T12:00:00.000Z"),
        },
      );

      expect(providerCalls).toHaveLength(1);
      expect(alerted).toEqual(["finding_2"]);
      expect(result.findings).toEqual([
        {
          findingId: "finding_2",
          impact: "high",
          kind: "paid_without_pass",
          status: "open",
          summaryCode: "authoritative_payment_has_no_local_access",
        },
      ]);
      expect(result.trace.map((event) => event.operation)).toEqual([
        "load_local_commerce",
        "load_local_commerce",
        "authoritative_payment_lookup",
        "authoritative_payment_lookup",
        "record_reconciliation_findings",
        "record_reconciliation_findings",
      ]);
      const order = await db.query<{ status: string }>(
        "select status from trip_pass_orders where id = $1",
        ["order_live_reconciliation"],
      );
      expect(order.rows).toEqual([{ status: "pending" }]);
      expect(JSON.stringify(result)).not.toContain("cs_live_reconciliation_secret");
      expect(JSON.stringify(result)).not.toContain("pi_live_reconciliation_secret");
    });
  });
});

describe("audited Repair Actions", () => {
  test("requires preview, explicit confirmation, allowlisted fresh MFA, and replays idempotently", async () => {
    await withTestDb(async (db) => {
      await seedFinding(db, "finding_repair");
      await db.query("create table repair_probe (id text primary key, state text not null)");
      await db.query("insert into repair_probe (id, state) values ('probe', 'before')");
      const executor: LocalRepairExecutor = {
        async preview({ db: client }) {
          const current = await client.query<{ state: string }>(
            "select state from repair_probe where id = 'probe'",
          );
          return { after: { state: "after" }, before: { state: current.rows[0]?.state } };
        },
        async apply({ db: client }) {
          await client.query("update repair_probe set state = 'after' where id = 'probe'");
          return { state: "after" };
        },
      };
      const preview = await previewRepairAction(
        { actionType: "manual_commerce_transition", findingId: "finding_repair" },
        { db, executor },
      );
      const common = {
        actionType: "manual_commerce_transition" as const,
        auth: { accountId: "account_operator", mfaFresh: true },
        confirmation: "APPLY REPAIR",
        findingId: "finding_repair",
        idempotencyKey: "repair-idempotency-0001",
        previewDigest: preview.digest,
        reasonCode: "verified_provider_mismatch",
      };
      const denied = await executeRepairAction(
        { ...common, auth: { accountId: "account_operator", mfaFresh: false } },
        { allowlist: new Set(["account_operator"]), db, executor },
      );
      expect(denied).toEqual({ reason: "fresh_mfa_required", status: "denied" });
      const first = await executeRepairAction(common, {
        allowlist: new Set(["account_operator"]),
        createId: () => "repair_action_1",
        db,
        executor,
      });
      const replay = await executeRepairAction(common, {
        allowlist: new Set(["account_operator"]),
        db,
        executor,
      });
      expect(first).toEqual({
        actionId: "repair_action_1",
        after: { state: "after" },
        status: "applied",
      });
      expect(replay).toEqual({
        actionId: "repair_action_1",
        after: { state: "after" },
        status: "replayed",
      });
      await expect(
        executeRepairAction(
          { ...common, reasonCode: "different_verified_reason" },
          { allowlist: new Set(["account_operator"]), db, executor },
        ),
      ).rejects.toThrow("repair_idempotency_mismatch");
      const audit = await db.query<{
        operator_account_id: string;
        idempotency_key_hash: string;
        before_state: Record<string, unknown>;
      }>(
        "select operator_account_id, idempotency_key_hash, before_state from operator_repair_actions",
      );
      expect(audit.rows[0]?.operator_account_id).toBe("account_operator");
      expect(audit.rows[0]?.idempotency_key_hash).not.toContain("repair-idempotency");
      expect(audit.rows[0]?.before_state).toEqual({ state: "before" });
      const auditCount = await db.query<{ count: string }>(
        "select count(*)::text as count from operator_repair_actions",
      );
      expect(auditCount.rows[0]?.count).toBe("1");
    });
  });

  test("uses strict production executors for sensitive commerce and recovery classes", async () => {
    await withTestDb(async (db) => {
      await seedOrder(db, "order_manual_transition");
      await seedFindingFor(
        db,
        "finding_manual_transition",
        "payment_state_mismatch",
        "trip_pass_order",
        "order_manual_transition",
        "authoritative_payment_terms_mismatch",
      );
      const manualPreview = await previewRepairAction(
        { actionType: "manual_commerce_transition", findingId: "finding_manual_transition" },
        { db, executor: tripPassLocalRepairExecutor },
      );
      await expect(
        executeRepairAction(
          commandFor(
            "manual_commerce_transition",
            "finding_manual_transition",
            manualPreview.digest,
          ),
          {
            allowlist: new Set(["account_operator"]),
            createId: () => "repair_manual_transition",
            db,
            executor: tripPassLocalRepairExecutor,
          },
        ),
      ).resolves.toMatchObject({ status: "applied", after: { status: "failed" } });

      await seedOrder(db, "order_goodwill");
      await db.query("update trip_pass_orders set status = 'paid' where id = 'order_goodwill'");
      await seedFindingFor(
        db,
        "finding_goodwill",
        "provider_application_failed",
        "trip_pass_order",
        "order_goodwill",
        "provider_application_failed",
      );
      const goodwillPreview = await previewRepairAction(
        { actionType: "goodwill_grant", findingId: "finding_goodwill" },
        { db, executor: tripPassLocalRepairExecutor },
      );
      await expect(
        executeRepairAction(
          commandFor("goodwill_grant", "finding_goodwill", goodwillPreview.digest),
          {
            allowlist: new Set(["account_operator"]),
            createId: () => "repair_goodwill",
            db,
            executor: tripPassLocalRepairExecutor,
          },
        ),
      ).resolves.toMatchObject({ status: "applied", after: { grantCount: 1 } });

      await db.query(
        `insert into account_closure_tombstones (
           id, subject_hash, subject_hash_version, subject_type, closure_policy_version
         ) values ('tombstone_recovery', 'subject_recovery', 1, 'clerk_user_id', 'closure-v1')`,
      );
      await db.query(
        `insert into account_closure_operations (
           id, tombstone_id, operation_type, status, attempts, last_error_code,
           phase_one_committed_at
         ) values (
           'closure_recovery', 'tombstone_recovery', 'traveler_requested_closure', 'failed', 1,
           'cleanup_failed', clock_timestamp()
         )`,
      );
      await seedFindingFor(
        db,
        "finding_recovery",
        "privacy_cleanup_failed",
        "closure_operation",
        "closure_recovery",
        "privacy_cleanup_failed",
      );
      const recoveryPreview = await previewRepairAction(
        { actionType: "account_recovery", findingId: "finding_recovery" },
        { db, executor: tripPassLocalRepairExecutor },
      );
      await expect(
        executeRepairAction(
          commandFor("account_recovery", "finding_recovery", recoveryPreview.digest),
          {
            allowlist: new Set(["account_operator"]),
            createId: () => "repair_recovery",
            db,
            executor: tripPassLocalRepairExecutor,
          },
        ),
      ).resolves.toMatchObject({ status: "applied", after: { status: "pending" } });
    });
  });
});

describe("operational worker CLI", () => {
  test("selects one or every production task type with bounded controls", () => {
    expect(parseOperationalWorkerArguments(["--task=pending_stripe_event", "--batch=3"])).toEqual({
      batchSize: 3,
      leaseSeconds: 60,
      taskTypes: ["pending_stripe_event"],
    });
    expect(parseOperationalWorkerArguments(["--task=all", "--lease-seconds=30"])).toEqual({
      batchSize: 100,
      leaseSeconds: 30,
      taskTypes: undefined,
    });
    expect(() => parseOperationalWorkerArguments(["--task=unknown"])).toThrow(
      "invalid_operational_task_type",
    );
  });
});

describe("Sentry operational paging", () => {
  test("pages only confirmed high-impact conditions and checkout-active Redis outages", () => {
    expect(
      classifyOperationalCondition({
        checkoutMode: "on",
        condition: "redis_unavailable",
        confirmed: true,
      }),
    ).toBe("high");
    expect(
      classifyOperationalCondition({
        checkoutMode: "off",
        condition: "redis_unavailable",
        confirmed: true,
      }),
    ).toBe("warning");
    for (const condition of [
      "invalid_stripe_signature",
      "checkout_abandoned",
      "partial_refund",
      "analytics_delivery_failure",
    ] as const) {
      expect(classifyOperationalCondition({ checkoutMode: "on", condition, confirmed: true })).toBe(
        "warning",
      );
    }
    expect(
      classifyOperationalCondition({
        checkoutMode: "on",
        condition: "paid_without_pass",
        confirmed: false,
      }),
    ).toBe("warning");
  });

  test("delivers a scrubbed high-impact page once and never invokes PostHog", async () => {
    await withTestDb(async (db) => {
      await seedFinding(db, "finding_opaque");
      const sent: string[] = [];
      const sink = createSentryHttpSink({
        dsn: "https://public@example.invalid/42",
        fetchImpl: async (_url, init) => {
          sent.push(String(init?.body));
          return new Response(null, { status: 200 });
        },
      });
      const alert = {
        alertKey: "finding_once",
        errorCode: "traveler@example.com",
        findingId: "finding_opaque",
        impact: "high" as const,
        operation: "paid_without_pass" as const,
      };
      await expect(
        deliverOperationalAlertOnce(alert, {
          createId: () => "delivery_1",
          createToken: () => "delivery_token_1",
          db,
          sink,
        }),
      ).resolves.toEqual({ status: "sent" });
      await expect(
        deliverOperationalAlertOnce(alert, {
          createId: () => "delivery_2",
          createToken: () => "delivery_token_2",
          db,
          sink,
        }),
      ).resolves.toEqual({ status: "already_delivered_or_in_flight" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain("traveler@example.com");
      expect(sent[0]).toContain("operational_failure");
    });
  });
});

describe("durable provider-neutral workers", () => {
  test("claims only the task kinds selected by the thin CLI adapter", async () => {
    await withTestDb(async (db) => {
      await enqueueOperationalTask(
        { id: "task_closure_selected", resourceRef: "closure", taskType: "account_closure" },
        db,
      );
      await enqueueOperationalTask(
        { id: "task_retention_selected", resourceRef: "retention", taskType: "retention_purge" },
        db,
      );
      const handled: string[] = [];
      const result = await runOperationalWorker(
        { batchSize: 2, leaseSeconds: 60, taskTypes: ["retention_purge"] },
        {
          db,
          handlers: {
            retention_purge: async ({ resourceRef }) => {
              handled.push(resourceRef);
            },
          },
        },
      );
      expect(result).toEqual({ claimed: 1, failed: 0, stale: 0, succeeded: 1 });
      expect(handled).toEqual(["retention"]);
      const closure = await db.query<{ status: string }>(
        "select status from operational_worker_tasks where id = 'task_closure_selected'",
      );
      expect(closure.rows[0]?.status).toBe("pending");
    });
  });

  test("retries crashes durably and fences a stale successful worker", async () => {
    await withTestDb(async (db) => {
      await enqueueOperationalTask(
        { id: "worker_task_retry", resourceRef: "opaque_resource", taskType: "retention_purge" },
        db,
      );
      const failed = await runOperationalWorker(
        { batchSize: 1, leaseSeconds: 60 },
        {
          createLeaseToken: () => "lease_failed",
          db,
          handlers: { retention_purge: async () => Promise.reject(new Error("raw provider body")) },
        },
      );
      expect(failed).toEqual({ claimed: 1, failed: 1, stale: 0, succeeded: 0 });
      const retry = await db.query<{ last_error_code: string; status: string }>(
        "select last_error_code, status from operational_worker_tasks where id = 'worker_task_retry'",
      );
      expect(retry.rows).toEqual([{ last_error_code: "task_failed", status: "pending" }]);

      await db.query(
        "update operational_worker_tasks set next_attempt_at = clock_timestamp() where id = 'worker_task_retry'",
      );
      const stale = await runOperationalWorker(
        { batchSize: 1, leaseSeconds: 60 },
        {
          createLeaseToken: () => "lease_stale",
          db,
          handlers: {
            retention_purge: async () => {
              await db.query(
                `update operational_worker_tasks set lease_token = 'replacement_lease'
                 where id = 'worker_task_retry'`,
              );
            },
          },
        },
      );
      expect(stale).toEqual({ claimed: 1, failed: 0, stale: 1, succeeded: 0 });
    });
  });
});

async function withTestDb(
  work: (db: DatabaseQueryClient, state: { inTransaction: boolean }) => Promise<void>,
) {
  await resetTestDatabase();
  const database = await openTestDatabase();
  const state = { inTransaction: false };
  try {
    await runInitialMigration(database);
    await work(createPgliteQueryClient(database, state), state);
  } finally {
    await database.close();
  }
}

function createPgliteQueryClient(
  database: PGlite,
  state: { inTransaction: boolean },
): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return database.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await database.exec("begin");
      state.inTransaction = true;
      try {
        const result = await callback(client);
        await database.exec("commit");
        return result;
      } catch (error) {
        await database.exec("rollback");
        throw error;
      } finally {
        state.inTransaction = false;
      }
    },
  };
  return client;
}

async function seedOrder(db: DatabaseQueryClient, id: string) {
  await db.query(
    "insert into users (id, email) values ('account_reconcile', null) on conflict (id) do nothing",
  );
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_version, stripe_price_id,
       amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, stripe_payment_intent_id, created_at, updated_at
     ) values (
       $1, 'account_reconcile', 'pending', 'siargao_trip_pass_14d_v2', 2, 'price_test',
       999, 'usd', $2, $3, $4, clock_timestamp() - interval '1 hour', clock_timestamp()
     )`,
    [id, `checkout_key_${id}`, `cs_${id}`, `pi_${id}`],
  );
}

async function seedFinding(db: DatabaseQueryClient, findingId: string) {
  await db.query(
    `insert into operational_reconciliation_runs (
       id, source, status, checked_count, finding_count, started_at, completed_at
     ) values ('run_repair', 'cli', 'succeeded', 1, 1, clock_timestamp(), clock_timestamp())`,
  );
  await db.query(
    `insert into operational_findings (
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code
     ) values ($1, 'run_repair', 'payment_state_mismatch', 'high',
       'trip_pass_order', 'order_private', 'payment_state_mismatch')`,
    [findingId],
  );
}

async function seedFindingFor(
  db: DatabaseQueryClient,
  findingId: string,
  kind: string,
  entityType: string,
  entityRef: string,
  summaryCode: string,
) {
  const runId = `run_${findingId}`;
  await db.query(
    `insert into operational_reconciliation_runs (
       id, source, status, checked_count, finding_count, started_at, completed_at
     ) values ($1, 'cli', 'succeeded', 1, 1, clock_timestamp(), clock_timestamp())`,
    [runId],
  );
  await db.query(
    `insert into operational_findings (
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code
     ) values ($1, $2, $3, 'high', $4, $5, $6)`,
    [findingId, runId, kind, entityType, entityRef, summaryCode],
  );
}

function commandFor(
  actionType: "account_recovery" | "goodwill_grant" | "manual_commerce_transition",
  findingId: string,
  previewDigest: string,
) {
  return {
    actionType,
    auth: { accountId: "account_operator", mfaFresh: true },
    confirmation: "APPLY REPAIR",
    findingId,
    idempotencyKey: `idempotency-${findingId}`,
    previewDigest,
    reasonCode: "verified_operator_action",
  };
}

function sequenceIds() {
  let index = 0;
  return (prefix: string) => `${prefix}_${++index}`;
}
