import type Stripe from "stripe";

import type { RealPostgresHarness } from "@/server/integration/postgres-harness";
import {
  receiveStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/server/payments/stripe-event-inbox";
import {
  type AccountClosurePolicy,
  beginAccountClosure,
  runClosureCleanupBatch,
} from "@/server/privacy/account-closure";
import { startTripPassCheckout } from "@/server/trip-pass/commerce";
import type { TripPassCheckoutClient } from "@/server/trip-pass/stripe-adapter";
import { tripPassCheckoutProductSnapshot } from "@/server/trip-pass/stripe-adapter";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

const raceNow = new Date("2026-08-07T06:00:00.000Z");
const racePolicy: AccountClosurePolicy = {
  alertAfterAttempts: 3,
  closurePolicyVersion: "integration-closure-v1",
  closureRetentionMs: 30 * 86_400_000,
  commercePolicyVersion: "integration-commerce-v1",
  commerceRetentionMs: 365 * 86_400_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 19).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "integration-closure-hmac-key",
  tombstoneHashVersion: 1,
};

export async function runAccountClosurePostgresIntegration(harness: RealPostgresHarness) {
  await runClosureWinsRace(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "closure-first" }));
  await runEarlierWriteWinsRace(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "write-first" }));
  await runRollbackAndDuplicateRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "rollback-duplicate" }));
  await runPostClosureMutationMatrix(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "write-matrix" }));
  await runConcurrentWorkerRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "worker-leases" }));
  await runStaleWorkerLeaseRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "worker-lease-fence" }));
  await runCheckoutProviderOverlapRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "checkout-provider" }));
  await runPrecommitStripeEventRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "precommit-stripe" }));
  await runStripeInboxClosureRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "stripe-inbox" }));
  await runRetainedCommerceEvidenceRegression(harness);
  console.log(JSON.stringify({ checked: "account-closure-postgres", race: "retained-commerce" }));
}

