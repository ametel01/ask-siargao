import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LEMON_SQUEEZY_API_ORIGIN = "https://api.lemonsqueezy.com";
export const LEMON_SQUEEZY_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export type LemonSqueezyOrderStatus =
  | "pending"
  | "failed"
  | "paid"
  | "refunded"
  | "partial_refund"
  | "fraudulent";

export type NormalizedPaymentFact = {
  provider: "lemon_squeezy";
  eventName: string;
  objectId: string;
  providerUpdatedAt: string;
  orderId: string | null;
  providerOrderId: string | null;
  checkoutId: string | null;
  paymentId: string | null;
  storeId: string | null;
  productId?: string | null;
  variantId: string | null;
  status: LemonSqueezyOrderStatus;
  amountTotalMinor: number | null;
  refundedAmountMinor: number | null;
  currency: string | null;
  testMode: boolean | null;
};

export type LemonSqueezyCheckout = {
  id: string;
  url: string;
  orderId: string;
  storeId: string;
  variantId: string;
  expiresAt: Date;
};

export type LemonSqueezyOrder = NormalizedPaymentFact & {
  provider: "lemon_squeezy";
  providerOrderId: string;
};

export type LemonSqueezyRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

export type LemonSqueezyHttpClient = {
  request: (request: LemonSqueezyRequest) => Promise<unknown>;
};

export class LemonSqueezyApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: { status: number; message: string; retryable?: boolean }) {
    super(input.message);
    this.name = "LemonSqueezyApiError";
    this.status = input.status;
    this.retryable =
      input.retryable ?? (input.status === 408 || input.status === 429 || input.status >= 500);
  }
}

export class LemonSqueezyWebhookBodyTooLargeError extends Error {
  constructor(message = "Lemon Squeezy webhook body exceeds the configured size limit.") {
    super(message);
    this.name = "LemonSqueezyWebhookBodyTooLargeError";
  }
}

