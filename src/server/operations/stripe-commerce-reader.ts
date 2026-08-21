import type Stripe from "stripe";

import type {
  AuthoritativeCommerceReader,
  AuthoritativePaymentFact,
} from "@/server/operations/live-reconciliation";
import { runProviderOperation } from "@/server/providers/provider-abort";

export function createStripeCommerceReader(
  stripe: Pick<Stripe, "checkout" | "paymentIntents">,
): AuthoritativeCommerceReader {
  return {
    async readPaymentFact(input) {
      if (input.paymentIntentId) {
        const intent = await runProviderOperation(
          () =>
            stripe.paymentIntents.retrieve(input.paymentIntentId as string, {
              expand: ["latest_charge"],
            }),
          input.signal,
        );
        return {
          amountMinor: intent.amount_received || intent.amount,
          currency: intent.currency,
          paymentState: paymentIntentState(intent),
        };
      }
      if (input.checkoutSessionId) {
        const session = await runProviderOperation(
          () => stripe.checkout.sessions.retrieve(input.checkoutSessionId as string),
          input.signal,
        );
        return {
          amountMinor: session.amount_total,
          currency: session.currency,
          paymentState: checkoutPaymentState(session.payment_status),
        };
      }
      return { amountMinor: null, currency: null, paymentState: "unpaid" };
    },
  };
}

function checkoutPaymentState(
  status: Stripe.Checkout.Session.PaymentStatus | null,
): AuthoritativePaymentFact["paymentState"] {
  if (status === "paid" || status === "no_payment_required") return "paid";
  return status === "unpaid" ? "unpaid" : "pending";
}

function paymentIntentState(
  intent: Stripe.PaymentIntent,
): AuthoritativePaymentFact["paymentState"] {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (charge?.disputed) return "disputed";
  if (charge?.refunded) return "refunded";
  if (intent.status === "succeeded") return "paid";
  if (intent.status === "canceled") return "unpaid";
  return "pending";
}
