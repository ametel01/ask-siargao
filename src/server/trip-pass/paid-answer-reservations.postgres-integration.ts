import type { DatabaseQueryClient } from "@/server/db/query-client";
import { type AccountClosurePolicy, beginAccountClosure } from "@/server/privacy/account-closure";
import { finalizePaidAnswer, reservePaidAnswer } from "@/server/trip-pass/paid-answer-reservations";
import {
  applyAuthoritativeDisputeFact,
  applyAuthoritativeRefundFact,
} from "@/server/trip-pass/payment-lifecycle";

type PostgresHarness = {
  createQueryClient(): DatabaseQueryClient & { end(): Promise<void> };
};

export async function runPaidAnswerReservationPostgresIntegration(harness: PostgresHarness) {
  await runFinalUnitRegression(harness);
  await runTerminalLifecycleRaces(harness);
  await runAccountClosureRace(harness);
  console.log(
    JSON.stringify({
      checked: "paid-answer-reservations-postgres",
      proofs: [
        "final-unit-capacity",
        "durable-result-replay",
        "finalize-before-full-refund",
        "finalize-before-dispute-loss",
        "finalize-before-account-closure",
        "full-refund-before-finalize",
        "dispute-loss-before-finalize",
        "account-closure-before-finalize",
      ],
    }),
  );
}

