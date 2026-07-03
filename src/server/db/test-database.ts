import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { listMigrationPaths, loadMigrationFiles } from "@/server/db/migration-files";
import type { MigrationDatabase, MigrationQueryValue } from "@/server/db/migration-runner";
import { runLedgerBackedMigrations } from "@/server/db/migration-runner";

const testDatabaseDir = path.join(process.cwd(), ".tmp", "pglite-step3");

export async function resetTestDatabase() {
  await rm(testDatabaseDir, { force: true, recursive: true });
  await mkdir(testDatabaseDir, { recursive: true });
}

export async function openTestDatabase() {
  await mkdir(testDatabaseDir, { recursive: true });
  return new PGlite(testDatabaseDir);
}

export async function runInitialMigration(db: PGlite) {
  const migrationFiles = await loadMigrationFiles();
  return runLedgerBackedMigrations(createPgliteMigrationDatabase(db), migrationFiles);
}

export async function getMigrationPaths() {
  return listMigrationPaths();
}

export function createPgliteMigrationDatabase(db: PGlite): MigrationDatabase {
  return {
    async query<T extends Record<string, unknown>>(
      statement: string,
      params: readonly MigrationQueryValue[] = [],
    ) {
      const result = await db.query<T>(statement, [...params]);
      return result.rows;
    },
    async execute(statement: string) {
      await db.exec(statement);
    },
    async transaction<T>(callback: (database: MigrationDatabase) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback(createPgliteMigrationDatabase(db));
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
}