async function runCheckoutProviderOverlapRegression(harness: RealPostgresHarness) {
  const checkoutClient = harness.createQueryClient();
  const closureClient = harness.createQueryClient();
  const providerStarted = deferred<void>();
  const releaseProvider = deferred<void>();
  let expiredSessionId: string | undefined;
  const checkoutProvider: TripPassCheckoutClient = {
    async createCheckoutSession(params) {
      providerStarted.resolve();
      await releaseProvider.promise;
      const orderId = String(params.client_reference_id);
      return {
        id: `cs_${orderId}`,
        url: `https://checkout.stripe.test/${orderId}`,
        clientReferenceId: orderId,
        metadata: Object.fromEntries(
          Object.entries(params.metadata ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        amountTotalMinor: tripPassCheckoutProductSnapshot.amountTotalMinor,
        currency: tripPassCheckoutProductSnapshot.currency,
        expiresAt: new Date(Number(params.expires_at) * 1_000),
        mode: "payment",
        paymentStatus: "unpaid",
        priceId: "price_trip_pass",
        status: "open",
        termsConsentCollected: false,
      };
    },
    async expireCheckoutSession(sessionId) {
      expiredSessionId = sessionId;
      return {
        id: sessionId,
        url: "",
        clientReferenceId: null,
        metadata: null,
        amountTotalMinor: tripPassCheckoutProductSnapshot.amountTotalMinor,
        currency: tripPassCheckoutProductSnapshot.currency,
        expiresAt: raceNow,
        mode: "payment",
        paymentStatus: "unpaid",
        priceId: "price_trip_pass",
        status: "expired",
        termsConsentCollected: false,
      };
    },
  };
  try {
    const userId = "closure_checkout_provider_overlap";
    await seedUser(checkoutClient, userId);
    const checkout = startTripPassCheckout(
      { appUrl: "https://siargao.test", userId },
      {
        checkoutClient: checkoutProvider,
        createId: () => "closure_checkout_provider_order",
        db: checkoutClient,
        env: {
          TRIP_PASS_CHECKOUT_MODE: "on",
          STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
        },
        now: raceNow,
      },
    );
    await providerStarted.promise;
    const closure = await beginAccountClosure(
      { now: raceNow, userId },
      { db: closureClient, policy: racePolicy },
    );
    await runClosureCleanupBatch({
      db: closureClient,
      now: raceNow,
      policy: racePolicy,
      providers: successfulProviders,
    });
    releaseProvider.resolve();
    const checkoutResult = await checkout;
    assertEqual(
      checkoutResult.status,
      "blocked",
      "a Session returned after closure must not be exposed",
    );
    const attached = await closureClient.query<{
      closure_outcome: string | null;
      stripe_checkout_session_id: string | null;
      user_id: string | null;
    }>(
      `select user_id, stripe_checkout_session_id, closure_outcome
       from trip_pass_orders where id = 'closure_checkout_provider_order'`,
    );
    assertEqual(attached.rows[0]?.user_id, null, "late Session order must detach identity");
    assertEqual(
      attached.rows[0]?.stripe_checkout_session_id,
      "cs_closure_checkout_provider_order",
      "late Session must be durable",
    );
    assertEqual(
      attached.rows[0]?.closure_outcome,
      "blocked_at_closure",
      "late Session must preserve the closure decision",
    );
    await runClosureCleanupBatch({
      db: closureClient,
      now: raceNow,
      policy: racePolicy,
      providers: {
        async deleteClerkUser() {},
        async expireCheckoutSession(sessionId) {
          await checkoutProvider.expireCheckoutSession(sessionId);
        },
      },
    });
    assertEqual(
      expiredSessionId,
      "cs_closure_checkout_provider_order",
      "late Session must reach durable expiry cleanup",
    );
    const converged = await closureClient.query<{
      operation_status: string;
      provider_subjects: string;
      session_status: string;
    }>(
      `select o.status as operation_status,
         (select status from account_closure_checkout_sessions
           where operation_id = o.id
             and stripe_checkout_session_id = 'cs_closure_checkout_provider_order') as session_status,
         (select count(*)::text from account_closure_provider_subjects s
           where s.operation_id = o.id) as provider_subjects
       from account_closure_operations o where o.id = $1`,
      [closure.operationRef],
    );
    assertEqual(
      converged.rows[0]?.operation_status,
      "succeeded",
      "late Session cleanup must reconverge the operation",
    );
    assertEqual(
      converged.rows[0]?.session_status,
      "succeeded",
      "late Session expiry must converge",
    );
    assertEqual(
      converged.rows[0]?.provider_subjects,
      "1",
      "reopenable closure must retain its encrypted provider subject",
    );
  } finally {
    releaseProvider.resolve();
    await Promise.all([checkoutClient.end(), closureClient.end()]);
  }
}

async function runPrecommitStripeEventRegression(harness: RealPostgresHarness) {
  const closureClient = harness.createQueryClient();
  const inboxClient = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const precommitReached = deferred<void>();
  const releaseClosure = deferred<void>();
  const userId = "closure_precommit_stripe";
  const orderId = "closure_precommit_stripe_order";
  try {
    await seedUser(closureClient, userId);
    await closureClient.query(
      `insert into trip_pass_orders (
         id, user_id, status, product_code, product_family, product_version,
         stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
         stripe_checkout_session_id, checkout_session_status, metadata_json, created_at, updated_at
       ) values ($1, $2, 'checkout_created', $3, $4, $5, 'price_trip_pass',
         $6, $7, $8, $9, 'open', '{}'::jsonb, $10, $10)`,
      [
        orderId,
        userId,
        tripPassCheckoutProductSnapshot.productCode,
        tripPassCheckoutProductSnapshot.productFamily,
        tripPassCheckoutProductSnapshot.productVersion,
        tripPassCheckoutProductSnapshot.amountTotalMinor,
        tripPassCheckoutProductSnapshot.currency,
        `trip_pass_checkout:${orderId}`,
        `cs_${orderId}`,
        new Date(raceNow.getTime() - 120_000),
      ],
    );
    const closure = beginAccountClosure(
      { now: raceNow, userId },
      {
        beforeCommit: async () => {
          precommitReached.resolve();
          await releaseClosure.promise;
        },
        db: closureClient,
        policy: racePolicy,
      },
    );
    await precommitReached.promise;
    const providerClock = await observer.query<{ now: Date }>("select clock_timestamp() as now");
    const eventCreatedAt = providerClock.rows[0]?.now;
    if (!eventCreatedAt) throw new Error("provider event clock was unavailable");
    const eventSecond = Math.floor(eventCreatedAt.getTime() / 1_000);
    const inboxPid = await backendPid(inboxClient);
    const inbox = receiveStripeWebhookEvent(
      closureCheckoutSessionEvent("evt_closure_precommit_stripe", orderId, eventCreatedAt),
      {
        db: inboxClient,
        applyEvent: (event, options) =>
          applyTripPassStripeEvent(event, { db: options.db, now: options.now }),
      },
    );
    await observeBlockedBackend(observer, inboxPid);
    await waitUntil(async () => {
      const clock = await observer.query<{ now: Date }>("select clock_timestamp() as now");
      return Math.floor((clock.rows[0]?.now.getTime() ?? 0) / 1_000) > eventSecond;
    }, "database clock did not advance beyond the held provider event second");
    releaseClosure.resolve();
    await closure;
    const inboxResult = await inbox;
    assertEqual(
      inboxResult.status,
      "applied",
      `held precommit Stripe event must apply: ${JSON.stringify(inboxResult)}`,
    );
    const state = await observer.query<{ outcome: string; refunds: string }>(
      `select closure_outcome as outcome,
         (select count(*)::text from account_closure_refund_obligations
           where order_id = $1) as refunds
       from trip_pass_orders where id = $1`,
      [orderId],
    );
    assertEqual(
      state.rows[0]?.outcome,
      "blocked_at_closure",
      "provider event created during the precommit hold must be Before Closure",
    );
    assertEqual(state.rows[0]?.refunds, "0", "Before Closure event must not create a refund");
  } finally {
    releaseClosure.resolve();
    await Promise.all([closureClient.end(), inboxClient.end(), observer.end()]);
  }
}

async function runStripeInboxClosureRegression(harness: RealPostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await runStripeInboxClosureCase(client, {
      eventOffsetSeconds: 60,
      eventId: "evt_closure_inbox_after",
      expectedOutcome: "paid_after_closure",
      expectedRefunds: "1",
      orderId: "closure_inbox_order_after",
      userId: "closure_inbox_after",
    });
    await runStripeInboxClosureCase(client, {
      eventOffsetSeconds: 60,
      eventId: "evt_closure_inbox_delayed_after_expiry_failure",
      expectedOutcome: "paid_after_closure",
      expectedRefunds: "1",
      expiryFailureBeforeEvent: true,
      orderId: "closure_inbox_order_delayed_after_expiry_failure",
      userId: "closure_inbox_delayed_after_expiry_failure",
    });
    await runStripeInboxClosureCase(client, {
      eventOffsetSeconds: -60,
      eventId: "evt_closure_inbox_before",
      expectedOutcome: "blocked_at_closure",
      expectedRefunds: "0",
      orderId: "closure_inbox_order_before",
      userId: "closure_inbox_before",
    });
    await runStripeInboxClosureCase(client, {
      eventOffsetSeconds: 0,
      eventId: "evt_closure_inbox_same_second",
      expectedOutcome: "paid_after_closure",
      expectedRefunds: "1",
      orderId: "closure_inbox_order_same_second",
      userId: "closure_inbox_same_second",
    });
  } finally {
    await client.end();
  }
}

async function runStripeInboxClosureCase(
  client: ReturnType<RealPostgresHarness["createQueryClient"]>,
  input: {
    eventOffsetSeconds: number;
    eventId: string;
    expectedOutcome: string;
    expectedRefunds: string;
    expiryFailureBeforeEvent?: boolean;
    orderId: string;
    userId: string;
  },
) {
  await seedUser(client, input.userId);
  await client.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
       stripe_checkout_session_id, checkout_session_status, metadata_json, created_at, updated_at
     ) values ($1, $2, 'checkout_created', $3, $4, $5, 'price_trip_pass',
       $6, $7, $8, $9, 'open', '{}'::jsonb, $10, $10)`,
    [
      input.orderId,
      input.userId,
      tripPassCheckoutProductSnapshot.productCode,
      tripPassCheckoutProductSnapshot.productFamily,
      tripPassCheckoutProductSnapshot.productVersion,
      tripPassCheckoutProductSnapshot.amountTotalMinor,
      tripPassCheckoutProductSnapshot.currency,
      `trip_pass_checkout:${input.orderId}`,
      `cs_${input.orderId}`,
      new Date(raceNow.getTime() - 120_000),
    ],
  );
  await beginAccountClosure(
    { now: raceNow, userId: input.userId },
    { db: client, policy: racePolicy },
  );
  const closure = await client.query<{ closed_at: Date }>(
    `select t.closed_at
     from trip_pass_orders o
     join account_closure_tombstones t on t.id = o.closure_tombstone_id
     where o.id = $1`,
    [input.orderId],
  );
  const closedAt = closure.rows[0]?.closed_at;
  if (!closedAt) throw new Error("closure timestamp was unavailable for Stripe classification");
  const closedSecond = Math.floor(closedAt.getTime() / 1_000) * 1_000;
  const eventCreatedAt = new Date(closedSecond + input.eventOffsetSeconds * 1_000);
  if (input.expiryFailureBeforeEvent) {
    await runClosureCleanupBatch({
      db: client,
      now: raceNow,
      policy: racePolicy,
      providers: {
        async deleteClerkUser() {},
        async expireCheckoutSession() {
          throw new Error("controlled expiry failure before delayed payment");
        },
      },
    });
  }
  const result = await receiveStripeWebhookEvent(
    closureCheckoutSessionEvent(input.eventId, input.orderId, eventCreatedAt),
    {
      db: client,
      applyEvent: (event, options) =>
        applyTripPassStripeEvent(event, { db: options.db, now: options.now }),
    },
  );
  assertEqual(
    result.status,
    "applied",
    `closure Stripe inbox event must apply atomically: ${JSON.stringify(result)}`,
  );
  const state = await client.query<{
    grants: string;
    inbox_status: string;
    meters: string;
    outcome: string | null;
    passes: string;
    refunds: string;
  }>(
    `select
       (select status from trip_pass_stripe_events where stripe_event_id = $1) as inbox_status,
       (select closure_outcome from trip_pass_orders where id = $2) as outcome,
       (select count(*)::text from account_closure_refund_obligations where order_id = $2) as refunds,
       (select count(*)::text from trip_passes where stripe_event_id = $1) as passes,
       (select count(*)::text from trip_pass_grants where source_event_id = $1) as grants,
       (select count(*)::text from trip_usage_meters m join trip_passes p on p.id = m.trip_pass_id
          where p.stripe_event_id = $1) as meters`,
    [input.eventId, input.orderId],
  );
  assertEqual(state.rows[0]?.inbox_status, "applied", "inbox receipt must commit applied");
  assertEqual(state.rows[0]?.outcome, input.expectedOutcome, "closure outcome must use event time");
  assertEqual(state.rows[0]?.refunds, input.expectedRefunds, "refund handoff count must converge");
  assertEqual(state.rows[0]?.passes, "0", "closure inbox event must not create a Pass");
  assertEqual(state.rows[0]?.grants, "0", "closure inbox event must not create a Grant");
  assertEqual(state.rows[0]?.meters, "0", "closure inbox event must not create a Meter");
}

function closureCheckoutSessionEvent(eventId: string, orderId: string, createdAt: Date) {
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(createdAt.getTime() / 1_000),
    data: {
      object: {
        id: `cs_${orderId}`,
        object: "checkout.session",
        mode: "payment",
        client_reference_id: orderId,
        metadata: {
          tripPassOrderId: orderId,
          productCode: tripPassCheckoutProductSnapshot.productCode,
          productVersion: String(tripPassCheckoutProductSnapshot.productVersion),
        },
        payment_intent: `pi_${orderId}`,
        payment_status: "paid",
        amount_total: tripPassCheckoutProductSnapshot.amountTotalMinor,
        currency: tripPassCheckoutProductSnapshot.currency,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

async function runPostClosureMutationMatrix(harness: RealPostgresHarness) {
  const client = harness.createQueryClient();
  const userId = "closure_mutation_matrix";
  try {
    await seedUser(client, userId);
    await seedUser(client, "closure_mutation_open_owner");
    await client.query("insert into user_profiles (user_id, display_name) values ($1, 'before')", [
      userId,
    ]);
    await client.query(
      "insert into chat_threads (id, user_id, title) values ('matrix_thread', $1, 'before')",
      [userId],
    );
    await client.query(
      `insert into chat_messages (id, thread_id, user_id, role, content)
       values ('matrix_message', 'matrix_thread', $1, 'assistant', 'before')`,
      [userId],
    );
    await client.query(
      `insert into saved_trips (id, user_id, client_trip_key_hash, title)
       values ('matrix_trip', $1, 'matrix_trip_hash', 'before')`,
      [userId],
    );
    await client.query(
      `insert into audit_requests (id, user_id, email, status)
       values ('matrix_audit', $1, $2, 'created')`,
      [userId, `${userId}@example.com`],
    );
    await client.query(
      `insert into trip_passes (id, user_id, email, status, starts_at, expires_at)
       values ('matrix_pass', $1, $2, 'active', $3, $4)`,
      [userId, `${userId}@example.com`, raceNow, new Date(raceNow.getTime() + 86_400_000)],
    );
    await client.query(
      `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
       values ('matrix_meter', 'matrix_pass', 'chat_message', 0, 10)`,
    );
    await client.query(
      `insert into trip_passes (id, user_id, email, status, starts_at, expires_at)
       values ('matrix_open_pass', 'closure_mutation_open_owner', 'open@example.com',
         'active', $1, $2)`,
      [raceNow, new Date(raceNow.getTime() + 86_400_000)],
    );
    await client.query(
      `insert into trip_usage_events
       (id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
        idempotency_key, request_id, occurred_at, created_at)
       values ('matrix_usage', 'matrix_pass', 'matrix_meter', $1, 'reserved',
         'chat_message', 1, 'matrix_usage_key', 'matrix_request', $2, $2)`,
      [userId, raceNow],
    );
    await beginAccountClosure({ now: raceNow, userId }, { db: client, policy: racePolicy });

    const mutations: Array<() => Promise<unknown>> = [
      () =>
        client.query("insert into user_profiles (user_id, display_name) values ($1, 'late')", [
          userId,
        ]),
      () =>
        client.query(
          `insert into chat_messages (id, thread_id, user_id, role, content)
           values ('matrix_late_message', 'matrix_thread', $1, 'user', 'late')`,
          [userId],
        ),
      () =>
        client.query(
          `insert into chat_response_ratings
           (id, message_id, thread_id, user_id, rating)
           values ('matrix_rating', 'matrix_message', 'matrix_thread', $1, 'helpful')`,
          [userId],
        ),
      () =>
        client.query(
          `insert into saved_trip_items (id, trip_id, kind, title, payload_json)
           values ('matrix_item', 'matrix_trip', 'note', 'late', '{}'::jsonb)`,
        ),
      () =>
        client.query(
          `insert into shared_trip_plans (id, trip_id, public_token_hash, title)
           values ('matrix_share', 'matrix_trip', 'matrix_share_hash', 'late')`,
        ),
      () =>
        client.query(
          `insert into audit_inputs (id, audit_request_id, top_constraint)
           values ('matrix_input', 'matrix_audit', 'late')`,
        ),
      () =>
        client.query(
          `insert into trip_pass_orders
           (id, user_id, status, product_code, product_version, stripe_price_id,
            checkout_idempotency_key)
           values ('matrix_order', $1, 'pending', 'siargao_trip_pass', 1,
             'price_matrix', 'matrix_checkout_key')`,
          [userId],
        ),
      () => client.query("update trip_passes set status = 'active' where id = 'matrix_pass'"),
      () =>
        client.query(
          "update user_profiles set user_id = 'closure_mutation_open_owner' where user_id = $1",
          [userId],
        ),
      () => client.query("update trip_passes set user_id = null where id = 'matrix_pass'"),
      () =>
        client.query(
          "update trip_usage_meters set trip_pass_id = 'matrix_open_pass' where id = 'matrix_meter'",
        ),
      () =>
        client.query(
          `update trip_usage_events set event_type = 'settled'
           where id = 'matrix_usage'`,
        ),
      () =>
        client.query(
          `insert into trip_usage_events
           (id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
            idempotency_key, request_id)
           values ('matrix_late_usage', 'matrix_pass', 'matrix_meter', $1, 'reserved',
             'chat_message', 1, 'matrix_late_usage_key', 'matrix_late_request')`,
          [userId],
        ),
    ];
    await Promise.all(
      mutations.map((mutation) => expectRejects(mutation(), "account is terminally closed")),
    );
  } finally {
    await client.end();
  }
}

async function runClosureWinsRace(harness: RealPostgresHarness) {
  const closureClient = harness.createQueryClient();
  const writer = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const closureReachedCommit = deferred<void>();
  const releaseClosure = deferred<void>();
  let dispatches = 0;
  try {
    await seedUser(closureClient, "closure_race_first");
    const closure = beginAccountClosure(
      { now: raceNow, userId: "closure_race_first" },
      {
        afterCommit: () => {
          dispatches += 1;
        },
        beforeCommit: async () => {
          closureReachedCommit.resolve();
          await releaseClosure.promise;
        },
        db: closureClient,
        policy: racePolicy,
      },
    );
    await closureReachedCommit.promise;
    const writerPid = await backendPid(writer);
    const lateWriteRejection = expectRejects(
      writer.query("insert into user_profiles (user_id, display_name) values ($1, 'late writer')", [
        "closure_race_first",
      ]),
      "account is terminally closed",
    );
    await observeBlockedBackend(observer, writerPid);
    releaseClosure.resolve();
    await Promise.all([closure, lateWriteRejection]);
    assertEqual(dispatches, 1, "external dispatch must start only after closure commits");
  } finally {
    releaseClosure.resolve();
    await Promise.all([closureClient.end(), writer.end(), observer.end()]);
  }
}

async function runEarlierWriteWinsRace(harness: RealPostgresHarness) {
  const holder = harness.createQueryClient();
  const closureClient = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const writeCommitted = deferred<void>();
  const releaseWrite = deferred<void>();
  try {
    await seedUser(holder, "closure_race_write_first");
    const write = holder.transaction(async (transaction) => {
      await transaction.query(
        "select pg_advisory_xact_lock(hashtext('ask-siargao-account-write'), hashtext($1))",
        ["closure_race_write_first"],
      );
      await transaction.query(
        "insert into user_profiles (user_id, display_name) values ($1, 'committed first')",
        ["closure_race_write_first"],
      );
      writeCommitted.resolve();
      await releaseWrite.promise;
    });
    await writeCommitted.promise;
    const closure = beginAccountClosure(
      { now: raceNow, userId: "closure_race_write_first" },
      { db: closureClient, policy: racePolicy },
    );
    await observeAnyBlockedClosure(observer);
    releaseWrite.resolve();
    await Promise.all([write, closure]);
    const profile = await observer.query<{ count: string }>(
      "select count(*)::text as count from user_profiles where user_id = $1",
      ["closure_race_write_first"],
    );
    assertEqual(profile.rows[0]?.count, "1", "the earlier writer must commit before phase one");
    await runClosureCleanupBatch({
      db: closureClient,
      now: raceNow,
      policy: racePolicy,
      providers: successfulProviders,
    });
    const erased = await observer.query<{ count: string }>(
      "select count(*)::text as count from user_profiles where user_id = $1",
      ["closure_race_write_first"],
    );
    assertEqual(erased.rows[0]?.count, "0", "the committed pre-closure write must be erased");
  } finally {
    releaseWrite.resolve();
    await Promise.all([holder.end(), closureClient.end(), observer.end()]);
  }
}

async function runRollbackAndDuplicateRegression(harness: RealPostgresHarness) {
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  try {
    await seedUser(first, "closure_race_rollback");
    let dispatches = 0;
    await expectRejects(
      beginAccountClosure(
        { now: raceNow, userId: "closure_race_rollback" },
        {
          afterCommit: () => {
            dispatches += 1;
          },
          beforeCommit: () => {
            throw new Error("controlled rollback");
          },
          db: first,
          policy: racePolicy,
        },
      ),
      "controlled rollback",
    );
    assertEqual(dispatches, 0, "rollback must start zero external work");

    const results = await Promise.all([
      beginAccountClosure(
        { now: raceNow, userId: "closure_race_rollback" },
        { db: first, policy: racePolicy },
      ),
      beginAccountClosure(
        { now: raceNow, userId: "closure_race_rollback" },
        { db: second, policy: racePolicy },
      ),
    ]);
    assertEqual(
      results.filter((result) => result.status === "closed").length,
      1,
      "one duplicate phase-one transaction must create the closure",
    );
    assertEqual(
      results.filter((result) => result.status === "already_closed").length,
      1,
      "the serialized duplicate must converge on the existing closure",
    );
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
}

async function runRetainedCommerceEvidenceRegression(harness: RealPostgresHarness) {
  const client = harness.createQueryClient();
  const userId = "closure_retained_commerce";
  try {
    await seedUser(client, userId);
    await client.query(
      `insert into trip_pass_orders (
         id, user_id, email, status, product_code, product_family, product_version,
         stripe_price_id, amount_total_minor, currency, checkout_idempotency_key,
         stripe_checkout_session_id, checkout_session_expires_at, checkout_session_status,
         checkout_cancellation_confirmed_at, stripe_payment_intent_id, stripe_customer_id,
         terms_policy_version, refund_policy_version, privacy_policy_version,
         retention_policy_version, terms_consent_presented_at, metadata_json,
         created_at, updated_at, completed_at
       ) values (
         'order_retained_real', $1, 'traveler-real@example.com', 'paid',
         'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2, 'price_retained_real', 999,
         'usd', 'idempotency_prohibited_real', 'cs_retained_real', $2, 'complete', $3,
         'pi_retained_real', 'cus_prohibited_real', 'terms-v1', 'refund-v1', 'privacy-v1',
         'retention-v1', $4, '{"notes":"traveler content prohibited real"}'::jsonb,
         $4, $3, $2
       )`,
      [
        userId,
        new Date("2026-08-07T02:00:00.000Z"),
        new Date("2026-08-07T03:00:00.000Z"),
        new Date("2026-08-07T01:00:00.000Z"),
      ],
    );
    await client.query(
      `insert into trip_passes (
         id, user_id, email, status, stripe_checkout_session_id, stripe_payment_intent_id,
         stripe_event_id, starts_at, expires_at, created_at, updated_at
       ) values (
         'pass_retained_real', $1, 'traveler-real@example.com', 'active',
         'cs_retained_real', 'pi_retained_real', 'evt_retained_real', $2, $3, $2, $2
       )`,
      [userId, new Date("2026-08-07T01:00:00.000Z"), new Date("2026-08-21T01:00:00.000Z")],
    );
    await client.query(
      `insert into trip_pass_grants (
         id, order_id, trip_pass_id, user_id, source_type, source_event_id,
         product_code, product_version, quantity, duration_days, meter_limits_json,
         starts_at, expires_at, created_at
       ) values (
         'grant_retained_real', 'order_retained_real', 'pass_retained_real', $1,
         'stripe_checkout', 'evt_retained_real', 'siargao_trip_pass_14d_v2', 2, 1, 14,
         '{"chat_message":150}'::jsonb, $2, $3, $2
       )`,
      [userId, new Date("2026-08-07T01:00:00.000Z"), new Date("2026-08-21T01:00:00.000Z")],
    );
    await client.query(
      `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
       values ('meter_retained_real', 'pass_retained_real', 'chat_message', 37, 150)`,
    );
    await client.query(
      `insert into trip_usage_events (
         id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
         idempotency_key, request_id, request_hash, provider_request_ids_json,
         occurred_at, created_at
       ) values (
         'usage_retained_real', 'pass_retained_real', 'meter_retained_real', $1,
         'settled', 'chat_message', 1, 'usage_idempotency_prohibited_real',
         'request_prohibited_real', 'request_hash_prohibited_real',
         '["provider_request_prohibited_real"]'::jsonb, $2, $2
       )`,
      [userId, raceNow],
    );

    const closure = await beginAccountClosure(
      { now: raceNow, userId },
      { db: client, policy: racePolicy },
    );
    const databaseClock = await client.query<{ closed_at: Date }>(
      "select closed_at from account_closure_tombstones where id = $1",
      [closure.tombstoneRef],
    );
    const closedAt = databaseClock.rows[0]?.closed_at;
    if (!closedAt) throw new Error("retained-commerce closure timestamp was unavailable");
    if (closedAt.getTime() === raceNow.getTime()) {
      throw new Error("phase one used the application clock instead of PostgreSQL");
    }
    await runClosureCleanupBatch({
      db: client,
      now: raceNow,
      policy: racePolicy,
      providers: successfulProviders,
    });

    const retained = await client.query<{
      aggregate_service_facts: Record<string, unknown>;
      amount_minor: number | null;
      consent_policy_versions: Record<string, unknown>;
      currency: string | null;
      lifecycle_status: string;
      lifecycle_timestamps: Record<string, unknown>;
      product_code: string | null;
      product_family: string | null;
      product_version: number | null;
      retention_expires_at: Date;
      source_type: string;
      stripe_checkout_session_id: string | null;
      stripe_event_id: string | null;
      stripe_payment_intent_id: string | null;
    }>(
      `select source_type, amount_minor, currency, product_code, product_version,
         product_family, lifecycle_status, lifecycle_timestamps, stripe_checkout_session_id,
         stripe_payment_intent_id, stripe_event_id, consent_policy_versions,
         aggregate_service_facts, retention_expires_at
       from retained_commerce_evidence
       where source_ref in ('order_retained_real', 'pass_retained_real')
       order by source_type`,
    );
    assertEqual(retained.rows.length, 2, "both commerce records must be retained");
    const order = retained.rows.find((row) => row.source_type === "trip_pass_order");
    const pass = retained.rows.find((row) => row.source_type === "trip_pass");
    assertJsonEqual(
      order,
      {
        aggregate_service_facts: {},
        amount_minor: 999,
        consent_policy_versions: {
          privacyPolicyVersion: "privacy-v1",
          refundPolicyVersion: "refund-v1",
          retentionPolicyVersion: "retention-v1",
          termsConsentPresentedAt: "2026-08-07T01:00:00+00:00",
          termsPolicyVersion: "terms-v1",
        },
        currency: "usd",
        lifecycle_status: "paid",
        lifecycle_timestamps: {
          checkoutCancellationConfirmedAt: "2026-08-07T03:00:00+00:00",
          checkoutSessionExpiresAt: "2026-08-07T02:00:00+00:00",
          completedAt: "2026-08-07T02:00:00+00:00",
          createdAt: "2026-08-07T01:00:00+00:00",
          disputeState: "none",
          refundState: "none",
          successfulRefundAmountMinor: 0,
          updatedAt: order?.lifecycle_timestamps.updatedAt,
        },
        product_code: "siargao_trip_pass_14d_v2",
        product_family: "siargao_trip_pass",
        product_version: 2,
        retention_expires_at: new Date(
          raceNow.getTime() + racePolicy.commerceRetentionMs,
        ).toISOString(),
        source_type: "trip_pass_order",
        stripe_checkout_session_id: "cs_retained_real",
        stripe_event_id: null,
        stripe_payment_intent_id: "pi_retained_real",
      },
      "order retention must contain the exact allowlist",
    );
    assertJsonEqual(
      pass,
      {
        aggregate_service_facts: {
          durationDays: 14,
          meterTotals: { chat_message: { limit: 150, used: 37 } },
          quantity: 1,
        },
        amount_minor: 999,
        consent_policy_versions: order?.consent_policy_versions,
        currency: "usd",
        lifecycle_status: "cancelled",
        lifecycle_timestamps: {
          createdAt: "2026-08-07T01:00:00+00:00",
          expiresAt: "2026-08-21T01:00:00+00:00",
          startsAt: "2026-08-07T01:00:00+00:00",
          updatedAt: pass?.lifecycle_timestamps.updatedAt,
        },
        product_code: "siargao_trip_pass_14d_v2",
        product_family: "siargao_trip_pass",
        product_version: 2,
        retention_expires_at: new Date(
          raceNow.getTime() + racePolicy.commerceRetentionMs,
        ).toISOString(),
        source_type: "trip_pass",
        stripe_checkout_session_id: "cs_retained_real",
        stripe_event_id: "evt_retained_real",
        stripe_payment_intent_id: "pi_retained_real",
      },
      "pass retention must contain the exact allowlist and aggregate service facts",
    );
    assertEqual(
      new Date(String(order?.lifecycle_timestamps.updatedAt)).getTime(),
      closedAt.getTime(),
      "order evidence must use the database closure boundary",
    );
    assertEqual(
      new Date(String(pass?.lifecycle_timestamps.updatedAt)).getTime(),
      closedAt.getTime(),
      "pass evidence must use the database closure boundary",
    );

    const retainedText = JSON.stringify(retained.rows);
    for (const prohibited of [
      userId,
      "traveler-real@example.com",
      "cus_prohibited_real",
      "traveler content prohibited real",
      "idempotency_prohibited_real",
      "request_prohibited_real",
      "request_hash_prohibited_real",
      "provider_request_prohibited_real",
    ]) {
      if (retainedText.includes(prohibited)) {
        throw new Error(`retained evidence leaked prohibited value: ${prohibited}`);
      }
    }
    const sourceRows = await client.query<{
      grants: string;
      meters: string;
      order_minimized: boolean;
      orders: string;
      passes: string;
      usage_events: string;
    }>(
      `select
         (select count(*)::text from trip_pass_orders where id = 'order_retained_real') as orders,
         (select user_id is null and email is null and stripe_customer_id is null
            and metadata_json = '{}'::jsonb
            and checkout_idempotency_key = 'closed:order_retained_real'
          from trip_pass_orders where id = 'order_retained_real') as order_minimized,
         (select count(*)::text from trip_passes where id = 'pass_retained_real') as passes,
         (select count(*)::text from trip_pass_grants where id = 'grant_retained_real') as grants,
         (select count(*)::text from trip_usage_meters where id = 'meter_retained_real') as meters,
         (select count(*)::text from trip_usage_events
            where id = 'usage_retained_real') as usage_events`,
    );
    assertJsonEqual(
      sourceRows.rows[0],
      {
        grants: "0",
        meters: "0",
        order_minimized: true,
        orders: "1",
        passes: "0",
        usage_events: "0",
      },
      "retained evidence must replace the traveler-bearing commerce source graph",
    );
  } finally {
    await client.end();
  }
}

async function runConcurrentWorkerRegression(harness: RealPostgresHarness) {
  const setup = harness.createQueryClient();
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  const clerkStarted = deferred<void>();
  const releaseClerk = deferred<void>();
  let clerkCalls = 0;
  try {
    await seedUser(setup, "closure_worker_race");
    const closure = await beginAccountClosure(
      { now: raceNow, userId: "closure_worker_race" },
      { db: setup, policy: racePolicy },
    );
    const providers = {
      deleteClerkUser: async (userId: string) => {
        if (userId !== "closure_worker_race") return;
        clerkCalls += 1;
        clerkStarted.resolve();
        await releaseClerk.promise;
      },
      expireCheckoutSession: async () => undefined,
    };
    const firstWorker = runClosureCleanupBatch({
      db: first,
      now: raceNow,
      policy: racePolicy,
      providers,
    });
    await clerkStarted.promise;
    const secondWorker = runClosureCleanupBatch({
      db: second,
      now: raceNow,
      policy: racePolicy,
      providers,
    });
    await secondWorker;
    releaseClerk.resolve();
    await firstWorker;
    await runClosureCleanupBatch({
      db: setup,
      now: new Date(raceNow.getTime() + 2_000),
      policy: racePolicy,
      providers: successfulProviders,
    });
    assertEqual(clerkCalls, 1, "SKIP LOCKED leasing must prevent duplicate provider calls");
    const state = await setup.query<{ status: string }>(
      "select status from account_closure_operations where id = $1",
      [closure.operationRef],
    );
    assertEqual(state.rows[0]?.status, "succeeded", "concurrent workers must converge");
  } finally {
    releaseClerk.resolve();
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

async function runStaleWorkerLeaseRegression(harness: RealPostgresHarness) {
  const setup = harness.createQueryClient();
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  const secondStarted = deferred<void>();
  const releaseSecond = deferred<void>();
  try {
    const userId = "closure_worker_lease_fence";
    await seedUser(setup, userId);
    const closure = await beginAccountClosure(
      { now: raceNow, userId },
      { db: setup, policy: racePolicy },
    );
    const firstWorker = runClosureCleanupBatch({
      db: first,
      leaseMs: 1_000,
      limit: 1,
      now: raceNow,
      policy: racePolicy,
      providers: {
        async deleteClerkUser() {
          firstStarted.resolve();
          await releaseFirst.promise;
        },
        async expireCheckoutSession() {},
      },
    });
    await firstStarted.promise;
    await runClosureCleanupBatch({
      db: setup,
      now: raceNow,
      policy: racePolicy,
      providers: successfulProviders,
    });
    const identity = await setup.query<{ status: string }>(
      `select status from account_closure_steps
       where operation_id = $1 and step_type = 'identity_erasure'`,
      [closure.operationRef],
    );
    assertEqual(
      identity.rows[0]?.status,
      "succeeded",
      "identity cleanup must finish while the first Clerk lease is held",
    );
    await waitUntil(async () => {
      const lease = await setup.query<{ expired: boolean }>(
        `select lease_expires_at <= clock_timestamp() as expired
         from account_closure_steps
         where operation_id = $1 and step_type = 'clerk_deletion'`,
        [closure.operationRef],
      );
      return lease.rows[0]?.expired === true;
    }, "first Clerk worker lease did not expire");
    const secondWorker = runClosureCleanupBatch({
      db: second,
      leaseMs: 1_000,
      limit: 1,
      now: raceNow,
      policy: racePolicy,
      providers: {
        async deleteClerkUser() {
          secondStarted.resolve();
          await releaseSecond.promise;
        },
        async expireCheckoutSession() {},
      },
    });
    await secondStarted.promise;
    const current = await setup.query<{ lease_token: string }>(
      `select lease_token from account_closure_steps
       where operation_id = $1 and step_type = 'clerk_deletion'`,
      [closure.operationRef],
    );
    releaseFirst.resolve();
    await firstWorker;
    const fenced = await setup.query<{
      last_error_category: string | null;
      lease_token: string | null;
      status: string;
    }>(
      `select status, lease_token, last_error_category from account_closure_steps
       where operation_id = $1 and step_type = 'clerk_deletion'`,
      [closure.operationRef],
    );
    assertEqual(fenced.rows[0]?.status, "running", "stale retry must not replace current lease");
    assertEqual(
      fenced.rows[0]?.lease_token,
      current.rows[0]?.lease_token,
      "stale retry must preserve the current worker token",
    );
    assertEqual(fenced.rows[0]?.last_error_category, null, "stale retry must not record an error");
    const subject = await setup.query<{ count: string }>(
      `select count(*)::text as count from account_closure_provider_subjects
       where operation_id = $1`,
      [closure.operationRef],
    );
    assertEqual(
      subject.rows[0]?.count,
      "1",
      "expired successful Clerk worker must not delete the reopenable provider subject",
    );
    releaseSecond.resolve();
    await secondWorker;
    const completed = await setup.query<{
      attempts: number;
      last_error_category: string | null;
      lease_token: string | null;
      status: string;
    }>(
      `select status, attempts, lease_token, last_error_category from account_closure_steps
       where operation_id = $1 and step_type = 'clerk_deletion'`,
      [closure.operationRef],
    );
    assertEqual(completed.rows[0]?.status, "succeeded", "current lease must complete");
    assertEqual(completed.rows[0]?.attempts, 2, "expired lease must be reclaimed exactly once");
    assertEqual(completed.rows[0]?.lease_token, null, "completed step must release its lease");
    assertEqual(completed.rows[0]?.last_error_category, null, "current success must remain clean");
  } finally {
    releaseFirst.resolve();
    releaseSecond.resolve();
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

const successfulProviders = {
  deleteClerkUser: async () => undefined,
  expireCheckoutSession: async () => undefined,
};

async function seedUser(client: ReturnType<RealPostgresHarness["createQueryClient"]>, id: string) {
  await client.query("insert into users (id, email) values ($1, $2)", [id, `${id}@example.com`]);
}

async function backendPid(client: ReturnType<RealPostgresHarness["createQueryClient"]>) {
  const result = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  const pid = Number(result.rows[0]?.pid);
  if (!Number.isInteger(pid)) throw new Error("PostgreSQL backend pid was unavailable.");
  return pid;
}

async function observeBlockedBackend(
  observer: ReturnType<RealPostgresHarness["createQueryClient"]>,
  pid: number,
) {
  await waitUntil(async () => {
    const result = await observer.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    return result.rows[0]?.wait_event_type === "Lock";
  }, "competing account mutation did not block on the closure transaction");
}

async function observeAnyBlockedClosure(
  observer: ReturnType<RealPostgresHarness["createQueryClient"]>,
) {
  await waitUntil(async () => {
    const result = await observer.query<{ blocked: boolean }>(
      `select exists(
         select 1 from pg_stat_activity
         where wait_event_type = 'Lock'
           and query like 'select pg_advisory_xact_lock%ask-siargao-account-write%'
       ) as blocked`,
    );
    return result.rows[0]?.blocked === true;
  }, "closure did not block behind the earlier account mutation");
}

async function waitUntil(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error(message);
}

async function expectRejects(promise: Promise<unknown>, message: string) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected rejection containing: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return value;
  };
  const normalizedActual = JSON.stringify(normalize(actual));
  const normalizedExpected = JSON.stringify(normalize(expected));
  if (normalizedActual !== normalizedExpected) {
    throw new Error(`${message}. Expected ${normalizedExpected}, received ${normalizedActual}.`);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
