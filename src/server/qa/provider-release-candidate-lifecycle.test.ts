import { afterEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  createProviderReleaseCandidateLifecycle,
  type ProviderReleaseCandidateEnv,
  type ProviderReleaseCandidateLifecycleDependencies,
  providerReleaseCandidateScenarios,
  runProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";

const sha = "a".repeat(40);
const changedSha = "b".repeat(40);
const migrations = [
  { checksum: "checksum-one", name: "0001_one.sql" },
  { checksum: "checksum-two", name: "0002_two.sql" },
] as const;

const openDatabases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...openDatabases].map((database) => database.close()));
  openDatabases.clear();
});

describe("provider Release Evidence lifecycle", () => {
  test("executes the Clerk lane in semantic Release Evidence order", async () => {
    const events: string[] = [];
    const completed = { evidencePath: `.tmp/provider-release-candidate/clerk-${sha}.json` };

    const result = await runProviderReleaseCandidateLane("clerk", {
      lifecycle: {
        async begin() {
          events.push("preflight");
        },
        async complete() {
          events.push("evidence");
          return completed;
        },
      },
      async runPhase(phase) {
        events.push(phase);
      },
    });

    expect(events).toEqual([
      "preflight",
      "acceptance",
      "account_closure_worker",
      "provider_deletion_convergence",
      "final_boundary",
      "evidence",
    ]);
    expect(result).toBe(completed);
  });

  test("does not start a downstream lane phase while its predecessor is pending", async () => {
    const acceptanceGate = Promise.withResolvers<void>();
    const acceptanceStarted = Promise.withResolvers<void>();
    const events: string[] = [];

    const execution = runProviderReleaseCandidateLane("stripe", {
      lifecycle: {
        async begin() {
          events.push("preflight");
        },
        async complete() {
          events.push("evidence");
        },
      },
      async runPhase(phase) {
        events.push(phase);
        if (phase === "acceptance") {
          acceptanceStarted.resolve();
          await acceptanceGate.promise;
        }
      },
    });

    await acceptanceStarted.promise;
    await Promise.resolve();
    expect(events).toEqual(["preflight", "acceptance"]);

    acceptanceGate.resolve();
    await execution;
    expect(events).toEqual([
      "preflight",
      "acceptance",
      "account_closure_worker",
      "paid_after_closure_refund_worker",
      "final_boundary",
      "evidence",
    ]);
  });

  test("rejects an invalid candidate before exposing lifecycle operations", async () => {
    const harness = await createLifecycleHarness();
    harness.dependencies.env.GITHUB_EVENT_NAME = "pull_request";

    await expect(
      createProviderReleaseCandidateLifecycle("clerk", harness.dependencies),
    ).rejects.toThrow("manual_dispatch_required");
  });

  test("owns candidate identity, receipts, scenarios, drift checks, and immutable evidence", async () => {
    const harness = await createLifecycleHarness();
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);

    await expect(lifecycle.begin()).resolves.toEqual({
      checkedOutCommitSha: sha,
      deployedMigrationLedgerFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      lane: "clerk",
      migrationCount: 2,
      protectedDatabaseEnvironment: "protected-test",
    });
    await lifecycle.recordScenarios(providerReleaseCandidateScenarios.clerk);
    await expect(lifecycle.revalidate(sha)).resolves.toMatch(/^[0-9a-f]{64}$/);
    await lifecycle.seal(sha);

    const completed = await lifecycle.complete();
    expect(completed.evidencePath).toBe(`.tmp/provider-release-candidate/clerk-${sha}.json`);
    expect(completed.evidence).toMatchObject({
      lane: "clerk",
      migrations: [
        { checksum: "checksum-one", filename: "0001_one.sql" },
        { checksum: "checksum-two", filename: "0002_two.sql" },
      ],
      scenarios: providerReleaseCandidateScenarios.clerk,
      source: { checkedOutCommitSha: sha, repository: "ametel01/ask-siargao" },
    });
    expect(completed.evidence.codeAndMigrationFingerprint).toBe(
      "04a28ddb165f78843ff0672f0525c9b39540b32e783b27b272e11fe70430d023",
    );
    await expect(lifecycle.complete()).rejects.toThrow("already exists");
  });

  test("enforces lifecycle ordering through the same seam used by live lanes", async () => {
    const harness = await createLifecycleHarness();
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);

    await expect(lifecycle.recordScenarios(["email_code_sign_in"])).rejects.toThrow(
      "before preflight",
    );
    await lifecycle.begin();
    await expect(lifecycle.begin()).rejects.toThrow("already exists");
    await expect(lifecycle.seal(sha)).rejects.toThrow("every scenario");
    await lifecycle.recordScenarios(providerReleaseCandidateScenarios.clerk);
    await lifecycle.seal(sha);
    await expect(lifecycle.recordScenarios(["email_code_sign_in"])).rejects.toThrow(
      "already sealed",
    );
  });

  test("does not start scenario recording while preflight is still pending", async () => {
    const harness = await createLifecycleHarness();
    const databaseGate = Promise.withResolvers<void>();
    const databaseStarted = Promise.withResolvers<void>();
    const withDatabase = harness.dependencies.withDatabase;
    harness.dependencies.withDatabase = async (work) => {
      databaseStarted.resolve();
      await databaseGate.promise;
      return withDatabase(work);
    };
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);

    const preflight = lifecycle.begin();
    await databaseStarted.promise;
    const scenarioRecording = lifecycle.recordScenarios(["email_code_sign_in"]);
    await Promise.resolve();
    expect(
      [...harness.files.values()].some((contents) => contents.includes("email_code_sign_in")),
    ).toBe(false);

    databaseGate.resolve();
    await preflight;
    await scenarioRecording;
    expect(
      [...harness.files.values()].some((contents) => contents.includes("email_code_sign_in")),
    ).toBe(true);
  });

  test("rejects a mismatched initial receipt before recording scenarios", async () => {
    const harness = await createLifecycleHarness();
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);
    await lifecycle.begin();
    const read = harness.dependencies.files.read;
    harness.dependencies.files.read = async (path) => {
      const contents = await read(path);
      if (!contents?.includes('"protectedDatabaseEnvironment"')) return contents;
      const receipt = JSON.parse(contents) as { deployedMigrationLedgerFingerprint: string };
      receipt.deployedMigrationLedgerFingerprint = "b".repeat(64);
      return JSON.stringify(receipt);
    };

    await expect(lifecycle.recordScenarios(["email_code_sign_in"])).rejects.toThrow(
      "drifted mid-run",
    );
  });

  test("serializes scenario recording with sealing", async () => {
    const harness = await createLifecycleHarness();
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);
    await lifecycle.begin();
    const finalScenario = providerReleaseCandidateScenarios.clerk.at(-1);
    if (!finalScenario) throw new Error("Clerk scenarios must not be empty.");
    await lifecycle.recordScenarios(providerReleaseCandidateScenarios.clerk.slice(0, -1));

    const firstAppendGate = Promise.withResolvers<void>();
    const firstAppendStarted = Promise.withResolvers<void>();
    const append = harness.dependencies.files.append;
    let appendCallCount = 0;
    harness.dependencies.files.append = async (path, content) => {
      appendCallCount += 1;
      if (appendCallCount === 1) {
        firstAppendStarted.resolve();
        await firstAppendGate.promise;
      }
      await append(path, content);
    };

    const firstRecording = lifecycle.recordScenarios([finalScenario]);
    await firstAppendStarted.promise;
    const secondRecording = lifecycle.recordScenarios([finalScenario]);
    const sealing = lifecycle.seal(sha);
    firstAppendGate.resolve();
    await Promise.all([firstRecording, secondRecording, sealing]);

    const recordedFinalScenarios = [...harness.files.values()]
      .flatMap((contents) => contents.split("\n"))
      .filter((line) => line === finalScenario);
    expect(recordedFinalScenarios).toHaveLength(1);
    await expect(lifecycle.recordScenarios([finalScenario])).rejects.toThrow("already sealed");
  });

  test("rejects deployed-commit and protected-database drift", async () => {
    const harness = await createLifecycleHarness();
    const lifecycle = await createProviderReleaseCandidateLifecycle("clerk", harness.dependencies);
    await lifecycle.begin();

    await expect(lifecycle.revalidate(changedSha)).rejects.toThrow("drifted mid-run");
    await harness.database.query("update schema_migrations set checksum = $1 where name = $2", [
      "changed-checksum",
      "0002_two.sql",
    ]);
    await expect(lifecycle.revalidate(sha)).rejects.toThrow("ledger content mismatch");
  });
});

