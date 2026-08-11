import type Stripe from "stripe";

import { listPendingMigrationNames, loadMigrationFiles } from "@/server/db/migration-files";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import { withTimeout } from "@/server/integration/entrypoint-shared";
import { withRealPostgresHarness } from "@/server/integration/postgres-harness";
import { runTripPassPaymentLifecyclePostgresRegression } from "@/server/integration/trip-pass-payment-lifecycle-postgres";
import { runOperationsPostgresIntegration } from "@/server/operations/operations.postgres-integration";
import {
  applyStripeInboxEvent,
  claimPendingStripeInboxEvents,
  receiveStripeWebhookEvent,
  STRIPE_API_VERSION,
} from "@/server/payments/stripe-event-inbox";
import { runAccountClosurePostgresIntegration } from "@/server/privacy/account-closure.postgres-integration";
import { startTripPassCheckout, type TripPassCheckoutResult } from "@/server/trip-pass/commerce";
import {
  PaidAnswerPurgeBatchError,
  purgeExpiredPaidAnswerDetails,
} from "@/server/trip-pass/paid-answer-reservations";
import { runPaidAnswerReservationPostgresIntegration } from "@/server/trip-pass/paid-answer-reservations.postgres-integration";
import type {
  TripPassCheckoutClient,
  TripPassCheckoutSessionSummary,
} from "@/server/trip-pass/stripe-adapter";
import { tripPassCheckoutProductSnapshot } from "@/server/trip-pass/stripe-adapter";
import { applyTripPassStripeEvent } from "@/server/trip-pass/webhook-application";

type PostgresHarness = Parameters<Parameters<typeof withRealPostgresHarness>[0]>[0];
type CheckoutCreateParams = Parameters<TripPassCheckoutClient["createCheckoutSession"]>[0];
type SuccessfulTripPassCheckoutResult = Extract<TripPassCheckoutResult, { checkoutUrl: string }>;

const tripPassCheckoutRaceEnv = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
} as const;

await runConcurrentHarnessIsolationRegression();
await runHistoricalPaidAnswerMigrationUpgrade();
await runHistoricalOperationsMigrationUpgrade();

await withRealPostgresHarness(async (harness) => {
  const migration = await harness.migrate();
  await runRollbackRegression(harness);
  await runDatabaseTimeRegression(harness);
  await runUniqueConflictRegression(harness);
  await runFailedTransactionRecoveryRegression(harness);
  await runAdvisoryLockRegression(harness);
  await runTripPassCheckoutRaceRegression(harness);
  await runStripeInboxRealPostgresRegression(harness);
  await runTripPassPaymentLifecyclePostgresRegression(harness);
  await runAccountClosurePostgresIntegration(harness);
  await runPaidAnswerReservationPostgresIntegration(harness);
  const operationsClient = harness.createQueryClient();
  try {
    await runOperationsPostgresIntegration(operationsClient, () =>
      harness.createQueryClient({ max: 1 }),
    );
  } finally {
    await operationsClient.end();
  }

  console.log(
    JSON.stringify(
      {
        checked: "postgres-integration-semantic-suite",
        migration,
        namespace: harness.namespace,
      },
      null,
      2,
    ),
  );
});

async function runHistoricalPaidAnswerMigrationUpgrade() {
  await withRealPostgresHarness(async (harness) => {
    const migrationFiles = await loadMigrationFiles();
    const throughHistoricalPaidAnswer = migrationFiles.filter(
      (migration) => migration.name <= "0014_durable_paid_answer_reservations.sql",
    );
    const historicalPaidAnswer = throughHistoricalPaidAnswer.at(-1);
    assertEqual(
      historicalPaidAnswer?.checksum,
      "3382b687fb8812b75446de022ce3c89e4efb68bd77a50025034997da942d974d",
      "historical 0014 checksum must remain immutable",
    );
    await harness.migrate(throughHistoricalPaidAnswer);
    const client = harness.createQueryClient();
    try {
      await client.query(
        `insert into users (id, email)
         values ('native_migration_retry_user', 'native-migration-retry@example.com')`,
      );
      await client.query(
        `insert into trip_passes (
           id, user_id, status, starts_at, expires_at, created_at, updated_at
         ) values (
           'native_migration_retry_pass', 'native_migration_retry_user', 'active',
           clock_timestamp() - interval '1 hour', clock_timestamp() + interval '14 days',
           clock_timestamp(), clock_timestamp()
         )`,
      );
      await client.query(
        `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
         values (
           'native_migration_retry_meter', 'native_migration_retry_pass',
           'chat_message', 1, 150
         )`,
      );
      await client.query(
        `insert into paid_answer_reservations (
           id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
           request_body_hash, request_id, lease_token, status, lease_expires_at,
           details_purge_at, reserved_at, finalized_at, updated_at
         ) values (
           'native_migration_retry_reservation', 'native_migration_retry_pass',
           'native_migration_retry_meter', 'native_migration_retry_user',
           'native_migration_retry_key', 'native_migration_retry_body',
           'native_migration_retry_request', 'native_migration_retry_lease', 'settled',
           clock_timestamp() - interval '39 days', clock_timestamp() - interval '1 day',
           clock_timestamp() - interval '40 days', clock_timestamp() - interval '39 days',
           clock_timestamp() - interval '39 days'
         )`,
      );
      const upgrade = await harness.migrate();
      assertDeepEqual(
        upgrade.applied,
        listPendingMigrationNames(migrationFiles, throughHistoricalPaidAnswer),
        "historical native ledger must advance through the additive operations migration",
      );
      const upgraded = await client.query<{
        purge_failure_count: number;
        purge_retry_at: Date | null;
      }>(
        `select purge_failure_count, purge_retry_at
         from paid_answer_reservations where id = 'native_migration_retry_reservation'`,
      );
      assertEqual(upgraded.rows[0]?.purge_failure_count, 0, "0015 must backfill retry count");
      assertEqual(upgraded.rows[0]?.purge_retry_at, null, "0015 must leave retry deadline unset");
      let purgeFailure: unknown;
      try {
        await purgeExpiredPaidAnswerDetails(client);
      } catch (error) {
        purgeFailure = error;
      }
      if (!(purgeFailure instanceof PaidAnswerPurgeBatchError)) {
        throw purgeFailure ?? new Error("native upgraded retry scheduling did not fail visibly");
      }
      assertEqual(purgeFailure.purgedCount, 0, "upgraded corrupt row must not claim deletion");
      assertEqual(
        purgeFailure.failures[0]?.retryScheduled,
        true,
        "upgraded corrupt row must schedule a retry",
      );
      const scheduled = await client.query<{
        purge_failure_count: number;
        retry_scheduled: boolean;
      }>(
        `select purge_failure_count, purge_retry_at > purge_attempted_at as retry_scheduled
         from paid_answer_reservations where id = 'native_migration_retry_reservation'`,
      );
      assertEqual(scheduled.rows[0]?.purge_failure_count, 1, "upgraded retry must increment once");
      assertEqual(scheduled.rows[0]?.retry_scheduled, true, "upgraded retry must be future-dated");
      console.log(
        JSON.stringify({
          checked: "historical-paid-answer-migration-upgrade",
          fromChecksum: historicalPaidAnswer?.checksum,
          applied: upgrade.applied,
        }),
      );
    } finally {
      await client.end();
    }
  });
}

