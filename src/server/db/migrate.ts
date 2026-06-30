import postgres from "postgres";

import { listMigrationPaths } from "@/server/db/migration-files";
import { createComponentLogger } from "@/server/observability/logger";

const databaseUrl = process.env.DATABASE_URL;
const migrationLogger = createComponentLogger("db.migrate");

if (!databaseUrl) {
  migrationLogger.error("DATABASE_URL is required to run database migrations.");
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const startedAt = performance.now();

try {
  const migrationPaths = await listMigrationPaths();

  migrationLogger.info(
    {
      databaseUrl: databaseUrlForLog(databaseUrl),
      migrationPaths,
    },
    "Database migration started.",
  );

  for (const migrationPath of migrationPaths) {
    await sql.file(migrationPath);
  }

  const tables = await sql<
    { table_name: string }[]
  >`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;

  migrationLogger.info(
    {
      databaseUrl: databaseUrlForLog(databaseUrl),
      durationMs: Math.round(performance.now() - startedAt),
      tableCount: tables.length,
      tables: tables.map((table) => table.table_name),
    },
    "Database migration completed.",
  );
} catch (error) {
  migrationLogger.error(
    {
      databaseUrl: databaseUrlForLog(databaseUrl),
      durationMs: Math.round(performance.now() - startedAt),
      err: error,
    },
    "Database migration failed.",
  );
  throw error;
} finally {
  await sql.end();
  migrationLogger.debug("Database migration connection closed.");
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}