async function createLifecycleHarness() {
  const database = new PGlite();
  openDatabases.add(database);
  await database.exec(`
    create table schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
    create table provider_release_candidate_sentinel (
      id text primary key,
      environment text not null,
      fingerprint text not null
    );
  `);
  for (const migration of migrations) {
    await database.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
      migration.name,
      migration.checksum,
    ]);
  }
  await database.query(
    "insert into provider_release_candidate_sentinel (id, environment, fingerprint) values ($1, $2, $3)",
    ["provider-release-candidate", "protected-test", "sentinel"],
  );

  const files = new Map<string, string>();
  const lockTails = new Map<string, Promise<void>>();
  const dependencies: ProviderReleaseCandidateLifecycleDependencies = {
    env: clerkEnvironment(),
    files: {
      async append(path, content) {
        files.set(path, `${files.get(path) ?? ""}${content}`);
      },
      async read(path) {
        return files.get(path);
      },
      async withLock(path, work) {
        const previous = lockTails.get(path) ?? Promise.resolve();
        const next = Promise.withResolvers<void>();
        lockTails.set(
          path,
          previous.then(() => next.promise),
        );
        await previous;
        try {
          return await work();
        } finally {
          next.resolve();
        }
      },
      async writeExclusive(path, content) {
        if (files.has(path)) throw new Error(`File already exists: ${path}`);
        files.set(path, content);
      },
    },
    loadMigrations: async () => migrations,
    readCheckedOutCommitSha: async () => sha,
    withDatabase: async (work) => work(pgliteClient(database)),
  };
  return { database, dependencies, files };
}

