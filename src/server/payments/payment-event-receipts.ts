import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  type NormalizedPaymentFact,
  parseLemonSqueezyOrderFact,
  paymentFactFingerprint,
} from "@/server/payments/lemon-squeezy";

const supportedLemonSqueezyEvents = new Set(["order_created", "order_refunded"]);

export type PaymentEventReceiptResult =
  | {
      status: "received" | "duplicate" | "pending" | "blocked";
      receiptId: string;
      fingerprint: string;
      fact: NormalizedPaymentFact;
      reason?: string;
    }
  | {
      status: "applied";
      receiptId: string;
      fingerprint: string;
      fact: NormalizedPaymentFact;
      applicationResult: unknown;
    };

export type PaymentFactApplication = (input: {
  fact: NormalizedPaymentFact;
  receiptId: string;
  db: DatabaseQueryClient;
  now: Date;
}) => Promise<unknown>;

export async function receiveLemonSqueezyPaymentEvent(
  payload: unknown,
  options: {
    db: DatabaseQueryClient;
    eventName?: string;
    now?: Date;
    applyFact?: PaymentFactApplication;
  },
): Promise<PaymentEventReceiptResult> {
  const now = options.now ?? new Date();
  const eventName = options.eventName ?? eventNameFromPayload(payload);
  const fact = parseLemonSqueezyOrderFact({ eventName, payload });
  const fingerprint = paymentFactFingerprint(fact);
  const receiptId = `payment_receipt_${fingerprint.slice(0, 32)}`;
  const supported = supportedLemonSqueezyEvents.has(eventName);

  const inserted = await options.db.query<{ id: string }>(
    `
      insert into trip_pass_payment_event_receipts (
        id, fingerprint, provider, event_name, object_id, provider_updated_at,
        order_id, provider_order_id, status, amount_total_minor, refunded_amount_minor,
        currency, normalized_facts_json, created_at, updated_at
      ) values ($1, $2, 'lemon_squeezy', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13)
      on conflict (fingerprint) do nothing
      returning id
    `,
    [
      receiptId,
      fingerprint,
      eventName,
      fact.objectId,
      fact.providerUpdatedAt,
      fact.orderId,
      fact.providerOrderId,
      supported ? "pending" : "blocked",
      fact.amountTotalMinor,
      fact.refundedAmountMinor,
      fact.currency,
      JSON.stringify(fact),
      now,
    ],
  );

  if (!inserted.rows[0]) {
    const existing = await options.db.query<PaymentEventReceiptRow>(
      `select id, fingerprint, event_name, status, normalized_facts_json
       from trip_pass_payment_event_receipts where fingerprint = $1`,
      [fingerprint],
    );
    const row = existing.rows[0];
    if (row?.status === "pending" && options.applyFact) {
      return applyPendingLemonSqueezyPaymentEvent(row.id, {
        applyFact: options.applyFact,
        db: options.db,
        now,
      });
    }
    if (row?.status === "pending") {
      return {
        status: "pending",
        receiptId: row.id,
        fingerprint,
        fact,
        reason: "pending_payment_event",
      };
    }
    if (row?.status === "blocked") {
      return {
        status: "blocked",
        receiptId: row.id,
        fingerprint,
        fact,
        reason: supported ? "payment_event_blocked" : "unsupported_lemon_squeezy_event",
      };
    }
    return {
      status: "duplicate",
      receiptId: row?.id ?? receiptId,
      fingerprint,
      fact,
      ...(supported ? {} : { reason: "unsupported_lemon_squeezy_event" }),
    };
  }

  if (!supported) {
    return {
      status: "blocked",
      receiptId,
      fingerprint,
      fact,
      reason: "unsupported_lemon_squeezy_event",
    };
  }
  if (!options.applyFact) return { status: "received", receiptId, fingerprint, fact };

  return applyPendingLemonSqueezyPaymentEvent(receiptId, {
    applyFact: options.applyFact,
    db: options.db,
    now,
  });
}

type PaymentEventReceiptRow = {
  id: string;
  fingerprint: string;
  event_name: string;
  status: string;
  normalized_facts_json: unknown;
};

