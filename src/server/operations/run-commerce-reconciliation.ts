import Stripe from "stripe";

import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  reconcileLiveCommerce,
  reconciliationAlertKey,
} from "@/server/operations/live-reconciliation";
import {
  createSentryHttpSink,
  deliverOperationalAlertOnce,
} from "@/server/operations/sentry-alerts";
import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";

const apiKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;
if (!apiKey) throw new Error("Stripe server configuration is required for live reconciliation.");

const orderArgument = process.argv.find((argument) => argument.startsWith("--order="));
const orderId = orderArgument?.slice("--order=".length).trim();
const db = getDefaultDatabaseQueryClient();
const sentrySink = process.env.SENTRY_DSN
  ? createSentryHttpSink({ dsn: process.env.SENTRY_DSN })
  : null;
const result = await reconcileLiveCommerce(
  { orderId: orderId || undefined, source: "cli" },
  {
    commerceReader: createStripeCommerceReader(new Stripe(apiKey)),
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
                finding.kind === "paid_without_pass" ? "paid_without_pass" : "live_reconciliation",
            },
            { db, sink: sentrySink },
          );
        }
      : undefined,
  },
);

console.info(
  JSON.stringify({
    checked: "live-commerce-reconciliation",
    checkedCount: result.checkedCount,
    findings: result.findings,
    runId: result.runId,
    trace: result.trace,
  }),
);
