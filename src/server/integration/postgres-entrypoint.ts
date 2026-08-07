import postgres from "postgres";

import {
  parseIntegrationEntrypointOptions,
  redactUrl,
  requireServiceUrl,
  withTimeout,
} from "@/server/integration/entrypoint-shared";

const options = parseIntegrationEntrypointOptions(process.argv.slice(2));
const databaseUrl = requireServiceUrl("DATABASE_URL");
const schemaName = `${options.namespace}_postgres`;
const sql = postgres(databaseUrl, {
  connect_timeout: Math.ceil(options.timeoutMs / 1_000),
  idle_timeout: 1,
  max: 1,
  prepare: false,
});

try {
  await withTimeout(
    sql`select current_database() as database_name`,
    options.timeoutMs,
    "PostgreSQL integration service did not respond before the bounded timeout.",
  );
  await sql.unsafe(`create schema ${quoteIdentifier(schemaName)}`);
  await sql.unsafe(
    `create table ${quoteIdentifier(schemaName)}.entrypoint_probe (id text primary key)`,
  );
  await sql.unsafe(
    `insert into ${quoteIdentifier(schemaName)}.entrypoint_probe (id) values ('ready')`,
  );

  const rows = await sql<{ id: string }[]>`
    select id from ${sql(schemaName)}.entrypoint_probe where id = 'ready'
  `;

  if (rows[0]?.id !== "ready") {
    throw new Error("PostgreSQL integration dry-run probe did not round-trip its namespace row.");
  }

  console.log(
    JSON.stringify(
      {
        checked: "postgres-integration-entrypoint",
        databaseUrl: redactUrl(databaseUrl),
        dryRun: options.dryRun,
        namespace: schemaName,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const cause = error instanceof Error ? error.message : String(error);
  throw new Error(
    `PostgreSQL integration service is required and must be reachable through DATABASE_URL; no PGlite fallback is allowed. Cause: ${cause}`,
  );
} finally {
  try {
    await sql.unsafe(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
  } finally {
    await sql.end();
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