async function runHistoricalOperationsMigrationUpgrade() {
  await withRealPostgresHarness(async (harness) => {
    const migrationFiles = await loadMigrationFiles();
    const through0016 = migrationFiles.filter(
      (migration) => migration.name <= "0016_operational_findings_and_repair.sql",
    );
    assertEqual(
      through0016.at(-1)?.checksum,
      "50344fcd9373e140eb9a92953a83e61f3f8e12c521cb0abff7994da6b7b15ec5",
      "historical 0016 checksum must remain immutable",
    );
    await harness.migrate(through0016);
    const client = harness.createQueryClient();
    try {
      for (const runId of ["native_duplicate_run_open", "native_duplicate_run_resolved"]) {
        await client.query(
          `insert into operational_reconciliation_runs (
             id, source, status, checked_count, finding_count, started_at, completed_at
           ) values ($1, 'worker', 'succeeded', 1, 1, clock_timestamp(), clock_timestamp())`,
          [runId],
        );
      }
      await client.query(
        `insert into operational_findings (
           id, run_id, kind, impact, status, local_entity_type, local_entity_ref,
           summary_code, detected_at, resolved_at
         ) values
         ('native_duplicate_open', 'native_duplicate_run_open', 'paid_without_pass', 'high',
          'open', 'trip_pass_order', 'native_duplicate_order',
          'authoritative_payment_has_no_local_access', clock_timestamp() - interval '2 hours', null),
         ('native_duplicate_resolved', 'native_duplicate_run_resolved', 'paid_without_pass',
          'high', 'resolved', 'trip_pass_order', 'native_duplicate_order',
          'authoritative_payment_has_no_local_access', clock_timestamp() - interval '1 hour',
          clock_timestamp() - interval '30 minutes')`,
      );
      await client.query(
        `insert into operator_repair_actions (
           id, finding_id, operator_account_id, idempotency_key_hash, action_type, reason_code,
           before_state, after_state
         ) values (
           'native_duplicate_repair', 'native_duplicate_resolved', 'native_operator',
           'native_duplicate_key', 'manual_commerce_transition', 'verified_duplicate',
           '{}'::jsonb, '{}'::jsonb
         )`,
      );
      await client.query(
        `insert into operational_alert_deliveries (
           id, alert_key, finding_id, impact, destination, status, delivery_token,
           attempted_at, delivered_at
         ) values (
           'native_duplicate_alert', 'native_duplicate_alert_key',
           'native_duplicate_resolved', 'high', 'sentry', 'sent', 'native_duplicate_token',
           clock_timestamp(), clock_timestamp()
         )`,
      );
      const upgrade = await harness.migrate();
      assertDeepEqual(
        upgrade.applied,
        listPendingMigrationNames(migrationFiles, through0016),
        "historical 0016 ledger did not apply preflight before immutable 0017",
      );
      const converged = await client.query<{
        alerts: string;
        count: string;
        repairs: string;
        status: string;
      }>(
        `select count(*)::text as count, min(status) as status,
           (select finding_id from operator_repair_actions
            where id = 'native_duplicate_repair') as repairs,
           (select finding_id from operational_alert_deliveries
            where id = 'native_duplicate_alert') as alerts
         from operational_findings where local_entity_ref = 'native_duplicate_order'`,
      );
      assertDeepEqual(
        converged.rows,
        [
          {
            count: "1",
            status: "open",
            repairs: "native_duplicate_open",
            alerts: "native_duplicate_open",
          },
        ],
        "native duplicate incident evidence did not converge",
      );
    } finally {
      await client.end();
    }
  });

  await withRealPostgresHarness(async (harness) => {
    const migrationFiles = await loadMigrationFiles();
    const historicalThrough0017 = migrationFiles.filter(
      (migration) =>
        migration.name !== "0016_preflight_operational_incident_dedup.sql" &&
        migration.name <= "0017_operational_incident_leases.sql",
    );
    await harness.migrate(historicalThrough0017);
    const upgrade = await harness.migrate();
    assertDeepEqual(
      upgrade.applied,
      listPendingMigrationNames(migrationFiles, historicalThrough0017),
      "already-applied 0017 ledger did not accept safe late preflight",
    );
  });
}

async function runConcurrentHarnessIsolationRegression() {
  const firstReady = deferred<string>();
  const secondCleaned = deferred<string>();

  const first = withRealPostgresHarness(async (harness) => {
    const client = harness.createQueryClient();
    try {
      await client.query("create table integration_owner_probe (id text primary key)");
      await client.query("insert into integration_owner_probe (id) values ($1)", ["first-harness"]);
      firstReady.resolve(harness.databaseName);
      await secondCleaned.promise;
      const rows = await client.query<{ id: string }>(
        "select id from integration_owner_probe where id = $1",
        ["first-harness"],
      );
      assertEqual(
        rows.rows[0]?.id,
        "first-harness",
        "cleanup for a concurrent PostgreSQL harness must not drop another owned database",
      );
      return harness.databaseName;
    } finally {
      await client.end();
    }
  }).catch((error) => {
    firstReady.reject(error);
    secondCleaned.reject(error);
    throw error;
  });

  const second = (async () => {
    const firstDatabaseName = await firstReady.promise;
    const secondDatabaseName = await withRealPostgresHarness(async (harness) => {
      assertNotEqual(
        harness.databaseName,
        firstDatabaseName,
        "concurrent PostgreSQL harnesses must use distinct database names",
      );
      const client = harness.createQueryClient();
      try {
        await client.query("create table integration_owner_probe (id text primary key)");
        await client.query("insert into integration_owner_probe (id) values ($1)", [
          "second-harness",
        ]);
      } finally {
        await client.end();
      }
      return harness.databaseName;
    });
    secondCleaned.resolve(secondDatabaseName);
    return secondDatabaseName;
  })();

  const [firstDatabaseName, secondDatabaseName] = await Promise.all([first, second]);
  assertNotEqual(
    firstDatabaseName,
    secondDatabaseName,
    "concurrent PostgreSQL harnesses must not collide on database ownership",
  );
}

async function runRollbackRegression(harness: PostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await client.query("create table integration_rollback_probe (id text primary key)");
    await expectRejects(
      client.transaction(async (transaction) => {
        await transaction.query("insert into integration_rollback_probe (id) values ($1)", [
          "rolled_back",
        ]);
        throw new Error("force rollback");
      }),
      "force rollback",
    );

    const count = await client.query<{ count: string }>(
      "select count(*)::text as count from integration_rollback_probe",
    );
    assertEqual(count.rows[0]?.count, "0", "rolled-back row must not be committed");
  } finally {
    await client.end();
  }
}

async function runDatabaseTimeRegression(harness: PostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await client.query(`
      create table integration_time_probe (
        id text primary key,
        expires_at timestamptz not null default (now() + interval '5 milliseconds')
      )
    `);
    await client.query("insert into integration_time_probe (id) values ($1)", ["db_time"]);
    await sleep(25);
    const expired = await client.query<{ expired: boolean }>(
      "select exists(select 1 from integration_time_probe where id = $1 and expires_at <= now()) as expired",
      ["db_time"],
    );
    assertEqual(expired.rows[0]?.expired, true, "database now() must govern expiry boundaries");
  } finally {
    await client.end();
  }
}

