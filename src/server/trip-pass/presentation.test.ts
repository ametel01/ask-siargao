import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import { buildTripPassAccountPresentation } from "@/server/trip-pass/presentation";

const now = new Date("2026-07-04T08:00:00.000Z");
const availableEnv = {
  LEMON_SQUEEZY_API_KEY: "lemon_test_key",
  LEMON_SQUEEZY_PRODUCT_ID: "product_trip_pass",
  LEMON_SQUEEZY_STORE_ID: "store_trip_pass",
  LEMON_SQUEEZY_VARIANT_ID: "variant_trip_pass",
  TRIP_PASS_CHECKOUT_MODE: "on",
};

describe("Trip Pass account presentation", () => {
  test("presents a free signed-in account without exposing internal identifiers", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_free");

      const presentation = await buildTripPassAccountPresentation(
        { userId: "user_free", now },
        { db, env: { TRIP_PASS_CHECKOUT_MODE: "off" } },
      );

      expect(presentation.status).toBe("free");
      expect(presentation.checkout).toEqual({
        status: "disabled",
        reason: "checkout_disabled",
      });
      expect(presentation.actions.startCheckout).toBe(false);
      expect(allowance(presentation, "chat_message")).toMatchObject({
        used: 0,
        limit: 10,
        remaining: 10,
        warning: true,
      });
      expect(JSON.stringify(presentation)).not.toContain("user_free");
      expect(JSON.stringify(presentation)).not.toContain("stripe");
    });
  });

  test("presents pending checkout before exposing paid access", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_pending");
      await insertPendingOrder(db, "order_pending", "user_pending");
      await insertPendingOrder(db, "order_other", "user_other");

      const presentation = await buildTripPassAccountPresentation(
        { userId: "user_pending", now },
        { db, env: availableEnv },
      );

      expect(presentation.status).toBe("pending");
      expect(presentation.actions.startCheckout).toBe(false);
      expect(presentation.validity).toEqual({ startsAt: null, expiresAt: null });
      expect(JSON.stringify(presentation)).not.toContain("order_pending");
      expect(JSON.stringify(presentation)).not.toContain("order_other");
    });
  });

  test("presents active paid access with answer and expiry warnings", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_active");
      await createActiveTripPassWithMeters(
        {
          id: "pass_active",
          userId: "user_active",
          startsAt: now,
          expiresAt: new Date(now.getTime() + 47 * 60 * 60_000),
          now,
        },
        db,
      );
      await db.query(
        `
          update trip_usage_meters
          set used = case
            when meter_type = 'chat_message' then "limit" - 20
            else used
          end
          where trip_pass_id = 'pass_active'
        `,
      );

      const presentation = await buildTripPassAccountPresentation(
        { userId: "user_active", now },
        { db, env: availableEnv },
      );

      expect(presentation.status).toBe("active");
      expect(presentation.attention).toEqual({
        lowChatMessages: true,
        expiresSoon: true,
      });
      expect(allowance(presentation, "chat_message")?.remaining).toBe(20);
      expect(presentation.allowances).toHaveLength(1);
      expect(JSON.stringify(presentation)).not.toContain("pass_active");
      expect(JSON.stringify(presentation)).not.toContain("user_active");
    });
  });

  test("presents expired and unavailable states without raw configuration reasons", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_expired");
      await insertUser(db, "user_unavailable");
      await createActiveTripPassWithMeters(
        {
          id: "pass_expired",
          userId: "user_expired",
          startsAt: new Date(now.getTime() - 15 * 24 * 60 * 60_000),
          expiresAt: new Date(now.getTime() - 24 * 60 * 60_000),
          now: new Date(now.getTime() - 15 * 24 * 60 * 60_000),
        },
        db,
      );

      const expired = await buildTripPassAccountPresentation(
        { userId: "user_expired", now },
        { db, env: availableEnv },
      );
      const unavailable = await buildTripPassAccountPresentation(
        { userId: "user_unavailable", now },
        { db, env: { TRIP_PASS_CHECKOUT_MODE: "on" } },
      );

      expect(expired.status).toBe("expired");
      expect(expired.attention.expiresSoon).toBe(false);
      expect(unavailable.status).toBe("unavailable");
      expect(unavailable.checkout).toEqual({
        status: "unavailable",
        reason: "checkout_unavailable",
      });
      expect(JSON.stringify(unavailable)).not.toContain("lemon_squeezy_configuration_unavailable");
    });
  });

  test("keeps checkout unavailable when only historical Stripe pricing remains", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_historical_stripe_only");

      const presentation = await buildTripPassAccountPresentation(
        { userId: "user_historical_stripe_only", now },
        {
          db,
          env: {
            TRIP_PASS_CHECKOUT_MODE: "on",
            STRIPE_TRIP_PASS_PRICE_ID: "price_historical_trip_pass",
          },
        },
      );

      expect(presentation.status).toBe("unavailable");
      expect(presentation.checkout).toEqual({
        status: "unavailable",
        reason: "checkout_unavailable",
      });
      expect(presentation.actions.startCheckout).toBe(false);
    });
  });

  test("keeps checkout presentation disabled when checkout mode is malformed", async () => {
    await withPresentationDb(async (db) => {
      await insertUser(db, "user_malformed_checkout");

      const presentation = await buildTripPassAccountPresentation(
        { userId: "user_malformed_checkout", now },
        { db, env: { TRIP_PASS_CHECKOUT_MODE: "malformed" } },
      );

      expect(presentation.status).toBe("free");
      expect(presentation.checkout).toEqual({
        status: "disabled",
        reason: "checkout_disabled",
      });
      expect(presentation.actions.startCheckout).toBe(false);
    });
  });
});

async function withPresentationDb(work: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  try {
    await runInitialMigration(db);
    await work(db);
  } finally {
    await db.close();
  }
}

async function insertUser(db: PGlite, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2) on conflict do nothing", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function insertPendingOrder(db: PGlite, orderId: string, userId: string) {
  await insertUser(db, userId);
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
      values ($1, $2, $3, 'checkout_created', 'siargao_trip_pass_14d_v1', 1, 'price_trip_pass', $4, '{}'::jsonb, $5, $5)
    `,
    [orderId, userId, `${userId}@example.com`, `trip_pass_checkout:${orderId}`, now],
  );
}

function allowance(
  presentation: Awaited<ReturnType<typeof buildTripPassAccountPresentation>>,
  meterType: string,
) {
  return presentation.allowances.find((item) => item.meterType === meterType);
}
