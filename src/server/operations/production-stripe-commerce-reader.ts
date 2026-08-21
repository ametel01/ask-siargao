import type Stripe from "stripe";

import type { AuthoritativeCommerceReader } from "@/server/operations/live-reconciliation";
import { createStripeCommerceReader } from "@/server/operations/stripe-commerce-reader";
import { createStripeServerClient } from "@/server/payments/stripe";

export function createProductionStripeCommerceReader(
  options: {
    createStripeClient?: (apiKey: string) => Pick<Stripe, "checkout" | "paymentIntents">;
    env?: Record<string, string | undefined>;
  } = {},
): AuthoritativeCommerceReader {
  const env = options.env ?? process.env;
  const apiKey = env.STRIPE_RESTRICTED_KEY ?? env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("stripe_configuration_unavailable");
  return createStripeCommerceReader(
    options.createStripeClient?.(apiKey) ?? createStripeServerClient(apiKey),
  );
}
