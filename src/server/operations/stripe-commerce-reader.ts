import type Stripe from "stripe";

import type {
  AuthoritativeCommerceReader,
  AuthoritativePaymentFact,
} from "@/server/operations/live-reconciliation";

export function createStripeCommerceReader(
  stripe: Pick<Stripe, "checkout" | "paymentIntents">,
): AuthoritativeCommerceReader {
  return {
    async readPaymentFact(input) {
      if (input.checkoutSessionId) {
        const session = await stripe.checkout.sessions.retrieve(input.checkoutSessionId);
        return {
          amountMinor: session.amount_total,
          currency: session.currency,
          paymentState: checkoutPaymentState(session.payment_status),
        };
      }
      if (input.paymentIntentId) {
        const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
        return {
          amountMinor: intent.amount_received || intent.amount,
          currency: intent.currency,
          paymentState: paymentIntentState(intent.status),
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
  status: Stripe.PaymentIntent.Status,
): AuthoritativePaymentFact["paymentState"] {
  if (status === "succeeded") return "paid";
  if (status === "canceled") return "unpaid";
  return "pending";
}
