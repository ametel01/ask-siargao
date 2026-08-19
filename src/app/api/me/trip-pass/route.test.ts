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

  test("converges one provider lookup after the checkout return grace period", async () => {
    await withRouteDb(async (db) => {
      await insertUser(db, "user_return");
      await db.query(
        `insert into trip_pass_orders (
          id, user_id, email, status, product_code, product_family, product_version,
          amount_total_minor, currency, checkout_idempotency_key, payment_provider,
          provider_store_id, provider_variant_id, provider_order_id, created_at, updated_at
        ) values ('order_return', 'user_return', 'user_return@example.com', 'checkout_created',
          $1, 'siargao_trip_pass', $2, 999, 'usd', 'return:key', 'lemon_squeezy',
          'store_test', 'variant_test', 'provider_return', $3, $3)`,
        [tripPassProductCode, tripPassProductVersion, now],
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
      let lookups = 0;
      dependencies.lemonCheckoutClient = {
        createCheckout: async () => {
          throw new Error("not used");
        },
        retrieveOrder: async () => {
          lookups += 1;
          return {
            provider: "lemon_squeezy",
            eventName: "order_created",
            objectId: "provider_return",
            providerUpdatedAt: now.toISOString(),
            orderId: "order_return",
            providerOrderId: "provider_return",
            checkoutId: null,
            paymentId: "payment_return",
            storeId: "store_test",
            productId: "product_test",
            variantId: "variant_test",
            status: "paid",
            amountTotalMinor: 999,
            refundedAmountMinor: 0,
            currency: "usd",
            testMode: false,
          };
        },
        refundOrder: async () => {
          throw new Error("not used");
        },
      };
      const response = await postTripPassCheckoutReturnResponse(
        checkoutReturnRequest("order_return"),
        dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "applied" });
      expect(lookups).toBe(1);
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

function checkoutReturnRequest(orderId: string) {
  return new Request("https://siargao.test/api/me/trip-pass/checkout/return", {
    method: "POST",
    headers: {
      origin: "https://siargao.test",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ orderId }),
  });
}

async function insertUser(db: PGlite, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2) on conflict do nothing", [
    userId,
    `${userId}@example.com`,
  ]);
}
