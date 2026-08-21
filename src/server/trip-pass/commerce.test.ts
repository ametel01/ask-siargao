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
import {
  type AccountClosurePolicy,
  beginAccountClosure,
  runClosureCleanupBatch,
} from "@/server/privacy/account-closure";
import {
  cancelHistoricalStripeTripPassCheckout as cancelTripPassCheckout,
  startTripPassCheckout as startActiveTripPassCheckout,
  startHistoricalStripeTripPassCheckout as startTripPassCheckout,
} from "@/server/trip-pass/commerce";
import type {
  TripPassCheckoutClient,
  TripPassCheckoutSessionSummary,
} from "@/server/trip-pass/stripe-adapter";
import {
  buildTripPassCheckoutSessionParams,
  TripPassCheckoutSessionCreationError,
} from "@/server/trip-pass/stripe-adapter";

const now = new Date("2026-07-03T08:00:00.000Z");
const enabledEnv = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
} as const;
const closurePolicy: AccountClosurePolicy = {
  alertAfterAttempts: 3,
  closurePolicyVersion: "commerce-test-closure-v1",
  closureRetentionMs: 30 * 86_400_000,
  commercePolicyVersion: "commerce-test-retention-v1",
  commerceRetentionMs: 365 * 86_400_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 31).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "commerce-test-tombstone-key",
  tombstoneHashVersion: 1,
};

