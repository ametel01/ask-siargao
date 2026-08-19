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
  productId?: string;
  variantId: string;
  testMode?: boolean;
};

export type LemonSqueezyCheckoutSummary = {
  id: string;
  url: string;
  orderId: string | null;
  storeId: string | null;
  productId?: string | null;
  variantId: string | null;
  customPrice?: number | null;
  enabledVariants?: string[] | null;
  quantity?: number | null;
  discountEnabled?: boolean | null;
  previewSubtotal?: number | null;
  previewDiscountTotal?: number | null;
  previewTax?: number | null;
  previewTotal?: number | null;
  testMode?: boolean | null;
  expiresAt?: Date | null;
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
  lookupOrderByCheckoutId?: (checkoutId: string) => Promise<LemonSqueezyOrder | null>;
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
    async lookupOrderByCheckoutId(checkoutId) {
      const response = await http.request({
        method: "GET",
        path: `/v1/orders?filter[checkout_id]=${encodeURIComponent(checkoutId)}&page[size]=1`,
      });
      return parseOrderCollection(response);
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
          variant_quantities: [
            { variant_id: lemonSqueezyNumericVariantId(input.order.variantId), quantity: 1 },
          ],
        },
        product_options: {
          enabled_variants: [lemonSqueezyNumericVariantId(input.order.variantId)],
          redirect_url: `${appUrl}/settings?trip_pass_checkout=return&order=${encodeURIComponent(input.order.id)}`,
          receipt_link_url: `${appUrl}/legal/trip-pass`,
        },
        checkout_options: {
          discount: false,
        },
        preview: true,
        test_mode: input.order.testMode ?? false,
        expires_at: input.order.checkoutSessionExpiresAt.toISOString(),
      },
      relationships: {
        store: { data: { type: "stores", id: input.order.storeId } },
        variant: { data: { type: "variants", id: input.order.variantId } },
      },
    },
  } as const;
}

function lemonSqueezyNumericVariantId(variantId: string) {
  const numericVariantId = Number(variantId);
  if (!Number.isSafeInteger(numericVariantId) || numericVariantId <= 0) {
    throw new Error("Lemon Squeezy Variant ID must be a positive integer.");
  }
  return numericVariantId;
}

export function validateLemonSqueezyCheckout(input: {
  checkout: LemonSqueezyCheckoutSummary;
  order: LemonSqueezyCheckoutOrderSnapshot;
}) {
  if (!input.checkout.url) throw new Error("Lemon Squeezy did not return a checkout URL.");
  if (!input.checkout.orderId) {
    throw new Error("Lemon Squeezy checkout custom order ID is missing.");
  }
  if (input.checkout.orderId !== input.order.id) {
    throw new Error("Lemon Squeezy checkout custom order ID does not match the local Order.");
  }
  if (!input.checkout.storeId) {
    throw new Error("Lemon Squeezy checkout Store is missing.");
  }
  if (input.checkout.storeId !== input.order.storeId) {
    throw new Error("Lemon Squeezy checkout Store does not match configuration.");
  }
  if (!input.checkout.variantId) {
    throw new Error("Lemon Squeezy checkout Variant is missing.");
  }
  if (input.checkout.variantId !== input.order.variantId) {
    throw new Error("Lemon Squeezy checkout Variant does not match configuration.");
  }
  if (input.checkout.customPrice !== null) {
    throw new Error("Lemon Squeezy checkout must not use custom pricing.");
  }
  if (
    input.checkout.enabledVariants?.length !== 1 ||
    input.checkout.enabledVariants[0] !== input.order.variantId
  ) {
    throw new Error("Lemon Squeezy checkout enabled variants do not match the configured Variant.");
  }
  if (input.checkout.quantity !== 1) {
    throw new Error("Lemon Squeezy checkout quantity must be exactly one.");
  }
  if (input.checkout.discountEnabled !== false) {
    throw new Error("Lemon Squeezy checkout discounts must be hidden.");
  }
  const previewTax = input.checkout.previewTax;
  const previewTotal = input.checkout.previewTotal;
  if (
    input.checkout.previewSubtotal == null ||
    input.checkout.previewDiscountTotal == null ||
    previewTax == null ||
    previewTotal == null ||
    input.checkout.previewSubtotal !== tripPassLemonSqueezyProductSnapshot.amountTotalMinor ||
    input.checkout.previewDiscountTotal !== 0 ||
    previewTax !== 0 ||
    previewTotal !== tripPassLemonSqueezyProductSnapshot.amountTotalMinor
  ) {
    throw new Error("Lemon Squeezy checkout commercial preview is incomplete or invalid.");
  }
  if (input.checkout.testMode !== (input.order.testMode ?? false)) {
    throw new Error("Lemon Squeezy checkout test/live mode does not match configuration.");
  }
  if (
    !input.checkout.expiresAt ||
    input.checkout.expiresAt > input.order.checkoutSessionExpiresAt
  ) {
    throw new Error("Lemon Squeezy checkout expiry does not match the local Order.");
  }
}

