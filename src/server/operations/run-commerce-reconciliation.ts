import type Stripe from "stripe";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import type { AuthoritativeCommerceReader } from "@/server/operations/live-reconciliation";
import {
  reconcileLiveCommerce,
  reconciliationAlertKey,
} from "@/server/operations/live-reconciliation";
import { createProductionStripeCommerceReader } from "@/server/operations/production-stripe-commerce-reader";
import {
  createSentryHttpSink,
  deliverOperationalAlertOnce,
} from "@/server/operations/sentry-alerts";

export async function runCommerceReconciliationCommand(
  dependencies: {
    argv?: string[];
    commerceReader?: AuthoritativeCommerceReader;
    createStripeClient?: (apiKey: string) => Pick<Stripe, "checkout" | "paymentIntents">;
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const env = dependencies.env ?? process.env;
  const orderArgument = (dependencies.argv ?? process.argv).find((argument) =>
    argument.startsWith("--order="),
  );
  const orderId = orderArgument?.slice("--order=".length).trim();
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const sentrySink = env.SENTRY_DSN ? createSentryHttpSink({ dsn: env.SENTRY_DSN }) : null;
  return reconcileLiveCommerce(
    { orderId: orderId || undefined, source: "cli" },
    {
      commerceReader:
        dependencies.commerceReader ??
        createProductionStripeCommerceReader({
          createStripeClient: dependencies.createStripeClient,
          env,
        }),
      db,
      alertFinding: sentrySink
        ? async (finding) => {
            await deliverOperationalAlertOnce(
              {
                alertKey: reconciliationAlertKey(finding),
                errorCode: finding.summaryCode,
                findingId: finding.findingId,
                findingObservationSequence: finding.observationSequence,
                impact: finding.impact,
                operation:
                  finding.kind === "paid_without_pass"
                    ? "paid_without_pass"
                    : "live_reconciliation",
              },
              { db, sink: sentrySink },
            );
          }
        : undefined,
    },
  );
}

if (import.meta.main) {
  const result = await runCommerceReconciliationCommand();
  console.info(
    JSON.stringify({
      checked: "live-commerce-reconciliation",
      checkedCount: result.checkedCount,
      findings: result.findings,
      runId: result.runId,
      trace: result.trace,
    }),
  );
}
