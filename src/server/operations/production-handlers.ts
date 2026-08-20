import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { OperationalTaskHandlers } from "@/server/operations/contracts";
import { createLemonSqueezyCommerceReader } from "@/server/operations/lemon-squeezy-commerce-reader";
import type {
  AuthoritativeCommerceReader,
  OperationalFindingView,
} from "@/server/operations/live-reconciliation";
import { reconcileLiveCommerce } from "@/server/operations/live-reconciliation";
import { runTrackedOperationalSchedule } from "@/server/operations/operational-schedule-sentinel";
import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";
import {
  applyPendingLemonSqueezyPaymentEvent,
  receiveLemonSqueezyPaymentFact,
} from "@/server/payments/payment-event-receipts";
import { createStripeServerClient, type StripeRefundClient } from "@/server/payments/stripe";
import { applyStripeInboxEvent } from "@/server/payments/stripe-event-inbox";
import { readAccountClosurePolicy, runClosureCleanupBatch } from "@/server/privacy/account-closure";
import {
  combineAbortSignals,
  providerRequestTimeoutMs,
  runProviderOperation,
} from "@/server/providers/provider-abort";
import { readLemonSqueezyEnvironment } from "@/server/trip-pass/catalog";
import { runCheckoutReturnLookup } from "@/server/trip-pass/checkout-return-lookup";
import {
  createLemonSqueezyCheckoutClient,
  type LemonSqueezyCheckoutClient,
} from "@/server/trip-pass/lemon-squeezy-adapter";
import { runLemonSqueezyRefundBatch } from "@/server/trip-pass/lemon-squeezy-refund-worker";
import { applyLemonSqueezyPaymentFact } from "@/server/trip-pass/lemon-squeezy-webhook-application";
import { runPaidAfterClosureRefundBatch } from "@/server/trip-pass/paid-after-closure-refund";
import { purgeExpiredPaidAnswerDetails } from "@/server/trip-pass/paid-answer-reservations";
import {
  applyTripPassStripeEvent,
  prepareTripPassStripeEvent,
} from "@/server/trip-pass/webhook-application";

type ClosureProviders = {
  deleteClerkUser(userId: string, signal?: AbortSignal): Promise<void>;
  expireCheckoutSession(sessionId: string, signal?: AbortSignal): Promise<void>;
};

