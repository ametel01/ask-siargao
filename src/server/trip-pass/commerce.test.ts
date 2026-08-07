import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { startTripPassCheckout } from "@/server/trip-pass/commerce";
import type {
  TripPassCheckoutClient,
  TripPassCheckoutSessionSummary,
} from "@/server/trip-pass/stripe-adapter";

const now = new Date("2026-07-03T08:00:00.000Z");
const enabledEnv = {
  TRIP_PASS_CHECKOUT_ENABLED: "true",
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
          { db, checkoutClient, env: { TRIP_PASS_CHECKOUT_ENABLED: "true" }, now },
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
        success_url: "https://siargao.test/settings?trip_pass_checkout=return&order=order_checkout",
        cancel_url:
          "https://siargao.test/settings?trip_pass_checkout=cancelled&order=order_checkout",
        metadata: {
          tripPassOrderId: "order_checkout",
          productCode: "siargao_trip_pass_14d_v2",
          productVersion: "2",
        },
        line_items: [{ price: "price_trip_pass", quantity: 1 }],
      });
      expect(checkoutClient.calls[0]?.options.idempotencyKey).toBe(
        "trip_pass_checkout:order_checkout",
      );
      await expectOrder(db, "order_checkout", {
        status: "checkout_created",
        email: null,
        stripeCheckoutSessionId: "cs_order_checkout",
        amountTotalMinor: 999,
        currency: "usd",
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

  test("expires a stale pending order and creates a deterministic replacement", async () => {
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

      expect(result).toMatchObject({ status: "started", orderId: "order_replacement" });
      await expectOrder(db, "order_stale", { status: "expired" });
      await expectOrder(db, "order_replacement", { status: "checkout_created" });
      await expectOrderCount(db, "2");
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
});

type FakeCheckoutClient = TripPassCheckoutClient & {
  calls: Array<{
    params: Stripe.Checkout.SessionCreateParams;
    options: { idempotencyKey: string };
  }>;
};

function createFakeCheckoutClient(
  options: {
    beforeCreate?: (params: Stripe.Checkout.SessionCreateParams) => Promise<void>;
    failWith?: Error;
    priceId?: string;
  } = {},
): FakeCheckoutClient {
  const sessionsByIdempotencyKey = new Map<string, TripPassCheckoutSessionSummary>();
  const calls: FakeCheckoutClient["calls"] = [];

  return {
    calls,
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
        metadata: stringMetadata(params.metadata),
        amountTotalMinor: 999,
        currency: "usd",
        priceId:
          options.priceId ??
          String((params.line_items?.[0] as Stripe.Checkout.SessionCreateParams.LineItem)?.price),
      };
      sessionsByIdempotencyKey.set(createOptions.idempotencyKey, session);
      return session;
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
  input: { id: string; userId: string; createdAt: string },
) {
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
        checkout_idempotency_key,
        metadata_json,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 'pending', 'siargao_trip_pass_14d_v2', 2, 'price_trip_pass', $4, '{}'::jsonb, $5, $5)
    `,
    [
      input.id,
      input.userId,
      `${input.userId}@example.com`,
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
    currency: string | null;
  }>,
) {
  const result = await db.query<{
    status: string;
    email: string | null;
    stripe_checkout_session_id: string | null;
    amount_total_minor: number | null;
    currency: string | null;
  }>(
    `
      select status, email, stripe_checkout_session_id, amount_total_minor, currency
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
