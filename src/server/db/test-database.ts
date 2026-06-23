import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

export const testDatabaseDir = path.join(process.cwd(), ".tmp", "pglite-step3");
export const migrationPath = path.join(process.cwd(), "drizzle", "0000_initial_schema.sql");

export async function resetTestDatabase() {
  await rm(testDatabaseDir, { force: true, recursive: true });
  await mkdir(testDatabaseDir, { recursive: true });
}

export async function openTestDatabase() {
  await mkdir(testDatabaseDir, { recursive: true });
  return new PGlite(testDatabaseDir);
}

export async function runInitialMigration(db: PGlite) {
  const sql = await readFile(migrationPath, "utf8");
  await db.exec(sql);
}
