import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import { cancelTripPassCheckout, startTripPassCheckout } from "@/server/trip-pass/commerce";
import type {
  TripPassCheckoutClient,
  TripPassCheckoutSessionSummary,
} from "@/server/trip-pass/stripe-adapter";

const now = new Date("2026-07-03T08:00:00.000Z");
const enabledEnv = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
} as const;

describe("Trip Pass checkout commerce", () => {
  test("does not create orders or call Stripe when checkout is disabled or unavailable", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_disabled");
      const checkoutClient = createFakeCheckoutClient();

      await expect(
        startTripPassCheckout(
          {
            userId: "user_disabled",
            email: "disabled@example.com",
            appUrl: "https://siargao.test",
          },
          { db, checkoutClient, env: {}, now },
        ),
      ).resolves.toEqual({ status: "disabled", reason: "trip_pass_checkout_disabled" });
      await expect(
        startTripPassCheckout(
          {
            userId: "user_disabled",
            email: "disabled@example.com",
            appUrl: "https://siargao.test",
          },
          { db, checkoutClient, env: { TRIP_PASS_CHECKOUT_MODE: "on" }, now },
        ),
      ).resolves.toEqual({
        status: "unavailable",
        reason: "missing_stripe_trip_pass_price_id",
      });

      expect(checkoutClient.calls).toHaveLength(0);
      await expectOrderCount(db, "0");
    });
  });

  test("creates a pending local order before Stripe and stores only checkout-created state", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_checkout");
      const events: string[] = [];
      const checkoutClient = createFakeCheckoutClient({
        beforeCreate: async (params) => {
          const count = await db.query<{ count: string }>(
            `
              select count(*)::text as count
              from trip_pass_orders
              where id = $1 and status = 'pending'
            `,
            [String(params.client_reference_id)],
          );
          events.push(`pending:${count.rows[0]?.count}`);
        },
      });

      const result = await startTripPassCheckout(
        {
          userId: "user_checkout",
          email: "checkout@example.com",
          appUrl: "https://siargao.test/",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_checkout",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toEqual({
        status: "started",
        orderId: "order_checkout",
        checkoutUrl: "https://checkout.stripe.test/order_checkout",
      });
      expect(events).toEqual(["pending:1"]);
      expect(checkoutClient.calls[0]?.params).toMatchObject({
        mode: "payment",
        client_reference_id: "order_checkout",
        customer_email: undefined,
        payment_method_types: ["card"],
        consent_collection: {
          terms_of_service: "required",
        },
        success_url: "https://siargao.test/settings?trip_pass_checkout=return&order=order_checkout",
        cancel_url:
          "https://siargao.test/settings?trip_pass_checkout=cancelled&order=order_checkout",
        metadata: {
          tripPassOrderId: "order_checkout",
          productCode: "siargao_trip_pass_14d_v2",
          productFamily: "siargao_trip_pass",
          productVersion: "2",
          durationHours: "336",
          chatMessageLimit: "150",
          termsPolicyVersion: "trip-pass-terms-2026-08-07",
          refundPolicyVersion: "trip-pass-refund-2026-08-07",
          privacyPolicyVersion: "privacy-2026-08-07",
          retentionPolicyVersion: "commerce-retention-2026-08-07",
        },
        line_items: [{ price: "price_trip_pass", quantity: 1 }],
      });
      expect(typeof checkoutClient.calls[0]?.params.expires_at).toBe("number");
      expect(checkoutClient.calls[0]?.options.idempotencyKey).toBe(
        "trip_pass_checkout:order_checkout",
      );
      await expectOrder(db, "order_checkout", {
        status: "checkout_created",
        email: null,
        stripeCheckoutSessionId: "cs_order_checkout",
        amountTotalMinor: 999,
        currency: "usd",
        checkoutSessionStatus: "open",
      });
      await expectNoAccessGrant(db);
    });
  });

  test("reuses a valid pending order and Stripe idempotency key for duplicate clicks", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_duplicate_checkout");
      const checkoutClient = createFakeCheckoutClient();

      const first = await startTripPassCheckout(
        {
          userId: "user_duplicate_checkout",
          email: "duplicate@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_duplicate_checkout",
          env: enabledEnv,
          now,
        },
      );
      const second = await startTripPassCheckout(
        {
          userId: "user_duplicate_checkout",
          email: "duplicate@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_should_not_be_used",
          env: enabledEnv,
          now: new Date("2026-07-03T08:05:00.000Z"),
        },
      );

      expect(first).toEqual({
        status: "started",
        orderId: "order_duplicate_checkout",
        checkoutUrl: "https://checkout.stripe.test/order_duplicate_checkout",
      });
      expect(second).toEqual({
        status: "reused",
        orderId: "order_duplicate_checkout",
        checkoutUrl: "https://checkout.stripe.test/order_duplicate_checkout",
      });
      expect(checkoutClient.calls.map((call) => call.options.idempotencyKey)).toEqual([
        "trip_pass_checkout:order_duplicate_checkout",
        "trip_pass_checkout:order_duplicate_checkout",
      ]);
      await expectOrderCount(db, "1");
      await expectNoAccessGrant(db);
    });
  });

  test("does not persist supplied provider email into new checkout orders", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_transient_email");

      await startTripPassCheckout(
        {
          userId: "user_transient_email",
          email: "transient-provider@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_transient_email",
          env: enabledEnv,
          now,
        },
      );

      await expectOrder(db, "order_transient_email", {
        status: "checkout_created",
        email: null,
      });
    });
  });

  test("keeps an old effective pending order until provider terminal confirmation", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_stale");
      await insertPendingOrder(db, {
        id: "order_stale",
        userId: "user_stale",
        createdAt: "2026-07-03T07:00:00.000Z",
      });

      const result = await startTripPassCheckout(
        {
          userId: "user_stale",
          email: "stale@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_replacement",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toMatchObject({ status: "reused", orderId: "order_stale" });
      await expectOrder(db, "order_stale", { status: "checkout_created" });
      await expectOrderCount(db, "1");
    });
  });

  test("keeps Stripe failures before activation as a retryable pending order", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_stripe_failure");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_stripe_failure",
            email: "failure@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({
              failWith: new Error("stripe fixture failure"),
            }),
            createId: () => "order_stripe_failure",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("stripe fixture failure");

      await expectOrder(db, "order_stripe_failure", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });
      await expectNoAccessGrant(db);
    });
  });

  test("does not reuse or expose another user's pending order", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_owner_checkout");
      await insertUser(db, "user_other_checkout");
      await insertPendingOrder(db, {
        id: "order_owner_checkout",
        userId: "user_owner_checkout",
        createdAt: "2026-07-03T07:59:00.000Z",
      });

      const result = await startTripPassCheckout(
        {
          userId: "user_other_checkout",
          email: "other@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_other_checkout",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toEqual({
        status: "started",
        orderId: "order_other_checkout",
        checkoutUrl: "https://checkout.stripe.test/order_other_checkout",
      });
      await expectOrder(db, "order_owner_checkout", { status: "pending" });
      await expectOrder(db, "order_other_checkout", { status: "checkout_created" });
      await expectOrderCount(db, "2");
    });
  });

  test("rejects Stripe sessions that do not match local metadata or Price identity", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_bad_session");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_session",
            email: "bad-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({ priceId: "price_wrong" }),
            createId: () => "order_bad_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("price does not match");

      await expectOrder(db, "order_bad_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });
      await expectNoAccessGrant(db);
    });
  });

  test("rejects Stripe sessions that do not match the presented policy versions", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_bad_policy_session");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_policy_session",
            email: "bad-policy-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({
              metadataOverrides: { termsPolicyVersion: "old-terms" },
            }),
            createId: () => "order_bad_policy_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("policy versions");

      await expectOrder(db, "order_bad_policy_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });
      await expectNoAccessGrant(db);
    });
  });

  test("rejects Stripe sessions that do not match the duration or meter contract", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_bad_terms_session");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_terms_session",
            email: "bad-terms-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({
              metadataOverrides: { chatMessageLimit: "149" },
            }),
            createId: () => "order_bad_terms_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("product terms");

      await expectOrder(db, "order_bad_terms_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });
      await expectNoAccessGrant(db);
    });
  });

  test("blocks family-wide checkout while an active non-exhausted pass exists", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_active_pass");
      await createActiveTripPassWithMeters(
        {
          id: "pass_active",
          userId: "user_active_pass",
          startsAt: new Date("2026-08-07T07:00:00.000Z"),
          expiresAt: new Date("2026-08-21T07:00:00.000Z"),
          now,
        },
        db,
      );
      const checkoutClient = createFakeCheckoutClient();

      const result = await startTripPassCheckout(
        {
          userId: "user_active_pass",
          email: "active-pass@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_should_not_start",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toEqual({ status: "blocked", reason: "trip_pass_family_active" });
      expect(checkoutClient.calls).toHaveLength(0);
      await expectOrderCount(db, "0");
    });
  });

  test("permits family-wide checkout when the active pass is exhausted", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_exhausted_pass");
      await createActiveTripPassWithMeters(
        {
          id: "pass_exhausted",
          userId: "user_exhausted_pass",
          startsAt: new Date("2026-08-07T07:00:00.000Z"),
          expiresAt: new Date("2026-08-21T07:00:00.000Z"),
          now,
        },
        db,
      );
      await db.query(
        `
          update trip_usage_meters
          set used = "limit"
          where trip_pass_id = $1
            and meter_type = 'chat_message'
        `,
        ["pass_exhausted"],
      );

      const result = await startTripPassCheckout(
        {
          userId: "user_exhausted_pass",
          email: "exhausted-pass@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_after_exhaustion",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toMatchObject({ status: "started", orderId: "order_after_exhaustion" });
      await expectOrder(db, "order_after_exhaustion", { status: "checkout_created" });
    });
  });

  test("expires an owner-scoped pending checkout only after Stripe confirms expiry", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_cancel");
      await insertPendingOrder(db, {
        id: "order_cancel",
        userId: "user_cancel",
        createdAt: "2026-07-03T07:59:00.000Z",
        stripeCheckoutSessionId: "cs_order_cancel",
      });
      const checkoutClient = createFakeCheckoutClient();

      const result = await cancelTripPassCheckout(
        { userId: "user_cancel" },
        { db, checkoutClient, now },
      );

      expect(result).toEqual({ status: "cancelled", orderId: "order_cancel" });
      expect(checkoutClient.expireCalls).toEqual(["cs_order_cancel"]);
      await expectOrder(db, "order_cancel", {
        status: "expired",
        checkoutSessionStatus: "expired",
      });
    });
  });

  test("does not release an effective pending order when Stripe cancellation is ambiguous", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_cancel_ambiguous");
      await insertPendingOrder(db, {
        id: "order_cancel_ambiguous",
        userId: "user_cancel_ambiguous",
        createdAt: "2026-07-03T07:59:00.000Z",
        stripeCheckoutSessionId: "cs_order_cancel_ambiguous",
      });

      const result = await cancelTripPassCheckout(
        { userId: "user_cancel_ambiguous" },
        {
          db,
          checkoutClient: createFakeCheckoutClient({ expireStatus: "open" }),
          now,
        },
      );

      expect(result).toEqual({
        status: "unavailable",
        reason: "checkout_cancellation_unavailable",
      });
      await expectOrder(db, "order_cancel_ambiguous", { status: "pending" });
    });
  });
});

