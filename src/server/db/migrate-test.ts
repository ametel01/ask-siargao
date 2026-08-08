import { runInitialMigration, withTestDatabase } from "@/server/db/test-database";

await withTestDatabase(async (db) => {
  await runInitialMigration(db);

  const result = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  const migrationLedger = await db.query<{ name: string }>(
    "select name from schema_migrations order by applied_at, name",
  );

  console.log(
    `Migrated ${result.rows.length} tables and recorded ${migrationLedger.rows.length} migrations in the Step 3 test database.`,
  );
});
