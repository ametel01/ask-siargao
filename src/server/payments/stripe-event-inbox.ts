import type Stripe from "stripe";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";

export const STRIPE_API_VERSION = "2026-07-29.dahlia";
export const STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION = 1;
export const STRIPE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const supportedEventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

export type NormalizedStripeEvent = {
  stripeEventId: string;
  stripeApiVersion: string;
  normalizedSchemaVersion: number;
  eventType: string;
  objectType: string;
  objectId: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  orderId: string | null;
  productCode: string | null;
  productVersion: number | null;
  stripePriceId: string | null;
  amountTotalMinor: number | null;
  currency: string | null;
  paymentStatus: string | null;
  status: "pending" | "blocked";
  sanitizedErrorClass: string | null;
  normalizedFacts: Record<string, unknown>;
};

export type StripeInboxReceiptResult =
  | {
      status: "received" | "duplicate";
      inboxId: string;
      stripeEventId: string;
      normalized: NormalizedStripeEvent;
    }
  | {
      status: "blocked";
      inboxId: string;
      stripeEventId: string;
      normalized: NormalizedStripeEvent;
      reason: string;
    };

export type StripeInboxApplicationResult =
  | {
      status: "applied";
      inboxId: string;
      stripeEventId: string;
      applicationResult: unknown;
    }
  | {
      status: "pending";
      inboxId: string;
      stripeEventId: string;
      reason: string;
      applicationResult?: unknown;
    }
  | {
      status: "blocked";
      inboxId: string;
      stripeEventId: string;
      reason: string;
      applicationResult?: unknown;
    };

export type StripeInboxReceiveResult = StripeInboxApplicationResult | StripeInboxReceiptResult;

export type StripeEventApplication = (
  event: Stripe.Event,
  options: { db: DatabaseQueryClient; now: Date },
) => Promise<unknown>;

export class StripeWebhookBodyTooLargeError extends Error {
  constructor(message = "Stripe webhook body exceeds the configured size limit.") {
    super(message);
    this.name = "StripeWebhookBodyTooLargeError";
  }
}

export async function readBoundedStripeWebhookBody(
  request: Request,
  maxBytes = STRIPE_WEBHOOK_MAX_BODY_BYTES,
) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new StripeWebhookBodyTooLargeError("Stripe webhook content-length is too large.");
    }
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new StripeWebhookBodyTooLargeError();
  }

  return body;
}

export async function receiveStripeWebhookEvent(
  event: Stripe.Event,
  options: {
    applyEvent?: StripeEventApplication;
    db?: DatabaseQueryClient;
    now?: Date;
  } = {},
): Promise<StripeInboxReceiveResult> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = options.now ?? new Date();
  const receipt = await commitStripeEventReceipt(normalizeStripeEvent(event), db, now);

  if (receipt.status === "duplicate" || receipt.status === "blocked" || !options.applyEvent) {
    return receipt;
  }

  return applyStripeInboxEvent(receipt.inboxId, { applyEvent: options.applyEvent, db, now });
}

export async function applyStripeInboxEvent(
  inboxId: string,
  options: {
    applyEvent: StripeEventApplication;
    db?: DatabaseQueryClient;
    now?: Date;
  },
): Promise<StripeInboxApplicationResult> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const now = options.now ?? new Date();
  const applyWithinTransaction = async (
    transaction: DatabaseQueryClient,
  ): Promise<StripeInboxApplicationResult> => {
    const inboxRow = await loadInboxRow(inboxId, transaction);

    if (!inboxRow) {
      return {
        status: "pending",
        inboxId,
        stripeEventId: inboxId,
        reason: "inbox_row_not_found",
      };
    }
    if (inboxRow.status === "applied") {
      return {
        status: "applied",
        inboxId,
        stripeEventId: inboxRow.stripe_event_id,
        applicationResult: { status: "duplicate" },
      };
    }
    if (inboxRow.status === "blocked") {
      return {
        status: "blocked",
        inboxId,
        stripeEventId: inboxRow.stripe_event_id,
        reason: inboxRow.sanitized_error_class ?? "blocked_stripe_event",
      };
    }

    const applicationResult = await options.applyEvent(eventFromInboxRow(inboxRow), {
      db: transaction,
      now,
    });
    const classification = classifyApplicationResult(applicationResult);
    if (classification.status === "applied") {
      await markInboxApplied(inboxId, transaction, now);
      return {
        status: "applied",
        inboxId,
        stripeEventId: inboxRow.stripe_event_id,
        applicationResult,
      };
    }
    await scheduleInboxRetry({
      inboxId,
      db: transaction,
      now,
      reason: classification.reason,
      status: classification.status,
    });
    return {
      status: classification.status,
      inboxId,
      stripeEventId: inboxRow.stripe_event_id,
      reason: classification.reason,
      applicationResult,
    };
  };

  try {
    if (db.transaction) {
      return await db.transaction(applyWithinTransaction);
    }
    return await applyWithinTransaction(db);
  } catch (error) {
    const inboxRow = await loadInboxRow(inboxId, db).catch(() => null);
    await scheduleInboxRetry({
      inboxId,
      db,
      now,
      reason: sanitizedErrorClass(error),
      status: "pending",
    });
    return {
      status: "pending",
      inboxId,
      stripeEventId: inboxRow?.stripe_event_id ?? inboxId,
      reason: sanitizedErrorClass(error),
    };
  }
}

