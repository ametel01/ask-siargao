import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import {
  claimPendingStripeInboxEvents,
  normalizeStripeEvent,
  readBoundedStripeWebhookBody,
  receiveStripeWebhookEvent,
  STRIPE_API_VERSION,
  STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION,
  StripeWebhookBodyTooLargeError,
} from "@/server/payments/stripe-event-inbox";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

const now = new Date("2026-08-07T08:00:00.000Z");
const env = { TRIP_PASS_CHECKOUT_MODE: "on", STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass" };

describe("Stripe event inbox", () => {
  test("normalizes supported events without raw payload or identity fields", () => {
    const normalized = normalizeStripeEvent(checkoutSessionEvent("evt_normalized", "order_123"));

    expect(normalized).toMatchObject({
      stripeEventId: "evt_normalized",
      stripeApiVersion: STRIPE_API_VERSION,
      normalizedSchemaVersion: STRIPE_NORMALIZED_EVENT_SCHEMA_VERSION,
      eventType: "checkout.session.completed",
      objectType: "checkout.session",
      checkoutSessionId: "cs_order_123",
      paymentIntentId: "pi_order_123",
      orderId: "order_123",
      productCode: "siargao_trip_pass_14d_v2",
      productVersion: 2,
      paymentStatus: "paid",
      status: "pending",
    });
    expect(JSON.stringify(normalized)).not.toContain("customer_email");
    expect(JSON.stringify(normalized)).not.toContain("raw");
  });

  test("commits a receipt before application and records applied state", async () => {
    await withTestDb(async (db) => {
      const appliedAfterReceipt: string[] = [];
      const result = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_applied", "order_1"),
        {
          db,
          now,
          applyEvent: async (_event, options) => {
            const receipt = await options.db.query<{ status: string }>(
              "select status from trip_pass_stripe_events where stripe_event_id = $1",
              ["evt_applied"],
            );
            appliedAfterReceipt.push(receipt.rows[0]?.status ?? "missing");
            return { status: "applied", action: "activated" };
          },
        },
      );

      expect(result).toMatchObject({ status: "applied", stripeEventId: "evt_applied" });
      expect(appliedAfterReceipt).toEqual(["pending"]);
      await expectInboxRow(db, "evt_applied", { status: "applied", attempt_count: 0 });
    });
  });

  test("replays the authoritative Stripe event timestamp instead of receipt time", async () => {
    await withTestDb(async (db) => {
      const event = checkoutSessionEvent("evt_authoritative_time", "order_authoritative_time");
      event.created = 1_786_003_200;
      let replayedCreated: number | undefined;

      await receiveStripeWebhookEvent(event, {
        db,
        applyEvent: async (replayedEvent) => {
          replayedCreated = replayedEvent.created;
          return { status: "applied" };
        },
      });

      expect(replayedCreated).toBe(1_786_003_200);
    });
  });

  test("keeps missing prerequisites pending and acknowledges durable receipt", async () => {
    await withTestDb(async (db) => {
      const result = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_missing_order", "order_missing"),
        {
          db,
          now,
          applyEvent: async () => ({
            status: "rejected",
            reason: "trip_pass_order_not_found",
          }),
        },
      );

      expect(result).toMatchObject({
        status: "pending",
        stripeEventId: "evt_missing_order",
        reason: "trip_pass_order_not_found",
      });
      const row = await expectInboxRow(db, "evt_missing_order", {
        status: "pending",
        attempt_count: 1,
        sanitized_error_class: "trip_pass_order_not_found",
      });
      expect(row.next_attempt_at).toBeTruthy();
    });
  });

  test("keeps application exceptions retryable after durable receipt", async () => {
    await withTestDb(async (db) => {
      const result = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_application_exception", "order_exception"),
        {
          db,
          now,
          applyEvent: async () => {
            throw new TypeError("provider retrieval failed with sensitive detail");
          },
        },
      );

      expect(result).toMatchObject({
        status: "pending",
        stripeEventId: "evt_application_exception",
        reason: "TypeError",
      });
      await expectInboxRow(db, "evt_application_exception", {
        status: "pending",
        attempt_count: 1,
        sanitized_error_class: "TypeError",
      });
    });
  });

  test("does not start application when durable receipt persistence fails", async () => {
    let applicationStarted = false;
    const failingDb: DatabaseQueryClient = {
      async query() {
        throw new Error("receipt commit failed");
      },
    };

    await expect(
      receiveStripeWebhookEvent(checkoutSessionEvent("evt_receipt_failure", "order_failure"), {
        db: failingDb,
        now,
        applyEvent: async () => {
          applicationStarted = true;
          return { status: "applied" };
        },
      }),
    ).rejects.toThrow("receipt commit failed");
    expect(applicationStarted).toBe(false);
  });

  test("blocks unsupported API versions and event types durably", async () => {
    await withTestDb(async (db) => {
      const apiResult = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_wrong_api", "order_api", { apiVersion: "2026-05-27.dahlia" }),
        { db, now },
      );
      const typeResult = await receiveStripeWebhookEvent(customerEvent("evt_customer"), {
        db,
        now,
      });

      expect(apiResult).toMatchObject({
        status: "blocked",
        reason: "unsupported_stripe_api_version",
      });
      expect(typeResult).toMatchObject({
        status: "blocked",
        reason: "unsupported_stripe_event_type",
      });
      await expectInboxRow(db, "evt_wrong_api", {
        status: "blocked",
        sanitized_error_class: "unsupported_stripe_api_version",
      });
      await expectInboxRow(db, "evt_customer", {
        status: "blocked",
        sanitized_error_class: "unsupported_stripe_event_type",
      });
    });
  });

  test("deduplicates identical events and blocks conflicting immutable facts", async () => {
    await withTestDb(async (db) => {
      await receiveStripeWebhookEvent(checkoutSessionEvent("evt_duplicate", "order_original"), {
        db,
        now,
      });
      const duplicate = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_duplicate", "order_original"),
        { db, now },
      );
      const conflicting = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_duplicate", "order_changed"),
        { db, now },
      );
      await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_duplicate_amount", "order_amount"),
        { db, now },
      );
      const amountConflict = await receiveStripeWebhookEvent(
        checkoutSessionEvent("evt_duplicate_amount", "order_amount", { amountTotal: 123 }),
        { db, now },
      );

      expect(duplicate).toMatchObject({ status: "duplicate" });
      expect(conflicting).toMatchObject({
        status: "blocked",
        reason: "stripe_event_fact_mismatch",
      });
      expect(amountConflict).toMatchObject({
        status: "blocked",
        reason: "stripe_event_fact_mismatch",
      });
      await expectInboxRow(db, "evt_duplicate", {
        status: "blocked",
        sanitized_error_class: "stripe_event_fact_mismatch",
      });
      await expectInboxRow(db, "evt_duplicate_amount", {
        status: "blocked",
        sanitized_error_class: "stripe_event_fact_mismatch",
      });
    });
  });

  test("claims due pending rows with a lease token", async () => {
    await withTestDb(async (db) => {
      await receiveStripeWebhookEvent(checkoutSessionEvent("evt_claim", "order_claim"), {
        db,
        now,
        applyEvent: async () => ({ status: "rejected", reason: "trip_pass_order_not_found" }),
      });
      await db.query(
        "update trip_pass_stripe_events set next_attempt_at = $2 where stripe_event_id = $1",
        ["evt_claim", now],
      );

      const firstClaim = await claimPendingStripeInboxEvents({
        claimToken: "claim_1",
        db,
        limit: 1,
        now,
      });
      const secondClaim = await claimPendingStripeInboxEvents({
        claimToken: "claim_2",
        db,
        limit: 1,
        now,
      });

      expect(firstClaim).toEqual(["stripe_event_evt_claim"]);
      expect(secondClaim).toEqual([]);
    });
  });

  test("rolls back actual Trip Pass target writes and inbox applied state at crash boundaries", async () => {
    const crashBoundaries: Array<{ name: string; pattern: RegExp }> = [
      {
        name: "order-provider-link",
        pattern: /set\s+stripe_checkout_session_id\s*=\s*\$2,\s*stripe_payment_intent_id/i,
      },
      { name: "pass", pattern: /insert\s+into\s+trip_passes\b/i },
      { name: "grant", pattern: /insert\s+into\s+trip_pass_grants\b/i },
      { name: "meter", pattern: /insert\s+into\s+trip_usage_meters\b/i },
      { name: "order-paid", pattern: /set\s+status\s*=\s*'paid'/i },
      { name: "inbox-applied", pattern: /set\s+status\s*=\s*'applied'/i },
    ];

    for (const boundary of crashBoundaries) {
      await withTestDb(async (db) => {
        const orderId = `order_crash_${boundary.name.replaceAll("-", "_")}`;
        const eventId = `evt_crash_${boundary.name.replaceAll("-", "_")}`;
        await insertCheckoutCreatedOrder(db, orderId, `user_${boundary.name.replaceAll("-", "_")}`);

        const result = await receiveStripeWebhookEvent(checkoutSessionEvent(eventId, orderId), {
          db: failAfterQuery(db, boundary.pattern),
          now,
          applyEvent: (event, options) =>
            applyTripPassStripeEvent(event, { db: options.db, env, now: options.now }),
        });

        expect(result).toMatchObject({ status: "pending", reason: "Error" });
        await expectInboxRow(db, eventId, {
          status: "pending",
          attempt_count: 1,
          sanitized_error_class: "Error",
        });
        await expectOrderUnpaid(db, orderId);
        await expectTargetCounts(db, { passes: "0", grants: "0", meters: "0" });
      });
    }
  }, 15_000);

  test("rejects declared and actual oversized bodies", async () => {
    await expect(
      readBoundedStripeWebhookBody(
        new Request("https://siargao.test/api/stripe/webhook", {
          method: "POST",
          headers: { "content-length": "10" },
          body: "1234567890",
        }),
        4,
      ),
    ).rejects.toBeInstanceOf(StripeWebhookBodyTooLargeError);

    await expect(
      readBoundedStripeWebhookBody(
        new Request("https://siargao.test/api/stripe/webhook", {
          method: "POST",
          body: "12345",
        }),
        4,
      ),
    ).rejects.toBeInstanceOf(StripeWebhookBodyTooLargeError);

    await expect(
      readBoundedStripeWebhookBody(
        new Request("https://siargao.test/api/stripe/webhook", {
          method: "POST",
          headers: { "content-length": "false" },
          body: chunkedBody(["ab", "cd", "é"]),
          duplex: "half",
        } as RequestInit),
        5,
      ),
    ).rejects.toBeInstanceOf(StripeWebhookBodyTooLargeError);
  });
});

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(createPgliteQueryClient(db));
  } finally {
    await db.close();
  }
}