async function runFinalUnitRegression(harness: PostgresHarness) {
  const setup = harness.createQueryClient();
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  try {
    await setup.query(
      `insert into users (id, email) values ('paid_answer_pg_user', 'paid-answer-pg@example.com')`,
    );
    await setup.query(
      `insert into trip_passes (
         id, user_id, status, starts_at, expires_at, created_at, updated_at
       ) values (
         'paid_answer_pg_pass', 'paid_answer_pg_user', 'active',
         clock_timestamp() - interval '1 hour', clock_timestamp() + interval '336 hours',
         clock_timestamp(), clock_timestamp()
       )`,
    );
    await setup.query(
      `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
       values ('paid_answer_pg_meter', 'paid_answer_pg_pass', 'chat_message', 149, 150)`,
    );
    const stale = await reservePaidAnswer({
      accountId: "paid_answer_pg_user",
      bodyHash: "paid_answer_pg_body_stale",
      db: setup,
      idempotencyKeyHash: "paid_answer_pg_key_stale",
      requestId: "paid_answer_pg_request_stale",
    });
    assertEqual(stale.status, "reserved", "the stale-capacity setup must reserve the final unit");
    if (stale.status !== "reserved") {
      throw new Error("paid answer stale-capacity reservation was unavailable");
    }
    await setup.query(
      `update paid_answer_reservations
       set reserved_at = clock_timestamp() - interval '20 minutes',
         lease_expires_at = clock_timestamp() - interval '10 minutes'
       where id = $1`,
      [stale.reservationId],
    );

    const [left, right] = await Promise.all([
      reservePaidAnswer({
        accountId: "paid_answer_pg_user",
        bodyHash: "paid_answer_pg_body_left",
        db: first,
        idempotencyKeyHash: "paid_answer_pg_key_left",
        requestId: "paid_answer_pg_request_left",
      }),
      reservePaidAnswer({
        accountId: "paid_answer_pg_user",
        bodyHash: "paid_answer_pg_body_right",
        db: second,
        idempotencyKeyHash: "paid_answer_pg_key_right",
        requestId: "paid_answer_pg_request_right",
      }),
    ]);
    const reserved = [left, right].filter((result) => result.status === "reserved");
    const denied = [left, right].filter((result) => result.status === "limit_reached");
    assertEqual(reserved.length, 1, "exactly one final-unit reservation must open");
    assertEqual(denied.length, 1, "the competing final-unit reservation must fail closed");
    const recovery = await setup.query<{ open_count: string; released_count: string }>(
      `select
         count(*) filter (where status = 'open')::text as open_count,
         count(*) filter (
           where status = 'released' and release_reason = 'stale_lease'
         )::text as released_count
       from paid_answer_reservations where trip_pass_id = 'paid_answer_pg_pass'`,
    );
    assertEqual(
      recovery.rows[0]?.released_count,
      "1",
      "different-key recovery must durably release the expired reservation",
    );
    assertEqual(
      recovery.rows[0]?.open_count,
      "1",
      "concurrent recovery must leave exactly one final-unit reservation open",
    );
    const winner = reserved[0];
    if (winner?.status !== "reserved") {
      throw new Error("paid answer final-unit winner was not available");
    }
    const winningSuffix = left.status === "reserved" ? "left" : "right";

    const staleFinalization = await finalizePaidAnswer({
      accountId: "paid_answer_pg_user",
      answerMessageId: "paid_answer_pg_stale_message",
      db: setup,
      leaseToken: stale.leaseToken,
      providerRequestIds: [],
      reservationId: stale.reservationId,
      persistAnswer: async () => {
        throw new Error("an expired reservation must not reach answer persistence");
      },
    });
    assertEqual(
      staleFinalization.status,
      "released",
      "the expired worker must remain fenced after different-key recovery",
    );

    const finalized = await finalizePaidAnswer({
      accountId: "paid_answer_pg_user",
      answerMessageId: "paid_answer_pg_message",
      db: first,
      leaseToken: winner.leaseToken,
      providerRequestIds: ["provider_request_one", "provider_request_two"],
      reservationId: winner.reservationId,
      persistAnswer: async (transaction, allowance) => {
        await transaction.query(
          `insert into chat_threads (id, user_id, title)
           values ('paid_answer_pg_thread', 'paid_answer_pg_user', 'Native PG answer')`,
        );
        await transaction.query(
          `insert into chat_messages (id, thread_id, user_id, role, content, request_id)
           values (
             'paid_answer_pg_message', 'paid_answer_pg_thread', 'paid_answer_pg_user',
             'assistant', 'One durable multi-tool answer.', $1
           )`,
          [`paid_answer_pg_request_${winningSuffix}`],
        );
        return { message: "One durable multi-tool answer.", tripPassUsage: allowance };
      },
    });
    assertEqual(finalized.status, "settled", "the winning durable answer must settle");

    const state = await setup.query<{
      messages: string;
      settled_events: string;
      used: number;
    }>(
      `select
         (select used from trip_usage_meters where id = 'paid_answer_pg_meter') as used,
         (select count(*)::text from trip_usage_events
           where trip_pass_id = 'paid_answer_pg_pass' and event_type = 'settled') as settled_events,
         (select count(*)::text from chat_messages
           where id = 'paid_answer_pg_message') as messages`,
    );
    assertEqual(state.rows[0]?.used, 150, "the meter must stop exactly at 150");
    assertEqual(state.rows[0]?.settled_events, "1", "multi-tool work must create one Usage event");
    assertEqual(state.rows[0]?.messages, "1", "settlement must store one durable answer");

    const replay = await reservePaidAnswer({
      accountId: "paid_answer_pg_user",
      bodyHash: `paid_answer_pg_body_${winningSuffix}`,
      db: second,
      idempotencyKeyHash: `paid_answer_pg_key_${winningSuffix}`,
      requestId: "paid_answer_pg_request_replay",
    });
    assertEqual(replay.status, "replay", "a retry must retrieve the stored answer");
    if (replay.status === "replay") {
      assertEqual(
        replay.responseBody.message,
        "One durable multi-tool answer.",
        "replay must return the durable result",
      );
    }
  } finally {
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

async function runTerminalLifecycleRaces(harness: PostgresHarness) {
  await runFinalizeWinsTerminalRace(harness, "full_refund");
  await runFinalizeWinsTerminalRace(harness, "dispute_lost");
  await runTerminalWinsRace(harness, "full_refund");
  await runTerminalWinsRace(harness, "dispute_lost");
}

async function runFinalizeWinsTerminalRace(
  harness: PostgresHarness,
  terminal: "full_refund" | "dispute_lost",
) {
  const setup = harness.createQueryClient();
  const finalizer = harness.createQueryClient();
  const lifecycle = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const finalizerHasAccountLock = deferred<void>();
  const releaseFinalizer = deferred<void>();
  const target = raceTarget(`finalize_first_${terminal}`);
  try {
    await seedRaceTarget(setup, target);
    const reservation = await reserveRaceAnswer(setup, target);
    const gatedFinalizer = gateAfterAccountLock(
      finalizer,
      finalizerHasAccountLock,
      releaseFinalizer,
    );
    const lifecyclePid = await backendPid(lifecycle);
    const finalization = finalizeRaceAnswer(gatedFinalizer, target, reservation);
    await finalizerHasAccountLock.promise;
    const terminalApplication =
      terminal === "full_refund"
        ? applyAuthoritativeRefundFact(fullRefundFact(target), lifecycle)
        : applyAuthoritativeDisputeFact(lostDisputeFact(target), lifecycle);
    await waitForLockWait(observer, lifecyclePid);
    releaseFinalizer.resolve();

    const [finalized, applied] = await Promise.all([finalization, terminalApplication]);
    assertEqual(finalized.status, "settled", "finalization holding the account lock must settle");
    assertEqual(applied.status, "applied", `the queued ${terminal} must apply after settlement`);
    await assertRaceState(setup, target, {
      messageCount: "1",
      meterUsed: 1,
      reservationStatus: "settled",
    });
  } finally {
    releaseFinalizer.resolve();
    await Promise.all([setup.end(), finalizer.end(), lifecycle.end(), observer.end()]);
  }
}

async function runTerminalWinsRace(
  harness: PostgresHarness,
  terminal: "full_refund" | "dispute_lost",
) {
  const setup = harness.createQueryClient();
  const finalizer = harness.createQueryClient();
  const lifecycle = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const lifecycleHasAccountLock = deferred<void>();
  const releaseLifecycle = deferred<void>();
  const target = raceTarget(`terminal_first_${terminal}`);
  try {
    await seedRaceTarget(setup, target);
    const reservation = await reserveRaceAnswer(setup, target);
    const gatedLifecycle = gateAfterAccountLock(
      lifecycle,
      lifecycleHasAccountLock,
      releaseLifecycle,
    );
    const terminalApplication =
      terminal === "full_refund"
        ? applyAuthoritativeRefundFact(fullRefundFact(target), gatedLifecycle)
        : applyAuthoritativeDisputeFact(lostDisputeFact(target), gatedLifecycle);
    await lifecycleHasAccountLock.promise;
    const finalizerPid = await backendPid(finalizer);
    const finalization = finalizeRaceAnswer(finalizer, target, reservation, true);
    await waitForLockWait(observer, finalizerPid);
    releaseLifecycle.resolve();

    const [applied, finalized] = await Promise.all([terminalApplication, finalization]);
    assertEqual(applied.status, "applied", `${terminal} must win the controlled lifecycle race`);
    assertEqual(
      finalized.status,
      "invalidated",
      `finalization must observe ${terminal} invalidation`,
    );
    await assertRaceState(setup, target, {
      invalidationReason: terminal,
      messageCount: "0",
      meterUsed: 0,
      reservationStatus: "invalidated",
    });
  } finally {
    releaseLifecycle.resolve();
    await Promise.all([setup.end(), finalizer.end(), lifecycle.end(), observer.end()]);
  }
}

async function runAccountClosureRace(harness: PostgresHarness) {
  await runFinalizeWinsAccountClosureRace(harness);
  await runAccountClosureWinsRace(harness);
}

async function runFinalizeWinsAccountClosureRace(harness: PostgresHarness) {
  const setup = harness.createQueryClient();
  const closureClient = harness.createQueryClient();
  const finalizer = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const finalizerHasAccountLock = deferred<void>();
  const releaseFinalizer = deferred<void>();
  const target = raceTarget("finalize_first_account_closure");
  try {
    await seedRaceTarget(setup, target);
    const reservation = await reserveRaceAnswer(setup, target);
    const gatedFinalizer = gateAfterAccountLock(
      finalizer,
      finalizerHasAccountLock,
      releaseFinalizer,
    );
    const finalization = finalizeRaceAnswer(gatedFinalizer, target, reservation);
    await finalizerHasAccountLock.promise;
    const closurePid = await backendPid(closureClient);
    const closure = beginAccountClosure(
      { now: new Date("2026-08-08T00:00:00.000Z"), userId: target.accountId },
      {
        createId: (prefix) => `${prefix}_${target.suffix}`,
        db: closureClient,
        policy: closureRacePolicy,
      },
    );
    await waitForLockWait(observer, closurePid);
    releaseFinalizer.resolve();

    const [finalized, closed] = await Promise.all([finalization, closure]);
    assertEqual(finalized.status, "settled", "finalization must commit before queued closure");
    assertEqual(closed.status, "closed", "queued account closure must apply after finalization");
    await assertRaceState(setup, target, {
      messageCount: "1",
      meterUsed: 1,
      reservationStatus: "settled",
    });
  } finally {
    releaseFinalizer.resolve();
    await Promise.all([setup.end(), closureClient.end(), finalizer.end(), observer.end()]);
  }
}

async function runAccountClosureWinsRace(harness: PostgresHarness) {
  const setup = harness.createQueryClient();
  const closureClient = harness.createQueryClient();
  const finalizer = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const closureReachedCommit = deferred<void>();
  const releaseClosure = deferred<void>();
  const target = raceTarget("terminal_first_account_closure");
  try {
    await seedRaceTarget(setup, target);
    const reservation = await reserveRaceAnswer(setup, target);
    const closure = beginAccountClosure(
      { now: new Date("2026-08-08T00:00:00.000Z"), userId: target.accountId },
      {
        beforeCommit: async () => {
          closureReachedCommit.resolve();
          await releaseClosure.promise;
        },
        createId: (prefix) => `${prefix}_${target.suffix}`,
        db: closureClient,
        policy: closureRacePolicy,
      },
    );
    await closureReachedCommit.promise;
    const finalizerPid = await backendPid(finalizer);
    const finalization = finalizeRaceAnswer(finalizer, target, reservation, true);
    await waitForLockWait(observer, finalizerPid);
    releaseClosure.resolve();

    const [closed, finalized] = await Promise.all([closure, finalization]);
    assertEqual(closed.status, "closed", "account closure must win the controlled race");
    assertEqual(
      finalized.status,
      "invalidated",
      "finalization must observe account closure invalidation",
    );
    await assertRaceState(setup, target, {
      invalidationReason: "account_closed",
      messageCount: "0",
      meterUsed: 0,
      reservationStatus: "invalidated",
    });
  } finally {
    releaseClosure.resolve();
    await Promise.all([setup.end(), closureClient.end(), finalizer.end(), observer.end()]);
  }
}

type RaceTarget = ReturnType<typeof raceTarget>;
type ReservedRaceAnswer = Extract<
  Awaited<ReturnType<typeof reservePaidAnswer>>,
  { status: "reserved" }
>;

function raceTarget(suffix: string) {
  return {
    accountId: `paid_answer_race_user_${suffix}`,
    meterId: `paid_answer_race_meter_${suffix}`,
    orderId: `paid_answer_race_order_${suffix}`,
    passId: `paid_answer_race_pass_${suffix}`,
    paymentIntentId: `pi_paid_answer_race_${suffix}`,
    suffix,
  };
}

async function seedRaceTarget(db: DatabaseQueryClient, target: RaceTarget) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    target.accountId,
    `${target.suffix}@example.com`,
  ]);
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_family, product_version,
       stripe_price_id, amount_total_minor, captured_amount_minor, currency,
       checkout_idempotency_key, stripe_payment_intent_id, metadata_json,
       completed_at, created_at, updated_at
     ) values ($1, $2, 'paid', 'siargao_trip_pass_14d_v2', 'siargao_trip_pass', 2,
       'price_trip_pass', 49900, 49900, 'usd', $3, $4, '{}'::jsonb,
       clock_timestamp(), clock_timestamp(), clock_timestamp())`,
    [target.orderId, target.accountId, `checkout_${target.suffix}`, target.paymentIntentId],
  );
  await db.query(
    `insert into trip_passes (
       id, user_id, status, stripe_payment_intent_id, starts_at, expires_at,
       created_at, updated_at
     ) values ($1, $2, 'active', $3, clock_timestamp() - interval '1 hour',
       clock_timestamp() + interval '336 hours', clock_timestamp(), clock_timestamp())`,
    [target.passId, target.accountId, target.paymentIntentId],
  );
  await db.query(
    `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
     values ($1, $2, 'chat_message', 0, 150)`,
    [target.meterId, target.passId],
  );
}

async function reserveRaceAnswer(db: DatabaseQueryClient, target: RaceTarget) {
  const reservation = await reservePaidAnswer({
    accountId: target.accountId,
    bodyHash: `body_${target.suffix}`,
    db,
    idempotencyKeyHash: `idempotency_${target.suffix}`,
    requestId: `request_${target.suffix}`,
  });
  if (reservation.status !== "reserved") {
    throw new Error(`race reservation was unavailable: ${target.suffix}/${reservation.status}`);
  }
  return reservation;
}

function finalizeRaceAnswer(
  db: DatabaseQueryClient,
  target: RaceTarget,
  reservation: ReservedRaceAnswer,
  persistenceMustNotRun = false,
) {
  return finalizePaidAnswer({
    accountId: target.accountId,
    answerMessageId: `answer_${target.suffix}`,
    db,
    leaseToken: reservation.leaseToken,
    providerRequestIds: [`provider_${target.suffix}`],
    reservationId: reservation.reservationId,
    persistAnswer: async (transaction, allowance) => {
      if (persistenceMustNotRun) {
        throw new Error(`invalidated race reached answer persistence: ${target.suffix}`);
      }
      await transaction.query(
        `insert into chat_threads (id, user_id, title) values ($1, $2, 'Race answer')`,
        [`thread_${target.suffix}`, target.accountId],
      );
      await transaction.query(
        `insert into chat_messages (id, thread_id, user_id, role, content, request_id)
         values ($1, $2, $3, 'assistant', 'Durable race answer.', $4)`,
        [
          `answer_${target.suffix}`,
          `thread_${target.suffix}`,
          target.accountId,
          `request_${target.suffix}`,
        ],
      );
      return { message: "Durable race answer.", tripPassUsage: allowance };
    },
  });
}

function fullRefundFact(target: RaceTarget) {
  return {
    amountMinor: 49_900,
    paymentIntentId: target.paymentIntentId,
    providerCreatedAt: new Date("2026-08-08T00:00:00.000Z"),
    providerStatus: "succeeded" as const,
    stripeChargeId: `ch_${target.suffix}`,
    stripeEventId: `evt_refund_${target.suffix}`,
    stripeRefundId: `re_${target.suffix}`,
    successfulAmountMinor: 49_900,
  };
}

function lostDisputeFact(target: RaceTarget) {
  return {
    amountMinor: 49_900,
    applicationStatus: "lost" as const,
    paymentIntentId: target.paymentIntentId,
    providerCreatedAt: new Date("2026-08-08T00:00:00.000Z"),
    providerStatus: "lost",
    stripeChargeId: `ch_${target.suffix}`,
    stripeDisputeId: `du_${target.suffix}`,
    stripeEventId: `evt_dispute_${target.suffix}`,
  };
}

async function assertRaceState(
  db: DatabaseQueryClient,
  target: RaceTarget,
  expected: {
    invalidationReason?: string;
    messageCount: string;
    meterUsed: number;
    reservationStatus: string;
  },
) {
  const state = await db.query<{
    invalidation_reason: string | null;
    messages: string;
    reservation_status: string;
    used: number;
  }>(
    `select
       (select used from trip_usage_meters where id = $1) as used,
       (select status from paid_answer_reservations where trip_pass_id = $2)
         as reservation_status,
       (select invalidation_reason from paid_answer_reservations where trip_pass_id = $2)
         as invalidation_reason,
       (select count(*)::text from chat_messages where id = $3) as messages`,
    [target.meterId, target.passId, `answer_${target.suffix}`],
  );
  assertEqual(state.rows[0]?.used, expected.meterUsed, `${target.suffix} meter state diverged`);
  assertEqual(
    state.rows[0]?.reservation_status,
    expected.reservationStatus,
    `${target.suffix} reservation state diverged`,
  );
  assertEqual(
    state.rows[0]?.invalidation_reason ?? undefined,
    expected.invalidationReason,
    `${target.suffix} invalidation reason diverged`,
  );
  assertEqual(
    state.rows[0]?.messages,
    expected.messageCount,
    `${target.suffix} message count diverged`,
  );
}

function gateAfterAccountLock(
  db: DatabaseQueryClient,
  reached: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
) {
  let gated = false;
  const wrap = (client: DatabaseQueryClient): DatabaseQueryClient => ({
    inTransaction: true,
    async query<T>(query: string, params: unknown[] = []) {
      const result = await client.query<T>(query, params);
      if (!gated && /ask-siargao-account-write/i.test(query)) {
        gated = true;
        reached.resolve();
        await release.promise;
      }
      return result;
    },
  });
  return {
    query: db.query.bind(db),
    transaction: async <T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) => {
      if (!db.transaction) throw new Error("native PostgreSQL transaction support is required");
      return db.transaction((transaction) => callback(wrap(transaction)));
    },
  } satisfies DatabaseQueryClient;
}

async function backendPid(db: DatabaseQueryClient) {
  const result = await db.query<{ pid: number }>("select pg_backend_pid() as pid");
  const pid = Number(result.rows[0]?.pid);
  if (!Number.isInteger(pid)) throw new Error("native PostgreSQL backend PID was unavailable");
  return pid;
}

async function waitForLockWait(db: DatabaseQueryClient, pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await db.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    if (state.rows[0]?.wait_event_type === "Lock") return;
    await Bun.sleep(10);
  }
  throw new Error(`backend ${pid} did not reach the controlled paid-answer lock wait`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const closureRacePolicy: AccountClosurePolicy = {
  alertAfterAttempts: 3,
  closurePolicyVersion: "paid-answer-native-closure-v1",
  closureRetentionMs: 30 * 86_400_000,
  commercePolicyVersion: "paid-answer-native-commerce-v1",
  commerceRetentionMs: 365 * 86_400_000,
  providerSubjectEncryptionKey: Buffer.alloc(32, 23).toString("base64"),
  providerSubjectEncryptionKeyVersion: 1,
  tombstoneHashKey: "paid-answer-native-closure-hmac-key",
  tombstoneHashVersion: 1,
};

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}