function pgliteClient(database: PGlite): DatabaseQueryClient {
  return {
    async query<T>(statement: string, params: unknown[] = []) {
      const result = await database.query<T>(statement, params);
      return { rows: result.rows };
    },
  };
}

function clerkEnvironment(): ProviderReleaseCandidateEnv {
  return {
    CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
    CLERK_SECRET_KEY: "sk_test_redacted",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_redacted",
    DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
    GITHUB_ENVIRONMENT: "provider-release-candidate",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "ametel01/ask-siargao",
    PROVIDER_RC_APP_ORIGIN: "https://provider-rc.asksiargao.test",
    PROVIDER_RC_BOUNDARY_USER: "boundary+clerk_test@example.test",
    PROVIDER_RC_CLERK_GOOGLE_EMAIL: "oauth@example.test",
    PROVIDER_RC_CLERK_GOOGLE_PASSWORD: "redacted-password",
    PROVIDER_RC_DATABASE_ENVIRONMENT: "protected-test",
    PROVIDER_RC_DATABASE_EXPECTED_HOST: "provider-rc-db.test",
    PROVIDER_RC_DATABASE_EXPECTED_NAME: "ask_siargao_provider_rc_test",
    PROVIDER_RC_DATABASE_RESOURCE_NAME: "ask-siargao-staging",
    PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT: "sentinel",
    PROVIDER_RC_EXPECTED_SHA: sha,
    PROVIDER_RC_PRODUCTION_ORIGIN: "https://asksiargao.com",
    PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET: "vercel-bypass-redacted",
    STRIPE_RESTRICTED_KEY: "rk_test_redacted",
  };
}