async function runUniqueConflictRegression(harness: PostgresHarness) {
  const first = harness.createClient();
  const second = harness.createClient();
  try {
    await first`create table integration_unique_probe (id text primary key, value text not null)`;
    const results = await Promise.allSettled([
      first`insert into integration_unique_probe (id, value) values ('same-id', 'first')`,
      second`insert into integration_unique_probe (id, value) values ('same-id', 'second')`,
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assertEqual(fulfilled.length, 1, "exactly one parallel unique insert must commit");
    assertEqual(rejected.length, 1, "exactly one parallel unique insert must conflict");

    const rows = await first<{ count: string }[]>`
      select count(*)::text as count from integration_unique_probe where id = 'same-id'
    `;
    assertEqual(rows[0]?.count, "1", "unique conflict must leave exactly one row");
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
}

async function runFailedTransactionRecoveryRegression(harness: PostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await expectRejects(
      client.transaction(async (transaction) => {
        await transaction.query("select 1");
        throw new Error("failed transaction probe");
      }),
      "failed transaction probe",
    );
    const healthy = await client.query<{ healthy: number }>("select 1 as healthy");
    assertEqual(healthy.rows[0]?.healthy, 1, "failed transaction must not poison later tests");
  } finally {
    await client.end();
  }
}

async function runAdvisoryLockRegression(harness: PostgresHarness) {
  const holder = harness.createClient();
  const waiter = harness.createClient();
  const observer = harness.createClient();
  const lockKey = "915000150";
  let releaseHolder!: () => void;
  let holderReady!: () => void;
  let waiterStarted!: () => void;
  let waiterPid: number | undefined;
  const transactionEvents: string[] = [];
  const releaseHolderPromise = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  const holderReadyPromise = new Promise<void>((resolve) => {
    holderReady = resolve;
  });
  const waiterStartedPromise = new Promise<void>((resolve) => {
    waiterStarted = resolve;
  });

  try {
    await observer`create table integration_lock_events (event text primary key, created_at timestamptz not null default now())`;

    const holderPromise = holder.begin(async (transaction) => {
      await transaction.unsafe("select pg_advisory_xact_lock($1::bigint)", [lockKey]);
      await transaction`insert into integration_lock_events (event) values ('holder_entered')`;
      transactionEvents.push("holder_entered");
      holderReady();
      await releaseHolderPromise;
    });
    await holderReadyPromise;

    const waiterPromise = waiter.begin(async (transaction) => {
      const pidRows = await transaction<{ pid: number }[]>`select pg_backend_pid() as pid`;
      waiterPid = Number(pidRows[0]?.pid);
      if (!Number.isInteger(waiterPid)) {
        throw new Error("waiter backend pid was not available.");
      }
      waiterStarted();
      await transaction.unsafe("select pg_advisory_xact_lock($1::bigint)", [lockKey]);
      await transaction`insert into integration_lock_events (event) values ('waiter_entered')`;
      transactionEvents.push("waiter_entered");
    });
    await waiterStartedPromise;
    const blockedWaiterPid = waiterPid;
    if (blockedWaiterPid === undefined || !Number.isInteger(blockedWaiterPid)) {
      throw new Error("waiter backend pid was not recorded before lock polling.");
    }
    await waitUntil(async () => {
      const rows = (await observer.unsafe(
        `
        select wait_event_type
        from pg_stat_activity
        where pid = $1
      `,
        [blockedWaiterPid],
      )) as { wait_event_type: string | null }[];
      return rows[0]?.wait_event_type === "Lock";
    }, "waiter did not block on the holder transaction-scoped advisory lock");

    assertDeepEqual(
      transactionEvents,
      ["holder_entered"],
      "waiter must not enter the protected section before holder transaction end",
    );

    releaseHolder();
    await Promise.all([holderPromise, waiterPromise]);

    const afterRelease = await observer<{ event: string }[]>`
      select event from integration_lock_events order by created_at, event
    `;
    assertDeepEqual(
      afterRelease.map((row) => row.event),
      ["holder_entered", "waiter_entered"],
      "waiter must enter after holder transaction releases the advisory lock",
    );

    const leaked = await observer.begin(async (transaction) => {
      const rows = await transaction<{ acquired: boolean }[]>`
        select pg_try_advisory_xact_lock(${lockKey}::bigint) as acquired
      `;
      return rows[0]?.acquired;
    });
    assertEqual(leaked, true, "transaction-scoped advisory lock must not leak after commit");
  } finally {
    releaseHolder();
    await Promise.allSettled([holder.end(), waiter.end(), observer.end()]);
  }
}

async function runTripPassCheckoutRaceRegression(harness: PostgresHarness) {
  await runTripPassCheckoutWinnerRegression(harness, "first");
  await runTripPassCheckoutWinnerRegression(harness, "second");
  await runTripPassCheckoutRollbackRaceRegression(harness);
}

async function runTripPassCheckoutWinnerRegression(
  harness: PostgresHarness,
  winner: "first" | "second",
) {
  const userId = `user_checkout_race_${winner}`;
  const firstOrderId = `order_checkout_race_${winner}_first`;
  const secondOrderId = `order_checkout_race_${winner}_second`;
  const winnerOrderId = winner === "first" ? firstOrderId : secondOrderId;
  const winnerRelease = deferred<void>();
  const firstMayAttemptLock = deferred<void>();
  const firstLocked = deferred<number>();
  const secondLocked = deferred<number>();
  const firstLockStarted = deferred<number>();
  const secondLockStarted = deferred<number>();
  const reservationEvents: string[] = [];
  const observer = harness.createClient();
  const visibilityClient = harness.createQueryClient();
  const checkoutClient = createRaceCheckoutClient(visibilityClient);
  const firstClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    afterFamilyLock: async (pid) => {
      reservationEvents.push("first:lock");
      firstLocked.resolve(pid);
      if (winner === "first") {
        await winnerRelease.promise;
      }
    },
    afterDatabaseNow: async () => {
      reservationEvents.push("first:now");
    },
    beforeFamilyLock: async (pid) => {
      firstLockStarted.resolve(pid);
      if (winner === "second") {
        await firstMayAttemptLock.promise;
      }
    },
  });
  const secondClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    afterFamilyLock: async (pid) => {
      reservationEvents.push("second:lock");
      secondLocked.resolve(pid);
      if (winner === "second") {
        await winnerRelease.promise;
      }
    },
    afterDatabaseNow: async () => {
      reservationEvents.push("second:now");
    },
    beforeFamilyLock: async (pid) => {
      secondLockStarted.resolve(pid);
    },
  });

  try {
    await insertIntegrationUser(visibilityClient, userId);

    const firstCheckout = startTripPassCheckout(
      { appUrl: "https://siargao.test", email: `${userId}@example.com`, userId },
      {
        checkoutClient,
        createId: () => firstOrderId,
        db: firstClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).catch((error: unknown) => {
      firstLocked.reject(error);
      firstLockStarted.reject(error);
      throw error;
    });

    if (winner === "first") {
      await waitForBarrier(
        firstLocked.promise,
        "Trip Pass checkout first request did not acquire the family reservation lock",
      );
      assertDeepEqual(
        reservationEvents,
        ["first:lock"],
        "first-winner checkout must read DB time only after entering the lock-held section",
      );
    } else {
      await waitForBarrier(
        firstLockStarted.promise,
        "Trip Pass checkout first request did not reach its pre-lock barrier",
      );
      assertDeepEqual(
        reservationEvents,
        [],
        "second-winner checkout must not let the paused first request read DB time before the lock",
      );
    }

    const secondCheckout = startTripPassCheckout(
      { appUrl: "https://siargao.test", email: `${userId}@example.com`, userId },
      {
        checkoutClient,
        createId: () => secondOrderId,
        db: secondClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).catch((error: unknown) => {
      secondLocked.reject(error);
      secondLockStarted.reject(error);
      throw error;
    });

    if (winner === "first") {
      const secondPid = await waitForBarrier(
        secondLockStarted.promise,
        "Trip Pass checkout second request did not attempt the family reservation lock",
      );
      await waitForBackendLock(
        observer,
        secondPid,
        "Trip Pass checkout second request did not wait on the first request family reservation lock",
      );
      assertDeepEqual(
        reservationEvents,
        ["first:lock"],
        "contended follower must not shorten the winner reservation before the lock is released",
      );
    } else {
      await waitForBarrier(
        secondLocked.promise,
        "Trip Pass checkout second request did not acquire the family reservation lock",
      );
      assertDeepEqual(
        reservationEvents,
        ["second:lock"],
        "second-winner checkout must read DB time only after entering the lock-held section",
      );
      firstMayAttemptLock.resolve();
      const firstPid = await waitForBarrier(
        firstLockStarted.promise,
        "Trip Pass checkout first request did not attempt the family reservation lock",
      );
      await waitForBackendLock(
        observer,
        firstPid,
        "Trip Pass checkout first request did not wait on the second request family reservation lock",
      );
      assertDeepEqual(
        reservationEvents,
        ["second:lock"],
        "contended first request must not read DB time while waiting for the winner lock",
      );
    }

    winnerRelease.resolve();
    const [firstResult, secondResult] = await Promise.all([firstCheckout, secondCheckout]);

    assertCheckoutResultStatus(firstResult, winner === "first" ? "started" : "reused");
    assertCheckoutResultStatus(secondResult, winner === "second" ? "started" : "reused");

    assertEqual(
      firstResult.orderId,
      winnerOrderId,
      "first checkout request must resolve to the actual lock winner order",
    );
    assertEqual(
      secondResult.orderId,
      winnerOrderId,
      "second checkout request must resolve to the actual lock winner order",
    );
    assertEqual(
      firstResult.checkoutUrl,
      secondResult.checkoutUrl,
      "parallel duplicate checkouts must converge on one checkout URL",
    );

    const orderRows = await visibilityClient.query<{
      count: string;
      idempotency_keys: string[];
    }>(
      `
        select count(*)::text as count,
               array_agg(distinct checkout_idempotency_key order by checkout_idempotency_key) as idempotency_keys
        from trip_pass_orders
        where user_id = $1
          and product_family = 'siargao_trip_pass'
          and status in ('pending', 'checkout_created')
      `,
      [userId],
    );
    assertEqual(
      orderRows.rows[0]?.count,
      "1",
      "parallel checkouts must leave exactly one effective pending Trip Pass order",
    );
    assertDeepEqual(
      orderRows.rows[0]?.idempotency_keys,
      [`trip_pass_checkout:${winnerOrderId}`],
      "parallel checkouts must share the winner idempotency key",
    );
    assertDeepEqual(
      checkoutClient.calls.map((call) => call.orderId),
      [winnerOrderId, winnerOrderId],
      "Stripe adapter calls must be made only for the committed reusable order",
    );
  } finally {
    firstMayAttemptLock.resolve();
    winnerRelease.resolve();
    await Promise.allSettled([
      firstClient.end(),
      secondClient.end(),
      observer.end(),
      visibilityClient.end(),
    ]);
  }
}

async function runTripPassCheckoutRollbackRaceRegression(harness: PostgresHarness) {
  const userId = "user_checkout_race_rollback";
  const rolledBackOrderId = "order_checkout_race_rollback_discarded";
  const winnerOrderId = "order_checkout_race_rollback_winner";
  const holderRelease = deferred<void>();
  const holderLocked = deferred<number>();
  const followerLockStarted = deferred<number>();
  const observer = harness.createClient();
  const visibilityClient = harness.createQueryClient();
  const checkoutClient = createRaceCheckoutClient(visibilityClient);
  const failingClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    afterFamilyLock: async (pid) => {
      holderLocked.resolve(pid);
      await holderRelease.promise;
    },
    afterTripPassOrderInsert: async () => {
      throw new Error("force checkout reservation rollback");
    },
  });
  const followerClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    beforeFamilyLock: async (pid) => {
      followerLockStarted.resolve(pid);
    },
  });

  try {
    await insertIntegrationUser(visibilityClient, userId);

    const failedCheckoutError = startTripPassCheckout(
      { appUrl: "https://siargao.test", userId },
      {
        checkoutClient,
        createId: () => rolledBackOrderId,
        db: failingClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).then(
      () => {
        throw new Error("Expected injected reservation checkout to roll back.");
      },
      (error: unknown) => {
        holderLocked.reject(error);
        return error;
      },
    );
    await waitForBarrier(
      holderLocked.promise,
      "Trip Pass rollback checkout did not acquire the family reservation lock",
    );

    const winningCheckout = startTripPassCheckout(
      { appUrl: "https://siargao.test", userId },
      {
        checkoutClient,
        createId: () => winnerOrderId,
        db: followerClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).catch((error: unknown) => {
      followerLockStarted.reject(error);
      throw error;
    });

    const followerPid = await waitForBarrier(
      followerLockStarted.promise,
      "Trip Pass rollback follower did not attempt the family reservation lock",
    );
    await waitForBackendLock(
      observer,
      followerPid,
      "Trip Pass checkout follower did not wait for a rolling-back reservation",
    );

    holderRelease.resolve();
    const failedError = await failedCheckoutError;
    if (
      !(failedError instanceof Error) ||
      !failedError.message.includes("force checkout reservation rollback")
    ) {
      throw failedError;
    }
    const result = await winningCheckout;
    assertCheckoutResultStatus(result, "started");
    assertEqual(
      result.orderId,
      winnerOrderId,
      "successful checkout after rollback must create its own reservation",
    );

    const orderRows = await visibilityClient.query<{
      count: string;
      idempotency_keys: string[];
    }>(
      `
        select count(*)::text as count,
               array_agg(distinct checkout_idempotency_key order by checkout_idempotency_key) as idempotency_keys
        from trip_pass_orders
        where user_id = $1
          and product_family = 'siargao_trip_pass'
          and status in ('pending', 'checkout_created')
      `,
      [userId],
    );
    assertEqual(
      orderRows.rows[0]?.count,
      "1",
      "rolled-back reservations must not leave an extra effective pending order",
    );
    assertDeepEqual(
      orderRows.rows[0]?.idempotency_keys,
      [`trip_pass_checkout:${winnerOrderId}`],
      "rollback follower must use only the committed winner idempotency key",
    );
    assertDeepEqual(
      checkoutClient.calls.map((call) => call.orderId),
      [winnerOrderId],
      "Stripe must not be called for a rolled-back local reservation",
    );
  } finally {
    holderRelease.resolve();
    await Promise.allSettled([
      failingClient.end(),
      followerClient.end(),
      observer.end(),
      visibilityClient.end(),
    ]);
  }
}

async function runStripeInboxRealPostgresRegression(harness: PostgresHarness) {
  await runStripeInboxReceiptConflictRegression(harness);
  await runStripeInboxRollbackAndReplayRegression(harness);
  await runStripeInboxTripPassCrashBoundaryRegression(harness);
  await runStripeInboxClaimLeaseRegression(harness);
}

async function runStripeInboxReceiptConflictRegression(harness: PostgresHarness) {
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  const observer = harness.createQueryClient();
  try {
    const event = stripeInboxCheckoutSessionEvent("evt_inbox_concurrent_receipt", "order_inbox");
    const [firstResult, secondResult] = await Promise.all([
      receiveStripeWebhookEvent(event, {
        db: first,
        now: new Date("2026-08-07T01:00:00.000Z"),
      }),
      receiveStripeWebhookEvent(event, {
        db: second,
        now: new Date("2026-08-07T01:00:00.000Z"),
      }),
    ]);
    assertDeepEqual(
      [firstResult.status, secondResult.status].toSorted(),
      ["duplicate", "received"],
      "parallel receipt of the same Stripe event must commit once and replay once",
    );

    const rows = await observer.query<{ count: string }>(
      "select count(*)::text as count from trip_pass_stripe_events where stripe_event_id = $1",
      ["evt_inbox_concurrent_receipt"],
    );
    assertEqual(rows.rows[0]?.count, "1", "parallel receipt must leave one durable inbox row");
    await observer.query(
      "update trip_pass_stripe_events set status = 'applied' where stripe_event_id = $1",
      ["evt_inbox_concurrent_receipt"],
    );
  } finally {
    await Promise.allSettled([first.end(), second.end(), observer.end()]);
  }
}

async function runStripeInboxRollbackAndReplayRegression(harness: PostgresHarness) {
  const client = harness.createQueryClient();
  try {
    await client.query(`
      create table integration_stripe_inbox_application_probe (
        stripe_event_id text primary key,
        note text not null
      )
    `);

    const firstApplication = await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_rollback_replay", "order_inbox_replay"),
      {
        db: client,
        now: new Date("2099-01-01T00:00:00.000Z"),
        applyEvent: async (event, options) => {
          assertEqual(
            options.now.getUTCFullYear() < 2099,
            true,
            "application callback time must come from the database, not a skewed process clock",
          );
          const visibleReceipt = await options.db.query<{ status: string }>(
            "select status from trip_pass_stripe_events where stripe_event_id = $1",
            [event.id],
          );
          assertEqual(
            visibleReceipt.rows[0]?.status,
            "pending",
            "application must start only after a committed pending inbox receipt is visible",
          );
          await options.db.query(
            `
              insert into integration_stripe_inbox_application_probe (stripe_event_id, note)
              values ($1, 'rolled-back')
            `,
            [event.id],
          );
          throw new Error("force inbox application rollback");
        },
      },
    );
    assertEqual(
      firstApplication.status,
      "pending",
      "application exception must keep the inbox row retryable",
    );

    const rolledBackProbe = await client.query<{ count: string }>(
      "select count(*)::text as count from integration_stripe_inbox_application_probe",
    );
    assertEqual(
      rolledBackProbe.rows[0]?.count,
      "0",
      "application writes inside the inbox transaction must roll back on failure",
    );
    const pendingRow = await client.query<{
      attempt_count: number;
      retry_uses_database_time: boolean;
      sanitized_error_class: string | null;
      status: string;
    }>(
      `
        select status,
               attempt_count,
               sanitized_error_class,
               next_attempt_at > now()
                 and next_attempt_at <= now() + interval '3 seconds'
                 and next_attempt_at < '2099-01-01T00:00:00.000Z'::timestamptz
                 as retry_uses_database_time
        from trip_pass_stripe_events
        where stripe_event_id = $1
      `,
      ["evt_inbox_rollback_replay"],
    );
    assertEqual(
      pendingRow.rows[0]?.status,
      "pending",
      "failed application must keep the inbox row pending",
    );
    assertEqual(
      pendingRow.rows[0]?.attempt_count,
      1,
      "failed application must increment the retry attempt count",
    );
    assertEqual(
      pendingRow.rows[0]?.sanitized_error_class,
      "Error",
      "failed application must store only a sanitized retry error class",
    );
    assertEqual(
      pendingRow.rows[0]?.retry_uses_database_time,
      true,
      "retry backoff must be anchored to database time rather than skewed caller time",
    );

    const replay = await applyStripeInboxEvent("stripe_event_evt_inbox_rollback_replay", {
      db: client,
      now: new Date("2099-01-01T00:00:00.000Z"),
      applyEvent: async (event, options) => {
        assertEqual(
          options.now.getUTCFullYear() < 2099,
          true,
          "replay application callback time must come from the database",
        );
        await options.db.query(
          `
            insert into integration_stripe_inbox_application_probe (stripe_event_id, note)
            values ($1, 'replayed')
          `,
          [event.id],
        );
        return { status: "applied", action: "activated" };
      },
    });
    assertEqual(replay.status, "applied", "retry replay must apply the pending inbox row");

    const appliedRow = await client.query<{
      applied_at: Date | string | null;
      count: string;
      status: string;
    }>(
      `
        select e.status,
               e.applied_at,
               count(p.stripe_event_id)::text as count
        from trip_pass_stripe_events e
        left join integration_stripe_inbox_application_probe p
          on p.stripe_event_id = e.stripe_event_id
        where e.stripe_event_id = $1
        group by e.status, e.applied_at
      `,
      ["evt_inbox_rollback_replay"],
    );
    assertEqual(appliedRow.rows[0]?.status, "applied", "replayed inbox row must be marked applied");
    assertEqual(
      Boolean(appliedRow.rows[0]?.applied_at),
      true,
      "replayed inbox row must record an applied timestamp",
    );
    assertEqual(
      appliedRow.rows[0]?.count,
      "1",
      "replay must commit exactly one application side effect",
    );
  } finally {
    await client.end();
  }
}

