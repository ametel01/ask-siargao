import Stripe from "stripe";

import {
  type AuditLifecycleRecord,
  type VerifiedCheckoutPayment,
  assertCanStartCheckout,
} from "@/server/audit/lifecycle";

export const AUDIT_PRICE_CENTS = 999;
export const AUDIT_PRICE_USD = 9.99;

export type StripeCheckoutClient = {
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
  ) => Promise<{ id: string; url: string | null }>;
};

export function createStripeClient(apiKey = stripeApiKeyFromEnv()) {
  return new Stripe(apiKey);
}

export function createStripeCheckoutClient(stripe = createStripeClient()): StripeCheckoutClient {
  return {
    createCheckoutSession: (params) => stripe.checkout.sessions.create(params),
  };
}

export async function createCheckoutSessionForAudit(input: {
  audit: AuditLifecycleRecord;
  appUrl: string;
  customerEmail?: string;
  client?: StripeCheckoutClient;
}) {
  const client = input.client ?? createStripeCheckoutClient();
  const params = buildAuditCheckoutSessionParams(input);
  const session = await client.createCheckoutSession(params);

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout Session URL.");
  }

  return {
    id: session.id,
    url: session.url,
    params,
  };
}

export function buildAuditCheckoutSessionParams(input: {
  audit: AuditLifecycleRecord;
  appUrl: string;
  customerEmail?: string;
}): Stripe.Checkout.SessionCreateParams {
  assertCanStartCheckout(input.audit);
  const appUrl = input.appUrl.replace(/\/$/, "");

  return {
    mode: "payment",
    client_reference_id: input.audit.id,
    customer_email: input.customerEmail,
    success_url: `${appUrl}/audits/${input.audit.id}/status?checkout=return`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    metadata: {
      auditRequestId: input.audit.id,
      product: "siargao_trip_risk_audit",
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: AUDIT_PRICE_CENTS,
          product_data: {
            name: "Siargao Trip Risk Audit",
            description: "One evidence-led trip risk audit for a submitted Siargao plan.",
          },
        },
      },
    ],
  };
}

export async function verifyStripeWebhookPayload(input: {
  payload: string | Buffer;
  signature: string;
  webhookSecret: string;
  stripe?: Stripe;
}) {
  const stripe = input.stripe ?? createStripeClient();

  return stripe.webhooks.constructEventAsync(input.payload, input.signature, input.webhookSecret);
}

export function extractVerifiedCheckoutPayment(
  event: Stripe.Event,
): VerifiedCheckoutPayment | null {
  if (event.type !== "checkout.session.completed") {
    return null;
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return null;
  }

  const auditRequestId = session.metadata?.auditRequestId ?? session.client_reference_id;
  if (!auditRequestId) {
    throw new Error("Verified checkout session is missing auditRequestId metadata.");
  }

  return {
    auditRequestId,
    stripeEventId: event.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id,
    eventType: event.type,
  };
}

export function buildVerifiedPaymentEventRecord(input: {
  payment: VerifiedCheckoutPayment;
  rawEvent: Stripe.Event;
  verifiedAt: Date;
}) {
  return {
    id: `payment_event_${input.payment.stripeEventId}`,
    auditRequestId: input.payment.auditRequestId,
    stripeEventId: input.payment.stripeEventId,
    stripeCheckoutSessionId: input.payment.stripeCheckoutSessionId,
    stripePaymentIntentId: input.payment.stripePaymentIntentId,
    eventType: input.payment.eventType,
    verifiedAt: input.verifiedAt.toISOString(),
    rawEvent: input.rawEvent as unknown as Record<string, unknown>,
  };
}

function stripeApiKeyFromEnv() {
  const apiKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    throw new Error("STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY is required for Stripe calls.");
  }

  return apiKey;
}
