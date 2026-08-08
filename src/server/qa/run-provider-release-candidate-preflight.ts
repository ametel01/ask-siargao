import postgres from "postgres";

import { loadMigrationFiles } from "@/server/db/migration-files";
import {
  assertProviderReleaseCandidateContext,
  type ProviderReleaseCandidateLane,
  verifyProviderReleaseCandidateDatabase,
} from "@/server/qa/provider-release-candidate";
import { writeProviderDatabaseReceipt } from "@/server/qa/provider-release-candidate-receipts";

const lane = readLane();
const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane });

const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
try {
  const [ledgerRows, sentinelRows] = await Promise.all([
    sql<{ checksum: string; name: string }[]>`
      select name, checksum
      from schema_migrations
      order by applied_at asc, name asc
    `,
    sql<{ environment: string; fingerprint: string }[]>`
      select environment, fingerprint
      from provider_release_candidate_sentinel
      where id = 'provider-release-candidate'
      limit 1
    `,
  ]);
  const expectedMigrations = await loadMigrationFiles();
  const deployedMigrationLedgerFingerprint = verifyProviderReleaseCandidateDatabase({
    expectedMigrations,
    expectedSentinelFingerprint: required("PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT"),
    ledgerRows,
    sentinel: sentinelRows[0],
  });
  await writeProviderDatabaseReceipt({
    checkedOutCommitSha,
    deployedMigrationLedgerFingerprint,
    lane,
    migrationCount: ledgerRows.length,
    protectedDatabaseEnvironment: "protected-test",
  });
  console.log(
    JSON.stringify({
      checkedOutCommitSha,
      deployedMigrationLedgerFingerprint,
      lane,
      migrationCount: ledgerRows.length,
      protectedDatabaseEnvironment: "protected-test",
    }),
  );
} finally {
  await sql.end();
}

function readLane(): ProviderReleaseCandidateLane {
  const index = process.argv.indexOf("--lane");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value !== "clerk" && value !== "stripe") throw new Error("Use --lane clerk or stripe.");
  return value;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for protected database preflight.`);
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
