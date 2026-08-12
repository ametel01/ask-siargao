import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { operationalTaskTypes } from "@/server/operations/contracts";
import {
  reconcileLiveCommerce,
  reconciliationAlertKey,
} from "@/server/operations/live-reconciliation";
import {
  enqueueDueOperationalTasks,
  stableOperationalTaskId,
} from "@/server/operations/operational-task-producer";
import {
  authorizeOperator,
  operatorMutationVerificationConfig,
  readOperatorAccountAllowlist,
} from "@/server/operations/operator-auth";
import { createProductionOperationalTaskHandlers } from "@/server/operations/production-handlers";
import {
  executeRepairAction,
  previewRepairAction,
  type RepairActionDispatcher,
} from "@/server/operations/repair-actions";
import { parseOperationalTaskProducerArguments } from "@/server/operations/run-operational-task-producer";
import {
  parseOperationalWorkerArguments,
  workerFailureAlertKey,
} from "@/server/operations/run-operational-worker";
import {
  classifyOperationalCondition,
  createSentryHttpSink,
  deliverOperationalAlertOnce,
  deliverPendingPageWorthyAlerts,
} from "@/server/operations/sentry-alerts";
import {
  createTripPassRepairActionDispatcher,
  type RepairActionType,
} from "@/server/operations/trip-pass-repair-executor";
import {
  enqueueOperationalTask,
  opaqueTaskKey,
  runOperationalWorker,
} from "@/server/operations/worker-runner";

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
          incidentKey: expect.stringMatching(/^incident_[a-f0-9]{32}$/),
          kind: "paid_without_pass",
          lifecycle: 1,
          observationSequence: "1",
          status: "open",
          summaryCode: "authoritative_payment_has_no_local_access",
        },
      ]);
      expect(result.trace.map((event) => event.operation)).toEqual([
        "load_local_commerce",
        "load_local_commerce",
        "authoritative_payment_lookup",
        "authoritative_payment_lookup",
        "allocate_reconciliation_observation",
        "allocate_reconciliation_observation",
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

  test("converges repeat, resolve, and recurrence on one incident and one page per lifecycle", async () => {
    await withTestDb(async (db) => {
      await seedOrder(db, "order_incident_lifecycle");
      let paymentState: "paid" | "unpaid" = "paid";
      const sent: string[] = [];
      const createId = sequenceIds();
      const reconcile = () =>
        reconcileLiveCommerce(
          { orderId: "order_incident_lifecycle", source: "worker" },
          {
            commerceReader: {
              async readPaymentFact() {
                return { amountMinor: 999, currency: "usd", paymentState };
              },
            },
            createId,
            db,
            alertFinding: async (finding) => {
              await deliverOperationalAlertOnce(
                {
                  alertKey: reconciliationAlertKey(finding),
                  errorCode: finding.summaryCode,
                  findingId: finding.findingId,
                  findingObservationSequence: finding.observationSequence,
                  impact: finding.impact,
                  operation: "paid_without_pass",
                },
                {
                  createId,
                  createToken: () => `delivery_token_${sent.length + 1}`,
                  db,
                  sink: {
                    async send() {
                      sent.push(reconciliationAlertKey(finding));
                    },
                  },
                },
              );
            },
          },
        );

      const first = await reconcile();
      const repeated = await reconcile();
      expect(repeated.findings[0]).toMatchObject({
        findingId: first.findings[0]?.findingId,
        incidentKey: first.findings[0]?.incidentKey,
        lifecycle: 1,
      });
      paymentState = "unpaid";
      expect((await reconcile()).findings).toEqual([]);
      paymentState = "paid";
      const recurred = await reconcile();
      expect(recurred.findings[0]).toMatchObject({
        findingId: first.findings[0]?.findingId,
        incidentKey: first.findings[0]?.incidentKey,
        lifecycle: 2,
      });
      expect(sent).toEqual([
        `reconciliation:${first.findings[0]?.incidentKey}:lifecycle:1`,
        `reconciliation:${first.findings[0]?.incidentKey}:lifecycle:2`,
      ]);
      const incidents = await db.query<{ count: string; lifecycle: number; status: string }>(
        `select count(*) over ()::text as count, lifecycle, status
         from operational_findings where local_entity_ref = 'order_incident_lifecycle'`,
      );
      expect(incidents.rows).toEqual([{ count: "1", lifecycle: 2, status: "open" }]);
    });
  });

  test("linearizes page intent against a newer healthy observation in both orders", async () => {
    await withTestDb(async (db) => {
      await seedOrder(db, "order_page_intent_stale");
      const staleResult = await reconcileLiveCommerce(
        { orderId: "order_page_intent_stale", source: "worker" },
        {
          commerceReader: {
            async readPaymentFact() {
              return { amountMinor: 999, currency: "usd", paymentState: "paid" };
            },
          },
          db,
        },
      );
      await reconcileLiveCommerce(
        { orderId: "order_page_intent_stale", source: "worker" },
        {
          commerceReader: {
            async readPaymentFact() {
              return { amountMinor: 999, currency: "usd", paymentState: "unpaid" };
            },
          },
          db,
        },
      );
      const staleFinding = staleResult.findings[0];
      if (!staleFinding) throw new Error("missing_stale_finding_fixture");
      let staleSends = 0;
      await expect(
        deliverOperationalAlertOnce(
          {
            alertKey: reconciliationAlertKey(staleFinding),
            errorCode: staleFinding.summaryCode,
            findingId: staleFinding.findingId,
            findingObservationSequence: staleFinding.observationSequence,
            impact: staleFinding.impact,
            operation: "paid_without_pass",
          },
          {
            db,
            sink: {
              async send() {
                staleSends += 1;
              },
            },
          },
        ),
      ).resolves.toEqual({ status: "already_delivered_or_in_flight" });
      expect(staleSends).toBe(0);

      await seedOrder(db, "order_page_intent_first");
      const pageClaimed = deferred<void>();
      const releasePage = deferred<void>();
      let legitimateSends = 0;
      const mismatch = reconcileLiveCommerce(
        { orderId: "order_page_intent_first", source: "worker" },
        {
          commerceReader: {
            async readPaymentFact() {
              return { amountMinor: 999, currency: "usd", paymentState: "paid" };
            },
          },
          db,
          alertFinding: async (finding) => {
            await deliverOperationalAlertOnce(
              {
                alertKey: reconciliationAlertKey(finding),
                errorCode: finding.summaryCode,
                findingId: finding.findingId,
                findingObservationSequence: finding.observationSequence,
                impact: finding.impact,
                operation: "paid_without_pass",
              },
              {
                db,
                sink: {
                  async send() {
                    legitimateSends += 1;
                    pageClaimed.resolve();
                    await releasePage.promise;
                  },
                },
              },
            );
          },
        },
      );
      await pageClaimed.promise;
      await reconcileLiveCommerce(
        { orderId: "order_page_intent_first", source: "worker" },
        {
          commerceReader: {
            async readPaymentFact() {
              return { amountMinor: 999, currency: "usd", paymentState: "unpaid" };
            },
          },
          db,
        },
      );
      releasePage.resolve();
      await mismatch;
      expect(legitimateSends).toBe(1);
    });
  });
});

