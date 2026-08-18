import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  type NormalizedPaymentFact,
  parseLemonSqueezyOrderFact,
  paymentFactFingerprint,
} from "@/server/payments/lemon-squeezy";

const supportedLemonSqueezyEvents = new Set(["order_created", "order_refunded"]);

export type PaymentEventReceiptResult =
  | {
      status: "received" | "duplicate" | "blocked";
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
    const existing = await options.db.query<{ id: string; status: string }>(
      "select id, status from trip_pass_payment_event_receipts where fingerprint = $1",
      [fingerprint],
    );
    return {
      status: "duplicate",
      receiptId: existing.rows[0]?.id ?? receiptId,
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

  try {
    const applicationResult = await options.applyFact({ fact, receiptId, db: options.db, now });
    await options.db.query(
      "update trip_pass_payment_event_receipts set status = 'applied', applied_at = $2, updated_at = $2 where id = $1",
      [receiptId, now],
    );
    return { status: "applied", receiptId, fingerprint, fact, applicationResult };
  } catch (error) {
    await options.db.query(
      "update trip_pass_payment_event_receipts set status = 'pending', attempt_count = attempt_count + 1, next_attempt_at = $2, updated_at = $2 where id = $1",
      [receiptId, new Date(now.getTime() + 60_000)],
    );
    throw error;
  }
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
