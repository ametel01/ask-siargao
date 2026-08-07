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

const now = new Date("2026-08-07T08:00:00.000Z");

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

      expect(duplicate).toMatchObject({ status: "duplicate" });
      expect(conflicting).toMatchObject({
        status: "blocked",
        reason: "stripe_event_fact_mismatch",
      });
      await expectInboxRow(db, "evt_duplicate", {
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

function createPgliteQueryClient(db: PGlite): DatabaseQueryClient {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return db.query<T>(query, params);
    },
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback(client);
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

function checkoutSessionEvent(
  eventId: string,
  orderId: string,
  options: { apiVersion?: string } = {},
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
        customer_email: "traveler@example.com",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
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
