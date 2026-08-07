import { randomUUID } from "node:crypto";

import type Stripe from "stripe";

import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";

export const STRIPE_API_VERSION = "2026-07-29.dahlia";
export const STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION = 2;
export const STRIPE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const supportedEventTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
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

export type StripeEventApplication<TEvent = Stripe.Event> = (
  event: TEvent,
  options: { db: DatabaseQueryClient; now: Date },
) => Promise<unknown>;

export type StripeEventPreparation<TEvent> = (event: Stripe.Event) => Promise<TEvent>;

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

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new StripeWebhookBodyTooLargeError();
      }

      body += decoder.decode(chunk.value, { stream: true });
    }

    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export async function receiveStripeWebhookEvent<TEvent = Stripe.Event>(
  event: Stripe.Event,
  options: {
    applyEvent?: StripeEventApplication<TEvent>;
    db?: DatabaseQueryClient;
    prepareEvent?: StripeEventPreparation<TEvent>;
    now?: Date;
  } = {},
): Promise<StripeInboxReceiveResult> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const receipt = await commitStripeEventReceipt(normalizeStripeEvent(event), db);

  if (receipt.status === "duplicate" || receipt.status === "blocked" || !options.applyEvent) {
    return receipt;
  }

  return applyStripeInboxEvent(receipt.inboxId, {
    applyEvent: options.applyEvent,
    db,
    prepareEvent: options.prepareEvent,
  });
}

