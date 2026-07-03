import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import {
  countExpiredGooglePlacesContent,
  deleteExpiredGooglePlacesContent,
  type GooglePlacesCleanupCounts,
  type GooglePlacesStoreDatabase,
} from "@/server/providers/google-places-store";

export type PruneGooglePlacesResult = GooglePlacesCleanupCounts & {
  dryRun: boolean;
  now: string;
};

export async function pruneGooglePlacesContent({
  db,
  dryRun = false,
  now = new Date().toISOString(),
}: {
  db: GooglePlacesStoreDatabase;
  dryRun?: boolean;
  now?: string;
}): Promise<PruneGooglePlacesResult> {
  const counts = dryRun
    ? await countExpiredGooglePlacesContent(db, { now })
    : await deleteExpiredGooglePlacesContent(db, { now });

  return {
    ...counts,
    dryRun,
    now,
  };
}

export async function runPruneGooglePlacesCli({
  argv = process.argv.slice(2),
  env = process.env,
}: {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
} = {}) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to prune expired Google Places content.");
  }

  const dryRun = argv.includes("--dry-run");
  const sql = postgres(databaseUrl, createPostgresConnectionOptions("cli"));

  try {
    const result = await pruneGooglePlacesContent({
      db: createPostgresGooglePlacesDatabase(sql),
      dryRun,
    });
    printPruneSummary(result, databaseUrl);
    return result;
  } finally {
    await sql.end();
  }
}

function createPostgresGooglePlacesDatabase(
  sql: ReturnType<typeof postgres>,
): GooglePlacesStoreDatabase {
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const rows = await sql.unsafe<T[]>(query, params as never[]);
      return { rows };
    },
  };
}

function printPruneSummary(result: PruneGooglePlacesResult, databaseUrl: string) {
  const action = result.dryRun ? "Dry run; no rows deleted." : "Expired rows deleted.";
  console.log(
    [
      "Google Places retention cleanup completed.",
      `Mode: ${result.dryRun ? "dry-run" : "delete"}.`,
      `Database: ${databaseUrlForLog(databaseUrl)}.`,
      `Cutoff: ${result.now}.`,
      `Reviews: ${result.reviewsDeleted}. Details: ${result.detailsDeleted}. Snapshots: ${result.snapshotsDeleted}.`,
      action,
    ].join("\n"),
  );
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

if (import.meta.main) {
  await runPruneGooglePlacesCli();
}
