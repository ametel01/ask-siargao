import type { DatabaseQueryClient } from "@/server/db/query-client";
import { stableOperationalTaskId } from "@/server/operations/operational-task-producer";
import { enqueueOperationalTask } from "@/server/operations/worker-runner";
import {
  applyPendingLemonSqueezyPaymentEvent,
  receiveLemonSqueezyPaymentFact,
} from "@/server/payments/payment-event-receipts";
import {
  createLemonSqueezyCheckoutClient,
  type LemonSqueezyCheckoutClient,
} from "@/server/trip-pass/lemon-squeezy-adapter";
import { applyLemonSqueezyPaymentFact } from "@/server/trip-pass/lemon-squeezy-webhook-application";

type CheckoutReturnState = "applied" | "before_grace" | "eligible" | "missing" | "pending";

type CheckoutReturnLookupRow = {
  accepted_payment_fact_id: string | null;
  checkout_return_lookup_attempts: number | string;
  checkout_return_lookup_status: string;
  checkout_return_provider_order_id: string | null;
  checkout_return_provider_order_identifier: string | null;
  created_at: Date | string;
  user_id: string | null;
};

export async function readCheckoutReturnState(
  db: DatabaseQueryClient,
  input: { orderId: string; userId: string; now: Date },
): Promise<CheckoutReturnState> {
  const row = (
    await db.query<CheckoutReturnLookupRow>(
      `select accepted_payment_fact_id, checkout_return_lookup_attempts,
         checkout_return_lookup_status, checkout_return_provider_order_id,
         checkout_return_provider_order_identifier, created_at, user_id
       from trip_pass_orders
       where id = $1 and user_id = $2 and payment_provider = 'lemon_squeezy'`,
      [input.orderId, input.userId],
    )
  ).rows[0];
  if (!row) return "missing";
  if (row.accepted_payment_fact_id) return "applied";
  if (input.now.getTime() < new Date(row.created_at).getTime() + 10_000) return "before_grace";
  if (Number(row.checkout_return_lookup_attempts) >= 1) return "pending";
  return "eligible";
}

export async function applyExistingCheckoutReturnReceipt(input: {
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now: Date;
  orderId: string;
  userId?: string;
}) {
  const receipt = await input.db.query<{ id: string }>(
    `select receipt.id
     from trip_pass_payment_event_receipts receipt
     join trip_pass_orders orders on orders.id = receipt.order_id
     where receipt.provider = 'lemon_squeezy' and receipt.event_name = 'order_created'
       and receipt.order_id = $1 and ($2::text is null or orders.user_id = $2)
     order by receipt.created_at desc, receipt.id desc limit 1`,
    [input.orderId, input.userId],
  );
  const receiptId = receipt.rows[0]?.id;
  if (!receiptId) return null;
  return applyPendingLemonSqueezyPaymentEvent(receiptId, {
    db: input.db,
    now: input.now,
    applyFact: ({ fact, db, now }) =>
      applyLemonSqueezyPaymentFact(fact, { db, env: input.env, now }),
  });
}

export async function enqueueCheckoutReturnLookup(
  db: DatabaseQueryClient,
  input: {
    now: Date;
    orderId: string;
    providerOrderId: string;
    providerOrderIdentifier: string;
    userId: string;
  },
) {
  if (!/^\d{1,32}$/.test(input.providerOrderId)) return { status: "invalid" as const };
  if (!isProviderOrderIdentifier(input.providerOrderIdentifier)) {
    return { status: "invalid" as const };
  }
  if (!db.transaction) throw new Error("database_transactions_required");
  return db.transaction(async (transaction) => {
    const row = (
      await transaction.query<CheckoutReturnLookupRow>(
        `select accepted_payment_fact_id, checkout_return_lookup_attempts,
           checkout_return_lookup_status, checkout_return_provider_order_id,
           checkout_return_provider_order_identifier, created_at, user_id
         from trip_pass_orders
         where id = $1 and user_id = $2 and payment_provider = 'lemon_squeezy'
         for update`,
        [input.orderId, input.userId],
      )
    ).rows[0];
    if (!row) return { status: "missing" as const };
    if (row.accepted_payment_fact_id) return { status: "applied" as const };
    if (input.now.getTime() < new Date(row.created_at).getTime() + 10_000) {
      return { status: "before_grace" as const };
    }
    if (Number(row.checkout_return_lookup_attempts) >= 1) {
      return { status: "pending" as const };
    }
    await transaction.query(
      `update trip_pass_orders set
         checkout_return_lookup_attempts = checkout_return_lookup_attempts + 1,
         checkout_return_lookup_status = 'pending', checkout_return_lookup_claimed_at = null,
         checkout_return_provider_order_id = $3,
         checkout_return_provider_order_identifier = $4,
         checkout_return_lookup_completed_at = null, updated_at = $5
       where id = $1 and user_id = $2`,
      [
        input.orderId,
        input.userId,
        input.providerOrderId,
        input.providerOrderIdentifier,
        input.now,
      ],
    );
    await enqueueOperationalTask(
      {
        id: stableOperationalTaskId("checkout_return_lookup", input.orderId),
        resourceRef: input.orderId,
        taskType: "checkout_return_lookup",
      },
      transaction,
    );
    return { status: "enqueued" as const };
  });
}

