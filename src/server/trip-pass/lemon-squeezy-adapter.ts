import {
  createLemonSqueezyHttpClient,
  type LemonSqueezyHttpClient,
  type LemonSqueezyOrder,
  type NormalizedPaymentFact,
  parseLemonSqueezyOrderFact,
} from "@/server/payments/lemon-squeezy";
import {
  tripPassProductCatalog,
  tripPassProductCode,
  tripPassProductFamily,
  tripPassProductVersion,
} from "@/server/trip-pass/catalog";

export type LemonSqueezyCheckoutOrderSnapshot = {
  id: string;
  checkoutIdempotencyKey: string;
  checkoutSessionExpiresAt: Date;
  userId: string;
  productFamily: string;
  customerEmail?: string | null;
  storeId: string;
  variantId: string;
};

export type LemonSqueezyCheckoutSummary = {
  id: string;
  url: string;
  orderId: string | null;
  storeId: string | null;
  variantId: string | null;
};

export class LemonSqueezyCheckoutCreationError extends Error {
  readonly kind: "ambiguous" | "definitive";
  readonly cause?: unknown;

  constructor(input: { kind: "ambiguous" | "definitive"; message: string; cause?: unknown }) {
    super(input.message);
    this.name = "LemonSqueezyCheckoutCreationError";
    this.kind = input.kind;
    this.cause = input.cause;
  }
}

export type LemonSqueezyCheckoutClient = {
  createCheckout: (
    input: LemonSqueezyCheckoutRequest,
    options: { idempotencyKey: string },
  ) => Promise<LemonSqueezyCheckoutSummary>;
  retrieveOrder: (providerOrderId: string) => Promise<LemonSqueezyOrder>;
  refundOrder: (
    providerOrderId: string,
    input: { amountMinor?: number; idempotencyKey: string },
  ) => Promise<NormalizedPaymentFact>;
};

export type LemonSqueezyCheckoutRequest = {
  order: LemonSqueezyCheckoutOrderSnapshot;
  appUrl: string;
};

export function createLemonSqueezyCheckoutClient(
  http: LemonSqueezyHttpClient = createLemonSqueezyHttpClient(),
): LemonSqueezyCheckoutClient {
  return {
    async createCheckout(input, options) {
      try {
        const response = await http.request({
          method: "POST",
          path: "/v1/checkouts",
          idempotencyKey: options.idempotencyKey,
          body: buildLemonSqueezyCheckoutRequest(input),
        });
        return summarizeCheckout(response);
      } catch (error) {
        throw new LemonSqueezyCheckoutCreationError({
          kind: isAmbiguousCheckoutError(error) ? "ambiguous" : "definitive",
          message: "Lemon Squeezy Trip Pass checkout creation did not complete.",
          cause: error,
        });
      }
    },
    async retrieveOrder(providerOrderId) {
      const response = await http.request({
        method: "GET",
        path: `/v1/orders/${encodeURIComponent(providerOrderId)}`,
      });
      return parseOrder(response);
    },
    async refundOrder(providerOrderId, input) {
      const response = await http.request({
        method: "POST",
        path: `/v1/orders/${encodeURIComponent(providerOrderId)}/refund`,
        idempotencyKey: input.idempotencyKey,
        body: {
          data: {
            type: "orders",
            id: providerOrderId,
            ...(input.amountMinor === undefined
              ? {}
              : { attributes: { amount: input.amountMinor } }),
          },
        },
      });
      return parseLemonSqueezyOrderFact({ eventName: "order_refunded", payload: response });
    },
  };
}

export function buildLemonSqueezyCheckoutRequest(input: LemonSqueezyCheckoutRequest) {
  const appUrl = input.appUrl.replace(/\/$/, "");
  return {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          ...(input.order.customerEmail ? { email: input.order.customerEmail } : {}),
          custom: { order_id: input.order.id },
        },
        product_options: {
          enabled_variants: [input.order.variantId],
          redirect_url: `${appUrl}/settings?trip_pass_checkout=return&order=${encodeURIComponent(input.order.id)}`,
          receipt_link_url: `${appUrl}/legal/trip-pass`,
        },
      },
      relationships: {
        store: { data: { type: "stores", id: input.order.storeId } },
        variant: { data: { type: "variants", id: input.order.variantId } },
      },
    },
  } as const;
}

export function validateLemonSqueezyCheckout(input: {
  checkout: LemonSqueezyCheckoutSummary;
  order: LemonSqueezyCheckoutOrderSnapshot;
}) {
  if (!input.checkout.url) throw new Error("Lemon Squeezy did not return a checkout URL.");
  if (input.checkout.orderId && input.checkout.orderId !== input.order.id) {
    throw new Error("Lemon Squeezy checkout custom order ID does not match the local Order.");
  }
  if (input.checkout.storeId && input.checkout.storeId !== input.order.storeId) {
    throw new Error("Lemon Squeezy checkout Store does not match configuration.");
  }
  if (input.checkout.variantId && input.checkout.variantId !== input.order.variantId) {
    throw new Error("Lemon Squeezy checkout Variant does not match configuration.");
  }
}

export function summarizeCheckout(response: unknown): LemonSqueezyCheckoutSummary {
  const data = record(record(response).data);
  const attributes = record(data.attributes);
  const relationships = record(data.relationships);
  const store = record(record(relationships.store).data);
  const variant = record(record(relationships.variant).data);
  return {
    id: stringValue(data.id) ?? "",
    url: stringValue(attributes.url) ?? stringValue(attributes.checkout_url) ?? "",
    orderId: stringValue(record(record(attributes.checkout_data).custom).order_id),
    storeId: stringValue(store.id) ?? stringValue(attributes.store_id),
    variantId: stringValue(variant.id) ?? stringValue(attributes.variant_id),
  };
}

function parseOrder(response: unknown): LemonSqueezyOrder {
  const fact = parseLemonSqueezyOrderFact({ eventName: "order_lookup", payload: response });
  if (!fact.providerOrderId)
    throw new Error("Lemon Squeezy Order response is missing its identifier.");
  return { ...fact, providerOrderId: fact.providerOrderId };
}

function isAmbiguousCheckoutError(error: unknown) {
  if (error instanceof TypeError) return true;
  return (
    typeof error === "object" && error !== null && "retryable" in error && error.retryable === true
  );
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export const tripPassLemonSqueezyProductSnapshot = {
  productCode: tripPassProductCatalog.code,
  productFamily: tripPassProductCatalog.family,
  productVersion: tripPassProductCatalog.version,
  amountTotalMinor: tripPassProductCatalog.amountTotalMinor,
  currency: tripPassProductCatalog.currency,
  durationHours: tripPassProductCatalog.durationHours,
  meterLimits: tripPassProductCatalog.paidMeterLimits,
  policyVersions: tripPassProductCatalog.policyVersions,
  provider: "lemon_squeezy",
  productCodeConstant: tripPassProductCode,
  productFamilyConstant: tripPassProductFamily,
  productVersionConstant: tripPassProductVersion,
} as const;