export function summarizeCheckout(response: unknown): LemonSqueezyCheckoutSummary {
  const data = record(record(response).data);
  const attributes = record(data.attributes);
  const relationships = record(data.relationships);
  const store = record(record(relationships.store).data);
  const variant = record(record(relationships.variant).data);
  const checkoutOptions = record(attributes.checkout_options);
  const productOptions = record(attributes.product_options);
  const checkoutData = record(attributes.checkout_data);
  const variantQuantities = Array.isArray(checkoutData.variant_quantities)
    ? checkoutData.variant_quantities
    : [];
  const targetVariantId = identifierValue(variant.id) ?? identifierValue(attributes.variant_id);
  const quantityEntry = variantQuantities
    .map(record)
    .find((entry) => identifierValue(entry.variant_id) === targetVariantId);
  const preview = record(attributes.preview);
  return {
    id: stringValue(data.id) ?? "",
    url: stringValue(attributes.url) ?? stringValue(attributes.checkout_url) ?? "",
    orderId: stringValue(record(record(attributes.checkout_data).custom).order_id),
    storeId: identifierValue(store.id) ?? identifierValue(attributes.store_id),
    productId: identifierValue(attributes.product_id),
    variantId: identifierValue(variant.id) ?? identifierValue(attributes.variant_id),
    customPrice: integerValue(attributes.custom_price),
    enabledVariants: Array.isArray(productOptions.enabled_variants)
      ? productOptions.enabled_variants
          .map(identifierValue)
          .filter((id): id is string => id !== null)
      : null,
    quantity: integerValue(quantityEntry?.quantity),
    discountEnabled: booleanValue(checkoutOptions.discount),
    previewSubtotal: integerValue(preview.subtotal),
    previewDiscountTotal: integerValue(preview.discount_total),
    previewTax: integerValue(preview.tax),
    previewTotal: integerValue(preview.total),
    testMode: booleanValue(attributes.test_mode),
    expiresAt: dateValue(attributes.expires_at),
  };
}

function parseOrder(response: unknown): LemonSqueezyOrder {
  const fact = parseLemonSqueezyOrderFact({ eventName: "order_lookup", payload: response });
  if (!fact.providerOrderId)
    throw new Error("Lemon Squeezy Order response is missing its identifier.");
  return { ...fact, providerOrderId: fact.providerOrderId };
}

function parseOrderCollection(response: unknown): LemonSqueezyOrder | null {
  const root = record(response);
  const data = Array.isArray(root.data) ? root.data[0] : null;
  if (!data) return null;
  const fact = parseLemonSqueezyOrderFact({
    eventName: "order_lookup",
    payload: { ...root, data },
  });
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

function identifierValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
  }
  return stringValue(value);
}

function integerValue(value: unknown) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