describe("historical Stripe Trip Pass checkout commerce", () => {
  test("never routes missing Lemon Squeezy configuration to legacy Stripe checkout", async () => {
    const checkoutClient = createFakeCheckoutClient();

    await expect(
      startActiveTripPassCheckout(
        {
          userId: "user_production_legacy_fallback",
          email: "legacy-fallback@example.com",
          appUrl: "https://asksiargao.com",
        },
        {
          checkoutClient,
          env: {
            ...enabledEnv,
            LEGACY_STRIPE_TRIP_PASS_COMPAT: "true",
            NODE_ENV: "test",
          },
          now,
        },
      ),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "lemon_squeezy_configuration_unavailable",
    });
    expect(checkoutClient.calls).toHaveLength(0);
  });

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
          const orderRows = await db.query<{
            checkout_session_expires_at: Date | string | null;
            count: string;
            created_at: Date | string;
          }>(
            `
              select count(*)::text as count, created_at, checkout_session_expires_at
              from trip_pass_orders
              where id = $1 and status = 'pending'
              group by created_at, checkout_session_expires_at
            `,
            [String(params.client_reference_id)],
          );
          const order = orderRows.rows[0];
          if (!order?.checkout_session_expires_at) {
            throw new Error("Pending order did not persist a checkout expiry before Stripe.");
          }
          const reservationEpochSeconds = Math.floor(
            dateFromDatabaseValue(order.created_at).getTime() / 1_000,
          );
          const expectedExpiresAt = reservationEpochSeconds + 30 * 60;
          expect(params.expires_at).toBe(expectedExpiresAt);
          expect(dateFromDatabaseValue(order.checkout_session_expires_at).getTime()).toBe(
            expectedExpiresAt * 1_000,
          );
          events.push(`pending:${order.count}`);
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

  test("hands a Session returned after Account Closure to durable expiry without exposing it", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_checkout_closed_during_provider_call");
      const checkoutClient = createFakeCheckoutClient({
        beforeCreate: async () => {
          await beginAccountClosure(
            { now, userId: "user_checkout_closed_during_provider_call" },
            { db, policy: closurePolicy },
          );
          await runClosureCleanupBatch({
            db,
            now,
            policy: closurePolicy,
            providers: {
              deleteClerkUser: async () => undefined,
              expireCheckoutSession: async () => undefined,
            },
          });
        },
      });

      const result = await startTripPassCheckout(
        {
          userId: "user_checkout_closed_during_provider_call",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_checkout_closed_during_provider_call",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toEqual({
        status: "blocked",
        reason: "account_closed_during_checkout",
      });
      const order = await db.query<{
        closure_outcome: string | null;
        stripe_checkout_session_id: string | null;
        user_id: string | null;
      }>(
        `select user_id, stripe_checkout_session_id, closure_outcome
         from trip_pass_orders where id = $1`,
        ["order_checkout_closed_during_provider_call"],
      );
      expect(order.rows[0]).toEqual({
        user_id: null,
        stripe_checkout_session_id: "cs_order_checkout_closed_during_provider_call",
        closure_outcome: "blocked_at_closure",
      });
      const handoff = await db.query<{
        commerce_step_status: string;
        operation_status: string;
        status: string;
        step_status: string;
      }>(
        `select s.status, expiry.status as step_status,
           commerce.status as commerce_step_status, operation.status as operation_status
         from account_closure_checkout_sessions s
         join account_closure_steps expiry on expiry.operation_id = s.operation_id
           and expiry.step_type = 'checkout_expiry'
         join account_closure_steps commerce on commerce.operation_id = s.operation_id
           and commerce.step_type = 'commerce_minimization'
         join account_closure_operations operation on operation.id = s.operation_id
         where s.stripe_checkout_session_id = $1`,
        ["cs_order_checkout_closed_during_provider_call"],
      );
      expect(handoff.rows[0]).toEqual({
        status: "pending",
        step_status: "pending",
        commerce_step_status: "pending",
        operation_status: "pending",
      });
      await runClosureCleanupBatch({
        db,
        now: new Date(now.getTime() + 1_000),
        policy: closurePolicy,
        providers: {
          deleteClerkUser: async () => undefined,
          expireCheckoutSession: async () => undefined,
        },
      });
      const converged = await db.query<{
        commerce_step_status: string;
        operation_status: string;
        provider_subjects: string;
        status: string;
        step_status: string;
      }>(
        `select s.status, expiry.status as step_status,
           commerce.status as commerce_step_status, operation.status as operation_status,
           (select count(*)::text from account_closure_provider_subjects subject
             where subject.operation_id = s.operation_id) as provider_subjects
         from account_closure_checkout_sessions s
         join account_closure_steps expiry on expiry.operation_id = s.operation_id
           and expiry.step_type = 'checkout_expiry'
         join account_closure_steps commerce on commerce.operation_id = s.operation_id
           and commerce.step_type = 'commerce_minimization'
         join account_closure_operations operation on operation.id = s.operation_id
         where s.stripe_checkout_session_id = $1`,
        ["cs_order_checkout_closed_during_provider_call"],
      );
      expect(converged.rows[0]).toEqual({
        status: "succeeded",
        step_status: "succeeded",
        commerce_step_status: "succeeded",
        operation_status: "succeeded",
        provider_subjects: "1",
      });
    });
  });

  test("builds Checkout expiry from reservation DB time instead of a skewed app clock", () => {
    const originalDateNow = Date.now;
    const reservationTime = new Date("2026-07-03T08:00:00.000Z");
    const checkoutSessionExpiresAt = new Date(reservationTime.getTime() + 30 * 60 * 1_000);
    const skewedAppNow = new Date("2036-01-01T00:00:00.000Z").getTime();

    Date.now = () => skewedAppNow;
    try {
      const params = buildTripPassCheckoutSessionParams({
        appUrl: "https://siargao.test",
        order: {
          id: "order_db_time",
          userId: "user_db_time",
          productFamily: "siargao_trip_pass",
          customerEmail: null,
          checkoutIdempotencyKey: "trip_pass_checkout:order_db_time",
          checkoutSessionExpiresAt,
          stripePriceId: "price_trip_pass",
        },
      });

      expect(params.expires_at).toBe(Math.floor(reservationTime.getTime() / 1_000) + 30 * 60);
      expect(params.expires_at).not.toBe(Math.floor((Date.now() + 30 * 60 * 1_000) / 1_000));
    } finally {
      Date.now = originalDateNow;
    }
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

  test("keeps ambiguous Stripe creation failures as a retryable pending order", async () => {
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
              failWith: new TripPassCheckoutSessionCreationError({
                kind: "ambiguous",
                message: "stripe fixture timeout",
              }),
            }),
            createId: () => "order_stripe_failure",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("stripe fixture timeout");

      await expectOrder(db, "order_stripe_failure", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });

      const retry = await startTripPassCheckout(
        {
          userId: "user_stripe_failure",
          email: "failure@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_should_not_replace_ambiguous_failure",
          env: enabledEnv,
          now,
        },
      );

      expect(retry).toMatchObject({ status: "reused", orderId: "order_stripe_failure" });
      await expectOrderCount(db, "1");
      await expectNoAccessGrant(db);
    });
  });

  test("releases pending checkout reservations after definitive Stripe creation rejection", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_stripe_definitive_failure");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_stripe_definitive_failure",
            email: "definitive@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({
              failWith: new TripPassCheckoutSessionCreationError({
                kind: "definitive",
                message: "stripe fixture invalid price",
              }),
            }),
            createId: () => "order_stripe_definitive_failure",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("stripe fixture invalid price");

      await expectOrder(db, "order_stripe_definitive_failure", {
        status: "failed",
        stripeCheckoutSessionId: null,
      });

      const retry = await startTripPassCheckout(
        {
          userId: "user_stripe_definitive_failure",
          email: "definitive@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient: createFakeCheckoutClient(),
          createId: () => "order_after_definitive_failure",
          env: enabledEnv,
          now,
        },
      );

      expect(retry).toMatchObject({ status: "started", orderId: "order_after_definitive_failure" });
      await expectOrderCount(db, "2");
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

  test("rejects Stripe sessions that do not match Checkout mode or payment state", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_bad_mode_session");

      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_mode_session",
            email: "bad-mode-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({ mode: "subscription" }),
            createId: () => "order_bad_mode_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("mode does not match");

      await expectOrder(db, "order_bad_mode_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });

      await insertUser(db, "user_bad_payment_session");
      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_payment_session",
            email: "bad-payment-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient: createFakeCheckoutClient({ paymentStatus: "paid" }),
            createId: () => "order_bad_payment_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("payment status does not match");

      await expectOrder(db, "order_bad_payment_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
      });
      await expectNoAccessGrant(db);
    });
  });

  test("rejects provider expiry mismatches without overwriting the reservation expiry", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_bad_expiry_session");
      const checkoutClient = createFakeCheckoutClient({
        expiresAtOverride: (params) => new Date((Number(params.expires_at) + 60) * 1_000),
      });

      await expect(
        startTripPassCheckout(
          {
            userId: "user_bad_expiry_session",
            email: "bad-expiry-session@example.com",
            appUrl: "https://siargao.test",
          },
          {
            db,
            checkoutClient,
            createId: () => "order_bad_expiry_session",
            env: enabledEnv,
            now,
          },
        ),
      ).rejects.toThrow("expiry does not match");

      await expectOrder(db, "order_bad_expiry_session", {
        status: "pending",
        stripeCheckoutSessionId: null,
        checkoutSessionExpiresAt: new Date(
          Number(checkoutClient.calls[0]?.params.expires_at) * 1_000,
        ),
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

  test("blocks checkout for an active pass when the primary meter is missing", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_missing_primary_meter");
      await createActiveTripPassWithMeters(
        {
          id: "pass_missing_primary_meter",
          userId: "user_missing_primary_meter",
          startsAt: new Date("2026-08-07T07:00:00.000Z"),
          expiresAt: new Date("2026-08-21T07:00:00.000Z"),
          now,
        },
        db,
      );
      await db.query(
        `
          delete from trip_usage_meters
          where trip_pass_id = $1
            and meter_type = 'chat_message'
        `,
        ["pass_missing_primary_meter"],
      );
      const checkoutClient = createFakeCheckoutClient();

      const result = await startTripPassCheckout(
        {
          userId: "user_missing_primary_meter",
          email: "missing-primary-meter@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_should_not_start_missing_primary_meter",
          env: enabledEnv,
          now,
        },
      );

      expect(result).toEqual({ status: "blocked", reason: "trip_pass_family_active" });
      expect(checkoutClient.calls).toHaveLength(0);
      await expectOrderCount(db, "0");
    });
  });

  test("blocks checkout for an unexpired dispute-suspended pass even when exhausted", async () => {
    await withTestDb(async (db) => {
      await insertUser(db, "user_suspended_pass");
      await createActiveTripPassWithMeters(
        {
          id: "pass_suspended",
          userId: "user_suspended_pass",
          startsAt: new Date("2026-08-07T07:00:00.000Z"),
          expiresAt: new Date("2026-08-21T07:00:00.000Z"),
          now,
        },
        db,
      );
      await db.query("update trip_passes set status = 'suspended' where id = 'pass_suspended'");
      await db.query(
        `update trip_usage_meters set used = "limit" where trip_pass_id = 'pass_suspended'`,
      );
      const checkoutClient = createFakeCheckoutClient();

      const result = await startTripPassCheckout(
        {
          userId: "user_suspended_pass",
          email: "suspended-pass@example.com",
          appUrl: "https://siargao.test",
        },
        {
          db,
          checkoutClient,
          createId: () => "order_should_not_start_suspended",
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
    expiresAtOverride?: (params: Stripe.Checkout.SessionCreateParams) => Date | null;
    failWith?: Error;
    metadataOverrides?: Record<string, string>;
    mode?: TripPassCheckoutSessionSummary["mode"];
    paymentStatus?: TripPassCheckoutSessionSummary["paymentStatus"];
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
        expiresAt: options.expiresAtOverride
          ? options.expiresAtOverride(params)
          : params.expires_at
            ? new Date(Number(params.expires_at) * 1000)
            : null,
        mode: options.mode ?? "payment",
        paymentStatus: options.paymentStatus ?? "unpaid",
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
        mode: "payment",
        paymentStatus: "unpaid",
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
    dialect: "pglite",
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
    checkoutSessionExpiresAt: Date | null;
    checkoutSessionStatus: string | null;
    currency: string | null;
  }>,
) {
  const result = await db.query<{
    status: string;
    email: string | null;
    stripe_checkout_session_id: string | null;
    amount_total_minor: number | null;
    checkout_session_expires_at: Date | string | null;
    checkout_session_status: string | null;
    currency: string | null;
  }>(
    `
      select status, email, stripe_checkout_session_id, amount_total_minor,
             checkout_session_expires_at, checkout_session_status, currency
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
  if (expected.checkoutSessionExpiresAt !== undefined) {
    if (expected.checkoutSessionExpiresAt === null) {
      expect(row.checkout_session_expires_at).toBeNull();
    } else {
      const actualCheckoutSessionExpiresAt = row.checkout_session_expires_at;
      expect(actualCheckoutSessionExpiresAt).not.toBeNull();
      if (!actualCheckoutSessionExpiresAt) {
        return;
      }
      expect(dateFromDatabaseValue(actualCheckoutSessionExpiresAt).getTime()).toBe(
        expected.checkoutSessionExpiresAt.getTime(),
      );
    }
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

function dateFromDatabaseValue(value: Date | string) {
  return value instanceof Date ? value : new Date(String(value));
}