export async function claimPendingStripeInboxEvents(input: {
  claimToken: string;
  limit: number;
  leaseMs?: number;
  db?: DatabaseQueryClient;
  now?: Date;
}) {
  const db = input.db ?? getDefaultDatabaseQueryClient();
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? 60_000;
  const claimExpiresAt = new Date(now.getTime() + leaseMs);
  const result = await db.query<{ id: string }>(
    `
      update trip_pass_stripe_events
      set claim_token = $1,
          claim_expires_at = $2,
          updated_at = $3
      where status = 'pending'
        and (next_attempt_at is null or next_attempt_at <= $3)
        and (claim_expires_at is null or claim_expires_at <= $3)
        and id in (
        select id
        from trip_pass_stripe_events
        where status = 'pending'
          and (next_attempt_at is null or next_attempt_at <= $3)
          and (claim_expires_at is null or claim_expires_at <= $3)
        order by received_at, id
        limit $4
      )
      returning id
    `,
    [input.claimToken, claimExpiresAt, now, input.limit],
  );

  return result.rows.map((row) => row.id);
}

export function normalizeStripeEvent(event: Stripe.Event): NormalizedStripeEvent {
  const object = event.data?.object as unknown as Record<string, unknown> | undefined;
  const objectType = stringValue(object?.object) ?? "unknown";
  const objectId = stringValue(object?.id) ?? `${event.id}:object`;
  const stripeApiVersion = stringValue(event.api_version) ?? "unknown";
  const facts = factsFromEvent(event, object);
  const unsupportedReason = unsupportedEventReason(event, stripeApiVersion);

  return {
    stripeEventId: event.id,
    stripeApiVersion,
    normalizedSchemaVersion: STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION,
    eventType: event.type,
    objectType,
    objectId,
    checkoutSessionId: facts.checkoutSessionId,
    paymentIntentId: facts.paymentIntentId,
    orderId: facts.orderId,
    productCode: facts.productCode,
    productVersion: facts.productVersion,
    stripePriceId: facts.stripePriceId,
    amountTotalMinor: facts.amountTotalMinor,
    currency: facts.currency,
    paymentStatus: facts.paymentStatus,
    status: unsupportedReason ? "blocked" : "pending",
    sanitizedErrorClass: unsupportedReason,
    normalizedFacts: facts.normalizedFacts,
  };
}

async function commitStripeEventReceipt(
  normalized: NormalizedStripeEvent,
  db: DatabaseQueryClient,
  now: Date,
): Promise<StripeInboxReceiptResult> {
  const inboxId = inboxIdForStripeEvent(normalized.stripeEventId);
  try {
    await db.query(
      `
        insert into trip_pass_stripe_events (
          id,
          stripe_event_id,
          stripe_api_version,
          normalized_schema_version,
          event_type,
          object_type,
          object_id,
          checkout_session_id,
          payment_intent_id,
          order_id,
          product_code,
          product_version,
          stripe_price_id,
          amount_total_minor,
          currency,
          payment_status,
          status,
          sanitized_error_class,
          normalized_facts_json,
          received_at,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $20, $20
        )
      `,
      [
        inboxId,
        normalized.stripeEventId,
        normalized.stripeApiVersion,
        normalized.normalizedSchemaVersion,
        normalized.eventType,
        normalized.objectType,
        normalized.objectId,
        normalized.checkoutSessionId,
        normalized.paymentIntentId,
        normalized.orderId,
        normalized.productCode,
        normalized.productVersion,
        normalized.stripePriceId,
        normalized.amountTotalMinor,
        normalized.currency,
        normalized.paymentStatus,
        normalized.status,
        normalized.sanitizedErrorClass,
        JSON.stringify(normalized.normalizedFacts),
        now,
      ],
    );
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    const existing = await loadInboxByStripeEventId(normalized.stripeEventId, db);
    if (!existing) {
      throw error;
    }
    if (hasImmutableFactMismatch(existing, normalized)) {
      await markInboxBlocked(existing.id, db, now, "stripe_event_fact_mismatch");
      return {
        status: "blocked",
        inboxId: existing.id,
        stripeEventId: normalized.stripeEventId,
        normalized,
        reason: "stripe_event_fact_mismatch",
      };
    }
    return {
      status: "duplicate",
      inboxId: existing.id,
      stripeEventId: normalized.stripeEventId,
      normalized,
    };
  }

  if (normalized.status === "blocked") {
    return {
      status: "blocked",
      inboxId,
      stripeEventId: normalized.stripeEventId,
      normalized,
      reason: normalized.sanitizedErrorClass ?? "unsupported_stripe_event",
    };
  }

  return { status: "received", inboxId, stripeEventId: normalized.stripeEventId, normalized };
}

