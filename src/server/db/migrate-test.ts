import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";

await resetTestDatabase();

const db = await openTestDatabase();
await runInitialMigration(db);

const result = await db.query<{ table_name: string }>(
  "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
);
const migrationLedger = await db.query<{ name: string }>(
  "select name from schema_migrations order by applied_at, name",
);

await db.close();

console.log(
  `Migrated ${result.rows.length} tables and recorded ${migrationLedger.rows.length} migrations in the Step 3 test database.`,
);