async function runStripeInboxTripPassCrashBoundaryRegression(harness: PostgresHarness) {
  const crashBoundaries = [
    {
      name: "order-provider-link",
      pattern:
        /update\s+trip_pass_orders[\s\S]*set\s+stripe_checkout_session_id\s*=\s*\$2,[\s\S]*stripe_payment_intent_id\s*=\s*\$3/i,
    },
    { name: "pass-insert", pattern: /insert\s+into\s+trip_passes\b/i },
    { name: "grant-insert", pattern: /insert\s+into\s+trip_pass_grants\b/i },
    { name: "meter-insert", pattern: /insert\s+into\s+trip_usage_meters\b/i },
    {
      name: "order-paid-update",
      pattern: /update\s+trip_pass_orders[\s\S]*set\s+status\s*=\s*'paid'/i,
    },
    {
      name: "inbox-applied-transition",
      pattern: /update\s+trip_pass_stripe_events[\s\S]*set\s+status\s*=\s*'applied'/i,
    },
  ] as const;
  const client = harness.createQueryClient();
  try {
    for (const boundary of crashBoundaries) {
      const suffix = boundary.name.replaceAll("-", "_");
      const userId = `user_inbox_crash_${suffix}`;
      const orderId = `order_inbox_crash_${suffix}`;
      const eventId = `evt_inbox_crash_${suffix}`;
      await insertStripeInboxCheckoutOrder(client, { eventId, orderId, userId });

      const failure = failAfterSuccessfulQuery(client, boundary.pattern);
      const failedApplication = await receiveStripeWebhookEvent(
        stripeInboxCheckoutSessionEvent(eventId, orderId),
        {
          db: failure.db,
          applyEvent: (event, options) =>
            applyTripPassStripeEvent(event, { db: options.db, now: options.now }),
        },
      );
      assertEqual(
        failure.wasInjected(),
        true,
        `${boundary.name} crash boundary must execute against the production SQL write (${JSON.stringify(failedApplication)})`,
      );
      assertEqual(
        failedApplication.status,
        "pending",
        `${boundary.name} crash must leave the durable receipt pending`,
      );
      await assertStripeInboxTripPassTarget(client, {
        eventId,
        expectedInboxStatus: "pending",
        expectedOrderStatus: "checkout_created",
        expectedPaymentIntentId: null,
        expectedTargetCount: "0",
        orderId,
      });

      const replay = await applyStripeInboxEvent(`stripe_event_${eventId}`, {
        db: client,
        applyEvent: (event, options) =>
          applyTripPassStripeEvent(event, { db: options.db, now: options.now }),
      });
      assertEqual(replay.status, "applied", `${boundary.name} replay must apply the actual target`);
      await assertStripeInboxTripPassTarget(client, {
        eventId,
        expectedInboxStatus: "applied",
        expectedOrderStatus: "paid",
        expectedPaymentIntentId: `pi_${orderId}`,
        expectedTargetCount: "1",
        orderId,
      });

      const duplicateReplay = await applyStripeInboxEvent(`stripe_event_${eventId}`, {
        db: client,
        applyEvent: (event, options) =>
          applyTripPassStripeEvent(event, { db: options.db, now: options.now }),
      });
      assertEqual(
        duplicateReplay.status,
        "applied",
        `${boundary.name} applied replay must remain a side-effect-free success`,
      );
      await assertStripeInboxTripPassTarget(client, {
        eventId,
        expectedInboxStatus: "applied",
        expectedOrderStatus: "paid",
        expectedPaymentIntentId: `pi_${orderId}`,
        expectedTargetCount: "1",
        orderId,
      });
    }
  } finally {
    await client.end();
  }
}

