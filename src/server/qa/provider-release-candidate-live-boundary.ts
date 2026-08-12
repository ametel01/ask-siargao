import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles } from "@/server/db/migration-files";
import { createPostgresQueryClient } from "@/server/db/query-client";
import {
  createProviderReleaseCandidateLifecycle,
  type ProviderReleaseCandidateEnv,
  type ProviderReleaseCandidateLane,
  type ProviderReleaseCandidateLanePhase,
  runProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";
import {
  createProtectedProviderHarness,
  readProviderReleaseCandidateHeadSha,
} from "@/server/qa/provider-release-candidate-harness";
import { providerReleaseCandidateDiskFiles } from "@/server/qa/provider-release-candidate-receipts";

type ProviderReleaseCandidateCommand = readonly [string, ...string[]];

const providerReleaseCandidateLaneCommands = {
  clerk: {
    acceptance: ["bun", "run", "test:e2e:clerk"],
    account_closure_worker: ["bun", "run", "privacy:closure-worker"],
    provider_deletion_convergence: ["bun", "run", "test:e2e:clerk:verify-deletion"],
    final_boundary: ["bun", "run", "test:e2e:clerk:final-boundary"],
  },
  stripe: {
    acceptance: ["bun", "run", "test:smoke:trip-pass-stripe"],
    account_closure_worker: ["bun", "run", "privacy:closure-worker"],
    paid_after_closure_refund_worker: ["bun", "run", "payments:closure-refund-worker"],
    final_boundary: ["bun", "run", "test:e2e:stripe:final-boundary"],
  },
} as const satisfies {
  [Lane in ProviderReleaseCandidateLane]: Record<
    ProviderReleaseCandidateLanePhase<Lane>,
    ProviderReleaseCandidateCommand
  >;
};

export function createLiveProviderReleaseCandidateLifecycle<
  Lane extends ProviderReleaseCandidateLane,
>(lane: Lane) {
  return createProviderReleaseCandidateLifecycle(lane, {
    env: process.env as ProviderReleaseCandidateEnv,
    files: providerReleaseCandidateDiskFiles,
    loadMigrations: () => loadMigrationFiles(),
    readCheckedOutCommitSha: readProviderReleaseCandidateHeadSha,
    async withDatabase(work) {
      const sql = postgres(required("DATABASE_URL"), {
        ...createPostgresConnectionOptions("cli"),
        max: 1,
        prepare: false,
      });
      try {
        return await work(createPostgresQueryClient(sql));
      } finally {
        await sql.end();
      }
    },
  });
}

export async function createLiveProtectedProviderHarness<Lane extends ProviderReleaseCandidateLane>(
  lane: Lane,
  options: { providerTimeoutMs?: number } = {},
) {
  return createProtectedProviderHarness(lane, {
    env: process.env as ProviderReleaseCandidateEnv,
    lifecycle: await createLiveProviderReleaseCandidateLifecycle(lane),
    providerTimeoutMs: options.providerTimeoutMs,
  });
}

export function createLiveProviderReleaseCandidateLaneAdapter<
  Lane extends ProviderReleaseCandidateLane,
>(
  lane: Lane,
  executeCommand: (
    command: ProviderReleaseCandidateCommand,
  ) => Promise<void> = executeProviderReleaseCandidateCommand,
) {
  const commands: Readonly<Record<string, ProviderReleaseCandidateCommand>> =
    providerReleaseCandidateLaneCommands[lane];
  return {
    async runPhase(phase: ProviderReleaseCandidateLanePhase<Lane>) {
      const command = commands[phase];
      if (!command) throw new Error(`No protected ${lane} adapter exists for phase ${phase}.`);
      await executeCommand(command);
    },
  };
}

export async function runLiveProviderReleaseCandidateLane<
  Lane extends ProviderReleaseCandidateLane,
>(lane: Lane) {
  const lifecycle = await createLiveProviderReleaseCandidateLifecycle(lane);
  const adapter = createLiveProviderReleaseCandidateLaneAdapter(lane);
  return runProviderReleaseCandidateLane(lane, {
    lifecycle,
    runPhase: adapter.runPhase,
  });
}

async function executeProviderReleaseCandidateCommand(command: ProviderReleaseCandidateCommand) {
  const child = Bun.spawn([...command], { stderr: "inherit", stdout: "inherit" });
  if ((await child.exited) !== 0) {
    throw new Error("A protected provider Release Evidence phase failed.");
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for protected live-boundary verification.`);
  return value;
}
