import type { RealPostgresHarness } from "@/server/integration/postgres-harness";
import {
  type AccountClosurePolicy,
  beginAccountClosure,
  runClosureCleanupBatch,
} from "@/server/privacy/account-closure";

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
}

async function runPostClosureMutationMatrix(harness: RealPostgresHarness) {
  const client = harness.createQueryClient();
  const userId = "closure_mutation_matrix";
  try {
    await seedUser(client, userId);
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
    for (const mutation of mutations) {
      await expectRejects(mutation(), "account is terminally closed");
    }
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
    const lateWrite = writer.query(
      "insert into user_profiles (user_id, display_name) values ($1, 'late writer')",
      ["closure_race_first"],
    );
    await observeBlockedBackend(observer, writerPid);
    releaseClosure.resolve();
    await closure;
    await expectRejects(lateWrite, "account is terminally closed");
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
