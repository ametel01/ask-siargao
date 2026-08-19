import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  deleteTripPassCheckoutResponse,
  getTripPassAccountResponse,
  postTripPassCheckoutResponse,
  postTripPassCheckoutReturnResponse,
  type TripPassAccountRouteDependencies,
} from "@/app/api/me/trip-pass/trip-pass-route";
import type { CurrentUserAuthSnapshot } from "@/server/auth/clerk-users";
import { runInitialMigration } from "@/server/db/test-database";
import { receiveLemonSqueezyPaymentEvent } from "@/server/payments/payment-event-receipts";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";

const now = new Date("2026-07-04T08:00:00.000Z");
const availableEnv = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
};

describe("Trip Pass account API routes", () => {
  test("requires authentication for status and checkout", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, { userId: null });

      const getResponse = await getTripPassAccountResponse(dependencies);
      const postResponse = await postTripPassCheckoutResponse(checkoutRequest(), dependencies);
      const deleteResponse = await deleteTripPassCheckoutResponse(checkoutRequest(), dependencies);

      expect(getResponse.status).toBe(401);
      expect(postResponse.status).toBe(401);
      expect(deleteResponse.status).toBe(401);
      expect(await getResponse.json()).toEqual({ error: "unauthenticated" });
      expect(await postResponse.json()).toEqual({ error: "unauthenticated" });
      expect(await deleteResponse.json()).toEqual({ error: "unauthenticated" });
      expect(getResponse.headers.get("cache-control")).toBe("private, no-store");
    });
  });

  test("returns owner-scoped status without internal identifiers", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_owner");
      await insertUser(db, "user_intruder");
      await createActiveTripPassWithMeters(
        {
          id: "pass_owner",
          userId: "user_owner",
          stripeCheckoutSessionId: "cs_secret_owner",
          stripePaymentIntentId: "pi_secret_owner",
          stripeEventId: "evt_secret_owner",
          startsAt: now,
          expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
          now,
        },
        db,
      );

      const ownerResponse = await getTripPassAccountResponse(
        routeDependencies(db, { userId: "user_owner" }),
      );
      const intruderResponse = await getTripPassAccountResponse(
        routeDependencies(db, { userId: "user_intruder" }),
      );
      const ownerBody = await ownerResponse.json();
      const intruderBody = await intruderResponse.json();

      expect(ownerResponse.status).toBe(200);
      expect(ownerBody.status).toBe("active");
      expect(intruderBody.status).toBe("free");
      expect(JSON.stringify(ownerBody)).not.toContain("user_owner");
      expect(JSON.stringify(ownerBody)).not.toContain("pass_owner");
      expect(JSON.stringify(ownerBody)).not.toContain("cs_secret_owner");
      expect(JSON.stringify(ownerBody)).not.toContain("pi_secret_owner");
      expect(JSON.stringify(ownerBody)).not.toContain("evt_secret_owner");
    });
  });

  test("rejects cross-origin checkout attempts before starting Stripe checkout", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, { userId: "user_origin" });
      const response = await postTripPassCheckoutResponse(
        checkoutRequest({ origin: "https://evil.example", secFetchSite: "cross-site" }),
        dependencies,
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "invalid_request_origin" });
      expect(dependencies.checkoutCalls).toHaveLength(0);
    });
  });

  test("starts checkout with the authenticated owner and redacts local order ids", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, { userId: "user_checkout" });
      const response = await postTripPassCheckoutResponse(checkoutRequest(), dependencies, {
        "x-ratelimit-limit": "4",
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-ratelimit-limit")).toBe("4");
      expect(body).toEqual({
        status: "started",
        checkoutUrl: "https://checkout.stripe.test/trip-pass",
      });
      expect(JSON.stringify(body)).not.toContain("order_route_secret");
      expect(dependencies.checkoutCalls).toEqual([
        {
          userId: "user_checkout",
          email: undefined,
          appUrl: "https://siargao.test",
        },
      ]);
      expect(dependencies.events).toEqual([
        {
          name: "trip_pass_checkout_started",
          payload: {
            checkoutAvailable: true,
            productCode: tripPassProductCode,
            productVersion: tripPassProductVersion,
            reason: undefined,
            status: "started",
            surface: "settings",
          },
        },
      ]);
      expect(JSON.stringify(dependencies.events)).not.toContain("order_route_secret");
    });
  });

  test("maps checkout disabled, unavailable, and thrown failures without raw provider errors", async () => {
    await withRouteDb(async (db) => {
      const disabled = routeDependencies(db, {
        userId: "user_disabled",
        checkoutResult: { status: "disabled", reason: "trip_pass_checkout_disabled" },
      });
      const unavailable = routeDependencies(db, {
        userId: "user_unavailable",
        checkoutResult: { status: "unavailable", reason: "missing_stripe_trip_pass_price_id" },
      });
      const throwing = routeDependencies(db, {
        userId: "user_throwing",
        checkoutError: new Error("stripe secret pi_should_not_render"),
      });

      const disabledBody = await (
        await postTripPassCheckoutResponse(checkoutRequest(), disabled)
      ).json();
      const unavailableBody = await (
        await postTripPassCheckoutResponse(checkoutRequest(), unavailable)
      ).json();
      const throwingResponse = await postTripPassCheckoutResponse(checkoutRequest(), throwing);
      const throwingBody = await throwingResponse.json();

      expect(disabledBody).toEqual({
        error: "trip_pass_checkout_unavailable",
        status: "disabled",
        reason: "checkout_disabled",
      });
      expect(unavailableBody).toEqual({
        error: "trip_pass_checkout_unavailable",
        status: "unavailable",
        reason: "checkout_unavailable",
      });
      expect(throwingResponse.status).toBe(409);
      expect(throwingBody).toEqual({
        error: "trip_pass_checkout_unavailable",
        message: "Trip Pass checkout could not be started.",
      });
      expect(JSON.stringify(unavailableBody)).not.toContain("missing_stripe_trip_pass_price_id");
      expect(JSON.stringify(throwingBody)).not.toContain("pi_should_not_render");
      expect(disabled.events.map((event) => event.name)).toEqual([
        "trip_pass_checkout_started",
        "trip_pass_checkout_failed",
      ]);
      expect(unavailable.events.map((event) => event.name)).toEqual([
        "trip_pass_checkout_started",
        "trip_pass_checkout_failed",
      ]);
      expect(throwing.events).toEqual([
        {
          name: "trip_pass_checkout_failed",
          payload: {
            applicationStatus: "thrown",
            reason: "checkout_exception",
            status: "failed",
          },
        },
      ]);
      expect(JSON.stringify(unavailable.events)).not.toContain("missing_stripe_trip_pass_price_id");
      expect(JSON.stringify(throwing.events)).not.toContain("pi_should_not_render");
    });
  });

  test("cancels the authenticated owner's effective pending checkout without exposing order ids", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, {
        userId: "user_cancel",
        cancelResult: { status: "cancelled", orderId: "order_cancel_secret" },
      });
      const response = await deleteTripPassCheckoutResponse(checkoutRequest(), dependencies);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "cancelled" });
      expect(dependencies.cancelCalls).toEqual([{ userId: "user_cancel" }]);
      expect(JSON.stringify(body)).not.toContain("order_cancel_secret");
      expect(dependencies.events).toEqual([
        {
          name: "trip_pass_checkout_cancelled",
          payload: {
            status: "cancelled",
            surface: "settings",
          },
        },
      ]);
      expect(JSON.stringify(dependencies.events)).not.toContain("order_cancel_secret");
    });
  });

  test("rejects cross-origin cancellation before reaching commerce", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, { userId: "user_cancel_origin" });
      const response = await deleteTripPassCheckoutResponse(
        checkoutRequest({ origin: "https://evil.example", secFetchSite: "cross-site" }),
        dependencies,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "invalid_request_origin" });
      expect(dependencies.cancelCalls).toHaveLength(0);
    });
  });

  test("applies one signature-verified local receipt after the checkout return grace period", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_return");
      await db.query(
        `insert into trip_pass_orders (
          id, user_id, email, status, product_code, product_family, product_version,
          amount_total_minor, currency, checkout_idempotency_key, payment_provider,
          provider_store_id, provider_product_id, provider_variant_id, provider_order_id,
          checkout_commercial_terms_verified_at, created_at, updated_at
        ) values ('order_return', 'user_return', 'user_return@example.com', 'checkout_created',
          $1, 'siargao_trip_pass', $2, 999, 'usd', 'return:key', 'lemon_squeezy',
          '7', 'product_test', 'variant_test', null, $3, $3, $3)`,
        [tripPassProductCode, tripPassProductVersion, new Date(now.getTime() - 11_000)],
      );
      const dependencies = routeDependencies(db, {
        env: {
          TRIP_PASS_CHECKOUT_MODE: "on",
          LEMON_SQUEEZY_STORE_ID: "store_test",
          LEMON_SQUEEZY_PRODUCT_ID: "product_test",
          LEMON_SQUEEZY_VARIANT_ID: "variant_test",
          LEMON_SQUEEZY_API_KEY: "test_key",
        },
        userId: "user_return",
      });
      await receiveLemonSqueezyPaymentEvent(
        {
          meta: { event_name: "order_created", custom_data: { order_id: "order_return" } },
          data: {
            type: "orders",
            id: "provider_return",
            attributes: {
              store_id: 7,
              status: "paid",
              total: 999,
              discount_total: 0,
              currency: "usd",
              first_order_item: {
                product_id: "product_test",
                variant_id: "variant_test",
                price: 999,
                test_mode: false,
              },
              updated_at: now.toISOString(),
            },
          },
        },
        { db: dependencies.db, now },
      );
      const response = await postTripPassCheckoutReturnResponse(
        checkoutReturnRequest("order_return"),
        dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "applied" });
      const state = await db.query<{ accepted_payment_fact_id: string | null }>(
        "select accepted_payment_fact_id from trip_pass_orders where id = 'order_return'",
      );
      expect(state.rows[0]?.accepted_payment_fact_id).toBeTruthy();
    });
  });

  test("never reports applied when verified receipt application fails", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_return_failed");
      const createdAt = new Date(now.getTime() - 11_000);
      await db.query(
        `insert into trip_pass_orders (
          id, user_id, status, product_code, product_family, product_version,
          amount_total_minor, currency, checkout_idempotency_key, payment_provider,
          provider_store_id, provider_variant_id, created_at, updated_at
        ) values ('order_return_failed', 'user_return_failed', 'checkout_created', $1,
          'siargao_trip_pass', $2, 999, 'usd', 'return:failed', 'lemon_squeezy',
          '7', 'variant_test', $3, $3)`,
        [tripPassProductCode, tripPassProductVersion, createdAt],
      );
      const dependencies = routeDependencies(db, { userId: "user_return_failed" });
      await receiveLemonSqueezyPaymentEvent(
        {
          meta: {
            event_name: "order_created",
            custom_data: { order_id: "order_return_failed" },
          },
          data: {
            type: "orders",
            id: "provider_return_failed",
            attributes: {
              store_id: 7,
              status: "paid",
              total: 999,
              discount_total: 0,
              currency: "usd",
              first_order_item: { variant_id: "variant_test", test_mode: false },
              updated_at: now.toISOString(),
            },
          },
        },
        { db: dependencies.db, now },
      );

      const first = await postTripPassCheckoutReturnResponse(
        checkoutReturnRequest("order_return_failed"),
        dependencies,
      );
      const second = await postTripPassCheckoutReturnResponse(
        checkoutReturnRequest("order_return_failed"),
        dependencies,
      );
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(await first.json()).toEqual({ status: "pending" });
      expect(await second.json()).toEqual({ status: "pending" });
      const state = await db.query<{
        accepted_payment_fact_id: string | null;
        checkout_return_lookup_status: string;
      }>(
        `select accepted_payment_fact_id, checkout_return_lookup_status
         from trip_pass_orders where id = 'order_return_failed'`,
      );
      expect(state.rows[0]).toEqual({
        accepted_payment_fact_id: null,
        checkout_return_lookup_status: "exhausted",
      });
    });
  });

  test("performs one bounded provider lookup when the paid webhook is lost", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_return_lookup");
      const createdAt = new Date(now.getTime() - 11_000);
      await db.query(
        `insert into trip_pass_orders (
          id, user_id, email, status, product_code, product_family, product_version,
          amount_total_minor, currency, checkout_idempotency_key, payment_provider,
          provider_store_id, provider_product_id, provider_variant_id,
          checkout_commercial_terms_verified_at, created_at, updated_at
        ) values ('order_return_lookup', 'user_return_lookup', 'lookup@example.com',
          'checkout_created', $1, 'siargao_trip_pass', $2, 999, 'usd', 'return:lookup',
          'lemon_squeezy', '7', 'product_test', 'variant_test', $3, $3, $3)`,
        [tripPassProductCode, tripPassProductVersion, createdAt],
      );
      const identifier = "104e18a2-d755-4d4b-80c4-a6c1dcbe1c10";
      const lookupCalls: string[] = [];
      const dependencies = routeDependencies(db, {
        env: {
          TRIP_PASS_CHECKOUT_MODE: "on",
          LEMON_SQUEEZY_STORE_ID: "7",
          LEMON_SQUEEZY_PRODUCT_ID: "product_test",
          LEMON_SQUEEZY_VARIANT_ID: "variant_test",
          LEMON_SQUEEZY_API_KEY: "test_key",
        },
        retrieveLemonSqueezyOrder: async (providerOrderId) => {
          lookupCalls.push(providerOrderId);
          return {
            provider: "lemon_squeezy",
            eventName: "order_lookup",
            objectId: providerOrderId,
            providerUpdatedAt: now.toISOString(),
            orderId: null,
            providerOrderId,
            paymentId: identifier,
            storeId: "7",
            productId: "product_test",
            variantId: "variant_test",
            status: "paid",
            amountTotalMinor: 999,
            refundedAmountMinor: 0,
            currency: "usd",
            testMode: false,
            discountTotalMinor: 0,
          };
        },
        userId: "user_return_lookup",
      });
      const request = () =>
        checkoutReturnRequest("order_return_lookup", {
          providerOrderId: "12345",
          providerOrderIdentifier: identifier,
        });

      const first = await postTripPassCheckoutReturnResponse(request(), dependencies);
      const second = await postTripPassCheckoutReturnResponse(request(), dependencies);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await first.json()).toEqual({ status: "applied" });
      expect(await second.json()).toEqual({ status: "applied" });
      expect(lookupCalls).toEqual(["12345"]);
      const receipts = await db.query<{ event_name: string; status: string }>(
        "select event_name, status from trip_pass_payment_event_receipts where order_id = $1",
        ["order_return_lookup"],
      );
      expect(receipts.rows).toEqual([{ event_name: "order_lookup", status: "applied" }]);
    });
  });

  test("does not bind a provider lookup with a mismatched order identifier", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_return_mismatch");
      const createdAt = new Date(now.getTime() - 11_000);
      await db.query(
        `insert into trip_pass_orders (
          id, user_id, status, product_code, product_family, product_version,
          amount_total_minor, currency, checkout_idempotency_key, payment_provider,
          created_at, updated_at
        ) values ('order_return_mismatch', 'user_return_mismatch', 'checkout_created', $1,
          'siargao_trip_pass', $2, 999, 'usd', 'return:mismatch', 'lemon_squeezy', $3, $3)`,
        [tripPassProductCode, tripPassProductVersion, createdAt],
      );
      let lookupCount = 0;
      const dependencies = routeDependencies(db, {
        retrieveLemonSqueezyOrder: async (providerOrderId) => {
          lookupCount += 1;
          return {
            provider: "lemon_squeezy",
            eventName: "order_lookup",
            objectId: providerOrderId,
            providerUpdatedAt: now.toISOString(),
            orderId: null,
            providerOrderId,
            paymentId: "104e18a2-d755-4d4b-80c4-a6c1dcbe1c10",
            storeId: "7",
            variantId: "variant_test",
            status: "paid",
            amountTotalMinor: 999,
            refundedAmountMinor: 0,
            currency: "usd",
            testMode: false,
          };
        },
        userId: "user_return_mismatch",
      });
      const response = await postTripPassCheckoutReturnResponse(
        checkoutReturnRequest("order_return_mismatch", {
          providerOrderId: "12345",
          providerOrderIdentifier: "58e39cb8-8d7e-4e9f-9eaf-e3eb974e91f2",
        }),
        dependencies,
      );

      expect(response.status).toBe(202);
      expect(lookupCount).toBe(1);
      const state = await db.query<{ checkout_return_lookup_status: string }>(
        "select checkout_return_lookup_status from trip_pass_orders where id = $1",
        ["order_return_mismatch"],
      );
      expect(state.rows[0]?.checkout_return_lookup_status).toBe("not_found");
    });
  });
});