type FakeCheckoutClient = TripPassCheckoutClient & {
  calls: Array<{
    params: Stripe.Checkout.SessionCreateParams;
    options: { idempotencyKey: string };
  }>;
  expireCalls: string[];
};

function createFakeCheckoutClient(
  options: {
    beforeCreate?: (params: Stripe.Checkout.SessionCreateParams) => Promise<void>;
    expireStatus?: TripPassCheckoutSessionSummary["status"];
    failWith?: Error;
    metadataOverrides?: Record<string, string>;
    priceId?: string;
  } = {},
): FakeCheckoutClient {
  const sessionsByIdempotencyKey = new Map<string, TripPassCheckoutSessionSummary>();
  const calls: FakeCheckoutClient["calls"] = [];
  const expireCalls: string[] = [];

  return {
    calls,
    expireCalls,
    async createCheckoutSession(params, createOptions) {
      calls.push({ params, options: createOptions });
      await options.beforeCreate?.(params);
      if (options.failWith) {
        throw options.failWith;
      }

      const cached = sessionsByIdempotencyKey.get(createOptions.idempotencyKey);
      if (cached) {
        return cached;
      }

      const orderId = String(params.client_reference_id);
      const session = {
        id: `cs_${orderId}`,
        url: `https://checkout.stripe.test/${orderId}`,
        clientReferenceId: orderId,
        metadata: { ...stringMetadata(params.metadata), ...(options.metadataOverrides ?? {}) },
        amountTotalMinor: 999,
        currency: "usd",
        expiresAt: params.expires_at ? new Date(Number(params.expires_at) * 1000) : null,
        priceId:
          options.priceId ??
          String((params.line_items?.[0] as Stripe.Checkout.SessionCreateParams.LineItem)?.price),
        status: "open" as const,
        termsConsentCollected: false,
      };
      sessionsByIdempotencyKey.set(createOptions.idempotencyKey, session);
      return session;
    },
    async expireCheckoutSession(sessionId) {
      expireCalls.push(sessionId);
      return {
        id: sessionId,
        url: "",
        clientReferenceId: null,
        metadata: null,
        amountTotalMinor: 999,
        currency: "usd",
        expiresAt: now,
        priceId: "price_trip_pass",
        status: options.expireStatus ?? "expired",
        termsConsentCollected: false,
      };
    },
  };
}

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