export async function runCheckoutReturnLookup(
  orderId: string,
  dependencies: {
    client?: Pick<LemonSqueezyCheckoutClient, "retrieveOrder">;
    db: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
    now?: () => Date;
  },
) {
  const now = dependencies.now?.() ?? new Date();
  const row = (
    await dependencies.db.query<CheckoutReturnLookupRow>(
      `select accepted_payment_fact_id, checkout_return_lookup_attempts,
         checkout_return_lookup_status, checkout_return_provider_order_id,
         checkout_return_provider_order_identifier, created_at, user_id
       from trip_pass_orders
       where id = $1 and payment_provider = 'lemon_squeezy'`,
      [orderId],
    )
  ).rows[0];
  if (!row) throw new Error("checkout_return_lookup_unavailable");
  if (row.accepted_payment_fact_id) {
    await completeCheckoutReturnLookup(dependencies.db, orderId, "succeeded", now);
    return { status: "applied" as const };
  }

  const existing = await applyExistingCheckoutReturnReceipt({
    db: dependencies.db,
    env: dependencies.env,
    now,
    orderId,
    userId: row.user_id ?? undefined,
  });
  if (existing) {
    if (await checkoutReturnPaymentApplied(dependencies.db, orderId)) {
      await completeCheckoutReturnLookup(dependencies.db, orderId, "succeeded", now);
      return { status: "applied" as const };
    }
    if (existing.status === "blocked") {
      await completeCheckoutReturnLookup(dependencies.db, orderId, "exhausted", now);
      return { status: "blocked" as const };
    }
    throw new Error("checkout_return_receipt_retryable");
  }

  const providerOrderId = row.checkout_return_provider_order_id;
  const providerOrderIdentifier = row.checkout_return_provider_order_identifier;
  if (!providerOrderId || !providerOrderIdentifier) {
    throw new Error("checkout_return_provider_reference_unavailable");
  }
  const client = dependencies.client ?? createLemonSqueezyCheckoutClient();
  const fact = await client.retrieveOrder(providerOrderId);
  if (fact.providerOrderId !== providerOrderId || fact.paymentId !== providerOrderIdentifier) {
    await completeCheckoutReturnLookup(dependencies.db, orderId, "not_found", now);
    return { status: "not_found" as const };
  }
  const received = await receiveLemonSqueezyPaymentFact(
    { ...fact, orderId },
    {
      db: dependencies.db,
      now,
      applyFact: ({ fact: normalizedFact, db, now: factNow }) =>
        applyLemonSqueezyPaymentFact(normalizedFact, {
          db,
          env: dependencies.env,
          now: factNow,
        }),
    },
  );
  if (await checkoutReturnPaymentApplied(dependencies.db, orderId)) {
    await completeCheckoutReturnLookup(dependencies.db, orderId, "succeeded", now);
    return { status: "applied" as const };
  }
  if (received.status === "blocked") {
    await completeCheckoutReturnLookup(dependencies.db, orderId, "exhausted", now);
    return { status: "blocked" as const };
  }
  throw new Error("checkout_return_lookup_retryable");
}

async function checkoutReturnPaymentApplied(db: DatabaseQueryClient, orderId: string) {
  const result = await db.query<{ accepted_payment_fact_id: string | null }>(
    "select accepted_payment_fact_id from trip_pass_orders where id = $1",
    [orderId],
  );
  return Boolean(result.rows[0]?.accepted_payment_fact_id);
}

async function completeCheckoutReturnLookup(
  db: DatabaseQueryClient,
  orderId: string,
  status: "succeeded" | "not_found" | "exhausted",
  now: Date,
) {
  await db.query(
    `update trip_pass_orders set checkout_return_lookup_status = $2,
       checkout_return_lookup_completed_at = $3, checkout_return_lookup_claimed_at = null,
       checkout_return_provider_order_id = null,
       checkout_return_provider_order_identifier = null, updated_at = $3
     where id = $1`,
    [orderId, status, now],
  );
}

function isProviderOrderIdentifier(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
