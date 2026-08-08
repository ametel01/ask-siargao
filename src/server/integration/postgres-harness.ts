import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import { loadMigrationFiles, type MigrationFile } from "@/server/db/migration-files";
import type { MigrationDatabase, MigrationQueryValue } from "@/server/db/migration-runner";
import { runLedgerBackedMigrations } from "@/server/db/migration-runner";
import {
  assertSafeIntegrationServiceUrl,
  parseIntegrationEntrypointOptions,
  redactUrl,
  requireServiceUrl,
  runWithIntegrationLifecycle,
} from "@/server/integration/entrypoint-shared";

export type RealPostgresHarness = {
  readonly adminUrl: string;
  readonly databaseName: string;
  readonly databaseUrl: string;
  readonly namespace: string;
  createClient(input?: { max?: number }): Sql;
  createQueryClient(input?: { max?: number }): {
    end(): Promise<void>;
    query<T>(query: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
    transaction<T>(
      callback: (client: {
        query<T>(query: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  migrate(
    migrationFiles?: readonly MigrationFile[],
  ): Promise<{ applied: string[]; skipped: string[] }>;
};

type HarnessOptions = {
  adminDatabaseUrl: string;
  allowRemote: boolean;
  namespace: string;
  timeoutMs: number;
};

export async function withRealPostgresHarness<T>(
  work: (harness: RealPostgresHarness) => Promise<T>,
  options = parsePostgresHarnessOptions(),
) {
  return runWithIntegrationLifecycle(async (owner) => {
    const admin = postgres(options.adminDatabaseUrl, {
      ...createPostgresConnectionOptions("cli"),
      connect_timeout: Math.ceil(options.timeoutMs / 1_000),
      max: 1,
    });
    let databaseCreated = false;
    const databaseName = integrationResourceName(options.namespace, "pg");
    const databaseUrl = databaseUrlForDatabase(options.adminDatabaseUrl, databaseName);

    owner.deferCleanup(async () => {
      await admin.end();
    });
    owner.deferCleanup(async () => {
      if (!databaseCreated) {
        return;
      }
      await terminateDatabaseConnections(admin, databaseName).catch(() => undefined);
      await admin
        .unsafe(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`)
        .catch(async () => {
          await admin.unsafe(`drop database if exists ${quoteIdentifier(databaseName)}`);
        });
    });

    await admin`select 1`;
    await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
    const harness = createRealPostgresHarness({
      adminDatabaseUrl: options.adminDatabaseUrl,
      databaseName,
      databaseUrl,
      namespace: options.namespace,
      timeoutMs: options.timeoutMs,
    });
    return await work(harness);
  });
}

export function parsePostgresHarnessOptions(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): HarnessOptions {
  const options = parseIntegrationEntrypointOptions(argv, env);
  const adminDatabaseUrl = requireServiceUrl("DATABASE_URL", env);
  const allowRemote = env.INTEGRATION_TEST_ALLOW_REMOTE === "1";
  assertSafeIntegrationServiceUrl({
    allowRemote,
    name: "DATABASE_URL",
    requiredText: ["test", "integration", "issue", "local", "ci"],
    url: adminDatabaseUrl,
  });

  return {
    adminDatabaseUrl,
    allowRemote,
    namespace: `${options.namespace}_postgres`,
    timeoutMs: options.timeoutMs,
  };
}

function createRealPostgresHarness(input: {
  adminDatabaseUrl: string;
  databaseName: string;
  databaseUrl: string;
  namespace: string;
  timeoutMs: number;
}): RealPostgresHarness {
  return {
    adminUrl: redactUrl(input.adminDatabaseUrl),
    databaseName: input.databaseName,
    databaseUrl: redactUrl(input.databaseUrl),
    namespace: input.namespace,
    createClient(clientInput = {}) {
      return postgres(input.databaseUrl, {
        ...createPostgresConnectionOptions("app"),
        connect_timeout: Math.ceil(input.timeoutMs / 1_000),
        max: clientInput.max ?? 1,
      });
    },
    createQueryClient(clientInput = {}) {
      const sql = this.createClient(clientInput);
      const queryClient = createHarnessQueryClient(sql);
      return {
        ...queryClient,
        async end() {
          await sql.end();
        },
      };
    },
    async migrate(migrationFiles) {
      const sql = this.createClient();
      try {
        return await runLedgerBackedMigrations(
          createPostgresMigrationDatabase(sql),
          migrationFiles ?? (await loadMigrationFiles()),
        );
      } finally {
        await sql.end();
      }
    },
  };
}

type HarnessSql = {
  begin?<T>(callback: (sql: HarnessSql) => Promise<T>): Promise<T>;
  unsafe(statement: string, params?: readonly unknown[]): Promise<unknown[]>;
};

function createHarnessQueryClient(sql: HarnessSql, inTransaction = false) {
  return {
    inTransaction,
    async query<T>(query: string, params: readonly unknown[] = []) {
      return { rows: (await sql.unsafe(query, [...params])) as T[] };
    },
    async transaction<T>(
      callback: (client: {
        query<T>(query: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
      }) => Promise<T>,
    ) {
      if (!sql.begin) {
        throw new Error("Nested harness transactions are not supported.");
      }
      return (await sql.begin(async (transactionSql) =>
        callback(createHarnessQueryClient(transactionSql, true)),
      )) as T;
    },
  };
}

function createPostgresMigrationDatabase(sql: Sql): MigrationDatabase {
  return createPostgresMigrationDatabaseFromUnsafe(
    sql.unsafe.bind(sql) as PostgresUnsafe,
    async <T>(callback: (database: MigrationDatabase) => Promise<T>): Promise<T> =>
      (await sql.begin(async (transactionSql) =>
        callback(
          createPostgresMigrationDatabaseFromUnsafe(
            transactionSql.unsafe.bind(transactionSql) as PostgresUnsafe,
            async () => {
              throw new Error("Nested migration transactions are not supported.");
            },
          ),
        ),
      )) as T,
  );
}

type PostgresUnsafe = (
  statement: string,
  params?: readonly MigrationQueryValue[],
) => Promise<unknown[]>;

function createPostgresMigrationDatabaseFromUnsafe(
  unsafe: PostgresUnsafe,
  transaction: <T>(callback: (database: MigrationDatabase) => Promise<T>) => Promise<T>,
): MigrationDatabase {
  return {
    async query<T extends Record<string, unknown>>(
      statement: string,
      params: readonly MigrationQueryValue[] = [],
    ) {
      return (await unsafe(statement, params)) as T[];
    },
    async execute(statement: string) {
      await unsafe(statement);
    },
    transaction,
  };
}

function databaseUrlForDatabase(adminDatabaseUrl: string, databaseName: string) {
  const parsed = new URL(adminDatabaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function terminateDatabaseConnections(admin: Sql, databaseName: string) {
  await admin`
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = ${databaseName}
      and pid <> pg_backend_pid()
  `;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function integrationResourceName(namespace: string, kind: "pg") {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 18);
  const maxNamespaceLength = 63 - kind.length - nonce.length - 2;
  return `${namespace.slice(0, maxNamespaceLength)}_${kind}_${nonce}`;
}
