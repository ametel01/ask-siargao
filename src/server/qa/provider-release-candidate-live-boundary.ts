import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles } from "@/server/db/migration-files";
import { createPostgresQueryClient } from "@/server/db/query-client";
import {
  createProviderReleaseCandidateLifecycle,
  type ProviderReleaseCandidateEnv,
  type ProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";
import {
  createProtectedProviderHarness,
  readProviderReleaseCandidateHeadSha,
} from "@/server/qa/provider-release-candidate-harness";
import { providerReleaseCandidateDiskFiles } from "@/server/qa/provider-release-candidate-receipts";

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

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for protected live-boundary verification.`);
  return value;
}