export function createLemonSqueezyHttpClient(
  input: { apiKey?: string; fetch?: typeof fetch; origin?: string } = {},
): LemonSqueezyHttpClient {
  const apiKey = input.apiKey ?? lemonSqueezyApiKeyFromEnv();
  const fetchLike = input.fetch ?? fetch;
  const origin = input.origin ?? LEMON_SQUEEZY_API_ORIGIN;

  return {
    async request(request) {
      const response = await fetchLike(`${origin}${request.path}`, {
        method: request.method,
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${apiKey}`,
          ...(request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {}),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!response.ok) {
        throw new LemonSqueezyApiError({
          status: response.status,
          message: "Lemon Squeezy API request failed.",
        });
      }
      return body;
    },
  };
}

export function verifyLemonSqueezyWebhookSignature(input: {
  payload: string | Buffer;
  signature: string;
  webhookSecret: string;
}) {
  const expected = createHmac("sha256", input.webhookSecret).update(input.payload).digest("hex");
  const provided = input.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) {
    throw new Error("Invalid Lemon Squeezy webhook signature.");
  }
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error("Invalid Lemon Squeezy webhook signature.");
  }
  return true;
}

export async function readBoundedLemonSqueezyWebhookBody(
  request: Request,
  maxBytes = LEMON_SQUEEZY_WEBHOOK_MAX_BODY_BYTES,
) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new LemonSqueezyWebhookBodyTooLargeError(
        "Lemon Squeezy webhook content-length is too large.",
      );
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new LemonSqueezyWebhookBodyTooLargeError();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function paymentFactFingerprint(fact: NormalizedPaymentFact) {
  const canonical = [
    fact.provider,
    fact.eventName,
    fact.objectId,
    fact.providerUpdatedAt,
    fact.status,
    String(fact.amountTotalMinor ?? ""),
    String(fact.refundedAmountMinor ?? ""),
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function lemonSqueezyApiKeyFromEnv(env: Record<string, string | undefined> = process.env) {
  const key = env.LEMON_SQUEEZY_API_KEY?.trim();
  if (!key) throw new Error("LEMON_SQUEEZY_API_KEY is required for Lemon Squeezy calls.");
  return key;
}

export function lemonSqueezyWebhookSecretFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const secret = env.LEMON_SQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret)
    throw new Error("LEMON_SQUEEZY_WEBHOOK_SECRET is required for webhook verification.");
  return secret;
}

export function parseLemonSqueezyOrderFact(input: {
  eventName: string;
  payload: unknown;
  orderId?: string | null;
}): NormalizedPaymentFact {
  const root = asRecord(input.payload);
  const data = asRecord(root.data);
  const attributes = asRecord(data.attributes);
  const relationships = asRecord(data.relationships);
  const orderItem = asRecord(asRecord(relationships.order_item).data);
  const orderItemAttributes = asRecord(orderItem.attributes);
  const firstOrderItem = asRecord(attributes.first_order_item);
  const providerOrderId =
    stringValue(data.id) ?? stringValue(attributes.id) ?? input.orderId ?? null;
  const updatedAt =
    stringValue(attributes.updated_at) ??
    stringValue(attributes.created_at) ??
    new Date(0).toISOString();
  const amountTotalMinor = integerValue(attributes.total ?? attributes.total_usd);
  const refundedAmountMinor = integerValue(
    attributes.refunded_amount ?? attributes.refunded_amount_usd,
  );
  const status = normalizeOrderStatus(attributes.status ?? attributes.order_status, {
    refunded: attributes.refunded,
    refundedAmountMinor,
    amountTotalMinor,
  });
  const variantId =
    stringValue(orderItemAttributes.variant_id) ??
    stringValue(firstOrderItem.variant_id) ??
    stringValue(attributes.variant_id) ??
    null;
  const productId =
    stringValue(orderItemAttributes.product_id) ??
    stringValue(firstOrderItem.product_id) ??
    stringValue(attributes.product_id) ??
    null;
  return {
    provider: "lemon_squeezy",
    eventName: input.eventName,
    objectId: providerOrderId ?? "unknown",
    providerUpdatedAt: updatedAt,
    orderId: input.orderId ?? customOrderId(root) ?? null,
    providerOrderId,
    checkoutId: stringValue(attributes.checkout_id),
    paymentId: stringValue(attributes.identifier) ?? stringValue(attributes.payment_id),
    storeId: stringValue(attributes.store_id),
    productId,
    variantId,
    status,
    amountTotalMinor,
    refundedAmountMinor,
    currency: stringValue(attributes.currency),
    testMode: booleanValue(attributes.test_mode),
  };
}

function normalizeOrderStatus(
  value: unknown,
  refund: {
    refunded: unknown;
    refundedAmountMinor: number | null;
    amountTotalMinor: number | null;
  },
): LemonSqueezyOrderStatus {
  switch (String(value ?? "").toLowerCase()) {
    case "paid":
      return inferredRefundStatus(refund) ?? "paid";
    case "refunded":
      return "refunded";
    case "partial_refund":
    case "partially_refunded":
      return "partial_refund";
    case "fraudulent":
    case "disputed":
      return "fraudulent";
    case "failed":
    case "cancelled":
      return "failed";
    case "pending":
      return inferredRefundStatus(refund) ?? "pending";
    default:
      return inferredRefundStatus(refund) ?? "pending";
  }
}

function inferredRefundStatus(input: {
  refunded: unknown;
  refundedAmountMinor: number | null;
  amountTotalMinor: number | null;
}): LemonSqueezyOrderStatus | null {
  if (input.refunded === true) return "refunded";
  if (input.refundedAmountMinor === null || input.refundedAmountMinor <= 0) return null;
  if (input.amountTotalMinor !== null && input.refundedAmountMinor >= input.amountTotalMinor) {
    return "refunded";
  }
  return "partial_refund";
}

function customOrderId(root: Record<string, unknown>) {
  const meta = asRecord(root.meta);
  const custom = asRecord(meta.custom_data ?? meta.custom);
  return stringValue(custom.order_id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : null;
}

function integerValue(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}
