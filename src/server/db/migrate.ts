import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles } from "@/server/db/migration-files";
import type { MigrationDatabase, MigrationQueryValue } from "@/server/db/migration-runner";
import { runLedgerBackedMigrations } from "@/server/db/migration-runner";
import { createComponentLogger } from "@/server/observability/logger";

const databaseUrl = process.env.DATABASE_URL;
const migrationAdvisoryLockKey = "62873221180462";
const migrationLogger = createComponentLogger("db.migrate");
let lockAcquired = false;

if (!databaseUrl) {
  migrationLogger.error("DATABASE_URL is required to run database migrations.");
  throw new Error("DATABASE_URL is required to run database migrations.");
}
const configuredDatabaseUrl = databaseUrl;

async function runMigrations() {
  const sql = postgres(configuredDatabaseUrl, createPostgresConnectionOptions("cli"));
  const startedAt = performance.now();

  try {
    const migrationFiles = await loadMigrationFiles();
    const migrationNames = migrationFiles.map((migrationFile) => migrationFile.name);

    migrationLogger.info(
      {
        databaseUrl: databaseUrlForLog(configuredDatabaseUrl),
        migrationNames,
      },
      "Database migration started.",
    );

    await acquireMigrationLock(sql);
    lockAcquired = true;

    const migrationResult = await runLedgerBackedMigrations(
      createPostgresMigrationDatabase(sql),
      migrationFiles,
    );

    const tables = await sql<
      { table_name: string }[]
    >`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;

    migrationLogger.info(
      {
        databaseUrl: databaseUrlForLog(configuredDatabaseUrl),
        appliedMigrations: migrationResult.applied,
        durationMs: Math.round(performance.now() - startedAt),
        skippedMigrations: migrationResult.skipped,
        tableCount: tables.length,
        tables: tables.map((table) => table.table_name),
      },
      "Database migration completed.",
    );
  } catch (error) {
    migrationLogger.error(
      {
        databaseUrl: databaseUrlForLog(configuredDatabaseUrl),
        durationMs: Math.round(performance.now() - startedAt),
        err: error,
      },
      "Database migration failed.",
    );
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await releaseMigrationLock(sql);
      }
    } finally {
      await sql.end();
      migrationLogger.debug("Database migration connection closed.");
    }
  }
}

await runMigrations();

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function acquireMigrationLock(sql: ReturnType<typeof postgres>) {
  await sql.unsafe("select pg_advisory_lock($1::bigint)", [migrationAdvisoryLockKey]);
  migrationLogger.debug({ lockKey: migrationAdvisoryLockKey }, "Database migration lock acquired.");
}

async function releaseMigrationLock(sql: ReturnType<typeof postgres>) {
  await sql.unsafe("select pg_advisory_unlock($1::bigint)", [migrationAdvisoryLockKey]);
  migrationLogger.debug({ lockKey: migrationAdvisoryLockKey }, "Database migration lock released.");
}

function createPostgresMigrationDatabase(sql: ReturnType<typeof postgres>): MigrationDatabase {
  const unsafe = sql.unsafe.bind(sql) as PostgresUnsafe;

  return createPostgresMigrationDatabaseFromUnsafe(
    unsafe,
    async <T>(callback: (database: MigrationDatabase) => Promise<T>): Promise<T> => {
      const result = await sql.begin(async (transactionSql) =>
        callback(
          createPostgresMigrationDatabaseFromUnsafe(
            transactionSql.unsafe.bind(transactionSql) as PostgresUnsafe,
            async () => {
              throw new Error("Nested migration transactions are not supported.");
            },
          ),
        ),
      );

      return result as T;
    },
  );
}

type PostgresUnsafe = (
  statement: string,
  params?: readonly MigrationQueryValue[],
) => Promise<unknown[]>;

function createPostgresMigrationDatabaseFromUnsafe(
  unsafe: PostgresUnsafe,
  transaction: <T>(callback: (database: MigrationDatabase) => Promise<T>) => Promise<T>,
): MigrationDatabase {
  return {
    async query<T extends Record<string, unknown>>(
      statement: string,
      params: readonly MigrationQueryValue[] = [],
    ) {
      const rows = await unsafe(statement, [...params]);
      return rows as T[];
    },
    async execute(statement: string) {
      await unsafe(statement);
    },
    transaction,
  };
}
