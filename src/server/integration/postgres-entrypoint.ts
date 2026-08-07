import type { DatabaseQueryClient } from "@/server/db/query-client";
import { withRealPostgresHarness } from "@/server/integration/postgres-harness";
import { startTripPassCheckout, type TripPassCheckoutResult } from "@/server/trip-pass/commerce";
import type {
  TripPassCheckoutClient,
  TripPassCheckoutSessionSummary,
} from "@/server/trip-pass/stripe-adapter";
import { tripPassCheckoutProductSnapshot } from "@/server/trip-pass/stripe-adapter";

type PostgresHarness = Parameters<Parameters<typeof withRealPostgresHarness>[0]>[0];
type CheckoutCreateParams = Parameters<TripPassCheckoutClient["createCheckoutSession"]>[0];
type SuccessfulTripPassCheckoutResult = Extract<TripPassCheckoutResult, { checkoutUrl: string }>;

const tripPassCheckoutRaceEnv = {
  TRIP_PASS_CHECKOUT_MODE: "on",
  STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass",
} as const;

await runConcurrentHarnessIsolationRegression();

await withRealPostgresHarness(async (harness) => {
  const migration = await harness.migrate();
  await runRollbackRegression(harness);
  await runDatabaseTimeRegression(harness);
  await runUniqueConflictRegression(harness);
  await runFailedTransactionRecoveryRegression(harness);
  await runAdvisoryLockRegression(harness);
  await runTripPassCheckoutRaceRegression(harness);

  console.log(
    JSON.stringify(
      {
        checked: "postgres-integration-semantic-suite",
        databaseUrl: harness.databaseUrl,
        migration,
        namespace: harness.namespace,
      },
      null,
      2,
    ),
  );
});

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
  const winnerOrderId = `order_checkout_race_${winner}_winner`;
  const loserOrderId = `order_checkout_race_${winner}_loser`;
  const holderRelease = deferred<void>();
  const holderLocked = deferred<number>();
  const followerLockStarted = deferred<number>();
  const observer = harness.createClient();
  const visibilityClient = harness.createQueryClient();
  const checkoutClient = createRaceCheckoutClient(visibilityClient);
  const holderClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    afterFamilyLock: async (pid) => {
      holderLocked.resolve(pid);
      await holderRelease.promise;
    },
  });
  const followerClient = createControlledCheckoutQueryClient(harness.createQueryClient(), {
    beforeFamilyLock: async (pid) => {
      followerLockStarted.resolve(pid);
    },
  });

  try {
    await insertIntegrationUser(visibilityClient, userId);

    const holderCheckout = startTripPassCheckout(
      { appUrl: "https://siargao.test", email: `${userId}@example.com`, userId },
      {
        checkoutClient,
        createId: () => winnerOrderId,
        db: holderClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).catch((error: unknown) => {
      holderLocked.reject(error);
      throw error;
    });
    await holderLocked.promise;

    const followerCheckout = startTripPassCheckout(
      { appUrl: "https://siargao.test", email: `${userId}@example.com`, userId },
      {
        checkoutClient,
        createId: () => loserOrderId,
        db: followerClient,
        env: tripPassCheckoutRaceEnv,
      },
    ).catch((error: unknown) => {
      followerLockStarted.reject(error);
      throw error;
    });

    const followerPid = await followerLockStarted.promise;
    await waitForBackendLock(
      observer,
      followerPid,
      "Trip Pass checkout follower did not wait on the family reservation lock",
    );

    holderRelease.resolve();
    const [holderResult, followerResult] = await Promise.all([holderCheckout, followerCheckout]);

    assertCheckoutResultStatus(holderResult, "started");
    assertCheckoutResultStatus(followerResult, "reused");
    const firstResult = winner === "first" ? holderResult : followerResult;
    const secondResult = winner === "first" ? followerResult : holderResult;

    assertEqual(
      firstResult.orderId,
      winnerOrderId,
      "winner request must expose the committed reservation order",
    );
    assertEqual(
      secondResult.orderId,
      winnerOrderId,
      "follower request must reuse the winner reservation order",
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
    holderRelease.resolve();
    await Promise.allSettled([
      holderClient.end(),
      followerClient.end(),
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
    await holderLocked.promise;

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

    const followerPid = await followerLockStarted.promise;
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

function createControlledCheckoutQueryClient(
  client: ReturnType<PostgresHarness["createQueryClient"]>,
  hooks: {
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
      const visibleOrder = await visibilityClient.query<{ status: string }>(
        `
          select status
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
