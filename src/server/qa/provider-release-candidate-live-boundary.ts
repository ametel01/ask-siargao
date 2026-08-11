import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles } from "@/server/db/migration-files";
import { createPostgresQueryClient } from "@/server/db/query-client";
import {
  createProviderReleaseCandidateLifecycle,
  type ProviderReleaseCandidateEnv,
  type ProviderReleaseCandidateLane,
} from "@/server/qa/provider-release-candidate";
import { providerReleaseCandidateDiskFiles } from "@/server/qa/provider-release-candidate-receipts";

export function createLiveProviderReleaseCandidateLifecycle<
  Lane extends ProviderReleaseCandidateLane,
>(lane: Lane) {
  return createProviderReleaseCandidateLifecycle(lane, {
    env: process.env as ProviderReleaseCandidateEnv,
    files: providerReleaseCandidateDiskFiles,
    loadMigrations: () => loadMigrationFiles(),
    readCheckedOutCommitSha: readHeadSha,
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

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for protected live-boundary verification.`);
  return value;
}

async function readHeadSha() {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}