function failAfterQuery(db: DatabaseQueryClient, pattern: RegExp): DatabaseQueryClient {
  let failed = false;
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const result = await db.query<T>(query, params);
      if (!failed && pattern.test(query)) {
        failed = true;
        throw new Error("forced actual Trip Pass target rollback");
      }
      return result;
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      if (!db.transaction) {
        throw new Error("Test database transaction support is required.");
      }
      return db.transaction((transaction) =>
        callback({ ...failAfterQuery(transaction, pattern), inTransaction: true }),
      );
    },
  };
}

function createPgliteQueryClient(db: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback({ ...client, inTransaction: true });
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };

  return client;
}

async function expectInboxRow(
  db: DatabaseQueryClient,
  stripeEventId: string,
  expected: Partial<{
    status: string;
    attempt_count: number;
    sanitized_error_class: string | null;
  }>,
) {
  const result = await db.query<{
    status: string;
    attempt_count: number;
    sanitized_error_class: string | null;
    next_attempt_at: Date | string | null;
    normalized_facts_json: Record<string, unknown>;
  }>(
    `
      select
        status,
        attempt_count,
        sanitized_error_class,
        next_attempt_at,
        normalized_facts_json
      from trip_pass_stripe_events
      where stripe_event_id = $1
    `,
    [stripeEventId],
  );

  const row = result.rows[0];
  expect(row).toMatchObject(expected);
  expect(JSON.stringify(row?.normalized_facts_json)).not.toContain("customer_email");
  if (!row) {
    throw new Error(`Missing inbox row for ${stripeEventId}.`);
  }
  return row;
}