export function createProductionOperationalTaskHandlers(dependencies: {
  alertFinding?: (finding: OperationalFindingView) => Promise<void>;
  closureProviders?: ClosureProviders;
  commerceReader?: AuthoritativeCommerceReader;
  commerceReaders?: Partial<Record<"stripe" | "lemon_squeezy", AuthoritativeCommerceReader>>;
  db: DatabaseQueryClient;
  lemonRefundClient?: LemonSqueezyCheckoutClient;
  lemonCheckoutClient?: Pick<LemonSqueezyCheckoutClient, "retrieveOrder">;
  refundClient?: StripeRefundClient;
}): OperationalTaskHandlers {
  const { db } = dependencies;
  return {
    account_closure: async ({ resourceRef, signal, trace }) => {
      await trace.record({ index: 0, operation: "account_closure_cleanup", result: "started" });
      const result = await runClosureCleanupBatch({
        db,
        limit: 1,
        now: new Date(),
        operationId: resourceRef,
        policy: readAccountClosurePolicy(),
        providers: dependencies.closureProviders ?? createDefaultClosureProviders(),
        signal,
      });
      const operation = await db.query<{ status: string }>(
        "select status from account_closure_operations where id = $1",
        [resourceRef],
      );
      if (!operation.rows[0]) throw new Error("closure_task_unavailable");
      if (operation.rows[0].status !== "succeeded") {
        throw new Error(result.retrying > 0 ? "closure_task_retryable" : "closure_task_incomplete");
      }
      await trace.record({ index: 0, operation: "account_closure_cleanup", result: "succeeded" });
    },
    checkout_return_lookup: async ({ resourceRef, signal, trace }) => {
      await trace.record({ index: 0, operation: "payment_event_application", result: "started" });
      await runCheckoutReturnLookup(resourceRef, {
        client: dependencies.lemonCheckoutClient,
        db,
        env: process.env,
        signal,
      });
      await trace.record({
        index: 0,
        operation: "payment_event_application",
        result: "succeeded",
      });
    },
    pending_payment_event: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "payment_event_application", result: "started" });
      const result = await applyPendingLemonSqueezyPaymentEvent(resourceRef, {
        applyFact: ({ fact, db: factDb, now }) =>
          applyLemonSqueezyPaymentFact(fact, { db: factDb, now, env: process.env }),
        db,
      });
      if (
        result.status !== "applied" &&
        result.status !== "duplicate" &&
        result.status !== "blocked"
      ) {
        throw new Error("payment_event_application_retryable");
      }
      await trace.record({
        index: 0,
        operation: "payment_event_application",
        result: "succeeded",
      });
    },
    pending_stripe_event: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "stripe_inbox_preparation", result: "started" });
      const result = await applyStripeInboxEvent(resourceRef, {
        applyEvent: async (prepared, options) =>
          applyTripPassStripeEvent(prepared.event, {
            db: options.db,
            now: options.now,
            preparedEvent: prepared,
          }),
        db,
        prepareEvent: prepareTripPassStripeEvent,
      });
      if (result.status !== "applied" && result.status !== "blocked") {
        throw new Error("stripe_inbox_retryable");
      }
      await trace.record({ index: 0, operation: "stripe_inbox_preparation", result: "succeeded" });
    },
    paid_after_closure_refund: async ({ resourceRef, signal, trace }) => {
      await trace.record({ index: 0, operation: "paid_after_closure_refund", result: "started" });
      const result = await runPaidAfterClosureRefundBatch({
        db,
        limit: 1,
        obligationId: resourceRef,
        stripe: dependencies.refundClient,
        signal,
      });
      if (result.claimed !== 1 || result.confirmed !== 1) {
        const obligation = await db.query<{ status: string }>(
          "select status from account_closure_refund_obligations where id = $1",
          [resourceRef],
        );
        if (obligation.rows[0]?.status !== "succeeded") {
          throw new Error("paid_after_closure_refund_retryable");
        }
      }
      await trace.record({ index: 0, operation: "paid_after_closure_refund", result: "succeeded" });
    },
    lemon_squeezy_refund: async ({ resourceRef, signal, trace }) => {
      await trace.record({ index: 0, operation: "lemon_squeezy_refund", result: "started" });
      const result = await runLemonSqueezyRefundBatch({
        client: dependencies.lemonRefundClient ?? createLemonSqueezyCheckoutClient(),
        db,
        limit: 1,
        operationId: resourceRef,
        signal,
        applyFact: async (fact) => {
          const applied = await applyLemonSqueezyPaymentFact(fact, { db, env: process.env });
          if (applied.status === "rejected") {
            throw new Error(`refund_payment_fact_rejected:${applied.reason}`);
          }
        },
      });
      if (result.claimed !== 1 || result.confirmed !== 1) {
        const operation = await db.query<{ status: string }>(
          "select status from trip_pass_refund_operations where id = $1",
          [resourceRef],
        );
        if (operation.rows[0]?.status !== "succeeded") {
          throw new Error("lemon_squeezy_refund_retryable");
        }
      }
      await trace.record({ index: 0, operation: "lemon_squeezy_refund", result: "succeeded" });
    },
    retention_purge: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "retention_purge", result: "started" });
      const purged = await purgeExpiredPaidAnswerDetails(db, 1, resourceRef);
      if (purged !== 1) {
        const reservation = await db.query<{ details_purged_at: Date | string | null }>(
          "select details_purged_at from paid_answer_reservations where id = $1",
          [resourceRef],
        );
        if (!reservation.rows[0]?.details_purged_at) throw new Error("retention_task_not_due");
      }
      await trace.record({ index: 0, operation: "retention_purge", result: "succeeded" });
    },
    commerce_reconciliation: async ({ resourceRef, signal, trace }) => {
      await trace.record({ index: 0, operation: "commerce_reconciliation", result: "started" });
      const target = parseCommerceReconciliationTarget(resourceRef);
      await runTrackedOperationalSchedule(
        "commerce_reconciliation",
        async () => {
          await reconcileLiveCommerce(
            {
              orderId: target.orderId,
              scope: target.scope,
              source: "worker",
            },
            {
              applyVerifiedPaymentFact: async ({ fact, local }) => {
                if (fact.provider !== "lemon_squeezy") return;
                const result = await receiveLemonSqueezyPaymentFact(
                  { ...fact, orderId: local.id },
                  {
                    applyFact: ({ fact: correlatedFact, db: factDb, now }) =>
                      applyLemonSqueezyPaymentFact(correlatedFact, {
                        db: factDb,
                        env: process.env,
                        now,
                      }),
                    db,
                  },
                );
                if (result.status === "pending" || result.status === "blocked") {
                  throw new Error(
                    `reconciliation_payment_fact_${result.status}:${result.reason ?? "unknown"}`,
                  );
                }
              },
              commerceReader: dependencies.commerceReader ?? createDefaultCommerceReader(),
              commerceReaders: dependencies.commerceReaders ?? createDefaultCommerceReaders(),
              db,
              signal,
              recordEvent: trace.record,
              alertFinding: dependencies.alertFinding,
            },
          );
        },
        { db },
      );
      await trace.record({ index: 0, operation: "commerce_reconciliation", result: "succeeded" });
    },
  };
}

