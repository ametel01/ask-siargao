import { expect, test } from "bun:test";
import { access, rm } from "node:fs/promises";
import path from "node:path";
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
}, 15_000);

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
}, 15_000);

for (const [signal, expectedExitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`cleans up its owned database before ${signal} exits`, async () => {
    const script = [
      'const { createTestDatabase } = await import("./src/server/db/test-database.ts");',
      "const owner = await createTestDatabase();",
      "const database = await owner.open();",
      'await database.query("select 1");',
      "console.log(owner.directory);",
      "await new Promise(() => {});",
    ].join("\n");
    const subprocess = Bun.spawn(["bun", "-e", script], {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "pipe",
    });
    let ownedDirectory: string | undefined;

    try {
      ownedDirectory = await readFirstLine(subprocess.stdout);
      expect(ownedDirectory).toStartWith(path.join(process.cwd(), ".tmp", "pglite-"));
      expect(await pathExists(ownedDirectory)).toBe(true);

      subprocess.kill(signal);
      const [exitCode, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stderr).text(),
      ]);

      expect(exitCode).toBe(expectedExitCode);
      expect(stderr).not.toContain("PGlite test database cleanup failed during termination");
      expect(await pathExists(ownedDirectory)).toBe(false);
    } finally {
      if (subprocess.exitCode === null) {
        subprocess.kill("SIGKILL");
        await subprocess.exited;
      }
      if (ownedDirectory) {
        await rm(ownedDirectory, { force: true, recursive: true });
      }
    }
  }, 15_000);
}

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

async function readFirstLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (!output.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  const line = output.split("\n", 1)[0]?.trim();
  if (!line) {
    throw new Error("Interrupted PGlite fixture exited before reporting its owned directory.");
  }
  return line;
}