describe("audited Repair Actions", () => {
  test("requires preview, explicit confirmation, allowlisted fresh MFA, and replays idempotently", async () => {
    await withTestDb(async (db) => {
      await seedFinding(db, "finding_repair");
      await db.query("create table repair_probe (id text primary key, state text not null)");
      await db.query("insert into repair_probe (id, state) values ('probe', 'before')");
      const actionEvents: string[] = [];
      const executor = {
        actionTypes: ["manual_commerce_transition"] as const,
        async preview({ db: client }) {
          actionEvents.push("preview");
          const current = await client.query<{ state: string }>(
            "select state from repair_probe where id = 'probe'",
          );
          return { after: { state: "after" }, before: { state: current.rows[0]?.state } };
        },
        async prepareExecution() {
          actionEvents.push("prepare");
          return {
            async executeInTransaction({ db: client, lockFindingOrReplay, reserveRepairAction }) {
              actionEvents.push("lock");
              const locked = await lockFindingOrReplay();
              if (locked.status === "replayed") return locked;
              actionEvents.push("preview");
              const current = await client.query<{ state: string }>(
                "select state from repair_probe where id = 'probe'",
              );
              const stateChange = {
                after: { state: "after" },
                before: { state: current.rows[0]?.state },
              };
              const decision = await reserveRepairAction(locked.finding, stateChange);
              if (decision.status === "replayed") return decision;
              actionEvents.push("apply");
              await client.query("update repair_probe set state = 'after' where id = 'probe'");
              return { actionId: decision.actionId, after: { state: "after" }, status: "applied" };
            },
          };
        },
      } satisfies RepairActionDispatcher<"manual_commerce_transition">;
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
      expect(actionEvents).toEqual(["preview", "prepare", "lock", "preview", "apply"]);
    });
  });

  test("uses strict production actions for sensitive commerce and closure-operation classes", async () => {
    await withTestDb(async (db, state) => {
      const executor = createTripPassRepairActionDispatcher({
        commerceReader: {
          async readPaymentFact({ checkoutSessionId }) {
            expect(state.inTransaction).toBe(false);
            return {
              amountMinor: 999,
              currency: "usd",
              paymentState: checkoutSessionId?.includes("manual_transition") ? "unpaid" : "paid",
            };
          },
        },
      });
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
        { db, executor },
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
            executor,
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
        { db, executor },
      );
      await expect(
        executeRepairAction(
          commandFor("goodwill_grant", "finding_goodwill", goodwillPreview.digest),
          {
            allowlist: new Set(["account_operator"]),
            createId: () => "repair_goodwill",
            db,
            executor,
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
        { db, executor },
      );
      await expect(
        executeRepairAction(
          commandFor("account_recovery", "finding_recovery", recoveryPreview.digest),
          {
            allowlist: new Set(["account_operator"]),
            createId: () => "repair_recovery",
            db,
            executor,
          },
        ),
      ).resolves.toMatchObject({ status: "applied", after: { status: "pending" } });
    });
  });

  test("prepares authoritative payment proof outside locks and aborts a reversed grant", async () => {
    await withTestDb(async (db, state) => {
      await seedOrder(db, "order_reversed_before_lock");
      await db.query(
        "update trip_pass_orders set status = 'paid' where id = 'order_reversed_before_lock'",
      );
      await seedFindingFor(
        db,
        "finding_reversed_before_lock",
        "provider_application_failed",
        "trip_pass_order",
        "order_reversed_before_lock",
        "provider_application_failed",
      );
      const ordering: string[] = [];
      const executor = createTripPassRepairActionDispatcher({
        commerceReader: {
          async readPaymentFact() {
            expect(state.inTransaction).toBe(false);
            ordering.push("provider_lookup");
            return { amountMinor: 999, currency: "usd", paymentState: "refunded" };
          },
        },
      });
      const preview = await previewRepairAction(
        { actionType: "goodwill_grant", findingId: "finding_reversed_before_lock" },
        { db, executor },
      );
      await expect(
        executeRepairAction(
          commandFor("goodwill_grant", "finding_reversed_before_lock", preview.digest),
          {
            allowlist: new Set(["account_operator"]),
            db,
            executor,
          },
        ),
      ).rejects.toThrow("repair_authoritative_state_changed");
      expect(ordering).toEqual(["provider_lookup"]);
      const unchanged = await db.query<{ audits: string; grants: string; status: string }>(
        `select
           (select count(*)::text from operator_repair_actions
            where finding_id = 'finding_reversed_before_lock') as audits,
           (select count(*)::text from trip_pass_grants
            where order_id = 'order_reversed_before_lock') as grants,
           (select status from operational_findings
            where id = 'finding_reversed_before_lock') as status`,
      );
      expect(unchanged.rows).toEqual([{ audits: "0", grants: "0", status: "open" }]);
    });
  });

  test("initializes missing Usage Meters and releases one stale reservation", async () => {
    await withTestDb(async (db) => {
      await db.query("insert into users (id, email) values ('account_local_repairs', null)");
      await db.query(
        `insert into trip_passes (id, user_id, status, starts_at, expires_at)
         values (
           'pass_local_repairs', 'account_local_repairs', 'active',
           clock_timestamp() - interval '1 hour', clock_timestamp() + interval '14 days'
         )`,
      );
      await seedFindingFor(
        db,
        "finding_missing_meters",
        "missing_usage_meters",
        "trip_pass",
        "pass_local_repairs",
        "missing_usage_meters",
      );
      const executor = createTripPassRepairActionDispatcher({
        commerceReader: {
          async readPaymentFact() {
            throw new Error("local_repair_requested_provider_proof");
          },
        },
      });
      const meterPreview = await previewRepairAction(
        { actionType: "initialize_missing_meters", findingId: "finding_missing_meters" },
        { db, executor },
      );
      await expect(
        executeRepairAction(
          commandFor("initialize_missing_meters", "finding_missing_meters", meterPreview.digest),
          {
            allowlist: new Set(["account_operator"]),
            db,
            executor,
          },
        ),
      ).resolves.toMatchObject({ after: { meterCount: 1 }, status: "applied" });

      const meter = await db.query<{ id: string }>(
        `select id from trip_usage_meters
         where trip_pass_id = 'pass_local_repairs' and meter_type = 'chat_message'`,
      );
      await db.query(
        `insert into trip_usage_events (
           id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
           idempotency_key, request_id
         ) values (
           'event_stale_reservation', 'pass_local_repairs', $1, 'account_local_repairs',
           'reserved', 'chat_message', 1, 'stale-reservation-key', 'stale-reservation-request'
         )`,
        [meter.rows[0]?.id],
      );
      await seedFindingFor(
        db,
        "finding_stale_reservation",
        "stale_usage_reservation",
        "service",
        "event_stale_reservation",
        "stale_usage_reservation",
      );
      const reservationPreview = await previewRepairAction(
        {
          actionType: "release_stale_reservation",
          findingId: "finding_stale_reservation",
        },
        { db, executor },
      );
      await expect(
        executeRepairAction(
          commandFor(
            "release_stale_reservation",
            "finding_stale_reservation",
            reservationPreview.digest,
          ),
          {
            allowlist: new Set(["account_operator"]),
            db,
            executor,
          },
        ),
      ).resolves.toMatchObject({ after: { eventType: "released" }, status: "applied" });
    });
  });
});

describe("operational worker CLI", () => {
  test("selects one or every production task type with bounded controls", () => {
    expect(parseOperationalWorkerArguments(["--task=pending_stripe_event", "--batch=3"])).toEqual({
      batchSize: 3,
      cycleKey: undefined,
      enqueue: false,
      enqueueLimit: 100,
      leaseSeconds: 60,
      taskTypes: ["pending_stripe_event"],
    });
    expect(parseOperationalWorkerArguments(["--task=all", "--lease-seconds=30"])).toEqual({
      batchSize: 100,
      cycleKey: undefined,
      enqueue: false,
      enqueueLimit: 100,
      leaseSeconds: 30,
      taskTypes: undefined,
    });
    expect(() => parseOperationalWorkerArguments(["--task=unknown"])).toThrow(
      "invalid_operational_task_type",
    );
    expect(
      parseOperationalWorkerArguments([
        "--enqueue",
        "--cycle-key=cycle-20260808T12",
        "--enqueue-limit=5",
      ]),
    ).toMatchObject({ cycleKey: "cycle-20260808T12", enqueue: true, enqueueLimit: 5 });
    expect(
      parseOperationalTaskProducerArguments([
        "--task=retention_purge",
        "--cycle-key=cycle-1",
        "--limit=4",
      ]),
    ).toEqual({
      cycleKey: "cycle-1",
      limitPerType: 4,
      taskTypes: ["retention_purge"],
    });
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

  test("bounds stalled Sentry delivery", async () => {
    const sink = createSentryHttpSink({
      dsn: "https://public@example.invalid/42",
      timeoutMs: 100,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });

    await expect(
      sink.send({
        errorCode: "bounded_transport",
        eventId: "a".repeat(32),
        impact: "high",
        operation: "account_closure",
      }),
    ).rejects.toBeDefined();
  });

  test("delivers all durable page-worthy state families through Sentry", async () => {
    await withTestDb(async (db) => {
      await db.query(
        `insert into trip_pass_stripe_events (
          id, stripe_event_id, stripe_api_version, normalized_schema_version, event_type,
          object_type, object_id, status, attempt_count, alert_state
        ) values ('event_page', 'evt_page', '2026-07-29.preview', 1, 'checkout.session.completed',
          'checkout.session', 'cs_page', 'pending', 10, 'page')`,
      );
      await db.query("insert into users (id) values ('closure_page_user')");
      await db.query(
        `insert into account_closure_tombstones (
           id, subject_type, subject_hash, subject_hash_version, closure_policy_version,
           closed_at, purge_after
         ) values ('closure_page_tombstone', 'clerk_user_id', 'closure_page_hash', 1,
           'closure-v1', now(), now() + interval '1 day')`,
      );
      await db.query(
        `insert into account_closure_operations (
           id, tombstone_id, operation_type, status, attempts, phase_one_committed_at,
           closure_policy_version, commerce_policy_version
         ) values ('closure_page_operation', 'closure_page_tombstone', 'traveler_requested_closure',
           'pending', 3, now(), 'closure-v1', 'commerce-v1')`,
      );
      await db.query(
        `insert into account_closure_steps (
           id, operation_id, step_type, status, attempts, alerted_at
         ) values ('closure_page_step', 'closure_page_operation', 'clerk_deletion',
           'pending', 3, now())`,
      );
      const sent: string[] = [];
      const result = await deliverPendingPageWorthyAlerts({
        db,
        sink: {
          async send(event) {
            sent.push(event.operation);
          },
        },
      });

      expect(result.checked).toBeGreaterThanOrEqual(2);
      expect(sent).toContain("stripe_application");
      expect(sent).toContain("account_closure");
    });
  });

  test("reclaims crashed alert leases and fences stale provider completions", async () => {
    await withTestDb(async (db, state) => {
      await seedFinding(db, "finding_alert_lease");
      await db.query(
        `insert into operational_alert_deliveries (
           id, alert_key, finding_id, impact, destination, status, delivery_token,
           lease_expires_at, attempted_at
         ) values (
           'delivery_crashed', 'alert_crashed', 'finding_alert_lease', 'high', 'sentry',
           'sending', 'crashed_token', clock_timestamp() - interval '1 second',
           clock_timestamp() - interval '2 minutes'
         )`,
      );
      let sends = 0;
      const baseAlert = {
        errorCode: "paid_without_pass",
        findingId: "finding_alert_lease",
        impact: "high" as const,
        operation: "paid_without_pass" as const,
      };
      await expect(
        deliverOperationalAlertOnce(
          { ...baseAlert, alertKey: "alert_crashed" },
          {
            createId: () => "delivery_reclaimed",
            createToken: () => "reclaimed_token",
            db,
            sink: {
              async send() {
                expect(state.inTransaction).toBe(false);
                sends += 1;
              },
            },
          },
        ),
      ).resolves.toEqual({ status: "sent" });

      await expect(
        deliverOperationalAlertOnce(
          { ...baseAlert, alertKey: "alert_stale_completion" },
          {
            createId: () => "delivery_stale",
            createToken: () => "stale_token",
            db,
            leaseSeconds: 60,
            sink: {
              async send() {
                expect(state.inTransaction).toBe(false);
                sends += 1;
                await db.query(
                  `update operational_alert_deliveries
                   set lease_expires_at = clock_timestamp() - interval '1 second'
                   where alert_key = 'alert_stale_completion'`,
                );
              },
            },
          },
        ),
      ).resolves.toEqual({ status: "stale_delivery" });
      await expect(
        deliverOperationalAlertOnce(
          { ...baseAlert, alertKey: "alert_stale_completion" },
          {
            createId: () => "delivery_takeover",
            createToken: () => "takeover_token",
            db,
            sink: {
              async send() {
                expect(state.inTransaction).toBe(false);
                sends += 1;
              },
            },
          },
        ),
      ).resolves.toEqual({ status: "sent" });
      expect(sends).toBe(3);
    });
  });

  test("reuses one Sentry event identity across transport retry and rotates by lifecycle", async () => {
    await withTestDb(async (db) => {
      const eventIds: string[] = [];
      const logicalPages = new Set<string>();
      const alert = {
        alertKey: "reconciliation:incident_opaque:lifecycle:7",
        errorCode: "paid_without_pass",
        impact: "high" as const,
        operation: "paid_without_pass" as const,
      };
      await expect(
        deliverOperationalAlertOnce(alert, {
          createId: () => "delivery_event_retry",
          createToken: () => "event_retry_token_1",
          db,
          sink: {
            async send({ eventId }) {
              eventIds.push(eventId);
              logicalPages.add(eventId);
              throw new Error("transport_response_lost");
            },
          },
        }),
      ).resolves.toEqual({ status: "failed" });
      await expect(
        deliverOperationalAlertOnce(alert, {
          createId: () => "delivery_event_retry_again",
          createToken: () => "event_retry_token_2",
          db,
          sink: {
            async send({ eventId }) {
              eventIds.push(eventId);
              logicalPages.add(eventId);
            },
          },
        }),
      ).resolves.toEqual({ status: "sent" });
      await deliverOperationalAlertOnce(
        { ...alert, alertKey: "reconciliation:incident_opaque:lifecycle:8" },
        {
          createId: () => "delivery_new_lifecycle",
          createToken: () => "new_lifecycle_token",
          db,
          sink: {
            async send({ eventId }) {
              eventIds.push(eventId);
              logicalPages.add(eventId);
            },
          },
        },
      );
      expect(eventIds[0]).toMatch(/^[a-f0-9]{32}$/);
      expect(eventIds[1]).toBe(eventIds[0]);
      expect(eventIds[2]).not.toBe(eventIds[0]);
      expect(logicalPages.size).toBe(2);
    });
  });
});

describe("durable provider-neutral workers", () => {
  test("producer enqueues one stable reconciliation cycle and worker drains it", async () => {
    await withTestDb(async (db) => {
      const input = {
        cycleKey: "cycle-20260808T12",
        taskTypes: ["commerce_reconciliation"] as const,
      };
      expect(await enqueueDueOperationalTasks(input, db)).toMatchObject({
        commerce_reconciliation: 1,
      });
      expect(await enqueueDueOperationalTasks(input, db)).toMatchObject({
        commerce_reconciliation: 0,
      });
      const resourceRef = "all:cycle-20260808T12";
      const queued = await db.query<{ id: string; resource_ref: string; task_type: string }>(
        "select id, resource_ref, task_type from operational_worker_tasks",
      );
      expect(queued.rows).toEqual([
        {
          id: stableOperationalTaskId("commerce_reconciliation", resourceRef),
          resource_ref: resourceRef,
          task_type: "commerce_reconciliation",
        },
      ]);
      await expect(
        runOperationalWorker(
          { batchSize: 1, leaseSeconds: 60 },
          {
            db,
            handlers: { commerce_reconciliation: async () => undefined },
          },
        ),
      ).resolves.toEqual({ claimed: 1, failed: 0, stale: 0, succeeded: 1 });
    });
  });

  test("producer keys remain terminal-idempotent after every task kind succeeds", async () => {
    await withTestDb(async (db) => {
      const cycleKey = "cycle-terminal-idempotency";
      const inputs = operationalTaskTypes.map((taskType) => {
        const resourceRef =
          taskType === "commerce_reconciliation" ? `all:${cycleKey}` : `opaque:${taskType}`;
        return {
          id: stableOperationalTaskId(taskType, resourceRef),
          resourceRef,
          taskType,
        };
      });
      const concurrentCreates = await Promise.all(
        inputs.flatMap((input) => [
          enqueueOperationalTask(input, db),
          enqueueOperationalTask(input, db),
        ]),
      );
      expect(concurrentCreates.filter(Boolean)).toHaveLength(operationalTaskTypes.length);

      const handlers = Object.fromEntries(
        operationalTaskTypes.map((taskType) => [taskType, async () => undefined]),
      );
      await expect(
        runOperationalWorker(
          { batchSize: operationalTaskTypes.length, leaseSeconds: 60 },
          { db, handlers },
        ),
      ).resolves.toEqual({
        claimed: operationalTaskTypes.length,
        failed: 0,
        stale: 0,
        succeeded: operationalTaskTypes.length,
      });

      const replayed = await Promise.all(inputs.map((input) => enqueueOperationalTask(input, db)));
      expect(replayed).toEqual(inputs.map(() => false));
      const terminal = await db.query<{
        attempts: number;
        completed_at: Date | string | null;
        resource_ref: string;
        status: string;
      }>(
        `select attempts, completed_at, resource_ref, status
         from operational_worker_tasks order by task_type`,
      );
      expect(terminal.rows).toHaveLength(operationalTaskTypes.length);
      for (const row of terminal.rows) {
        expect(row.status).toBe("succeeded");
        expect(row.attempts).toBe(1);
        expect(row.completed_at).not.toBeNull();
        expect(row.resource_ref).toMatch(/^(?:all:cycle-|opaque:)[a-z_:-]+$/);
      }

      const nextCycle = await Promise.all([
        enqueueDueOperationalTasks(
          { cycleKey: "cycle-terminal-idempotency-next", taskTypes: ["commerce_reconciliation"] },
          db,
        ),
        enqueueDueOperationalTasks(
          { cycleKey: "cycle-terminal-idempotency-next", taskTypes: ["commerce_reconciliation"] },
          db,
        ),
      ]);
      expect(nextCycle.reduce((sum, result) => sum + result.commerce_reconciliation, 0)).toBe(1);
    });
  });

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

  test("fences an expired retry before takeover convergence", async () => {
    await withTestDb(async (db) => {
      await enqueueOperationalTask(
        { id: "worker_expired_retry", resourceRef: "expired", taskType: "retention_purge" },
        db,
      );
      const expired = await runOperationalWorker(
        { batchSize: 1, leaseSeconds: 60 },
        {
          createLeaseToken: () => "expired_retry_token",
          db,
          handlers: {
            retention_purge: async () => {
              await db.query(
                `update operational_worker_tasks
                 set lease_expires_at = clock_timestamp() - interval '1 second'
                 where id = 'worker_expired_retry'`,
              );
              throw new Error("expired_worker_crash");
            },
          },
        },
      );
      expect(expired).toEqual({ claimed: 1, failed: 0, stale: 1, succeeded: 0 });
      const takeover = await runOperationalWorker(
        { batchSize: 1, leaseSeconds: 60 },
        {
          createLeaseToken: () => "takeover_retry_token",
          db,
          handlers: { retention_purge: async () => undefined },
        },
      );
      expect(takeover).toEqual({ claimed: 1, failed: 0, stale: 0, succeeded: 1 });
    });
  });

  test("uses one opaque alert key per task across retries without cross-task suppression", async () => {
    await withTestDb(async (db) => {
      for (const id of ["raw_task_alpha", "raw_task_beta"]) {
        await enqueueOperationalTask({ id, resourceRef: id, taskType: "retention_purge" }, db);
        await db.query("update operational_worker_tasks set attempts = 2 where id = $1", [id]);
      }
      await db.query(
        `update operational_worker_tasks
         set next_attempt_at = clock_timestamp() + interval '1 day'
         where id = 'raw_task_beta'`,
      );
      const taskKeys: string[] = [];
      const failOne = () =>
        runOperationalWorker(
          { batchSize: 1, leaseSeconds: 60 },
          {
            db,
            handlers: { retention_purge: async () => Promise.reject(new Error("retry")) },
            onRepeatedFailure: async ({ taskKey }) => {
              taskKeys.push(taskKey);
            },
          },
        );
      await failOne();
      await db.query(
        "update operational_worker_tasks set next_attempt_at = clock_timestamp() where id = 'raw_task_alpha'",
      );
      await failOne();
      await db.query(
        "update operational_worker_tasks set next_attempt_at = clock_timestamp() where id = 'raw_task_beta'",
      );
      await failOne();
      expect(taskKeys[0]).toBe(taskKeys[1]);
      expect(taskKeys[2]).not.toBe(taskKeys[0]);
      expect(taskKeys).toEqual([
        opaqueTaskKey("raw_task_alpha"),
        opaqueTaskKey("raw_task_alpha"),
        opaqueTaskKey("raw_task_beta"),
      ]);
      expect(taskKeys.join(" ")).not.toContain("raw_task_");
    });
  });

  test("uses distinct stable warning and high escalation identities for one task", () => {
    const taskKey = opaqueTaskKey("raw_escalation_task");
    expect(workerFailureAlertKey(taskKey, 3)).toBe(workerFailureAlertKey(taskKey, 4));
    expect(workerFailureAlertKey(taskKey, 5)).toBe(workerFailureAlertKey(taskKey, 8));
    expect(workerFailureAlertKey(taskKey, 3)).not.toBe(workerFailureAlertKey(taskKey, 5));
    expect(workerFailureAlertKey(taskKey, 3)).not.toContain("raw_escalation_task");
  });

  test("keeps an Account Closure task retryable until every operation step is terminal", async () => {
    await withTestDb(async (db) => {
      const encrypted = encryptLocalClosureSubject("user_closure_multistep");
      await db.query(
        `insert into account_closure_tombstones (
           id, subject_hash, subject_hash_version, subject_type, closure_policy_version
         ) values ('closure_multistep_tombstone', 'closure_multistep_hash', 1,
           'clerk_user_id', 'local-closure-v1')`,
      );
      await db.query(
        `insert into account_closure_operations (
           id, tombstone_id, operation_type, status, phase_one_committed_at
         ) values ('closure_multistep_operation', 'closure_multistep_tombstone',
           'traveler_requested_closure', 'pending', clock_timestamp())`,
      );
      await db.query(
        `insert into account_closure_provider_subjects (
           operation_id, ciphertext, iv, auth_tag, key_version
         ) values ('closure_multistep_operation', $1, $2, $3, 1)`,
        [encrypted.ciphertext, encrypted.iv, encrypted.authTag],
      );
      await db.query(
        `insert into account_closure_steps (id, operation_id, step_type)
         values
           ('closure_multistep_clerk', 'closure_multistep_operation', 'clerk_deletion'),
           ('closure_multistep_checkout', 'closure_multistep_operation', 'checkout_expiry')`,
      );
      await enqueueOperationalTask(
        {
          id: "closure_multistep_task",
          resourceRef: "closure_multistep_operation",
          taskType: "account_closure",
        },
        db,
      );
      const handlers = createProductionOperationalTaskHandlers({
        closureProviders: {
          async deleteClerkUser() {},
          async expireCheckoutSession() {},
        },
        db,
      });
      await expect(
        runOperationalWorker({ batchSize: 1, leaseSeconds: 60 }, { db, handlers }),
      ).resolves.toEqual({ claimed: 1, failed: 1, stale: 0, succeeded: 0 });
      const partial = await db.query<{ operation_status: string; task_status: string }>(
        `select o.status as operation_status, t.status as task_status
         from account_closure_operations o
         join operational_worker_tasks t on t.resource_ref = o.id
         where o.id = 'closure_multistep_operation'`,
      );
      expect(partial.rows).toEqual([{ operation_status: "pending", task_status: "pending" }]);
      await db.query(
        `update operational_worker_tasks set next_attempt_at = clock_timestamp()
         where id = 'closure_multistep_task'`,
      );
      await expect(
        runOperationalWorker({ batchSize: 1, leaseSeconds: 60 }, { db, handlers }),
      ).resolves.toEqual({ claimed: 1, failed: 0, stale: 0, succeeded: 1 });
      const terminal = await db.query<{
        attempts: number;
        operation_status: string;
        task_status: string;
      }>(
        `select t.attempts, o.status as operation_status, t.status as task_status
         from account_closure_operations o
         join operational_worker_tasks t on t.resource_ref = o.id
         where o.id = 'closure_multistep_operation'`,
      );
      expect(terminal.rows).toEqual([
        { attempts: 2, operation_status: "succeeded", task_status: "succeeded" },
      ]);
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
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code,
       incident_key, last_detected_at
     ) values ($1, 'run_repair', 'payment_state_mismatch', 'high',
       'trip_pass_order', 'order_private', 'payment_state_mismatch', $2, clock_timestamp())`,
    [findingId, `incident_${findingId}`],
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
       id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code,
       incident_key, last_detected_at
     ) values ($1, $2, $3, 'high', $4, $5, $6, $7, clock_timestamp())`,
    [findingId, runId, kind, entityType, entityRef, summaryCode, `incident_${findingId}`],
  );
}

function commandFor(actionType: RepairActionType, findingId: string, previewDigest: string) {
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

function encryptLocalClosureSubject(value: string) {
  const iv = Buffer.alloc(12, 2);
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
