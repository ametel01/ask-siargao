import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import {
  countExpiredGooglePlacesContent,
  defaultGooglePlacesCleanupBatchSize,
  defaultGooglePlacesCleanupMaxBatches,
  deleteExpiredGooglePlacesContent,
  type GooglePlacesCleanupProgress,
  type GooglePlacesStoreDatabase,
} from "@/server/providers/google-places-store";

export const defaultGooglePlacesPruneBatchSize = defaultGooglePlacesCleanupBatchSize;
export const defaultGooglePlacesPruneMaxBatches = defaultGooglePlacesCleanupMaxBatches;

export type PruneGooglePlacesOptions = {
  batchSize: number;
  dryRun: boolean;
  maxBatches: number;
};

export type PruneGooglePlacesResult = GooglePlacesCleanupProgress & {
  batchSize: number;
  dryRun: boolean;
  maxBatches: number;
  now: string;
};

export async function pruneGooglePlacesContent({
  batchSize = defaultGooglePlacesPruneBatchSize,
  db,
  dryRun = false,
  maxBatches = defaultGooglePlacesPruneMaxBatches,
  now = new Date().toISOString(),
}: {
  batchSize?: number;
  db: GooglePlacesStoreDatabase;
  dryRun?: boolean;
  maxBatches?: number;
  now?: string;
}): Promise<PruneGooglePlacesResult> {
  const counts = dryRun
    ? await countExpiredGooglePlacesContent(db, { now })
    : await deleteExpiredGooglePlacesContent(db, { batchSize, maxBatches, now });

  return {
    ...counts,
    batchSize,
    dryRun,
    maxBatches,
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
  const options = parsePruneGooglePlacesArgs(argv);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to prune expired Google Places content.");
  }

  const sql = postgres(databaseUrl, createPostgresConnectionOptions("cli"));

  try {
    const result = await pruneGooglePlacesContent({
      batchSize: options.batchSize,
      db: createPostgresGooglePlacesDatabase(sql),
      dryRun: options.dryRun,
      maxBatches: options.maxBatches,
    });
    console.log(formatPruneSummary(result, databaseUrl));
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

export function parsePruneGooglePlacesArgs(argv: readonly string[]): PruneGooglePlacesOptions {
  const options: PruneGooglePlacesOptions = {
    batchSize: defaultGooglePlacesPruneBatchSize,
    dryRun: false,
    maxBatches: defaultGooglePlacesPruneMaxBatches,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--batch-size") {
      options.batchSize = parsePositiveIntegerOption("--batch-size", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--batch-size=")) {
      options.batchSize = parsePositiveIntegerOption(
        "--batch-size",
        arg.slice("--batch-size=".length),
      );
      continue;
    }

    if (arg === "--max-batches") {
      options.maxBatches = parsePositiveIntegerOption("--max-batches", argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-batches=")) {
      options.maxBatches = parsePositiveIntegerOption(
        "--max-batches",
        arg.slice("--max-batches=".length),
      );
      continue;
    }

    throw new Error(`Unsupported Google Places prune argument: ${arg}.`);
  }

  return options;
}

function parsePositiveIntegerOption(name: string, rawValue: string | undefined) {
  if (rawValue === undefined || rawValue.startsWith("--")) {
    throw new Error(`${name} requires a positive integer value.`);
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export function formatPruneSummary(result: PruneGooglePlacesResult, databaseUrl: string) {
  const action = result.dryRun ? "Dry run; no rows deleted." : "Expired rows deleted.";
  const countLabel = result.dryRun ? "expired rows" : "deleted rows";
  return [
    "Google Places retention cleanup completed.",
    `Mode: ${result.dryRun ? "dry-run" : "delete"}.`,
    `Database: ${databaseUrlForLog(databaseUrl)}.`,
    `Cutoff: ${result.now}.`,
    `Batch size: ${result.batchSize}. Max batches per table: ${result.maxBatches}.`,
    `Reviews: ${result.reviewsDeleted} ${countLabel}, ${result.reviews.batches} batches, more expired rows remain: ${yesNo(result.reviews.hasMore)}.`,
    `Details: ${result.detailsDeleted} ${countLabel}, ${result.details.batches} batches, more expired rows remain: ${yesNo(result.details.hasMore)}.`,
    `Snapshots: ${result.snapshotsDeleted} ${countLabel}, ${result.snapshots.batches} batches, more expired rows remain: ${yesNo(result.snapshots.hasMore)}.`,
    `Total: ${result.totalRows} ${countLabel}, ${result.totalBatches} batches, more expired rows remain: ${yesNo(result.hasMore)}.`,
    action,
  ].join("\n");
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

if (import.meta.main) {
  await runPruneGooglePlacesCli();
}