export async function applyStripeInboxEvent<TEvent = Stripe.Event>(
  inboxId: string,
  options: {
    applyEvent: StripeEventApplication<TEvent>;
    claimToken?: string;
    db?: DatabaseQueryClient;
    leaseMs?: number;
    now?: Date;
    prepareEvent?: StripeEventPreparation<TEvent>;
  },
): Promise<StripeInboxApplicationResult> {
  const db = options.db ?? getDefaultDatabaseQueryClient();
  const claimToken = options.claimToken ?? randomUUID();
  const preflight = options.claimToken
    ? await loadInboxRow(inboxId, db)
    : await claimStripeInboxEvent(inboxId, claimToken, options.leaseMs ?? 60_000, db);
  const preflightResult = classifyInboxPreflight(inboxId, preflight, claimToken);
  if (preflightResult) return preflightResult;

  let preparedEvent: TEvent;
  try {
    const event = eventFromInboxRow(preflight as StripeInboxRow);
    preparedEvent = options.prepareEvent
      ? await options.prepareEvent(event)
      : (event as unknown as TEvent);
  } catch (error) {
    await scheduleInboxRetry({
      inboxId,
      db,
      claimToken,
      reason: sanitizedErrorClass(error),
      status: "pending",
    });
    return {
      status: "pending",
      inboxId,
      stripeEventId: preflight?.stripe_event_id ?? inboxId,
      reason: sanitizedErrorClass(error),
    };
  }

  const applyWithinTransaction = async (
    transaction: DatabaseQueryClient,
  ): Promise<StripeInboxApplicationResult> => {
    const inboxRow = await lockInboxRowForApplication(inboxId, transaction);

    if (!inboxRow) {
      return {
        status: "pending",
        inboxId,
        stripeEventId: inboxId,
        reason: "inbox_row_not_found",
      };
    }
    const now = dateFromDatabaseValue(inboxRow.database_now);
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
    if (inboxRow.status !== "pending") {
      return {
        status: "pending",
        inboxId,
        stripeEventId: inboxRow.stripe_event_id,
        reason: "stripe_inbox_not_pending",
      };
    }
    if (
      inboxRow.claim_token !== claimToken ||
      !inboxRow.claim_expires_at ||
      dateFromDatabaseValue(inboxRow.claim_expires_at).getTime() <= now.getTime()
    ) {
      return {
        status: "pending",
        inboxId,
        stripeEventId: inboxRow.stripe_event_id,
        reason: "stripe_inbox_claim_not_owned",
      };
    }

    const applicationResult = await options.applyEvent(preparedEvent, {
      db: transaction,
      now,
    });
    const classification = classifyApplicationResult(applicationResult);
    if (classification.status === "applied") {
      await markInboxApplied(inboxId, claimToken, transaction);
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
      claimToken,
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
      claimToken,
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
  const leaseMs = input.leaseMs ?? 60_000;
  const result = await db.query<{ id: string }>(
    `
      with due as (
        select id, now() as database_now
        from trip_pass_stripe_events
        where status = 'pending'
          and (next_attempt_at is null or next_attempt_at <= now())
          and (claim_expires_at is null or claim_expires_at <= now())
        order by received_at, id
        limit $2
        for update skip locked
      )
      update trip_pass_stripe_events
      set claim_token = $1,
          claim_expires_at = due.database_now + ($3::double precision * interval '1 millisecond'),
          updated_at = due.database_now
      from due
      where trip_pass_stripe_events.id = due.id
      returning trip_pass_stripe_events.id
    `,
    [input.claimToken, input.limit, leaseMs],
  );

  return result.rows.map((row) => row.id);
}

async function claimStripeInboxEvent(
  inboxId: string,
  claimToken: string,
  leaseMs: number,
  db: DatabaseQueryClient,
) {
  const result = await db.query<StripeInboxRow>(
    `
      with database_time as (
        select now() as database_now
      )
      update trip_pass_stripe_events
      set claim_token = $2,
          claim_expires_at = database_time.database_now
            + ($3::double precision * interval '1 millisecond'),
          updated_at = database_time.database_now
      from database_time
      where id = $1
        and status = 'pending'
        and (claim_expires_at is null or claim_expires_at <= database_time.database_now)
      returning trip_pass_stripe_events.*
    `,
    [inboxId, claimToken, leaseMs],
  );
  return result.rows[0] ?? loadInboxRow(inboxId, db);
}

function classifyInboxPreflight(
  inboxId: string,
  row: StripeInboxRow | null,
  claimToken: string,
): StripeInboxApplicationResult | null {
  if (!row) {
    return {
      status: "pending",
      inboxId,
      stripeEventId: inboxId,
      reason: "inbox_row_not_found",
    };
  }
  if (row.status === "applied") {
    return {
      status: "applied",
      inboxId,
      stripeEventId: row.stripe_event_id,
      applicationResult: { status: "duplicate" },
    };
  }
  if (row.status === "blocked") {
    return {
      status: "blocked",
      inboxId,
      stripeEventId: row.stripe_event_id,
      reason: row.sanitized_error_class ?? "blocked_stripe_event",
    };
  }
  if (row.status !== "pending") {
    return {
      status: "pending",
      inboxId,
      stripeEventId: row.stripe_event_id,
      reason: "stripe_inbox_not_pending",
    };
  }
  if (row.claim_token !== claimToken) {
    return {
      status: "pending",
      inboxId,
      stripeEventId: row.stripe_event_id,
      reason: "stripe_inbox_claimed",
    };
  }
  return null;
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
    normalizedFacts: {
      ...facts.normalizedFacts,
      stripeEventCreated: Number.isFinite(event.created) ? event.created : null,
    },
  };
}

async function commitStripeEventReceipt(
  normalized: NormalizedStripeEvent,
  db: DatabaseQueryClient,
): Promise<StripeInboxReceiptResult> {
  const inboxId = inboxIdForStripeEvent(normalized.stripeEventId);
  try {
    await db.query(
      `
        with database_time as (
          select now() as database_now
        )
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
        select
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb,
          database_time.database_now, database_time.database_now, database_time.database_now
        from database_time
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
      await markInboxBlocked(existing.id, db, "stripe_event_fact_mismatch");
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
  if (
    event.type === "charge.refunded" ||
    event.type === "refund.created" ||
    event.type === "refund.updated" ||
    event.type === "refund.failed"
  ) {
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
  const normalizedFacts = storedJsonRecordValue(row.normalized_facts_json) ?? {};
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
    created:
      numberValue(normalizedFacts.stripeEventCreated) ??
      Math.floor(new Date(row.received_at).getTime() / 1000),
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
  const applicationStatus = stringValue(result?.applicationStatus);
  const status = resultStatus ?? applicationStatus;

  if (status === "applied" || status === "duplicate" || status === "noop") {
    return { status: "applied", reason };
  }
  if (
    reason === "trip_pass_order_not_found" ||
    reason === "missing_trip_pass_order_id" ||
    reason === "trip_pass_payment_intent_not_found"
  ) {
    return { status: "pending", reason };
  }
  if (status === "ignored") {
    return { status: "blocked", reason };
  }
  if (status === "rejected") {
    return { status: "blocked", reason };
  }

  return { status: "pending", reason };
}

async function scheduleInboxRetry(input: {
  inboxId: string;
  claimToken?: string;
  db: DatabaseQueryClient;
  reason: string;
  status: "pending" | "blocked";
}) {
  const current = await loadInboxRow(input.inboxId, input.db);
  const attemptCount = (current?.attempt_count ?? 0) + 1;
  const backoffDelayMs = input.status === "pending" ? backoffMs(attemptCount) : null;
  const alertState = attemptCount >= 10 ? "page" : attemptCount >= 5 ? "watch" : "none";

  await input.db.query(
    `
      with database_time as (
        select now() as database_now
      )
      update trip_pass_stripe_events
      set status = $2,
          attempt_count = $3,
          next_attempt_at = case
            when $4::double precision is null then null
            else database_time.database_now + ($4::double precision * interval '1 millisecond')
          end,
          claim_token = null,
          claim_expires_at = null,
          alert_state = $5,
          sanitized_error_class = $6,
          updated_at = database_time.database_now
      from database_time
      where id = $1
        and ($7::text is null or claim_token = $7)
    `,
    [
      input.inboxId,
      input.status,
      attemptCount,
      backoffDelayMs,
      alertState,
      input.reason,
      input.claimToken ?? null,
    ],
  );
}

function backoffMs(attemptCount: number) {
  return Math.min(60 * 60 * 1000, 2 ** Math.min(attemptCount, 8) * 1_000);
}

async function markInboxApplied(inboxId: string, claimToken: string, db: DatabaseQueryClient) {
  await db.query(
    `
      with database_time as (
        select now() as database_now
      )
      update trip_pass_stripe_events
      set status = 'applied',
          applied_at = database_time.database_now,
          next_attempt_at = null,
          claim_token = null,
          claim_expires_at = null,
          sanitized_error_class = null,
          updated_at = database_time.database_now
      from database_time
      where id = $1 and claim_token = $2
    `,
    [inboxId, claimToken],
  );
}

async function markInboxBlocked(inboxId: string, db: DatabaseQueryClient, reason: string) {
  await db.query(
    `
      with database_time as (
        select now() as database_now
      )
      update trip_pass_stripe_events
      set status = 'blocked',
          sanitized_error_class = $2,
          next_attempt_at = null,
          claim_token = null,
          claim_expires_at = null,
          updated_at = database_time.database_now
      from database_time
      where id = $1
    `,
    [inboxId, reason],
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

async function lockInboxRowForApplication(inboxId: string, db: DatabaseQueryClient) {
  const result = await db.query<StripeInboxRow & { database_now: Date | string }>(
    `
      select *, now() as database_now
      from trip_pass_stripe_events
      where id = $1
      for update
    `,
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
    row.order_id !== normalized.orderId ||
    row.product_code !== normalized.productCode ||
    row.product_version !== normalized.productVersion ||
    row.stripe_price_id !== normalized.stripePriceId ||
    row.amount_total_minor !== normalized.amountTotalMinor ||
    row.currency !== normalized.currency ||
    row.payment_status !== normalized.paymentStatus ||
    canonicalJson(row.normalized_facts_json) !== canonicalJson(normalized.normalizedFacts)
  );
}

function canonicalJson(value: unknown): string {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return JSON.stringify(sortJsonValue(parsed));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }
  return value;
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

function storedJsonRecordValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") {
    return recordValue(value);
  }
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
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
  claim_token: string | null;
  claim_expires_at: Date | string | null;
  sanitized_error_class: string | null;
  normalized_facts_json: Record<string, unknown> | string;
  received_at: Date | string;
};

function dateFromDatabaseValue(value: Date | string) {
  return value instanceof Date ? value : new Date(String(value));
}
