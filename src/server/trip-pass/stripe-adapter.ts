import Stripe from "stripe";

import {
  tripPassProductCatalog,
  tripPassProductCode,
  tripPassProductFamily,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";

export type TripPassCheckoutOrderSnapshot = {
  id: string;
  checkoutIdempotencyKey: string;
  checkoutSessionExpiresAt: Date;
  userId: string;
  productFamily: string;
  customerEmail?: string | null;
  stripePriceId: string;
};

export type TripPassCheckoutSessionSummary = {
  id: string;
  url: string;
  clientReferenceId: string | null;
  metadata: Record<string, string> | null;
  amountTotalMinor: number | null;
  currency: string | null;
  expiresAt: Date | null;
  priceId: string | null;
  status: "open" | "complete" | "expired" | null;
  termsConsentCollected: boolean | null;
};

export type TripPassCheckoutClient = {
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
    options: { idempotencyKey: string },
  ) => Promise<TripPassCheckoutSessionSummary>;
  expireCheckoutSession: (sessionId: string) => Promise<TripPassCheckoutSessionSummary>;
};

export function createTripPassCheckoutClient(
  stripe = createStripeClient(),
): TripPassCheckoutClient {
  return {
    async createCheckoutSession(params, options) {
      const session = await stripe.checkout.sessions.create(params, {
        idempotencyKey: options.idempotencyKey,
      });

      return summarizeTripPassCheckoutSession(session);
    },
    async expireCheckoutSession(sessionId) {
      const session = await stripe.checkout.sessions.expire(sessionId, {
        expand: ["line_items"],
      });
      return summarizeTripPassCheckoutSession(session);
    },
  };
}

export function buildTripPassCheckoutSessionParams(input: {
  order: TripPassCheckoutOrderSnapshot;
  appUrl: string;
}) {
  const appUrl = input.appUrl.replace(/\/$/, "");

  return {
    mode: "payment",
    client_reference_id: input.order.id,
    customer_email: input.order.customerEmail ?? undefined,
    payment_method_types: ["card"],
    expires_at: Math.floor(input.order.checkoutSessionExpiresAt.getTime() / 1000),
    consent_collection: {
      terms_of_service: "required",
    },
    success_url: `${appUrl}/settings?trip_pass_checkout=return&order=${encodeURIComponent(
      input.order.id,
    )}`,
    cancel_url: `${appUrl}/settings?trip_pass_checkout=cancelled&order=${encodeURIComponent(
      input.order.id,
    )}`,
    metadata: {
      tripPassOrderId: input.order.id,
      productCode: tripPassProductCode,
      productFamily: tripPassProductFamily,
      productVersion: String(tripPassProductVersion),
      durationHours: String(tripPassCheckoutProductSnapshot.durationHours),
      chatMessageLimit: String(tripPassCheckoutProductSnapshot.meterLimits.chat_message),
      termsPolicyVersion: tripPassCheckoutProductSnapshot.policyVersions.terms,
      refundPolicyVersion: tripPassCheckoutProductSnapshot.policyVersions.refund,
      privacyPolicyVersion: tripPassCheckoutProductSnapshot.policyVersions.privacy,
      retentionPolicyVersion: tripPassCheckoutProductSnapshot.policyVersions.retention,
    },
    line_items: [
      {
        price: input.order.stripePriceId,
        quantity: 1,
      },
    ],
    expand: ["line_items"],
  } satisfies Stripe.Checkout.SessionCreateParams;
}