function stringMetadata(metadata: Stripe.MetadataParam | undefined) {
  if (!metadata) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}

async function insertUser(db: DatabaseQueryClient, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function insertPendingOrder(
  db: DatabaseQueryClient,
  input: { id: string; userId: string; createdAt: string; stripeCheckoutSessionId?: string },
) {
  await db.query(
    `
      insert into trip_pass_orders (
        id,
        user_id,
        email,
        status,
        product_code,
        product_family,
        product_version,
        stripe_price_id,
        stripe_checkout_session_id,
        checkout_session_status,
        checkout_idempotency_key,
        metadata_json,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        'pending',
        'siargao_trip_pass_14d_v2',
        'siargao_trip_pass',
        2,
        'price_trip_pass',
        $4,
        $5,
        $6,
        '{}'::jsonb,
        $7,
        $7
      )
    `,
    [
      input.id,
      input.userId,
      `${input.userId}@example.com`,
      input.stripeCheckoutSessionId ?? null,
      input.stripeCheckoutSessionId ? "open" : null,
      `trip_pass_checkout:${input.id}`,
      input.createdAt,
    ],
  );
}

async function expectOrder(
  db: DatabaseQueryClient,
  orderId: string,
  expected: Partial<{
    status: string;
    email: string | null;
    stripeCheckoutSessionId: string | null;
    amountTotalMinor: number | null;
    checkoutSessionStatus: string | null;
    currency: string | null;
  }>,
) {
  const result = await db.query<{
    status: string;
    email: string | null;
    stripe_checkout_session_id: string | null;
    amount_total_minor: number | null;
    checkout_session_status: string | null;
    currency: string | null;
  }>(
    `
      select status, email, stripe_checkout_session_id, amount_total_minor, checkout_session_status, currency
      from trip_pass_orders
      where id = $1
    `,
    [orderId],
  );
  const row = result.rows[0];

  expect(row).toBeDefined();
  if (!row) {
    return;
  }
  if (expected.status !== undefined) {
    expect(row.status).toBe(expected.status);
  }
  if (expected.email !== undefined) {
    expect(row.email).toBe(expected.email);
  }
  if (expected.stripeCheckoutSessionId !== undefined) {
    expect(row.stripe_checkout_session_id).toBe(expected.stripeCheckoutSessionId);
  }
  if (expected.amountTotalMinor !== undefined) {
    expect(row.amount_total_minor).toBe(expected.amountTotalMinor);
  }
  if (expected.checkoutSessionStatus !== undefined) {
    expect(row.checkout_session_status).toBe(expected.checkoutSessionStatus);
  }
  if (expected.currency !== undefined) {
    expect(row.currency).toBe(expected.currency);
  }
}

async function expectOrderCount(db: DatabaseQueryClient, count: string) {
  const result = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_orders",
  );

  expect(result.rows[0]?.count).toBe(count);
}

async function expectNoAccessGrant(db: DatabaseQueryClient) {
  const passes = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_passes",
  );
  const grants = await db.query<{ count: string }>(
    "select count(*)::text as count from trip_pass_grants",
  );

  expect(passes.rows[0]?.count).toBe("0");
  expect(grants.rows[0]?.count).toBe("0");
}
