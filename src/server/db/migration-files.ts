import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const migrationDirectory = path.join(process.cwd(), "drizzle");

export type MigrationFile = {
  path: string;
  sql: string;
};

export async function listMigrationPaths() {
  const entries = await readdir(migrationDirectory, { withFileTypes: true });

  const migrationPaths: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && /^\d+_.+\.sql$/.test(entry.name)) {
      migrationPaths.push(path.join(migrationDirectory, entry.name));
    }
  }

  return migrationPaths.toSorted();
}

export async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const migrationPaths = await listMigrationPaths();
  return Promise.all(
    migrationPaths.map(async (migrationPath) => ({
      path: migrationPath,
      sql: await readFile(migrationPath, "utf8"),
    })),
  );
}
