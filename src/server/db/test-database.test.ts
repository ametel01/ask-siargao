import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";

import { seedSiargaoBaseline } from "@/server/db/seed";
import {
  createPgliteSeedQueryRunner,
  createTestDatabase,
  runInitialMigration,
  withTestDatabase,
} from "@/server/db/test-database";

test("keeps concurrently active test databases isolated through cleanup", async () => {
  const [firstOwner, secondOwner] = await Promise.all([createTestDatabase(), createTestDatabase()]);
  const [firstDb, secondDb] = await Promise.all([firstOwner.open(), secondOwner.open()]);

  try {
    expect(firstOwner.directory).not.toBe(secondOwner.directory);

    await Promise.all([migrateAndSeed(firstDb), migrateAndSeed(secondDb)]);

    await firstOwner.close();

    expect(await pathExists(firstOwner.directory)).toBe(false);
    expect(await pathExists(secondOwner.directory)).toBe(true);
    const secondAreaCount = await secondDb.query<{ count: string }>(
      "select count(*)::text as count from areas",
    );
    expect(secondAreaCount.rows).toEqual([{ count: "5" }]);
  } finally {
    await Promise.allSettled([firstOwner.close(), secondOwner.close()]);
  }

  expect(await pathExists(secondOwner.directory)).toBe(false);
});

test("cleans up its owned database when an invocation fails", async () => {
  let ownedDirectory: string | undefined;
  const failure = new Error("expected verification failure");

  await expect(
    withTestDatabase(async (db, directory) => {
      ownedDirectory = directory;
      await runInitialMigration(db);
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(ownedDirectory).toBeDefined();
  expect(await pathExists(ownedDirectory as string)).toBe(false);
});

async function migrateAndSeed(db: PGlite) {
  await runInitialMigration(db);
  return seedSiargaoBaseline(createPgliteSeedQueryRunner(db));
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