function failAfterSuccessfulQuery(db: DatabaseQueryClient, pattern: RegExp) {
  let injected = false;
  const wrap = (client: DatabaseQueryClient): DatabaseQueryClient => ({
    inTransaction: client.inTransaction,
    async query<T>(query: string, params: unknown[] = []) {
      const result = await client.query<T>(query, params);
      if (!injected && pattern.test(query)) {
        injected = true;
        throw new Error("injected production Trip Pass application crash");
      }
      return result;
    },
    ...(client.transaction
      ? {
          transaction: async <T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) =>
            client.transaction?.((transaction) => callback(wrap(transaction))) as Promise<T>,
        }
      : {}),
  });

  return { db: wrap(db), wasInjected: () => injected };
}

async function insertStripeInboxCheckoutOrder(
  db: DatabaseQueryClient,
  input: { eventId: string; orderId: string; userId: string },
) {
  await insertIntegrationUser(db, input.userId);
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
        amount_total_minor,
        currency,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        metadata_json
      )
      values ($1, $2, $3, 'checkout_created', $4, $5, 'price_trip_pass', $6, $7, $8, $9, '{}'::jsonb)
    `,
    [
      input.orderId,
      input.userId,
      `${input.userId}@example.com`,
      tripPassCheckoutProductSnapshot.productCode,
      tripPassCheckoutProductSnapshot.productVersion,
      tripPassCheckoutProductSnapshot.amountTotalMinor,
      tripPassCheckoutProductSnapshot.currency,
      `trip_pass_checkout:${input.eventId}`,
      `cs_${input.orderId}`,
    ],
  );
}

async function assertStripeInboxTripPassTarget(
  db: DatabaseQueryClient,
  input: {
    eventId: string;
    expectedInboxStatus: "applied" | "pending";
    expectedOrderStatus: "checkout_created" | "paid";
    expectedPaymentIntentId: string | null;
    expectedTargetCount: string;
    orderId: string;
  },
) {
  const order = await db.query<{ status: string; stripe_payment_intent_id: string | null }>(
    `select status, stripe_payment_intent_id from trip_pass_orders where id = $1`,
    [input.orderId],
  );
  assertEqual(
    order.rows[0]?.status,
    input.expectedOrderStatus,
    `${input.eventId} Order status must match the atomic target`,
  );
  assertEqual(
    order.rows[0]?.stripe_payment_intent_id ?? null,
    input.expectedPaymentIntentId,
    `${input.eventId} provider link must match the atomic target`,
  );

  const target = await db.query<{
    grants: string;
    meters: string;
    passes: string;
  }>(
    `
      select
        (select count(*)::text from trip_passes where stripe_event_id = $1) as passes,
        (select count(*)::text from trip_pass_grants where source_event_id = $1) as grants,
        (
          select count(*)::text
          from trip_usage_meters meter
          join trip_passes pass on pass.id = meter.trip_pass_id
          where pass.stripe_event_id = $1 and meter.meter_type = 'chat_message'
        ) as meters
    `,
    [input.eventId],
  );
  assertEqual(
    target.rows[0]?.passes,
    input.expectedTargetCount,
    `${input.eventId} must have the expected Pass count`,
  );
  assertEqual(
    target.rows[0]?.grants,
    input.expectedTargetCount,
    `${input.eventId} must have the expected Grant count`,
  );
  assertEqual(
    target.rows[0]?.meters,
    input.expectedTargetCount,
    `${input.eventId} must have the expected primary Meter count`,
  );

  const inbox = await db.query<{ status: string }>(
    "select status from trip_pass_stripe_events where stripe_event_id = $1",
    [input.eventId],
  );
  assertEqual(
    inbox.rows[0]?.status,
    input.expectedInboxStatus,
    `${input.eventId} inbox state must commit atomically with its target`,
  );
}

async function runStripeInboxClaimLeaseRegression(harness: PostgresHarness) {
  const holder = harness.createClient();
  const setup = harness.createQueryClient();
  const claimant = harness.createQueryClient();
  const competingClaimant = harness.createQueryClient();
  const leaseMs = 60_000;
  const now = new Date("2026-08-07T01:03:00.000Z");
  let releaseHolder!: () => void;
  const holderRelease = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  try {
    await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_claim_locked", "order_inbox_claim_locked"),
      { db: setup, now },
    );
    await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_claim_skip", "order_inbox_claim_skip"),
      { db: setup, now },
    );

    const holderReady = deferred<void>();
    const holderTransaction = holder.begin(async (transaction) => {
      await transaction`
        select id
        from trip_pass_stripe_events
        where stripe_event_id = 'evt_inbox_claim_locked'
        for update
      `;
      holderReady.resolve();
      await holderRelease;
    });
    await waitForBarrier(holderReady.promise, "Stripe inbox claim holder did not lock the due row");

    const skipLockedClaim = await claimPendingStripeInboxEvents({
      claimToken: "claim_skip_locked",
      db: claimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      skipLockedClaim,
      ["stripe_event_evt_inbox_claim_skip"],
      "claim workers must skip a locked due row and claim another due row",
    );
    const skippedClaimTime = await setup.query<{
      locked_claim_token: string | null;
      skip_claim_uses_database_time: boolean;
    }>(
      `
        select
          max(case when stripe_event_id = 'evt_inbox_claim_locked' then claim_token end)
            as locked_claim_token,
          bool_or(
            stripe_event_id = 'evt_inbox_claim_skip'
            and claim_expires_at > now()
            and claim_expires_at <= now() + interval '61 seconds'
            and claim_expires_at < '2099-01-01T00:00:00.000Z'::timestamptz
          ) as skip_claim_uses_database_time
        from trip_pass_stripe_events
        where stripe_event_id in ('evt_inbox_claim_locked', 'evt_inbox_claim_skip')
      `,
    );
    assertEqual(
      skippedClaimTime.rows[0]?.locked_claim_token,
      null,
      "SKIP LOCKED claim must not mutate the row held by another transaction",
    );
    assertEqual(
      skippedClaimTime.rows[0]?.skip_claim_uses_database_time,
      true,
      "claim lease expiry must be anchored to database time rather than skewed caller time",
    );

    releaseHolder();
    await holderTransaction;

    const firstClaim = await claimPendingStripeInboxEvents({
      claimToken: "claim_first",
      db: claimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      firstClaim,
      ["stripe_event_evt_inbox_claim_locked"],
      "released locked row must be claimable after the holder transaction commits",
    );

    const immediateReclaim = await claimPendingStripeInboxEvents({
      claimToken: "claim_locked_immediate_reclaim",
      db: competingClaimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      immediateReclaim,
      [],
      "claimed inbox rows must not be reclaimed before the crash lease expires",
    );

    const afterCrashLease = await claimPendingStripeInboxEvents({
      claimToken: "claim_locked_after_crash_lease",
      db: competingClaimant,
      leaseMs,
      limit: 1,
    });
    assertDeepEqual(
      afterCrashLease,
      [],
      "skewed caller time must not make a database-time crash lease expire early",
    );
    await setup.query(
      `
        update trip_pass_stripe_events
        set claim_expires_at = now() - interval '1 millisecond'
        where stripe_event_id = 'evt_inbox_claim_locked'
      `,
    );
    const afterDatabaseLeaseExpiry = await claimPendingStripeInboxEvents({
      claimToken: "claim_locked_after_database_lease",
      db: competingClaimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      afterDatabaseLeaseExpiry,
      ["stripe_event_evt_inbox_claim_locked"],
      "database-expired crash leases must make pending inbox rows reclaimable",
    );

    await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_claim_rollback", "order_inbox_claim_rollback"),
      { db: setup, now },
    );
    await expectRejects(
      claimant.transaction(async (transaction) => {
        const rolledBackClaim = await claimPendingStripeInboxEvents({
          claimToken: "claim_rollback",
          db: transaction,
          leaseMs,
          limit: 1,
          now: new Date("2099-01-01T00:00:00.000Z"),
        });
        assertDeepEqual(
          rolledBackClaim,
          ["stripe_event_evt_inbox_claim_rollback"],
          "claim rollback fixture must acquire its row before rollback",
        );
        throw new Error("force inbox claim rollback");
      }),
      "force inbox claim rollback",
    );
    const afterClaimRollback = await claimPendingStripeInboxEvents({
      claimToken: "claim_after_rollback",
      db: competingClaimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      afterClaimRollback,
      ["stripe_event_evt_inbox_claim_rollback"],
      "rolled-back claims must not leave a durable lease",
    );

    await setup.query(`
      create table if not exists integration_stripe_inbox_claim_fence_probe (
        stripe_event_id text primary key,
        claim_token text not null
      )
    `);
    await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_claim_takeover", "order_inbox_claim_takeover"),
      { db: setup, now },
    );
    const oldClaim = await claimPendingStripeInboxEvents({
      claimToken: "claim_takeover_old",
      db: claimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      oldClaim,
      ["stripe_event_evt_inbox_claim_takeover"],
      "lease takeover fixture must start with an old claim",
    );
    await setup.query(
      `
        update trip_pass_stripe_events
        set claim_expires_at = now() - interval '1 millisecond'
        where stripe_event_id = 'evt_inbox_claim_takeover'
      `,
    );
    const newClaim = await claimPendingStripeInboxEvents({
      claimToken: "claim_takeover_new",
      db: competingClaimant,
      leaseMs,
      limit: 1,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assertDeepEqual(
      newClaim,
      ["stripe_event_evt_inbox_claim_takeover"],
      "new claimant must take over only after database-time lease expiry",
    );
    const staleWorker = await applyStripeInboxEvent("stripe_event_evt_inbox_claim_takeover", {
      claimToken: "claim_takeover_old",
      db: claimant,
      applyEvent: async () => {
        throw new Error("stale claim token must not reach application");
      },
    });
    assertEqual(
      staleWorker.status,
      "pending",
      "expired old worker must not apply after another worker takes over its lease",
    );
    const newWorker = await applyStripeInboxEvent("stripe_event_evt_inbox_claim_takeover", {
      claimToken: "claim_takeover_new",
      db: competingClaimant,
      applyEvent: async (event, options) => {
        await options.db.query(
          `
            insert into integration_stripe_inbox_claim_fence_probe (stripe_event_id, claim_token)
            values ($1, 'claim_takeover_new')
          `,
          [event.id],
        );
        return { status: "applied", action: "activated" };
      },
    });
    assertEqual(
      newWorker.status,
      "applied",
      "current claimant must be able to apply the takeover row",
    );
    const takeoverProbe = await setup.query<{ count: string; status: string }>(
      `
        select e.status, count(p.stripe_event_id)::text as count
        from trip_pass_stripe_events e
        left join integration_stripe_inbox_claim_fence_probe p
          on p.stripe_event_id = e.stripe_event_id
        where e.stripe_event_id = 'evt_inbox_claim_takeover'
        group by e.status
      `,
    );
    assertEqual(
      takeoverProbe.rows[0]?.status,
      "applied",
      "takeover application must mark the inbox row applied",
    );
    assertEqual(
      takeoverProbe.rows[0]?.count,
      "1",
      "only the current claim token may commit application side effects",
    );

    await receiveStripeWebhookEvent(
      stripeInboxCheckoutSessionEvent("evt_inbox_claim_race", "order_inbox_claim_race"),
      { db: setup, now },
    );
    const [firstRaceClaim, secondRaceClaim] = await Promise.all([
      claimPendingStripeInboxEvents({
        claimToken: "claim_race_first",
        db: claimant,
        leaseMs,
        limit: 1,
        now: new Date("2099-01-01T00:00:00.000Z"),
      }),
      claimPendingStripeInboxEvents({
        claimToken: "claim_race_second",
        db: competingClaimant,
        leaseMs,
        limit: 1,
        now: new Date("2099-01-01T00:00:00.000Z"),
      }),
    ]);
    assertEqual(
      [...firstRaceClaim, ...secondRaceClaim].filter(
        (id) => id === "stripe_event_evt_inbox_claim_race",
      ).length,
      1,
      "parallel claimers must not both claim the same pending inbox row",
    );
  } finally {
    releaseHolder();
    await Promise.allSettled([holder.end(), setup.end(), claimant.end(), competingClaimant.end()]);
  }
}

function createControlledCheckoutQueryClient(
  client: ReturnType<PostgresHarness["createQueryClient"]>,
  hooks: {
    afterDatabaseNow?: (pid: number) => Promise<void>;
    afterFamilyLock?: (pid: number) => Promise<void>;
    afterTripPassOrderInsert?: () => Promise<void>;
    beforeFamilyLock?: (pid: number) => Promise<void>;
  },
) {
  return {
    ...client,
    async transaction<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>) {
      return client.transaction(async (transaction) => {
        const controlledTransaction: DatabaseQueryClient = {
          async query<T>(query: string, params: unknown[] = []) {
            if (/\bselect\s+now\(\)\s+as\s+database_now\b/i.test(query)) {
              const pidRows = await transaction.query<{ pid: number }>(
                "select pg_backend_pid() as pid",
              );
              const pid = Number(pidRows.rows[0]?.pid);
              if (!Number.isInteger(pid)) {
                throw new Error("Trip Pass checkout DB-time backend pid was not available.");
              }
              const result = await transaction.query<T>(query, params);
              await hooks.afterDatabaseNow?.(pid);
              return result;
            }
            if (!query.includes("pg_advisory_xact_lock")) {
              const result = await transaction.query<T>(query, params);
              if (/\binsert\s+into\s+trip_pass_orders\b/i.test(query)) {
                await hooks.afterTripPassOrderInsert?.();
              }
              return result;
            }

            const pidRows = await transaction.query<{ pid: number }>(
              "select pg_backend_pid() as pid",
            );
            const pid = Number(pidRows.rows[0]?.pid);
            if (!Number.isInteger(pid)) {
              throw new Error("Trip Pass checkout lock backend pid was not available.");
            }

            await hooks.beforeFamilyLock?.(pid);
            const result = await transaction.query<T>(query, params);
            await hooks.afterFamilyLock?.(pid);
            return result;
          },
        };
        return callback(controlledTransaction);
      });
    },
  };
}

function createRaceCheckoutClient(
  visibilityClient: ReturnType<PostgresHarness["createQueryClient"]>,
) {
  const sessionsByIdempotencyKey = new Map<string, TripPassCheckoutSessionSummary>();
  const calls: Array<{ idempotencyKey: string; orderId: string }> = [];
  const client: TripPassCheckoutClient & { calls: typeof calls } = {
    calls,
    async createCheckoutSession(params, options) {
      const orderId = String(params.client_reference_id);
      const visibleOrder = await visibilityClient.query<{
        checkout_session_expires_at: Date | string | null;
        created_at: Date | string;
        status: string;
      }>(
        `
          select status, created_at, checkout_session_expires_at
          from trip_pass_orders
          where id = $1
            and product_family = 'siargao_trip_pass'
            and status in ('pending', 'checkout_created')
        `,
        [orderId],
      );
      if (!visibleOrder.rows[0]) {
        throw new Error("Stripe adapter started before the local checkout reservation committed.");
      }
      if (!visibleOrder.rows[0].checkout_session_expires_at) {
        throw new Error("Local checkout reservation committed without an expiry.");
      }
      const reservationEpochSeconds = Math.floor(
        dateFromDatabaseValue(visibleOrder.rows[0].created_at).getTime() / 1_000,
      );
      const expectedExpiresAt = reservationEpochSeconds + 30 * 60;
      assertEqual(
        params.expires_at,
        expectedExpiresAt,
        "Stripe expires_at must derive from committed DB reservation time",
      );
      assertEqual(
        dateFromDatabaseValue(visibleOrder.rows[0].checkout_session_expires_at).getTime(),
        expectedExpiresAt * 1_000,
        "Committed checkout reservation expiry must be exactly thirty minutes after DB time",
      );

      calls.push({ idempotencyKey: options.idempotencyKey, orderId });
      const cached = sessionsByIdempotencyKey.get(options.idempotencyKey);
      if (cached) {
        return cached;
      }

      const session: TripPassCheckoutSessionSummary = {
        id: `cs_${orderId}`,
        url: `https://checkout.stripe.test/${orderId}`,
        clientReferenceId: orderId,
        metadata: stringMetadata(params.metadata),
        amountTotalMinor: tripPassCheckoutProductSnapshot.amountTotalMinor,
        currency: tripPassCheckoutProductSnapshot.currency,
        expiresAt: params.expires_at ? new Date(Number(params.expires_at) * 1000) : null,
        mode: "payment",
        paymentStatus: "unpaid",
        priceId: priceIdFromCheckoutParams(params),
        status: "open",
        termsConsentCollected: false,
      };
      sessionsByIdempotencyKey.set(options.idempotencyKey, session);
      return session;
    },
    async expireCheckoutSession(sessionId) {
      return {
        id: sessionId,
        url: "",
        clientReferenceId: null,
        metadata: null,
        amountTotalMinor: tripPassCheckoutProductSnapshot.amountTotalMinor,
        currency: tripPassCheckoutProductSnapshot.currency,
        expiresAt: null,
        mode: "payment",
        paymentStatus: "unpaid",
        priceId: "price_trip_pass",
        status: "expired",
        termsConsentCollected: false,
      };
    },
  };
  return client;
}