export function parseCommerceReconciliationTarget(resourceRef: string) {
  const match = /^(risk|daily):([^:]+):(.+)$/.exec(resourceRef);
  if (!match) throw new Error("invalid_commerce_reconciliation_target");
  const orderId = match[3] ?? "";
  if (!orderId) throw new Error("invalid_commerce_reconciliation_target");
  return { orderId, scope: match[1] as "risk" | "daily" };
}

function createDefaultCommerceReader() {
  if (readLemonSqueezyEnvironment().configured) return createLemonSqueezyCommerceReader();
  return createStripeCommerceReader(createStripeServerClient());
}

export function createDefaultCommerceReaders(
  options: {
    env?: Record<string, string | undefined>;
    createStripeClient?: (apiKey: string) => Pick<Stripe, "checkout" | "paymentIntents">;
  } = {},
) {
  const env = options.env ?? process.env;
  const readers: Partial<Record<"stripe" | "lemon_squeezy", AuthoritativeCommerceReader>> = {};
  if (readLemonSqueezyEnvironment(env).configured) {
    readers.lemon_squeezy = createLemonSqueezyCommerceReader();
  }
  const stripeKey = env.STRIPE_RESTRICTED_KEY ?? env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    readers.stripe = createStripeCommerceReader(
      options.createStripeClient?.(stripeKey) ?? createStripeServerClient(stripeKey),
    );
  }
  return readers;
}

function createDefaultClosureProviders(): ClosureProviders {
  return {
    async deleteClerkUser(userId, signal) {
      await deleteClerkUserThroughBackendApi(userId, {
        secretKey: process.env.CLERK_SECRET_KEY,
        signal,
      });
    },
    async expireCheckoutSession(sessionId, signal) {
      const stripe = createStripeServerClient();
      const session = await runProviderOperation(
        () => stripe.checkout.sessions.retrieve(sessionId),
        signal,
      );
      if (session.status === "open") {
        await runProviderOperation(() => stripe.checkout.sessions.expire(sessionId), signal);
      }
    },
  };
}

export async function deleteClerkUserThroughBackendApi(
  userId: string,
  options: {
    fetch?: (request: string, init?: RequestInit) => Promise<Response>;
    secretKey?: string;
    apiUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
) {
  if (!options.secretKey) throw new Error("clerk_configuration_unavailable");
  const signal = combineAbortSignals([
    options.signal,
    AbortSignal.timeout(options.timeoutMs ?? providerRequestTimeoutMs),
  ]);
  const apiUrl = (options.apiUrl ?? process.env.CLERK_API_URL ?? "https://api.clerk.com").replace(
    /\/$/,
    "",
  );
  const response = await (options.fetch ?? fetch)(
    `${apiUrl}/v1/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${options.secretKey}` },
      signal,
    },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error("clerk_user_deletion_failed");
}
