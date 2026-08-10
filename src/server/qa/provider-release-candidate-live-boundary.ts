import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles } from "@/server/db/migration-files";
import {
  assertProviderReleaseCandidateBoundaryStable,
  type ProviderReleaseCandidateLane,
  verifyProviderReleaseCandidateDatabase,
} from "@/server/qa/provider-release-candidate";
import { readProviderDatabaseReceipt } from "@/server/qa/provider-release-candidate-receipts";

export async function verifyLiveProviderDatabase(input: {
  checkedOutCommitSha: string;
  compareInitialReceipt: boolean;
  lane: ProviderReleaseCandidateLane;
}) {
  const sql = postgres(required("DATABASE_URL"), {
    ...createPostgresConnectionOptions("cli"),
    max: 1,
    prepare: false,
  });
  try {
    const [ledgerRows, sentinelRows, expectedMigrations] = await Promise.all([
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
      loadMigrationFiles(),
    ]);
    const deployedMigrationLedgerFingerprint = verifyProviderReleaseCandidateDatabase({
      expectedMigrations,
      expectedSentinelFingerprint: required("PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT"),
      ledgerRows,
      sentinel: sentinelRows[0],
    });
    if (input.compareInitialReceipt) {
      const initial = await readProviderDatabaseReceipt(input.lane, input.checkedOutCommitSha);
      if (initial.migrationCount !== ledgerRows.length) {
        throw new Error("Protected database changed after initial preflight.");
      }
      assertProviderReleaseCandidateBoundaryStable({
        currentDatabaseFingerprint: deployedMigrationLedgerFingerprint,
        deployedCommitSha: input.checkedOutCommitSha,
        expectedCommitSha: input.checkedOutCommitSha,
        initialDatabaseFingerprint: initial.deployedMigrationLedgerFingerprint,
      });
    }
    return { deployedMigrationLedgerFingerprint, migrationCount: ledgerRows.length };
  } finally {
    await sql.end();
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for protected live-boundary verification.`);
  return value;
}