function factsFromEvent(event: Stripe.Event, object: Record<string, unknown> | undefined) {
  if (event.type.startsWith("checkout.session.")) {
    const metadata = recordValue(object?.metadata);
    return {
      checkoutSessionId: stringValue(object?.id),
      paymentIntentId: stripeIdValue(object?.payment_intent),
      orderId: stringValue(metadata?.tripPassOrderId) ?? stringValue(object?.client_reference_id),
      productCode: stringValue(metadata?.productCode),
      productVersion: integerStringValue(metadata?.productVersion),
      stripePriceId: null,
      amountTotalMinor: numberValue(object?.amount_total),
      currency: stringValue(object?.currency),
      paymentStatus: stringValue(object?.payment_status),
      normalizedFacts: {
        mode: stringValue(object?.mode),
        livemode: Boolean(event.livemode),
      },
    };
  }
  if (event.type === "charge.refunded" || event.type === "refund.created") {
    return {
      checkoutSessionId: null,
      paymentIntentId: stripeIdValue(object?.payment_intent),
      orderId: null,
      productCode: null,
      productVersion: null,
      stripePriceId: null,
      amountTotalMinor: numberValue(object?.amount),
      currency: stringValue(object?.currency),
      paymentStatus: null,
      normalizedFacts: { livemode: Boolean(event.livemode) },
    };
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    return {
      checkoutSessionId: null,
      paymentIntentId: stripeIdValue(object?.payment_intent),
      orderId: null,
      productCode: null,
      productVersion: null,
      stripePriceId: null,
      amountTotalMinor: numberValue(object?.amount),
      currency: stringValue(object?.currency),
      paymentStatus: stringValue(object?.status),
      normalizedFacts: { livemode: Boolean(event.livemode) },
    };
  }
  return {
    checkoutSessionId: null,
    paymentIntentId: null,
    orderId: null,
    productCode: null,
    productVersion: null,
    stripePriceId: null,
    amountTotalMinor: null,
    currency: null,
    paymentStatus: null,
    normalizedFacts: { livemode: Boolean(event.livemode) },
  };
}

function eventFromInboxRow(row: StripeInboxRow): Stripe.Event {
  const normalizedFacts = recordValue(row.normalized_facts_json) ?? {};
  const metadata =
    row.product_code || row.product_version || row.order_id
      ? {
          tripPassOrderId: row.order_id ?? undefined,
          productCode: row.product_code ?? undefined,
          productVersion: row.product_version === null ? undefined : String(row.product_version),
        }
      : {};
  const object = {
    id: row.object_id,
    object: row.object_type,
    mode: normalizedFacts.mode,
    client_reference_id: row.order_id,
    metadata,
    payment_intent: row.payment_intent_id,
    payment_status: row.payment_status,
    amount_total: row.amount_total_minor,
    amount: row.amount_total_minor,
    currency: row.currency,
  };

  return {
    id: row.stripe_event_id,
    object: "event",
    api_version: row.stripe_api_version,
    created: Math.floor(new Date(row.received_at).getTime() / 1000),
    data: { object },
    livemode: Boolean(normalizedFacts.livemode),
    pending_webhooks: 0,
    request: null,
    type: row.event_type,
  } as unknown as Stripe.Event;
}

function classifyApplicationResult(applicationResult: unknown): {
  status: "applied" | "pending" | "blocked";
  reason: string;
} {
  const result = recordValue(applicationResult);
  const resultStatus = stringValue(result?.status);
  const reason = stringValue(result?.reason) ?? resultStatus ?? "unknown_application_result";

  if (resultStatus === "applied" || resultStatus === "duplicate" || resultStatus === "noop") {
    return { status: "applied", reason };
  }
  if (reason === "trip_pass_order_not_found" || reason === "missing_trip_pass_order_id") {
    return { status: "pending", reason };
  }
  if (resultStatus === "ignored") {
    return { status: "blocked", reason };
  }
  if (resultStatus === "rejected") {
    return { status: "blocked", reason };
  }

  return { status: "pending", reason };
}

