import Stripe from "stripe";

import {
  tripPassProductCatalog,
  tripPassProductCode,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";

export type TripPassCheckoutOrderSnapshot = {
  id: string;
  checkoutIdempotencyKey: string;
  userId: string;
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
  priceId: string | null;
};

export type TripPassCheckoutClient = {
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
    options: { idempotencyKey: string },
  ) => Promise<TripPassCheckoutSessionSummary>;
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
    success_url: `${appUrl}/settings?trip_pass_checkout=return&order=${encodeURIComponent(
      input.order.id,
    )}`,
    cancel_url: `${appUrl}/settings?trip_pass_checkout=cancelled&order=${encodeURIComponent(
      input.order.id,
    )}`,
    metadata: {
      tripPassOrderId: input.order.id,
      productCode: tripPassProductCode,
      productVersion: String(tripPassProductVersion),
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
  if (input.session.priceId !== input.order.stripePriceId) {
    throw new Error("Stripe Trip Pass Checkout Session price does not match configuration.");
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
    priceId: checkoutSessionPriceId(session),
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
  productVersion: tripPassProductCatalog.version,
  durationDays: tripPassProductCatalog.durationDays,
  meterLimits: tripPassProductCatalog.paidMeterLimits,
} as const;
