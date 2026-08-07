import type { DatabaseQueryClient } from "@/server/db/query-client";
import { type AccountClosurePolicy, beginAccountClosure } from "@/server/privacy/account-closure";
import {
  finalizePaidAnswer,
  PaidAnswerPurgeBatchError,
  purgeExpiredPaidAnswerDetails,
  reservePaidAnswer,
} from "@/server/trip-pass/paid-answer-reservations";
import {
  applyAuthoritativeDisputeFact,
  applyAuthoritativeRefundFact,
} from "@/server/trip-pass/payment-lifecycle";
import { reconcileTripPassState } from "@/server/trip-pass/reconciliation";

type PostgresHarness = {
  createQueryClient(): DatabaseQueryClient & { end(): Promise<void> };
};

export async function runPaidAnswerReservationPostgresIntegration(harness: PostgresHarness) {
  await runFinalUnitRegression(harness);
  await runCorruptPurgeCandidateProgress(harness);
  await runPurgeReplayAndFinalizeRaces(harness);
  await runConcurrentPurgeWorkers(harness);
  await runTerminalLifecycleRaces(harness);
  await runAccountClosureRace(harness);
  console.log(
    JSON.stringify({
      checked: "paid-answer-reservations-postgres",
      proofs: [
        "final-unit-capacity",
        "durable-result-replay",
        "purged-aggregate-reconciliation",
        "corrupt-purge-candidate-forward-progress",
        "purge-before-replay-and-finalize",
        "replay-and-finalize-before-purge",
        "concurrent-multi-account-purge-workers",
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

async function runCorruptPurgeCandidateProgress(harness: PostgresHarness) {
  const db = harness.createQueryClient();
  const mismatchTarget = raceTarget("purge_corrupt_0_mismatch");
  const missingTarget = raceTarget("purge_corrupt_1_missing");
  const conflictTarget = raceTarget("purge_corrupt_2_conflict");
  const validTarget = raceTarget("purge_corrupt_9_valid");
  try {
    for (const target of [mismatchTarget, missingTarget, conflictTarget, validTarget]) {
      await seedRaceTarget(db, target);
    }
    const mismatch = await createExpiredSettledAnswer(db, mismatchTarget, "only", {
      providerRequestIds: [],
    });
    const missing = await createExpiredSettledAnswer(db, missingTarget, "only", {
      providerRequestIds: [],
    });
    const conflicted = await createExpiredSettledAnswer(db, conflictTarget, "only", {
      blockUsageEventInsert: true,
      providerRequestIds: [],
    });
    const valid = await createExpiredSettledAnswer(db, validTarget, "only");
    await db.query(`update trip_usage_events set idempotency_key = $2 where id = $1`, [
      `trip_usage_event_${mismatch.reservationId}`,
      "paid-answer:wrong-native-reservation",
    ]);
    await db.query(`delete from trip_usage_events where id = $1`, [
      `trip_usage_event_${missing.reservationId}`,
    ]);

    await assertPaidAnswerIntegrityMatrix(db, [
      { reservationId: mismatch.reservationId, target: mismatchTarget, warning: true },
      { reservationId: missing.reservationId, target: missingTarget, warning: true },
      { reservationId: conflicted.reservationId, target: conflictTarget, warning: true },
      { reservationId: valid.reservationId, target: validTarget, warning: false },
    ]);

    const firstFailure = await captureNativePurgeFailure(db);
    assertEqual(firstFailure.purgedCount, 1, "valid later candidate must purge after corrupt rows");
    assertJsonEqual(
      firstFailure.failures.map((failure) => failure.reservationId),
      [mismatch.reservationId, missing.reservationId, conflicted.reservationId],
      "native purge must surface every corrupt candidate in deterministic order",
    );
    const markers = await db.query<{ details_purged_at: Date | null; id: string }>(
      `select id, details_purged_at from paid_answer_reservations
       where id in ($1, $2, $3, $4) order by account_id`,
      [
        mismatch.reservationId,
        missing.reservationId,
        conflicted.reservationId,
        valid.reservationId,
      ],
    );
    assertJsonEqual(
      markers.rows.map((row) => ({ id: row.id, purged: row.details_purged_at !== null })),
      [
        { id: mismatch.reservationId, purged: false },
        { id: missing.reservationId, purged: false },
        { id: conflicted.reservationId, purged: false },
        { id: valid.reservationId, purged: true },
      ],
      "corrupt candidates must roll back while a later valid candidate commits",
    );
    const retainedEvents = await db.query<{ id: string; request_id: string | null }>(
      `select id, request_id from trip_usage_events where id in ($1, $2, $3) order by id`,
      [
        `trip_usage_event_${mismatch.reservationId}`,
        `trip_usage_event_${valid.reservationId}`,
        `unrelated_usage_event_${conflictTarget.suffix}_only`,
      ],
    );
    const retainedEventMap = new Map(retainedEvents.rows.map((row) => [row.id, row.request_id]));
    assertEqual(
      retainedEventMap.get(`trip_usage_event_${mismatch.reservationId}`),
      `request_${mismatchTarget.suffix}_only`,
      "linkage-mismatched event details must remain when its candidate rolls back",
    );
    assertEqual(
      retainedEventMap.get(`trip_usage_event_${valid.reservationId}`),
      null,
      "valid later event details must scrub despite earlier corrupt candidates",
    );
    assertEqual(
      retainedEventMap.get(`unrelated_usage_event_${conflictTarget.suffix}_only`),
      `unrelated_request_${conflictTarget.suffix}_only`,
      "finalize-conflict event details must remain when its candidate rolls back",
    );
    await assertPaidAnswerIntegrityMatrix(db, [
      { reservationId: mismatch.reservationId, target: mismatchTarget, warning: true },
      { reservationId: missing.reservationId, target: missingTarget, warning: true },
      { reservationId: conflicted.reservationId, target: conflictTarget, warning: true },
      { reservationId: valid.reservationId, target: validTarget, warning: false },
    ]);
    const retryFailure = await captureNativePurgeFailure(db);
    assertEqual(retryFailure.purgedCount, 0, "retry must not recount the already purged answer");
    assertJsonEqual(
      retryFailure.failures.map((failure) => failure.reservationId),
      [mismatch.reservationId, missing.reservationId, conflicted.reservationId],
      "corrupt candidates must remain eligible and retryable",
    );
    await db.query(`update trip_usage_events set idempotency_key = $2 where id = $1`, [
      `trip_usage_event_${mismatch.reservationId}`,
      `paid-answer:${mismatch.reservationId}`,
    ]);
    await db.query(`delete from trip_usage_events where id = $1`, [
      `unrelated_usage_event_${conflictTarget.suffix}_only`,
    ]);
    await insertExactSettledUsageEvent(db, missingTarget, missing, "only");
    await insertExactSettledUsageEvent(db, conflictTarget, conflicted, "only");
    assertEqual(
      await purgeExpiredPaidAnswerDetails(db),
      3,
      "repaired corrupt candidates must remain retryable and purge exactly once",
    );
    await assertPurgedSettledAnswer(db, mismatchTarget, mismatch, 1);
    await assertPurgedSettledAnswer(db, missingTarget, missing, 1);
    await assertPurgedSettledAnswer(db, conflictTarget, conflicted, 1);
    await assertPurgedSettledAnswer(db, validTarget, valid, 1);
    await assertPaidAnswerIntegrityMatrix(db, [
      { reservationId: mismatch.reservationId, target: mismatchTarget, warning: false },
      { reservationId: missing.reservationId, target: missingTarget, warning: false },
      { reservationId: conflicted.reservationId, target: conflictTarget, warning: false },
      { reservationId: valid.reservationId, target: validTarget, warning: false },
    ]);
  } finally {
    await db.end();
  }
}

async function assertPaidAnswerIntegrityMatrix(
  db: DatabaseQueryClient,
  cases: Array<{ reservationId: string; target: RaceTarget; warning: boolean }>,
) {
  for (const mode of ["dry_run", "repair"] as const) {
    for (const entry of cases) {
      const snapshot = await reconcileTripPassState({
        confirmMutation: mode === "repair",
        db,
        mode,
        scope: { passId: entry.target.passId },
      });
      assertEqual(
        snapshot.issues.some(
          (issue) =>
            issue.code === "paid_answer_usage_event_missing" &&
            issue.localRef === entry.reservationId,
        ),
        entry.warning,
        `${mode} reconciliation paid-answer integrity warning for ${entry.reservationId}`,
      );
      if (entry.warning) {
        assertEqual(
          snapshot.issues.some(
            (issue) =>
              issue.code === "provider_usage_missing_request_id" &&
              (issue.localRef === `trip_usage_event_${entry.reservationId}` ||
                issue.localRef === `unrelated_usage_event_${entry.target.suffix}_only`),
          ),
          false,
          `${mode} reconciliation must not duplicate the paid-answer integrity warning`,
        );
      }
    }
  }
}

async function insertExactSettledUsageEvent(
  db: DatabaseQueryClient,
  target: RaceTarget,
  settled: SettledRaceAnswer,
  variant: string,
) {
  await db.query(
    `insert into trip_usage_events (
       id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
       idempotency_key, request_id, request_hash, provider_request_ids_json,
       occurred_at, created_at
     ) values ($1, $2, $3, $4, 'settled', 'chat_message', 1, $5, $6, $7,
       '[]'::jsonb, clock_timestamp(), clock_timestamp())`,
    [
      `trip_usage_event_${settled.reservationId}`,
      target.passId,
      target.meterId,
      target.accountId,
      `paid-answer:${settled.reservationId}`,
      `request_${target.suffix}_${variant}`,
      settled.bodyHash,
    ],
  );
}

async function captureNativePurgeFailure(db: DatabaseQueryClient) {
  try {
    await purgeExpiredPaidAnswerDetails(db);
  } catch (error) {
    if (error instanceof PaidAnswerPurgeBatchError) return error;
    throw error;
  }
  throw new Error("expected native paid answer purge candidate failures");
}

async function runPurgeReplayAndFinalizeRaces(harness: PostgresHarness) {
  await runPurgeOperationRace(harness, "purge_first", "replay");
  await runPurgeOperationRace(harness, "operation_first", "replay");
  await runPurgeOperationRace(harness, "purge_first", "finalize");
  await runPurgeOperationRace(harness, "operation_first", "finalize");
}

async function runPurgeOperationRace(
  harness: PostgresHarness,
  ordering: "operation_first" | "purge_first",
  operationKind: "finalize" | "replay",
) {
  const setup = harness.createQueryClient();
  const purger = harness.createQueryClient();
  const operationClient = harness.createQueryClient();
  const observer = harness.createQueryClient();
  const firstHasAccountLock = deferred<void>();
  const releaseFirst = deferred<void>();
  const target = raceTarget(`purge_${ordering}_${operationKind}`);
  try {
    await seedRaceTarget(setup, target);
    const settled = await createExpiredSettledAnswer(setup, target, "primary");
    const operation = (db: DatabaseQueryClient) =>
      operationKind === "replay"
        ? reservePaidAnswer({
            accountId: target.accountId,
            bodyHash: settled.bodyHash,
            db,
            idempotencyKeyHash: settled.idempotencyKeyHash,
            requestId: `retry_${target.suffix}`,
          })
        : finalizeSettledAnswer(db, target, settled);

    if (ordering === "purge_first") {
      const gatedPurger = gateAfterAccountLock(purger, firstHasAccountLock, releaseFirst);
      const purge = purgeExpiredPaidAnswerDetails(gatedPurger);
      await firstHasAccountLock.promise;
      const operationPid = await backendPid(operationClient);
      const queuedOperation = operation(operationClient);
      await waitForLockWait(observer, operationPid);
      releaseFirst.resolve();
      const [purged, operationResult] = await Promise.all([purge, queuedOperation]);
      assertEqual(purged, 1, `${operationKind} race must purge exactly one answer`);
      assertEqual(
        operationResult.status,
        operationKind === "replay" ? "in_progress" : "lease_lost",
        `purge-first ${operationKind} must observe scrubbed settled details`,
      );
    } else {
      const gatedOperation = gateAfterAccountLock(
        operationClient,
        firstHasAccountLock,
        releaseFirst,
      );
      const firstOperation = operation(gatedOperation);
      await firstHasAccountLock.promise;
      const purgerPid = await backendPid(purger);
      const queuedPurge = purgeExpiredPaidAnswerDetails(purger);
      await waitForLockWait(observer, purgerPid);
      releaseFirst.resolve();
      const [operationResult, purged] = await Promise.all([firstOperation, queuedPurge]);
      assertEqual(
        operationResult.status,
        operationKind === "replay" ? "replay" : "duplicate",
        `${operationKind}-first must read the durable settled result`,
      );
      assertEqual(purged, 1, `${operationKind}-first race must later purge one answer`);
    }
    await assertPurgedSettledAnswer(setup, target, settled, 1);
  } finally {
    releaseFirst.resolve();
    await Promise.all([setup.end(), purger.end(), operationClient.end(), observer.end()]);
  }
}

async function runConcurrentPurgeWorkers(harness: PostgresHarness) {
  const setup = harness.createQueryClient();
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  const firstRead = deferred<void>();
  const secondRead = deferred<void>();
  const releaseReads = deferred<void>();
  const sameAccount = raceTarget("purge_workers_same_account");
  const otherAccount = raceTarget("purge_workers_other_account");
  try {
    await seedRaceTarget(setup, sameAccount);
    await seedRaceTarget(setup, otherAccount);
    const sameFirst = await createExpiredSettledAnswer(setup, sameAccount, "first");
    const sameSecond = await createExpiredSettledAnswer(setup, sameAccount, "second");
    const other = await createExpiredSettledAnswer(setup, otherAccount, "only");
    await setup.query(
      `insert into trip_usage_events (
         id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
         idempotency_key, request_id, request_hash, provider_request_ids_json,
         occurred_at, created_at
       ) values (
         'unrelated_purge_worker_event', $1, $2, $3, 'adjusted', 'chat_message', 1,
         'unrelated-purge-worker', 'unrelated-request', 'unrelated-hash',
         '["unrelated-provider"]'::jsonb, clock_timestamp(), clock_timestamp()
       )`,
      [sameAccount.passId, sameAccount.meterId, sameAccount.accountId],
    );

    const firstWorker = purgeExpiredPaidAnswerDetails(
      gateAfterCandidateRead(first, firstRead, releaseReads),
    );
    const secondWorker = purgeExpiredPaidAnswerDetails(
      gateAfterCandidateRead(second, secondRead, releaseReads),
    );
    await Promise.all([firstRead.promise, secondRead.promise]);
    releaseReads.resolve();
    const counts = await Promise.all([firstWorker, secondWorker]);
    const totalPurged = counts.reduce((total, count) => total + count, 0);
    assertEqual(
      totalPurged,
      3,
      "concurrent purge workers must count each eligible answer exactly once",
    );
    await assertPurgedSettledAnswer(setup, sameAccount, sameFirst, 2);
    await assertPurgedSettledAnswer(setup, sameAccount, sameSecond, 2);
    await assertPurgedSettledAnswer(setup, otherAccount, other, 1);
    const unrelated = await setup.query<{
      provider_request_ids_json: unknown;
      request_hash: string | null;
      request_id: string | null;
    }>(
      `select request_id, request_hash, provider_request_ids_json
       from trip_usage_events where id = 'unrelated_purge_worker_event'`,
    );
    assertEqual(
      unrelated.rows[0]?.request_id,
      "unrelated-request",
      "concurrent purge workers must not scrub an unrelated event",
    );
    assertEqual(
      unrelated.rows[0]?.request_hash,
      "unrelated-hash",
      "unrelated request hash must remain",
    );
    assertEqual(
      JSON.stringify(unrelated.rows[0]?.provider_request_ids_json),
      '["unrelated-provider"]',
      "unrelated provider evidence must remain",
    );
  } finally {
    releaseReads.resolve();
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
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
    await setup.query(
      `insert into trip_usage_events (
         id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
         idempotency_key, request_id, request_hash, provider_request_ids_json,
         occurred_at, created_at
       ) values (
         'paid_answer_pg_baseline_event', 'paid_answer_pg_pass', 'paid_answer_pg_meter',
         'paid_answer_pg_user', 'settled', 'chat_message', 149,
         'paid-answer-baseline', 'paid-answer-baseline-request', 'paid-answer-baseline-hash',
         '["paid-answer-baseline-provider"]'::jsonb, clock_timestamp(), clock_timestamp()
       )`,
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
           where trip_pass_id = 'paid_answer_pg_pass' and event_type = 'settled'
             and id <> 'paid_answer_pg_baseline_event') as settled_events,
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
    assertEqual(
      await purgeExpiredPaidAnswerDetails(setup),
      0,
      "retention purge must not run before the database-time deadline",
    );
    await setup.query(
      `update paid_answer_reservations
       set reserved_at = clock_timestamp() - interval '40 days',
         details_purge_at = clock_timestamp() - interval '1 second'
       where id = $1`,
      [winner.reservationId],
    );
    assertEqual(
      await purgeExpiredPaidAnswerDetails(setup),
      1,
      "retention purge must run at expiry",
    );
    const purged = await setup.query<{
      event_provider_ids: unknown;
      event_request_hash: string | null;
      event_request_id: string | null;
      quantity: number;
      reservation_purged_at: Date | null;
      used: number;
    }>(
      `select
         (select details_purged_at from paid_answer_reservations where id = $1)
           as reservation_purged_at,
         (select request_id from trip_usage_events where id = $2) as event_request_id,
         (select request_hash from trip_usage_events where id = $2) as event_request_hash,
         (select provider_request_ids_json from trip_usage_events where id = $2)
           as event_provider_ids,
         (select quantity from trip_usage_events where id = $2) as quantity,
         (select used from trip_usage_meters where id = 'paid_answer_pg_meter') as used`,
      [winner.reservationId, `trip_usage_event_${winner.reservationId}`],
    );
    assertEqual(purged.rows[0]?.event_request_id, null, "usage event request ID must purge");
    assertEqual(purged.rows[0]?.event_request_hash, null, "usage event request hash must purge");
    assertEqual(
      JSON.stringify(purged.rows[0]?.event_provider_ids),
      "[]",
      "provider IDs must purge",
    );
    assertEqual(purged.rows[0]?.quantity, 1, "usage event aggregate quantity must remain");
    assertEqual(purged.rows[0]?.used, 150, "aggregate meter usage must remain");
    if (!purged.rows[0]?.reservation_purged_at) throw new Error("reservation purge marker missing");
    for (const mode of ["dry_run", "repair"] as const) {
      const snapshot = await reconcileTripPassState({
        confirmMutation: mode === "repair",
        db: setup,
        mode,
        scope: { passId: "paid_answer_pg_pass" },
      });
      assertEqual(
        snapshot.issues.some(
          (issue) =>
            issue.code === "provider_usage_missing_request_id" &&
            issue.localRef === `trip_usage_event_${winner.reservationId}`,
        ),
        false,
        `${mode} reconciliation must accept the exactly linked purged paid-answer aggregate`,
      );
      assertEqual(
        snapshot.issues.some(
          (issue) =>
            issue.code === "usage_meter_aggregate_mismatch" &&
            issue.localRef === "paid_answer_pg_pass:chat_message",
        ),
        false,
        `${mode} reconciliation must preserve the paid-answer aggregate`,
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
type SettledRaceAnswer = {
  answerMessageId: string;
  bodyHash: string;
  idempotencyKeyHash: string;
  leaseToken: string;
  reservationId: string;
};

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

async function createExpiredSettledAnswer(
  db: DatabaseQueryClient,
  target: RaceTarget,
  variant: string,
  options: { blockUsageEventInsert?: boolean; providerRequestIds?: string[] } = {},
): Promise<SettledRaceAnswer> {
  const bodyHash = `body_${target.suffix}_${variant}`;
  const idempotencyKeyHash = `idempotency_${target.suffix}_${variant}`;
  const answerMessageId = `answer_${target.suffix}_${variant}`;
  const reservation = await reservePaidAnswer({
    accountId: target.accountId,
    bodyHash,
    db,
    idempotencyKeyHash,
    requestId: `request_${target.suffix}_${variant}`,
  });
  if (reservation.status !== "reserved") {
    throw new Error(
      `settled purge race reservation unavailable: ${target.suffix}/${variant}/${reservation.status}`,
    );
  }
  if (options.blockUsageEventInsert) {
    await db.query(
      `insert into trip_usage_events (
         id, trip_pass_id, usage_meter_id, user_id, event_type, meter_type, quantity,
         idempotency_key, request_id, request_hash, provider_request_ids_json,
         occurred_at, created_at
       ) values ($1, $2, $3, $4, 'settled', 'chat_message', 1, $5, $6, $7,
         '[]'::jsonb, clock_timestamp(), clock_timestamp())`,
      [
        `unrelated_usage_event_${target.suffix}_${variant}`,
        target.passId,
        target.meterId,
        target.accountId,
        `paid-answer:${reservation.reservationId}`,
        `unrelated_request_${target.suffix}_${variant}`,
        `unrelated_hash_${target.suffix}_${variant}`,
      ],
    );
  }
  const finalized = await finalizePaidAnswer({
    accountId: target.accountId,
    answerMessageId,
    db,
    leaseToken: reservation.leaseToken,
    providerRequestIds: options.providerRequestIds ?? [`provider_${target.suffix}_${variant}`],
    reservationId: reservation.reservationId,
    persistAnswer: async (transaction, allowance) => {
      await transaction.query(
        `insert into chat_threads (id, user_id, title) values ($1, $2, 'Purge race answer')`,
        [`thread_${target.suffix}_${variant}`, target.accountId],
      );
      await transaction.query(
        `insert into chat_messages (id, thread_id, user_id, role, content, request_id)
         values ($1, $2, $3, 'assistant', 'Durable purge race answer.', $4)`,
        [
          answerMessageId,
          `thread_${target.suffix}_${variant}`,
          target.accountId,
          `request_${target.suffix}_${variant}`,
        ],
      );
      return { message: "Durable purge race answer.", tripPassUsage: allowance };
    },
  });
  assertEqual(finalized.status, "settled", "purge race setup must settle the answer");
  await db.query(
    `update paid_answer_reservations
     set reserved_at = clock_timestamp() - interval '40 days',
       details_purge_at = clock_timestamp() - interval '1 second'
     where id = $1`,
    [reservation.reservationId],
  );
  return {
    answerMessageId,
    bodyHash,
    idempotencyKeyHash,
    leaseToken: reservation.leaseToken,
    reservationId: reservation.reservationId,
  };
}

function finalizeSettledAnswer(
  db: DatabaseQueryClient,
  target: RaceTarget,
  settled: SettledRaceAnswer,
) {
  return finalizePaidAnswer({
    accountId: target.accountId,
    answerMessageId: settled.answerMessageId,
    db,
    leaseToken: settled.leaseToken,
    providerRequestIds: [`duplicate_provider_${target.suffix}`],
    reservationId: settled.reservationId,
    persistAnswer: async () => {
      throw new Error(`duplicate finalization persisted again: ${target.suffix}`);
    },
  });
}

async function assertPurgedSettledAnswer(
  db: DatabaseQueryClient,
  target: RaceTarget,
  settled: SettledRaceAnswer,
  expectedMeterUsed: number,
) {
  const result = await db.query<{
    details_purged_at: Date | null;
    event_provider_ids: unknown;
    event_request_id: string | null;
    meter_used: number;
    reservation_status: string;
  }>(
    `select
       r.status as reservation_status,
       r.details_purged_at,
       e.request_id as event_request_id,
       e.provider_request_ids_json as event_provider_ids,
       m.used as meter_used
     from paid_answer_reservations r
     join trip_usage_events e on e.id = 'trip_usage_event_' || r.id
     join trip_usage_meters m on m.id = r.usage_meter_id
     where r.id = $1 and r.account_id = $2`,
    [settled.reservationId, target.accountId],
  );
  assertEqual(result.rows[0]?.reservation_status, "settled", "purge must retain settled status");
  if (!result.rows[0]?.details_purged_at) {
    throw new Error(`purge marker missing after controlled race: ${target.suffix}`);
  }
  assertEqual(result.rows[0]?.event_request_id, null, "paired event request must be scrubbed");
  assertEqual(
    JSON.stringify(result.rows[0]?.event_provider_ids),
    "[]",
    "paired event provider evidence must be scrubbed",
  );
  assertEqual(
    result.rows[0]?.meter_used,
    expectedMeterUsed,
    "purge races must preserve aggregate meter usage",
  );
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

function gateAfterCandidateRead(
  db: DatabaseQueryClient,
  reached: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
) {
  let gated = false;
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const result = await db.query<T>(query, params);
      if (!gated && /select id, account_id[\s\S]*paid_answer_reservations/i.test(query)) {
        gated = true;
        reached.resolve();
        await release.promise;
      }
      return result;
    },
    transaction: db.transaction?.bind(db),
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

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}
