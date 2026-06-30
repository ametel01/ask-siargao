import { readdir } from "node:fs/promises";
import path from "node:path";

export const migrationDirectory = path.join(process.cwd(), "drizzle");

export async function listMigrationPaths() {
  const entries = await readdir(migrationDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => path.join(migrationDirectory, entry.name))
    .toSorted();
}
