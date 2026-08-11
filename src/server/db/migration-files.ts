import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const migrationDirectory = path.join(process.cwd(), "drizzle");

export type MigrationFile = {
  name: string;
  path: string;
  sql: string;
  checksum: string;
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
    migrationPaths.map(async (migrationPath) => {
      const sql = await readFile(migrationPath, "utf8");

      return {
        name: path.basename(migrationPath),
        path: migrationPath,
        sql,
        checksum: checksumMigrationSql(sql),
      };
    }),
  );
}

export function listPendingMigrationNames(
  migrationFiles: readonly MigrationFile[],
  appliedMigrations: readonly MigrationFile[],
) {
  const appliedNames = new Set(appliedMigrations.map((migration) => migration.name));
  return migrationFiles
    .filter((migration) => !appliedNames.has(migration.name))
    .map((migration) => migration.name);
}

export function checksumMigrationSql(sql: string) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}