async function insertCheckoutCreatedOrder(
  db: DatabaseQueryClient,
  orderId: string,
  userId: string,
) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
  await db.query(
    `
      insert into trip_pass_orders (
        id,
        user_id,
        email,
        status,
        product_code,
        product_version,
        stripe_price_id,
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        metadata_json,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 'checkout_created', 'siargao_trip_pass_14d_v2', 2, 'price_trip_pass', 49900, 'php', $4, $5, '{}'::jsonb, $6, $6)
    `,
    [
      orderId,
      userId,
      `${userId}@example.com`,
      `trip_pass_checkout:${orderId}`,
      `cs_${orderId}`,
      now,
    ],
  );
}

async function expectOrderUnpaid(db: DatabaseQueryClient, orderId: string) {
  const result = await db.query<{
    status: string;
    stripe_payment_intent_id: string | null;
  }>(
    `
      select status, stripe_payment_intent_id
      from trip_pass_orders
      where id = $1
    `,
    [orderId],
  );
  expect(result.rows[0]).toEqual({
    status: "checkout_created",
    stripe_payment_intent_id: null,
  });
}

async function expectTargetCounts(
  db: DatabaseQueryClient,
  expected: { passes: string; grants: string; meters: string },
) {
  const passes = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_passes",
  );
  const grants = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_grants",
  );
  const meters = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_usage_meters",
  );

  expect(passes.rows[0]?.count).toBe(expected.passes);
  expect(grants.rows[0]?.count).toBe(expected.grants);
  expect(meters.rows[0]?.count).toBe(expected.meters);
}

function checkoutSessionEvent(
  eventId: string,
  orderId: string,
  options: { amountTotal?: number; apiVersion?: string; currency?: string } = {},
) {
  return {
    id: eventId,
    object: "event",
    api_version: options.apiVersion ?? STRIPE_API_VERSION,
    created: 1_786_080_000,
    data: {
      object: {
        id: `cs_${orderId}`,
        object: "checkout.session",
        mode: "payment",
        client_reference_id: orderId,
        metadata: {
          tripPassOrderId: orderId,
          productCode: "siargao_trip_pass_14d_v2",
          productVersion: "2",
        },
        payment_intent: `pi_${orderId}`,
        payment_status: "paid",
        amount_total: options.amountTotal ?? 49900,
        currency: options.currency ?? "php",
        customer_email: "traveler@example.com",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

function chunkedBody(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function customerEvent(eventId: string) {
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_786_080_000,
    data: {
      object: {
        id: "cus_test",
        object: "customer",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.created",
  } as Stripe.Event;
}
