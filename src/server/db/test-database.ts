import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { listMigrationPaths } from "@/server/db/migration-files";

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
  for (const migrationPath of await getMigrationPaths()) {
    const sql = await readFile(migrationPath, "utf8");
    await db.exec(sql);
  }
}

export async function getMigrationPaths() {
  return listMigrationPaths();
}
