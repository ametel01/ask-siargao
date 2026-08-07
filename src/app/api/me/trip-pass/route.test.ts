import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import {
  getTripPassAccountResponse,
  postTripPassCheckoutResponse,
  type TripPassAccountRouteDependencies,
} from "@/app/api/me/trip-pass/trip-pass-route";
import type { CurrentUserAuthSnapshot } from "@/server/auth/clerk-users";
import { runInitialMigration } from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";

const now = new Date("2026-07-04T08:00:00.000Z");
const availableEnv = {
  TRIP_PASS_CHECKOUT_ENABLED: "true",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
};

describe("Trip Pass account API routes", () => {
  test("requires authentication for status and checkout", async () => {
    await withRouteDb(async (db) => {
      const dependencies = routeDependencies(db, { userId: null });

      const getResponse = await getTripPassAccountResponse(dependencies);
      const postResponse = await postTripPassCheckoutResponse(checkoutRequest(), dependencies);

      expect(getResponse.status).toBe(401);
      expect(postResponse.status).toBe(401);
      expect(await getResponse.json()).toEqual({ error: "unauthenticated" });
      expect(await postResponse.json()).toEqual({ error: "unauthenticated" });
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
});

type TestRouteDependencies = TripPassAccountRouteDependencies & {
  checkoutCalls: Array<{ userId: string; email: string | null | undefined; appUrl: string }>;
  events: Array<{ name: string; payload: Record<string, unknown> }>;
};

function routeDependencies(
  db: PGlite,
  input: {
    checkoutError?: Error;
    checkoutResult?: Awaited<ReturnType<TripPassAccountRouteDependencies["startTripPassCheckout"]>>;
    userId: string | null;
  },
): TestRouteDependencies {
  const checkoutCalls: TestRouteDependencies["checkoutCalls"] = [];
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
    checkoutCalls,
    db,
    env: availableEnv,
    events,
    now: () => now,
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

async function insertUser(db: PGlite, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2) on conflict do nothing", [
    userId,
    `${userId}@example.com`,
  ]);
}
