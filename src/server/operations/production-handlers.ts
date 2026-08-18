import Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import type { OperationalTaskHandlers } from "@/server/operations/contracts";
import { createLemonSqueezyCommerceReader } from "@/server/operations/lemon-squeezy-commerce-reader";
import type {
  AuthoritativeCommerceReader,
  OperationalFindingView,
} from "@/server/operations/live-reconciliation";
import { reconcileLiveCommerce } from "@/server/operations/live-reconciliation";
import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";
import type { StripeRefundClient } from "@/server/payments/stripe";
import { applyStripeInboxEvent } from "@/server/payments/stripe-event-inbox";
import { readAccountClosurePolicy, runClosureCleanupBatch } from "@/server/privacy/account-closure";
import { readLemonSqueezyEnvironment } from "@/server/trip-pass/catalog";
import { runPaidAfterClosureRefundBatch } from "@/server/trip-pass/paid-after-closure-refund";
import { purgeExpiredPaidAnswerDetails } from "@/server/trip-pass/paid-answer-reservations";
import {
  applyTripPassStripeEvent,
  prepareTripPassStripeEvent,
} from "@/server/trip-pass/webhook-application";

type ClosureProviders = {
  deleteClerkUser(userId: string): Promise<void>;
  expireCheckoutSession(sessionId: string): Promise<void>;
};

export function createProductionOperationalTaskHandlers(dependencies: {
  alertFinding?: (finding: OperationalFindingView) => Promise<void>;
  closureProviders?: ClosureProviders;
  commerceReader?: AuthoritativeCommerceReader;
  db: DatabaseQueryClient;
  refundClient?: StripeRefundClient;
}): OperationalTaskHandlers {
  const { db } = dependencies;
  return {
    account_closure: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "account_closure_cleanup", result: "started" });
      const result = await runClosureCleanupBatch({
        db,
        limit: 1,
        now: new Date(),
        operationId: resourceRef,
        policy: readAccountClosurePolicy(),
        providers: dependencies.closureProviders ?? createDefaultClosureProviders(),
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
    paid_after_closure_refund: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "paid_after_closure_refund", result: "started" });
      const result = await runPaidAfterClosureRefundBatch({
        db,
        limit: 1,
        obligationId: resourceRef,
        stripe: dependencies.refundClient,
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
    commerce_reconciliation: async ({ resourceRef, trace }) => {
      await trace.record({ index: 0, operation: "commerce_reconciliation", result: "started" });
      await reconcileLiveCommerce(
        {
          orderId:
            resourceRef === "all" || resourceRef.startsWith("all:") ? undefined : resourceRef,
          source: "worker",
        },
        {
          commerceReader: dependencies.commerceReader ?? createDefaultCommerceReader(),
          db,
          recordEvent: trace.record,
          alertFinding: dependencies.alertFinding,
        },
      );
      await trace.record({ index: 0, operation: "commerce_reconciliation", result: "succeeded" });
    },
  };
}

function createDefaultCommerceReader() {
  if (readLemonSqueezyEnvironment().configured) return createLemonSqueezyCommerceReader();
  return createStripeCommerceReader(createStripeServerClient());
}

function createDefaultClosureProviders(): ClosureProviders {
  return {
    async deleteClerkUser(userId) {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const clerk = await clerkClient();
      try {
        await clerk.users.deleteUser(userId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    async expireCheckoutSession(sessionId) {
      const stripe = createStripeServerClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    },
  };
}

function createStripeServerClient() {
  const apiKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("stripe_configuration_unavailable");
  return new Stripe(apiKey);
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}