type TestRouteDependencies = TripPassAccountRouteDependencies & {
  cancelCalls: Array<{ userId: string }>;
  checkoutCalls: Array<{ userId: string; email: string | null | undefined; appUrl: string }>;
  events: Array<{ name: string; payload: Record<string, unknown> }>;
};

function routeDependencies(
  db: PGlite,
  input: {
    cancelError?: Error;
    cancelResult?: Awaited<ReturnType<TripPassAccountRouteDependencies["cancelTripPassCheckout"]>>;
    checkoutError?: Error;
    checkoutResult?: Awaited<ReturnType<TripPassAccountRouteDependencies["startTripPassCheckout"]>>;
    env?: Record<string, string | undefined>;
    retrieveLemonSqueezyOrder?: TripPassAccountRouteDependencies["retrieveLemonSqueezyOrder"];
    userId: string | null;
  },
): TestRouteDependencies {
  const checkoutCalls: TestRouteDependencies["checkoutCalls"] = [];
  const cancelCalls: TestRouteDependencies["cancelCalls"] = [];
  const events: TestRouteDependencies["events"] = [];

  return {
    auth: async (): Promise<CurrentUserAuthSnapshot> => ({
      userId: input.userId,
      sessionClaims: input.userId
        ? {
            email: `${input.userId}@example.com`,
          }
        : null,
    }),
    cancelCalls,
    checkoutCalls,
    db,
    env: input.env ?? availableEnv,
    events,
    now: () => now,
    retrieveLemonSqueezyOrder: input.retrieveLemonSqueezyOrder,
    cancelTripPassCheckout: async (cancelInput) => {
      cancelCalls.push({ userId: cancelInput.userId });
      if (input.cancelError) {
        throw input.cancelError;
      }
      return input.cancelResult ?? { status: "not_found", reason: "no_effective_pending_order" };
    },
    startTripPassCheckout: async (checkoutInput) => {
      checkoutCalls.push({
        userId: checkoutInput.userId,
        email: checkoutInput.email,
        appUrl: checkoutInput.appUrl,
      });
      if (input.checkoutError) {
        throw input.checkoutError;
      }
      return (
        input.checkoutResult ?? {
          status: "started",
          orderId: "order_route_secret",
          checkoutUrl: "https://checkout.stripe.test/trip-pass",
        }
      );
    },
    trackServerEvent: (event) => {
      events.push({ name: event.name, payload: event.payload });
      return {
        name: event.name,
        at: now.toISOString(),
        payload: event.payload,
        sinks: {
          posthogConfigured: false,
          sentryConfigured: false,
        },
      };
    },
  };
}

async function withRouteDb(work: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  try {
    await runInitialMigration(db);
    await work(db);
  } finally {
    await db.close();
  }
}

function checkoutRequest(input: { origin?: string; secFetchSite?: string } = {}) {
  return new Request("https://siargao.test/api/me/trip-pass/checkout", {
    method: "POST",
    headers: {
      origin: input.origin ?? "https://siargao.test",
      "sec-fetch-site": input.secFetchSite ?? "same-origin",
    },
  });
}

function checkoutReturnRequest(
  orderId: string,
  provider: { providerOrderId: string; providerOrderIdentifier: string } = {
    providerOrderId: "",
    providerOrderIdentifier: "",
  },
) {
  return new Request("https://siargao.test/api/me/trip-pass/checkout/return", {
    method: "POST",
    headers: {
      origin: "https://siargao.test",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ orderId, ...provider }),
  });
}

async function insertUser(db: PGlite, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2) on conflict do nothing", [
    userId,
    `${userId}@example.com`,
  ]);
}