async function insertIntegrationUser(db: DatabaseQueryClient, userId: string) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
}

async function waitForBackendLock(
  observer: PostgresHarness["createClient"] extends () => infer T ? T : never,
  pid: number,
  failureMessage: string,
) {
  await waitUntil(async () => {
    const rows = (await observer.unsafe(
      `
        select wait_event_type
        from pg_stat_activity
        where pid = $1
      `,
      [pid],
    )) as { wait_event_type: string | null }[];
    return rows[0]?.wait_event_type === "Lock";
  }, failureMessage);
}

async function waitForBarrier<T>(promise: Promise<T>, failureMessage: string) {
  return withTimeout(promise, 5_000, failureMessage);
}

function assertCheckoutResultStatus(
  result: TripPassCheckoutResult,
  status: SuccessfulTripPassCheckoutResult["status"],
): asserts result is SuccessfulTripPassCheckoutResult {
  if (result.status !== status) {
    throw new Error(`Expected checkout status ${status}, got ${result.status}.`);
  }
}

function stringMetadata(metadata: CheckoutCreateParams["metadata"] | undefined) {
  if (!metadata) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}

function priceIdFromCheckoutParams(params: CheckoutCreateParams) {
  const firstLineItem = params.line_items?.[0];
  const price = firstLineItem?.price;
  return typeof price === "string" ? price : null;
}

function dateFromDatabaseValue(value: Date | string) {
  return value instanceof Date ? value : new Date(String(value));
}

function stripeInboxCheckoutSessionEvent(eventId: string, orderId: string) {
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 1_786_080_000,
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
        customer_email: "integration-traveler@example.com",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  } as unknown as Stripe.Event;
}

async function waitUntil(check: () => Promise<boolean>, failureMessage: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await sleep(25);
  }
  throw new Error(failureMessage);
}

async function expectRejects(promise: Promise<unknown>, message: string) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected promise to reject with ${message}.`);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertNotEqual<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    throw new Error(`${message}. Both values were ${String(actual)}.`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
    );
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