export function validateTripPassCheckoutSession(input: {
  session: TripPassCheckoutSessionSummary;
  order: TripPassCheckoutOrderSnapshot;
}) {
  if (!input.session.url) {
    throw new Error("Stripe did not return a Trip Pass Checkout Session URL.");
  }
  if (input.session.clientReferenceId !== input.order.id) {
    throw new Error("Stripe Trip Pass Checkout Session client reference does not match order.");
  }
  if (input.session.metadata?.tripPassOrderId !== input.order.id) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match order.");
  }
  if (input.session.metadata?.productCode !== tripPassProductCode) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match product.");
  }
  if (input.session.metadata?.productFamily !== input.order.productFamily) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match product family.");
  }
  if (input.session.metadata?.productVersion !== String(tripPassProductVersion)) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match product version.");
  }
  if (
    input.session.metadata?.durationHours !==
      String(tripPassCheckoutProductSnapshot.durationHours) ||
    input.session.metadata?.chatMessageLimit !==
      String(tripPassCheckoutProductSnapshot.meterLimits.chat_message)
  ) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match product terms.");
  }
  if (
    input.session.metadata?.termsPolicyVersion !==
      tripPassCheckoutProductSnapshot.policyVersions.terms ||
    input.session.metadata?.refundPolicyVersion !==
      tripPassCheckoutProductSnapshot.policyVersions.refund ||
    input.session.metadata?.privacyPolicyVersion !==
      tripPassCheckoutProductSnapshot.policyVersions.privacy ||
    input.session.metadata?.retentionPolicyVersion !==
      tripPassCheckoutProductSnapshot.policyVersions.retention
  ) {
    throw new Error("Stripe Trip Pass Checkout Session metadata does not match policy versions.");
  }
  if (
    input.session.amountTotalMinor !== tripPassCheckoutProductSnapshot.amountTotalMinor ||
    input.session.currency !== tripPassCheckoutProductSnapshot.currency
  ) {
    throw new Error("Stripe Trip Pass Checkout Session amount or currency does not match product.");
  }
  if (input.session.priceId !== input.order.stripePriceId) {
    throw new Error("Stripe Trip Pass Checkout Session price does not match configuration.");
  }
  if (input.session.status !== "open") {
    throw new Error("Stripe Trip Pass Checkout Session did not remain payable.");
  }
}

export function summarizeTripPassCheckoutSession(
  session: Stripe.Checkout.Session,
): TripPassCheckoutSessionSummary {
  return {
    id: session.id,
    url: session.url ?? "",
    clientReferenceId: session.client_reference_id,
    metadata: session.metadata,
    amountTotalMinor: session.amount_total,
    currency: session.currency,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    priceId: checkoutSessionPriceId(session),
    status: normalizeCheckoutSessionStatus(session.status),
    termsConsentCollected: session.consent?.terms_of_service === "accepted",
  };
}

function checkoutSessionPriceId(session: Stripe.Checkout.Session) {
  const lineItems = session.line_items?.data ?? [];
  const firstPrice = lineItems[0]?.price;

  if (!firstPrice) {
    return null;
  }
  return typeof firstPrice === "string" ? firstPrice : firstPrice.id;
}

function createStripeClient(apiKey = stripeApiKeyFromEnv()) {
  return new Stripe(apiKey);
}

function stripeApiKeyFromEnv() {
  const apiKey = process.env.STRIPE_RESTRICTED_KEY ?? process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    throw new Error("STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY is required for Stripe calls.");
  }

  return apiKey;
}

export const tripPassCheckoutProductSnapshot = {
  productCode: tripPassProductCatalog.code,
  productFamily: tripPassProductCatalog.family,
  productVersion: tripPassProductCatalog.version,
  durationDays: tripPassProductCatalog.durationDays,
  durationHours: tripPassProductCatalog.durationHours,
  amountTotalMinor: tripPassProductCatalog.amountTotalMinor,
  currency: tripPassProductCatalog.currency,
  meterLimits: tripPassProductCatalog.paidMeterLimits,
  policyVersions: tripPassProductCatalog.policyVersions,
} as const;

function normalizeCheckoutSessionStatus(status: Stripe.Checkout.Session.Status | null) {
  if (status === "open" || status === "complete" || status === "expired") {
    return status;
  }
  return null;
}