export async function applyPendingLemonSqueezyPaymentEvent(
  receiptId: string,
  options: {
    db: DatabaseQueryClient;
    applyFact: PaymentFactApplication;
    now?: Date;
  },
): Promise<PaymentEventReceiptResult> {
  const now = options.now ?? new Date();
  const applyWithinTransaction = async (db: DatabaseQueryClient) => {
    const result = await db.query<PaymentEventReceiptRow>(
      `select id, fingerprint, event_name, status, normalized_facts_json
       from trip_pass_payment_event_receipts where id = $1 for update`,
      [receiptId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        status: "pending" as const,
        receiptId,
        fingerprint: receiptId,
        fact: emptyFact(row),
        reason: "payment_receipt_not_found",
      };
    }
    const fact = normalizedFactFromReceipt(row);
    if (row.status === "applied") {
      return {
        status: "duplicate" as const,
        receiptId: row.id,
        fingerprint: row.fingerprint,
        fact,
      };
    }
    if (row.status === "blocked") {
      return {
        status: "blocked" as const,
        receiptId: row.id,
        fingerprint: row.fingerprint,
        fact,
        reason: "payment_event_blocked",
      };
    }
    if (row.status !== "pending") {
      return {
        status: "pending" as const,
        receiptId: row.id,
        fingerprint: row.fingerprint,
        fact,
        reason: "payment_receipt_not_pending",
      };
    }

    let applicationResult: unknown;
    try {
      applicationResult = await options.applyFact({ fact, receiptId: row.id, db, now });
    } catch (error) {
      throw new RetryablePaymentEventError(sanitizedErrorReason(error));
    }
    const classification = classifyApplicationResult(applicationResult);
    if (classification.status === "applied") {
      await db.query(
        `update trip_pass_payment_event_receipts
         set status = 'applied', applied_at = $2, next_attempt_at = null, updated_at = $2
         where id = $1`,
        [row.id, now],
      );
      return {
        status: "applied" as const,
        receiptId: row.id,
        fingerprint: row.fingerprint,
        fact,
        applicationResult,
      };
    }
    if (classification.status === "blocked") {
      await db.query(
        `update trip_pass_payment_event_receipts
         set status = 'blocked', next_attempt_at = null, updated_at = $2 where id = $1`,
        [row.id, now],
      );
      return {
        status: "blocked" as const,
        receiptId: row.id,
        fingerprint: row.fingerprint,
        fact,
        reason: classification.reason,
      };
    }
    await schedulePaymentEventRetry(row.id, classification.reason, db, now);
    return {
      status: "pending" as const,
      receiptId: row.id,
      fingerprint: row.fingerprint,
      fact,
      reason: classification.reason,
    };
  };

  try {
    const result = options.db.transaction
      ? await options.db.transaction(applyWithinTransaction)
      : await applyWithinTransaction(options.db);
    return result;
  } catch (error) {
    const reason =
      error instanceof RetryablePaymentEventError ? error.reason : sanitizedErrorReason(error);
    await schedulePaymentEventRetry(receiptId, reason, options.db, now);
    const row = await options.db
      .query<PaymentEventReceiptRow>(
        `select id, fingerprint, event_name, status, normalized_facts_json
         from trip_pass_payment_event_receipts where id = $1`,
        [receiptId],
      )
      .then((result) => result.rows[0]);
    let fact: NormalizedPaymentFact;
    try {
      fact = row ? normalizedFactFromReceipt(row) : emptyFact(row);
    } catch {
      fact = emptyFact(row);
    }
    return {
      status: "pending",
      receiptId,
      fingerprint: row?.fingerprint ?? receiptId,
      fact,
      reason,
    };
  }
}

function classifyApplicationResult(
  result: unknown,
):
  | { status: "applied" }
  | { status: "pending"; reason: string }
  | { status: "blocked"; reason: string } {
  const application =
    typeof result === "object" && result !== null && "applicationResult" in result
      ? (result as { applicationResult?: unknown }).applicationResult
      : result;
  const status =
    typeof application === "object" && application !== null && "status" in application
      ? (application as { status?: unknown }).status
      : undefined;
  if (status === "applied" || status === "duplicate" || status === "ignored") {
    return { status: "applied" };
  }
  if (status === "rejected") {
    const reason =
      typeof application === "object" && application !== null && "reason" in application
        ? String((application as { reason?: unknown }).reason ?? "payment_event_rejected")
        : "payment_event_rejected";
    return reason === "trip_pass_order_not_found"
      ? { status: "pending", reason }
      : { status: "blocked", reason };
  }
  return { status: "pending", reason: "payment_event_application_pending" };
}

async function schedulePaymentEventRetry(
  receiptId: string,
  reason: string,
  db: DatabaseQueryClient,
  now: Date,
) {
  await db.query(
    `update trip_pass_payment_event_receipts
     set status = 'pending', attempt_count = attempt_count + 1,
         next_attempt_at = $2, updated_at = $2 where id = $1`,
    [receiptId, new Date(now.getTime() + 60_000)],
  );
  return reason;
}

class RetryablePaymentEventError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RetryablePaymentEventError";
  }
}

function sanitizedErrorReason(error: unknown) {
  return error instanceof Error && error.name ? error.name : "payment_event_application_failed";
}

function normalizedFactFromReceipt(row: PaymentEventReceiptRow): NormalizedPaymentFact {
  const value =
    typeof row.normalized_facts_json === "string"
      ? JSON.parse(row.normalized_facts_json)
      : row.normalized_facts_json;
  if (typeof value !== "object" || value === null) throw new Error("payment_receipt_fact_invalid");
  return value as NormalizedPaymentFact;
}

function emptyFact(_row: PaymentEventReceiptRow | undefined): NormalizedPaymentFact {
  return {
    provider: "lemon_squeezy",
    eventName: "unknown",
    objectId: "unknown",
    providerUpdatedAt: new Date(0).toISOString(),
    orderId: null,
    providerOrderId: null,
    checkoutId: null,
    paymentId: null,
    storeId: null,
    variantId: null,
    status: "pending",
    amountTotalMinor: null,
    refundedAmountMinor: null,
    currency: null,
    testMode: null,
  };
}

export function eventNameFromPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return "unknown";
  const meta = (payload as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return "unknown";
  const eventName = (meta as { event_name?: unknown }).event_name;
  return typeof eventName === "string" && eventName.trim() ? eventName : "unknown";
}

export function isSupportedLemonSqueezyEvent(eventName: string) {
  return supportedLemonSqueezyEvents.has(eventName);
}
