import path from "node:path";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const migrationPath = path.join(process.cwd(), "drizzle", "0000_initial_schema.sql");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.file(migrationPath);

  const tables = await sql<
    { table_name: string }[]
  >`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;

  console.log(`Migrated ${tables.length} tables in ${databaseUrlForLog(databaseUrl)}.`);
} finally {
  await sql.end();
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}