async function scheduleInboxRetry(input: {
  inboxId: string;
  db: DatabaseQueryClient;
  now: Date;
  reason: string;
  status: "pending" | "blocked";
}) {
  const current = await loadInboxRow(input.inboxId, input.db);
  const attemptCount = (current?.attempt_count ?? 0) + 1;
  const nextAttemptAt =
    input.status === "pending" ? new Date(input.now.getTime() + backoffMs(attemptCount)) : null;
  const alertState = attemptCount >= 10 ? "page" : attemptCount >= 5 ? "watch" : "none";

  await input.db.query(
    `
      update trip_pass_stripe_events
      set status = $2,
          attempt_count = $3,
          next_attempt_at = $4,
          claim_token = null,
          claim_expires_at = null,
          alert_state = $5,
          sanitized_error_class = $6,
          updated_at = $7
      where id = $1
    `,
    [input.inboxId, input.status, attemptCount, nextAttemptAt, alertState, input.reason, input.now],
  );
}

function backoffMs(attemptCount: number) {
  return Math.min(60 * 60 * 1000, 2 ** Math.min(attemptCount, 8) * 1_000);
}

async function markInboxApplied(inboxId: string, db: DatabaseQueryClient, now: Date) {
  await db.query(
    `
      update trip_pass_stripe_events
      set status = 'applied',
          applied_at = $2,
          next_attempt_at = null,
          claim_token = null,
          claim_expires_at = null,
          sanitized_error_class = null,
          updated_at = $2
      where id = $1
    `,
    [inboxId, now],
  );
}

async function markInboxBlocked(
  inboxId: string,
  db: DatabaseQueryClient,
  now: Date,
  reason: string,
) {
  await db.query(
    `
      update trip_pass_stripe_events
      set status = 'blocked',
          sanitized_error_class = $2,
          next_attempt_at = null,
          claim_token = null,
          claim_expires_at = null,
          updated_at = $3
      where id = $1
    `,
    [inboxId, reason, now],
  );
}

async function loadInboxByStripeEventId(stripeEventId: string, db: DatabaseQueryClient) {
  const result = await db.query<StripeInboxRow>(
    "select * from trip_pass_stripe_events where stripe_event_id = $1 limit 1",
    [stripeEventId],
  );
  return result.rows[0] ?? null;
}

async function loadInboxRow(inboxId: string, db: DatabaseQueryClient) {
  const result = await db.query<StripeInboxRow>(
    "select * from trip_pass_stripe_events where id = $1 limit 1",
    [inboxId],
  );
  return result.rows[0] ?? null;
}

function unsupportedEventReason(event: Stripe.Event, stripeApiVersion: string) {
  if (stripeApiVersion !== STRIPE_API_VERSION) {
    return "unsupported_stripe_api_version";
  }
  if (event.object !== "event" || !event.id || !event.type) {
    return "unsupported_stripe_event_shape";
  }
  if (!supportedEventTypes.has(event.type)) {
    return "unsupported_stripe_event_type";
  }
  return null;
}

function hasImmutableFactMismatch(row: StripeInboxRow, normalized: NormalizedStripeEvent) {
  return (
    row.stripe_api_version !== normalized.stripeApiVersion ||
    row.normalized_schema_version !== normalized.normalizedSchemaVersion ||
    row.event_type !== normalized.eventType ||
    row.object_type !== normalized.objectType ||
    row.object_id !== normalized.objectId ||
    row.checkout_session_id !== normalized.checkoutSessionId ||
    row.payment_intent_id !== normalized.paymentIntentId ||
    row.order_id !== normalized.orderId
  );
}

function inboxIdForStripeEvent(stripeEventId: string) {
  return `stripe_event_${stripeEventId}`;
}

function sanitizedErrorClass(error: unknown) {
  return error instanceof Error ? error.name : "unknown_error";
}

function isUniqueConflict(error: unknown) {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const constraint = typeof candidate.constraint === "string" ? candidate.constraint : "";

  return (
    candidate.code === "23505" ||
    constraint.includes("trip_pass_stripe_events") ||
    message.includes("trip_pass_stripe_events") ||
    message.toLowerCase().includes("unique")
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerStringValue(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function stripeIdValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return stringValue(recordValue(value)?.id);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type StripeInboxRow = {
  id: string;
  stripe_event_id: string;
  stripe_api_version: string;
  normalized_schema_version: number;
  event_type: string;
  object_type: string;
  object_id: string;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  order_id: string | null;
  product_code: string | null;
  product_version: number | null;
  stripe_price_id: string | null;
  amount_total_minor: number | null;
  currency: string | null;
  payment_status: string | null;
  status: string;
  attempt_count: number;
  sanitized_error_class: string | null;
  normalized_facts_json: Record<string, unknown> | string;
  received_at: Date | string;
};
