import type { MigrationFile } from "@/server/db/migration-files";

export type MigrationQueryValue = string | number | boolean | Date | null;

export type MigrationDatabase = {
  query<T extends Record<string, unknown>>(
    statement: string,
    params?: readonly MigrationQueryValue[],
  ): Promise<T[]>;
  execute(statement: string): Promise<void>;
  transaction<T>(callback: (database: MigrationDatabase) => Promise<T>): Promise<T>;
};

export type MigrationRunResult = {
  applied: string[];
  skipped: string[];
};

type LedgerRow = {
  name: string;
  checksum: string;
};

const schemaMigrationsTableSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

const nonTransactionalMigrationPatterns = [
  /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i,
  /\bREINDEX\s+CONCURRENTLY\b/i,
  /\bVACUUM\b/i,
  /\bCREATE\s+DATABASE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/i,
];

export async function runLedgerBackedMigrations(
  database: MigrationDatabase,
  migrationFiles: readonly MigrationFile[],
): Promise<MigrationRunResult> {
  await database.execute(schemaMigrationsTableSql);

  const ledgerRows = await database.query<LedgerRow>(
    `
      select name, checksum
      from schema_migrations
      order by applied_at asc, name asc
    `,
  );
  validateMigrationLedger(migrationFiles, ledgerRows);

  const applied: string[] = [];
  const skipped = ledgerRows.map((row) => row.name);
  const appliedNames = new Set(skipped);

  const pendingMigrationFiles = migrationFiles.filter(
    (migrationFile) => !appliedNames.has(migrationFile.name),
  );
  await runMigrationsInLedgerOrder(database, pendingMigrationFiles, applied);

  return { applied, skipped };
}

function runMigrationsInLedgerOrder(
  database: MigrationDatabase,
  migrationFiles: readonly MigrationFile[],
  applied: string[],
) {
  return migrationFiles.reduce<Promise<void>>(
    (sequence, migrationFile) =>
      sequence.then(async () => {
        await runMigration(database, migrationFile);
        applied.push(migrationFile.name);
      }),
    Promise.resolve(),
  );
}

function validateMigrationLedger(
  migrationFiles: readonly MigrationFile[],
  ledgerRows: readonly LedgerRow[],
) {
  const migrationsByName = new Map(
    migrationFiles.map((migrationFile) => [migrationFile.name, migrationFile]),
  );
  const ledgerNames = new Set<string>();

  for (const ledgerRow of ledgerRows) {
    const migrationFile = migrationsByName.get(ledgerRow.name);
    if (!migrationFile) {
      throw new Error(
        `Migration ledger drift: schema_migrations contains unknown migration ${ledgerRow.name}.`,
      );
    }
    if (ledgerNames.has(ledgerRow.name)) {
      throw new Error(
        `Migration ledger drift: schema_migrations contains duplicate migration ${ledgerRow.name}.`,
      );
    }
    ledgerNames.add(ledgerRow.name);
    if (ledgerRow.checksum !== migrationFile.checksum) {
      throw new Error(
        `Migration checksum mismatch for ${ledgerRow.name}: ledger has ${ledgerRow.checksum}, file has ${migrationFile.checksum}.`,
      );
    }
  }

  const latestAppliedIndex = migrationFiles.reduce(
    (latest, migrationFile, index) => (ledgerNames.has(migrationFile.name) ? index : latest),
    -1,
  );
  for (const [index, migrationFile] of migrationFiles.entries()) {
    if (index > latestAppliedIndex) break;
    if (!ledgerNames.has(migrationFile.name) && !isLateAdditivePreflight(migrationFile.name)) {
      throw new Error(
        `Migration ledger drift: applied migrations skip required migration ${migrationFile.name}.`,
      );
    }
  }
}

function isLateAdditivePreflight(name: string) {
  return /^\d+_preflight_.+\.sql$/.test(name);
}

async function runMigration(database: MigrationDatabase, migrationFile: MigrationFile) {
  const applyMigration = async (transactionDatabase: MigrationDatabase) => {
    await transactionDatabase.execute(migrationFile.sql);
    await transactionDatabase.query(
      `
        insert into schema_migrations (name, checksum)
        values ($1, $2)
      `,
      [migrationFile.name, migrationFile.checksum],
    );
  };

  if (isTransactionSafeMigration(migrationFile.sql)) {
    await database.transaction(applyMigration);
    return;
  }

  await applyMigration(database);
}

function isTransactionSafeMigration(sql: string) {
  return nonTransactionalMigrationPatterns.every((pattern) => !pattern.test(sql));
}
